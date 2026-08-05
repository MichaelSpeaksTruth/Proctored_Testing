'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag } from '@/lib/proctoring';

// ── Hysteresis ───────────────────────────────────────────────────────────────
// Require N consecutive bad frames BEFORE opening a violation → kills false positives.
// Require M consecutive clean frames BEFORE closing a violation → prevents ping-pong.
const FRAMES_TO_START = 14;
const FRAMES_TO_CLEAR = 20;

// MediaPipe FaceMesh landmark indices (out of 468)
const IDX_NOSE_TIP   = 4;
const IDX_FOREHEAD   = 10;
const IDX_CHIN       = 152;
const IDX_LEFT_EAR   = 234;
const IDX_RIGHT_EAR  = 454;

interface Props {
  uid: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onViolation?: (flag: DurationFlag) => void;
  calibrationMode?: boolean;
  /** Optional canvas to draw face-mesh / object overlays on top of the video */
  overlayCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

type LM = { x: number; y: number; z: number };

export default function ProctoringMonitor({
  uid,
  videoRef,
  onViolation,
  calibrationMode = false,
  overlayCanvasRef,
}: Props) {
  // Active (ongoing) infractions map: event → { startTime, severity }
  const activeInfractions = useRef<Map<ProctoringEvent, { startTime: number; severity: Severity }>>(
    new Map()
  );

  // Hysteresis counters per event
  const hys = useRef<Map<ProctoringEvent, { v: number; c: number }>>(new Map());
  const getHys = (e: ProctoringEvent) => {
    if (!hys.current.has(e)) hys.current.set(e, { v: 0, c: 0 });
    return hys.current.get(e)!;
  };

  // ── Core infraction open/close ─────────────────────────────────────────────
  const openInfraction = useCallback(
    (event: ProctoringEvent, severity: Severity) => {
      if (activeInfractions.current.has(event)) return;
      activeInfractions.current.set(event, { startTime: Date.now(), severity });
    },
    []
  );

  const closeInfraction = useCallback(
    (event: ProctoringEvent) => {
      const record = activeInfractions.current.get(event);
      if (!record) return;
      const endMs = Date.now();
      const durationInSeconds = Math.round((endMs - record.startTime) / 1000);
      activeInfractions.current.delete(event);
      if (durationInSeconds < 1) return;
      const flag: DurationFlag = {
        event,
        severity: record.severity,
        startTime: new Date(record.startTime).toISOString(),
        endTime: new Date(endMs).toISOString(),
        durationInSeconds,
      };
      onViolation?.(flag);
      if (!calibrationMode) push(ref(rtdb, `proctoringFlags/${uid}`), flag);
    },
    [uid, onViolation, calibrationMode]
  );

  // ── Hysteresis-gated report (call every frame) ────────────────────────────
  const report = useCallback(
    (event: ProctoringEvent, violating: boolean, severity: Severity) => {
      const h = getHys(event);
      if (violating) {
        h.v++;
        h.c = 0;
        if (h.v >= FRAMES_TO_START) openInfraction(event, severity);
      } else {
        h.c++;
        h.v = Math.max(0, h.v - 2); // gradual decay
        if (h.c >= FRAMES_TO_CLEAR) {
          closeInfraction(event);
          h.v = 0;
          h.c = 0;
        }
      }
    },
    [openInfraction, closeInfraction]
  );

  useEffect(() => {
    let camera: { start: () => void; stop: () => void } | null = null;
    let audioCtx: AudioContext | null = null;
    let audioStream: MediaStream | null = null;
    let faceMeshInst: { close: () => void } | null = null;
    let rafId: number | null = null;
    let cocoTimer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    // Ambient noise calibration state
    let ambientBaseline = 0.06;
    let calibFrames = 0;
    let calibSum = 0;
    const CALIB_FRAMES = 60; // ~2s

    // ── 1. Tab Switch & Fullscreen (discrete — bypass hysteresis) ─────────────
    const onVisibility = () => {
      if (document.hidden) {
        openInfraction('TAB_SWITCHED', 'critical');
      } else {
        closeInfraction('TAB_SWITCHED');
      }
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        openInfraction('LEFT_FULLSCREEN', 'high');
      } else {
        closeInfraction('LEFT_FULLSCREEN');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);

    // ── 2. Phone / Object Detection (COCO-SSD) ────────────────────────────────
    const initCoco = async () => {
      if (!mounted) return;
      try {
        await import('@tensorflow/tfjs');
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        // mobilenet_v2 is much more accurate than lite for real-world objects
        const model = await cocoSsd.load({ base: 'mobilenet_v2' });

        const CHEAT_CLASSES = new Set([
          'cell phone', 'remote', 'book', 'laptop',
        ]);

        let detecting = false;
        cocoTimer = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || detecting)
            return;
          try {
            detecting = true;
            const preds = await model.detect(videoRef.current);

            // Draw bounding boxes on overlay canvas
            if (overlayCanvasRef?.current) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              if (gx && videoRef.current.videoWidth > 0) {
                const sx = cv.width / videoRef.current.videoWidth;
                const sy = cv.height / videoRef.current.videoHeight;
                preds.forEach((p) => {
                  if (p.score < 0.45) return;
                  const isCheat = CHEAT_CLASSES.has(p.class);
                  const [bx, by, bw, bh] = p.bbox;
                  gx.strokeStyle = isCheat ? '#ff3333' : '#33ff99';
                  gx.lineWidth = 2;
                  gx.strokeRect(bx * sx, by * sy, bw * sx, bh * sy);
                  gx.fillStyle = isCheat ? 'rgba(255,51,51,0.7)' : 'rgba(51,255,153,0.7)';
                  gx.font = 'bold 11px monospace';
                  gx.fillText(
                    `${p.class} ${(p.score * 100).toFixed(0)}%`,
                    bx * sx + 2,
                    by * sy - 4
                  );
                });
              }
            }

            const phoneDetected = preds.some(
              (p) => CHEAT_CLASSES.has(p.class) && p.score > 0.58
            );
            report('PHONE_DETECTED', phoneDetected, 'critical');
          } catch {
            /* ignore */
          } finally {
            detecting = false;
          }
        }, 2500);
      } catch (e) {
        console.warn('[Proctor] COCO-SSD load failed:', e);
      }
    };
    initCoco();

    // ── 3. FaceMesh + Head Pose + Gaze ────────────────────────────────────────
    const initFace = async () => {
      if (!mounted) return;
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        const { Camera } = await import('@mediapipe/camera_utils');

        const faceMesh = new FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 4,
          refineLandmarks: true,          // uses iris refine model — much more accurate
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });

        faceMesh.onResults((results: { multiFaceLandmarks: LM[][] }) => {
          if (!mounted) return;
          const count = results.multiFaceLandmarks.length;

          // Face count check with hysteresis
          report('INVALID_FACE_COUNT', count !== 1, count === 0 ? 'medium' : 'critical');

          if (overlayCanvasRef?.current) {
            const cv = overlayCanvasRef.current;
            const gx = cv.getContext('2d');
            const W = cv.width;
            const H = cv.height;

            if (gx && W > 0 && H > 0) {
              if (count === 0) {
                // No face warning overlay
                gx.fillStyle = 'rgba(255,60,60,0.18)';
                gx.fillRect(0, 0, W, H);
                gx.fillStyle = '#ff4444';
                gx.font = 'bold 16px monospace';
                gx.textAlign = 'center';
                gx.fillText('⚠ NO FACE DETECTED', W / 2, H / 2);
                gx.textAlign = 'left';
              } else if (count > 1) {
                gx.fillStyle = 'rgba(255,60,60,0.18)';
                gx.fillRect(0, 0, W, H);
                gx.fillStyle = '#ff4444';
                gx.font = 'bold 16px monospace';
                gx.textAlign = 'center';
                gx.fillText(`⚠ MULTIPLE FACES (${count})`, W / 2, H / 2);
                gx.textAlign = 'left';
              }
            }
          }

          // Head pose + gaze tracking when exactly 1 face
          if (count === 1) {
            const lm = results.multiFaceLandmarks[0];
            const noseTip  = lm[IDX_NOSE_TIP];
            const leftEar  = lm[IDX_LEFT_EAR];
            const rightEar = lm[IDX_RIGHT_EAR];
            const forehead = lm[IDX_FOREHEAD];
            const chin     = lm[IDX_CHIN];

            // Yaw: how far the nose is from the centre between ears
            const faceW = rightEar.x - leftEar.x;
            const yawRatio = faceW > 0.01
              ? (noseTip.x - leftEar.x) / faceW   // 0=full-left, 0.5=forward, 1=full-right
              : 0.5;

            // Pitch: nose position within forehead-chin span
            const faceH = chin.y - forehead.y;
            const pitchRatio = faceH > 0.01
              ? (noseTip.y - forehead.y) / faceH   // 0=up, 0.5=level, 1=down
              : 0.5;

            // >±30° yaw or >30° pitch down / >15° pitch up → looking away
            const yawDeg   = (yawRatio - 0.5) * 90;
            const pitchDeg = (pitchRatio - 0.5) * 90;
            const gazeAway = Math.abs(yawDeg) > 28 || pitchDeg > 30 || pitchDeg < -18;

            report('GAZE_AWAY', gazeAway, 'medium');

            // Draw landmarks + gaze HUD on overlay canvas
            if (overlayCanvasRef?.current) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              const W = cv.width;
              const H = cv.height;
              if (gx && W > 0) {
                const dotColor = gazeAway ? 'rgba(255,120,0,0.85)' : 'rgba(0,255,120,0.85)';
                gx.fillStyle = dotColor;
                // Draw every 4th landmark for performance
                for (let i = 0; i < lm.length; i += 4) {
                  const p = lm[i];
                  gx.beginPath();
                  gx.arc(p.x * W, p.y * H, 1.2, 0, Math.PI * 2);
                  gx.fill();
                }

                // Gaze direction arrow from nose tip
                gx.strokeStyle = gazeAway ? '#ff7800' : '#00ff78';
                gx.lineWidth = 2.5;
                gx.beginPath();
                const nx = noseTip.x * W;
                const ny = noseTip.y * H;
                const arrowScale = 60;
                const ax = nx + (yawDeg / 45) * arrowScale;
                const ay = ny + (pitchDeg / 45) * arrowScale;
                gx.moveTo(nx, ny);
                gx.lineTo(ax, ay);
                gx.stroke();
                // Arrowhead
                const angle = Math.atan2(ay - ny, ax - nx);
                gx.beginPath();
                gx.moveTo(ax, ay);
                gx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
                gx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
                gx.closePath();
                gx.fillStyle = gazeAway ? '#ff7800' : '#00ff78';
                gx.fill();

                // HUD text bottom-left
                gx.font = 'bold 12px monospace';
                gx.fillStyle = gazeAway ? '#ff7800' : '#00ff78';
                const gazeLabel = gazeAway
                  ? `⚠ GAZE AWAY  Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`
                  : `✓ FACE OK    Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`;
                gx.fillText(gazeLabel, 6, H - 8);
              }
            }
          }
        });

        faceMeshInst = faceMesh;
        let processing = false;

        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (!videoRef.current || !mounted || processing) return;
              try {
                processing = true;
                // Sync canvas dimensions once per frame
                if (overlayCanvasRef?.current && videoRef.current.videoWidth > 0) {
                  const cv = overlayCanvasRef.current;
                  if (cv.width !== videoRef.current.videoWidth)
                    cv.width = videoRef.current.videoWidth;
                  if (cv.height !== videoRef.current.videoHeight)
                    cv.height = videoRef.current.videoHeight;
                  // Clear before each render pass
                  cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
                }
                await faceMesh.send({ image: videoRef.current });
              } catch {
                /* suppress */
              } finally {
                processing = false;
              }
            },
            width: 640,
            height: 480,
          });
          camera.start();
        }
      } catch (e) {
        console.warn('[Proctor] FaceMesh load failed:', e);
      }
    };
    initFace();

    // ── 4. Audio Analysis + Camera-covered Check ──────────────────────────────
    const initAudio = async () => {
      if (!mounted) return;
      const hiddenCv = document.createElement('canvas');
      hiddenCv.width = 64;
      hiddenCv.height = 64;
      const hCtx = hiddenCv.getContext('2d', { willReadFrequently: true });

      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        audioCtx.createMediaStreamSource(audioStream).connect(analyser);

        const timeBuf  = new Float32Array(analyser.frequencyBinCount);
        const freqBuf  = new Uint8Array(analyser.frequencyBinCount);
        let quietFrames = 0;

        const tick = () => {
          if (!mounted) return;

          // RMS of time-domain signal
          analyser.getFloatTimeDomainData(timeBuf);
          let sumSq = 0;
          for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
          const rms = Math.sqrt(sumSq / timeBuf.length);

          // Phase 1: ambient calibration (first ~2s)
          if (calibFrames < CALIB_FRAMES) {
            calibSum += rms;
            calibFrames++;
            if (calibFrames === CALIB_FRAMES) {
              // Baseline = 3× the ambient RMS, clamped to reasonable range
              ambientBaseline = Math.max(0.045, Math.min(0.14, (calibSum / CALIB_FRAMES) * 3.2));
            }
          } else {
            // Phase 2: speech frequency energy (300–3500 Hz) check
            analyser.getByteFrequencyData(freqBuf);
            const binHz    = (audioCtx!.sampleRate / 2) / freqBuf.length;
            const lo = Math.floor(300  / binHz);
            const hi = Math.min(Math.floor(3500 / binHz), freqBuf.length - 1);
            let speechSum = 0;
            for (let i = lo; i <= hi; i++) speechSum += freqBuf[i];
            const speechAvg = speechSum / (hi - lo + 1);

            const isLoud = rms > ambientBaseline || speechAvg > 72;

            if (isLoud) {
              openInfraction('LOUD_AUDIO', 'medium');
              quietFrames = 0;
            } else {
              quietFrames++;
              if (quietFrames > 40) closeInfraction('LOUD_AUDIO');
            }
          }

          // Camera covered: check average frame luminance
          if (hCtx && videoRef.current && videoRef.current.readyState === 4) {
            hCtx.drawImage(videoRef.current, 0, 0, 64, 64);
            const pixels = hCtx.getImageData(0, 0, 64, 64).data;
            let lum = 0;
            for (let i = 0; i < pixels.length; i += 4)
              lum += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
            report('CAMERA_COVERED', (lum / (64 * 64)) < 12, 'critical');
          }

          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.warn('[Proctor] Microphone access failed:', e);
      }
    };
    initAudio();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);

      // Flush any active infractions
      const endMs = Date.now();
      activeInfractions.current.forEach((val, event) => {
        const dur = Math.round((endMs - val.startTime) / 1000);
        if (dur >= 1 && !calibrationMode) {
          push(ref(rtdb, `proctoringFlags/${uid}`), {
            event,
            severity: val.severity,
            startTime: new Date(val.startTime).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationInSeconds: dur,
          });
        }
      });
      activeInfractions.current.clear();

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cocoTimer !== null) clearInterval(cocoTimer);
      if (camera) camera.stop();
      if (faceMeshInst) faceMeshInst.close();
      if (audioCtx) audioCtx.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return null;
}
