'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag } from '@/lib/proctoring';

// ── Hysteresis ────────────────────────────────────────────────────────────────
// Requiring sustained violating frames prevents momentary twitches or frame drops
const FRAMES_TO_START = 16;
const FRAMES_TO_CLEAR = 18;

// MediaPipe FaceMesh landmark indices (out of 468)
const IDX_NOSE_TIP  = 4;
const IDX_FOREHEAD  = 10;
const IDX_CHIN      = 152;
const IDX_NOSE_BRIDGE = 168;
const IDX_LEFT_EAR  = 234;
const IDX_RIGHT_EAR = 454;

// COCO-SSD verified classes for external devices
const PHONE_CLASSES: Record<string, number> = {
  'cell phone': 0.52,
};

/**
 * Captures a small, compressed JPEG thumbnail directly from the webcam element.
 * Typical size is ~6-10 KB, safe for Firebase Realtime Database and instant for admin review.
 */
function captureSnapshot(videoEl: HTMLVideoElement | null): string | undefined {
  if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return undefined;
  try {
    const canvas = document.createElement('canvas');
    const targetW = 320;
    const targetH = Math.round((videoEl.videoHeight / videoEl.videoWidth) * targetW) || 240;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(videoEl, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.5);
  } catch {
    return undefined;
  }
}

export interface MonitorStatus {
  faceDetected: boolean;
  cameraCovered: boolean;
  micWorking: boolean;
}

interface Props {
  uid: string;
  testId?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onViolation?: (flag: DurationFlag) => void;
  onViolationStart?: (event: ProctoringEvent, severity: Severity) => void;
  onViolationClear?: (event: ProctoringEvent) => void;
  onStatusChange?: (status: MonitorStatus) => void;
  calibrationMode?: boolean;
  isSubmitting?: boolean;
  overlayCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  onAlignmentUpdate?: (aligned: boolean) => void;
  /** Parent's MediaStream — audio track is reused to avoid opening a second getUserMedia session */
  stream?: MediaStream | null;
  /** When true, skips heavy ML models (COCO-SSD) to prevent OOM on low-RAM devices */
  isMobile?: boolean;
}

type LM = { x: number; y: number; z: number };

export default function ProctoringMonitor({
  uid,
  testId,
  videoRef,
  onViolation,
  onViolationStart,
  onViolationClear,
  onStatusChange,
  calibrationMode = false,
  isSubmitting = false,
  overlayCanvasRef,
  onAlignmentUpdate,
  stream,
  isMobile = false,
}: Props) {

  const activeInfractions = useRef<Map<ProctoringEvent, { 
    startTime: number; 
    severity: Severity; 
    evidenceSnapshot?: string; 
  }>>(new Map());
  
  const lastAlignment = useRef(false);
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  const isMobileRef = useRef(isMobile);
  const streamRef = useRef<MediaStream | null>(stream ?? null);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  useEffect(() => { streamRef.current = stream ?? null; }, [stream]);

  const hys = useRef<Map<ProctoringEvent, { v: number; c: number }>>(new Map());
  const getHys = (e: ProctoringEvent) => {
    if (!hys.current.has(e)) hys.current.set(e, { v: 0, c: 0 });
    return hys.current.get(e)!;
  };

  const lastStatus = useRef<MonitorStatus>({ faceDetected: false, cameraCovered: false, micWorking: false });
  const pushStatus = useCallback((updates: Partial<MonitorStatus>) => {
    let changed = false;
    const next = { ...lastStatus.current };
    if (updates.faceDetected !== undefined && updates.faceDetected !== next.faceDetected) { next.faceDetected = updates.faceDetected; changed = true; }
    if (updates.cameraCovered !== undefined && updates.cameraCovered !== next.cameraCovered) { next.cameraCovered = updates.cameraCovered; changed = true; }
    if (updates.micWorking !== undefined && updates.micWorking !== next.micWorking) { next.micWorking = updates.micWorking; changed = true; }
    if (changed) {
      lastStatus.current = next;
      onStatusChange?.(next);
    }
  }, [onStatusChange]);

  // DB path: proctoringFlags/{uid}/{testId}/flags
  const flagPath = useCallback(() => {
    if (calibrationMode) return `proctoringFlags/calibration`;
    return testId
      ? `proctoringFlags/${uid}/${testId}/flags`
      : `proctoringFlags/${uid}/flags`;
  }, [uid, testId, calibrationMode]);

  const openInfraction = useCallback(
    (event: ProctoringEvent, severity: Severity) => {
      if (activeInfractions.current.has(event)) return;

      // Capture lightweight snapshot evidence for critical/hard infractions
      let snapshot: string | undefined = undefined;
      if (event === 'MULTIPLE_FACES' || event === 'PHONE_DETECTED' || event === 'CAMERA_COVERED') {
        snapshot = captureSnapshot(videoRef.current);
      }

      activeInfractions.current.set(event, { 
        startTime: Date.now(), 
        severity, 
        evidenceSnapshot: snapshot 
      });
      onViolationStart?.(event, severity);
    },
    [onViolationStart, videoRef]
  );

  const closeInfraction = useCallback(
    (event: ProctoringEvent) => {
      const record = activeInfractions.current.get(event);
      if (!record) return;
      const endMs = Date.now();
      const durationInSeconds = Math.round((endMs - record.startTime) / 1000);
      activeInfractions.current.delete(event);
      onViolationClear?.(event);
      
      const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY';
      // Minimum duration filters to ignore momentary glances or twitches
      if (isSlowEvent && durationInSeconds < 4) return;
      if (!isSlowEvent && durationInSeconds < 2) return;
      
      // Capture snapshot if face was missing for sustained duration (> 4s)
      let snapshot = record.evidenceSnapshot;
      if (!snapshot && (event === 'NO_FACE' || isSlowEvent) && durationInSeconds >= 5) {
        snapshot = captureSnapshot(videoRef.current);
      }

      const flag: DurationFlag = {
        event,
        severity: record.severity,
        startTime: new Date(record.startTime).toISOString(),
        endTime: new Date(endMs).toISOString(),
        durationInSeconds,
        ...(snapshot ? { evidenceSnapshot: snapshot } : {}),
      };
      onViolation?.(flag);
      if (!calibrationMode) push(ref(rtdb, flagPath()), flag);
    },
    [calibrationMode, flagPath, onViolation, videoRef]
  );

  const report = useCallback(
    (event: ProctoringEvent, violating: boolean, severity: Severity) => {
      const h = getHys(event);
      if (violating) {
        h.v++;
        h.c = 0;
        if (h.v === FRAMES_TO_START) openInfraction(event, severity);
      } else {
        h.c++;
        h.v = Math.max(0, h.v - 2);
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
    let fmRaf: number | null = null;
    let audioCtx: AudioContext | null = null;
    let audioStream: MediaStream | null = null;
    let faceMeshInst: { close: () => void; send: (options: { image: HTMLVideoElement }) => Promise<void> } | null = null;
    let rafId: number | null = null;
    let cocoTimer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    // ── Dynamic Audio Baseline ──
    let ambientBaseline = 0.05;
    let calibFrames = 0;
    let calibSum = 0;
    const CALIB_FRAMES = 120; // ~2-3 seconds initial calibration

    // ── 1. Tab & Window monitoring ────────────────────────────────────────────
    let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (isSubmittingRef.current) return;
      if (document.hidden) {
        if (visibilityTimeout) { clearTimeout(visibilityTimeout); visibilityTimeout = null; }
        openInfraction('TAB_SWITCHED', 'critical');
      } else {
        const buffer = isMobileRef.current ? 3000 : 1500;
        visibilityTimeout = setTimeout(() => {
          closeInfraction('TAB_SWITCHED');
        }, buffer);
      }
    };

    const onFullscreen = () => {
      if (isSubmittingRef.current) return;
      if (!document.fullscreenElement) {
        openInfraction('LEFT_FULLSCREEN', 'high');
      } else {
        closeInfraction('LEFT_FULLSCREEN');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);

    const flushInfractions = () => {
      const endMs = Date.now();
      activeInfractions.current.forEach((val, event) => {
        const dur = Math.round((endMs - val.startTime) / 1000);
        const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY';
        const isValid = (isSlowEvent && dur >= 4) || (!isSlowEvent && dur >= 2);
        if (isValid && !calibrationMode) {
          const snapshot = val.evidenceSnapshot || (dur >= 4 ? captureSnapshot(videoRef.current) : undefined);
          push(ref(rtdb, flagPath()), {
            event, 
            severity: val.severity,
            startTime: new Date(val.startTime).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationInSeconds: dur,
            ...(snapshot ? { evidenceSnapshot: snapshot } : {}),
          });
        }
      });
      activeInfractions.current.clear();
    };
    window.addEventListener('beforeunload', flushInfractions);

    // Global catch for MediaPipe crashes
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      if (e.reason && e.reason.message && e.reason.message.includes('mediapipe')) {
        openInfraction('CAMERA_COVERED', 'critical');
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    // ── 2. Verified AI Object Detection (COCO-SSD) ───────────────────────────
    const DETECT_W = 384, DETECT_H = 384;
    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = DETECT_W;
    detectCanvas.height = DETECT_H;
    const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });

    const initCoco = async () => {
      if (!mounted) return;
      try {
        const tf = await import('@tensorflow/tfjs');
        const backends = ['webgl', 'wasm', 'cpu'] as const;
        let backendReady = false;
        for (const backend of backends) {
          try {
            await tf.setBackend(backend);
            await tf.ready();
            backendReady = true;
            break;
          } catch {
            console.warn(`[Proctor] TF backend '${backend}' failed, trying next...`);
          }
        }
        if (!backendReady) throw new Error('No TF backend available');

        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        const model = await cocoSsd.load({ base: 'mobilenet_v2' });

        if (mounted && videoRef.current && videoRef.current.readyState === 4) {
          try { await model.detect(videoRef.current); } catch { /* ok */ }
        }

        let detecting = false;
        cocoTimer = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || detecting) return;
          try {
            detecting = true;
            if (detectCtx && videoRef.current.videoWidth > 0) {
              detectCtx.drawImage(videoRef.current, 0, 0, DETECT_W, DETECT_H);
            }
            let preds: import('@tensorflow-models/coco-ssd').DetectedObject[] = [];
            
            tf.engine().startScope();
            try {
              preds = await model.detect(detectCanvas);
            } finally {
              tf.engine().endScope();
            }

            const phoneDetected = preds.some((p) => {
              const thr = PHONE_CLASSES[p.class];
              return thr !== undefined && p.score >= thr;
            });

            // Report through hysteresis debouncer to prevent single-frame anomalies
            report('PHONE_DETECTED', phoneDetected, 'critical');

            // Draw bounding boxes on overlay canvas for active visual verification
            if (overlayCanvasRef?.current && videoRef.current.videoWidth > 0) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              if (gx) {
                const sx = cv.width / DETECT_W;
                const sy = cv.height / DETECT_H;
                preds.forEach((p) => {
                  if (p.score < 0.45) return;
                  const isCheat = p.class in PHONE_CLASSES;
                  const [bx, by, bw, bh] = p.bbox;
                  gx.strokeStyle = isCheat ? '#ff2200' : 'rgba(34,255,136,0.6)';
                  gx.lineWidth   = isCheat ? 2.5 : 1;
                  gx.strokeRect(bx * sx, by * sy, bw * sx, bh * sy);
                  if (isCheat) {
                    gx.fillStyle = 'rgba(255,34,0,0.85)';
                    gx.font = 'bold 12px monospace';
                    gx.fillText(
                      `${p.class.toUpperCase()} ${(p.score * 100).toFixed(0)}%`,
                      bx * sx + 2,
                      by * sy > 14 ? by * sy - 4 : by * sy + bh * sy + 12
                    );
                  }
                });
              }
            }
          } catch {
            /* suppress */
          } finally {
            detecting = false;
          }
        }, 1200);
      } catch (e) {
        console.warn('[Proctor] COCO-SSD load failed:', e);
      }
    };

    // Skip heavy secondary ML models on mobile OR low-RAM/low-core devices (<= 4GB RAM or <= 4 CPU cores)
    // to prevent browser tab crashes (OOM) and guarantee smooth 60fps UI performance.
    const isLowEndHardware =
      typeof navigator !== 'undefined' &&
      (navigator.hardwareConcurrency <= 4 ||
        Boolean((navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4));
    if (!isMobileRef.current && !isLowEndHardware) {
      initCoco();
    }

    // ── 3. FaceMesh + Head Pose + Gaze ────────────────────────────────────────
    const initFace = async () => {
      if (!mounted) return;
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');

        const faceMesh = new FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 3,
          refineLandmarks: true,
          minDetectionConfidence: 0.60,
          minTrackingConfidence: 0.60,
        });

        faceMesh.onResults((results: { multiFaceLandmarks: LM[][] }) => {
          if (!mounted) return;
          const count = results.multiFaceLandmarks.length;
          report('NO_FACE', count === 0, 'medium');
          report('MULTIPLE_FACES', count > 1, 'critical');
          pushStatus({ faceDetected: count === 1 });

          if (overlayCanvasRef?.current) {
            const cv = overlayCanvasRef.current;
            const gx = cv.getContext('2d');
            const W = cv.width, H = cv.height;
            if (gx && W > 0 && H > 0 && count !== 1) {
              gx.fillStyle = 'rgba(255,50,50,0.15)';
              gx.fillRect(0, 0, W, H);
              gx.fillStyle = '#ff4444';
              gx.font = 'bold 15px monospace';
              gx.textAlign = 'center';
              gx.fillText(
                count === 0 ? 'NO FACE DETECTED' : `${count} FACES DETECTED`,
                W / 2, H / 2
              );
              gx.textAlign = 'left';
            }
          }

          if (count === 1) {
            const lm = results.multiFaceLandmarks[0];
            const noseTip  = lm[IDX_NOSE_TIP];
            const leftEar  = lm[IDX_LEFT_EAR];
            const rightEar = lm[IDX_RIGHT_EAR];
            const forehead = lm[IDX_FOREHEAD];
            const chin     = lm[IDX_CHIN];

            const faceW = rightEar.x - leftEar.x;
            const yawRatio   = faceW > 0.01 ? (noseTip.x - leftEar.x) / faceW : 0.5;
            const faceH      = chin.y - forehead.y;
            const pitchRatio = faceH > 0.01 ? (noseTip.y - forehead.y) / faceH : 0.5;
            const yawDeg     = (yawRatio - 0.5) * 90;
            const pitchDeg   = (pitchRatio - 0.5) * 90;

            // Natural gaze leeway: allow reading across entire screen & reading options
            const gazeAway   = Math.abs(yawDeg) > 35 || pitchDeg > 28 || pitchDeg < -24;
            report('GAZE_AWAY', gazeAway, 'medium');

            // ── Head Pitch (Looking down into lap / phone on lap) ──
            const calculateHeadPitch = (landmarks: LM[]) => {
              const f = landmarks[IDX_FOREHEAD];
              const c = landmarks[IDX_CHIN];
              const theta = Math.atan2(f.z - c.z, c.y - f.y);
              return theta * (180 / Math.PI);
            };
            const headPitchDegrees = calculateHeadPitch(lm);
            
            // Forehead and chin landmarks
            const foreheadPt = lm[IDX_FOREHEAD];
            const chinPt = lm[IDX_CHIN];
            
            // Head vs chin mass ratio
            const headMass = Math.abs(foreheadPt.y - noseTip.y);
            const lowerMass = Math.abs(chinPt.y - noseTip.y);
            const headVsChinRatio = lowerMass > 0.001 ? headMass / lowerMass : 1.0;
            
            // Ducking: chin drops out of frame completely or extreme crouch
            const isDucking = (chinPt.y > 0.98 && foreheadPt.y < 0.90) || (headVsChinRatio > 1.85);

            // Shoulder proxy alignment
            const isShouldersOut = chinPt.y > 0.88;

            // Realistic pitch down: When looking at lap/knees, pitch angle is steep (< -28°) and pitchDeg is pronounced
            const PITCH_DOWN_THRESHOLD = -28;
            const isPitchDown = headPitchDegrees < PITCH_DOWN_THRESHOLD && pitchDeg > 12;
            
            report('HEAD_PITCH_DOWN', isPitchDown, 'medium');
            report('DUCKING_DOWN', isDucking, 'high');
            report('SHOULDERS_OUT_OF_FRAME', isShouldersOut, 'medium');

            if (overlayCanvasRef?.current) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              const W = cv.width, H = cv.height;
              if (gx && W > 0) {
                gx.fillStyle = gazeAway ? 'rgba(255,120,0,0.85)' : 'rgba(0,255,120,0.85)';
                for (let i = 0; i < lm.length; i += 4) {
                  gx.beginPath();
                  gx.arc(lm[i].x * W, lm[i].y * H, 1.2, 0, Math.PI * 2);
                  gx.fill();
                }
                const nx = noseTip.x * W, ny = noseTip.y * H;
                const ax = nx + (yawDeg / 45) * 60, ay = ny + (pitchDeg / 45) * 60;
                gx.strokeStyle = gazeAway ? '#ff7800' : '#00ff78';
                gx.lineWidth = 2.5;
                gx.beginPath(); gx.moveTo(nx, ny); gx.lineTo(ax, ay); gx.stroke();
                const ang = Math.atan2(ay - ny, ax - nx);
                gx.beginPath();
                gx.moveTo(ax, ay);
                gx.lineTo(ax - 8 * Math.cos(ang - 0.4), ay - 8 * Math.sin(ang - 0.4));
                gx.lineTo(ax - 8 * Math.cos(ang + 0.4), ay - 8 * Math.sin(ang + 0.4));
                gx.closePath();
                gx.fillStyle = gazeAway ? '#ff7800' : '#00ff78';
                gx.fill();
                gx.font = 'bold 12px monospace';
                gx.fillStyle = gazeAway ? '#ff7800' : '#00ff78';
                gx.fillText(
                  gazeAway
                    ? `GAZE AWAY  Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`
                    : `FACE OK    Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`,
                  6, H - 8
                );
                
                if (isPitchDown) {
                  gx.fillStyle = '#ff2200';
                  gx.fillText(`LOOKING DOWN (PITCH: ${headPitchDegrees.toFixed(1)}°)`, 6, H - 24);
                }
                
                if (isDucking) {
                  gx.fillStyle = '#ff0000';
                  gx.fillText(`FACE CROUCHED`, 6, H - 40);
                }
                
                // ── Calibration Geometric Centering ──
                if (calibrationMode) {
                  const isCenteredX = noseTip.x > 0.32 && noseTip.x < 0.68;
                  const isCenteredY = noseTip.y > 0.28 && noseTip.y < 0.72;
                  const isProximityGood = (chin.y - forehead.y) > 0.22;
                  
                  const isAligned = isCenteredX && isCenteredY && isProximityGood;
                  
                  if (lastAlignment.current !== isAligned) {
                    lastAlignment.current = isAligned;
                    onAlignmentUpdate?.(isAligned);
                  }
                }
              }
            }
          }
        });

        faceMeshInst = faceMesh;
        let processing = false;

        if (videoRef.current) {
          let lastFrameTime = 0;
          const processFrame = async () => {
            if (!videoRef.current || !mounted || !faceMeshInst) return;
            
            const video = videoRef.current;
            if (video.readyState >= 2 && !video.paused && !video.ended) {
              const now = Date.now();
              // Throttle AI inference to ~12 FPS (83ms delta) to save CPU/RAM
              if (!processing && now - lastFrameTime >= 83) {
                lastFrameTime = now;
                try {
                  processing = true;
                  if (overlayCanvasRef?.current && video.videoWidth > 0) {
                    const cv = overlayCanvasRef.current;
                    if (cv.width !== video.videoWidth) cv.width = video.videoWidth;
                    if (cv.height !== video.videoHeight) cv.height = video.videoHeight;
                    cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
                  }
                  await faceMeshInst.send({ image: video });
                } catch { /* suppress */ } finally {
                  processing = false;
                }
              }
            }
            fmRaf = requestAnimationFrame(processFrame);
          };
          processFrame();
        }
      } catch (e) {
        console.warn('[Proctor] FaceMesh load failed:', e);
      }
    };
    initFace();

    // ── 4. Audio + Camera-covered ─────────────────────────────────────────────
    const initAudio = async () => {
      if (!mounted) return;
      const hiddenCv = document.createElement('canvas');
      hiddenCv.width = 64; hiddenCv.height = 64;
      const hCtx = hiddenCv.getContext('2d', { willReadFrequently: true });

      try {
        if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
          audioStream = new MediaStream(streamRef.current.getAudioTracks());
        } else {
          audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }

        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        audioCtx.createMediaStreamSource(audioStream).connect(analyser);

        const timeBuf = new Float32Array(analyser.frequencyBinCount);
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!mounted) return;
          analyser.getFloatTimeDomainData(timeBuf);
          let sumSq = 0;
          for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
          const rms = Math.sqrt(sumSq / timeBuf.length);
          
          const isMuted = !audioStream || audioStream.getAudioTracks().length === 0 || audioStream.getAudioTracks()[0].readyState !== 'live';
          report('MIC_MUTED', isMuted, 'critical');
          pushStatus({ micWorking: !isMuted });

          if (calibFrames < CALIB_FRAMES) {
            calibSum += rms; calibFrames++;
            if (calibFrames === CALIB_FRAMES) {
              ambientBaseline = Math.max(0.03, Math.min(0.12, (calibSum / CALIB_FRAMES) * 1.5));
            }
          } else {
            // Adaptive smoothing to dynamic ambient room sound (fan, AC)
            ambientBaseline = ambientBaseline * 0.998 + rms * 0.002;

            analyser.getByteFrequencyData(freqBuf);
            const binHz = (audioCtx!.sampleRate / 2) / freqBuf.length;
            // Human voice fundamental frequencies: ~300Hz to 3000Hz
            const lo = Math.floor(300  / binHz);
            const hi = Math.min(Math.floor(3000 / binHz), freqBuf.length - 1);
            let sp = 0;
            for (let i = lo; i <= hi; i++) sp += freqBuf[i];
            const avgSpeechBand = sp / (hi - lo + 1);

            // Require both significant volume above ambient AND speech frequency energy
            const isLoud = rms > Math.max(0.08, ambientBaseline * 2.8) && avgSpeechBand > 78;
            report('LOUD_AUDIO', isLoud, 'medium');
          }

          // Camera covered
          if (hCtx && videoRef.current && videoRef.current.readyState >= 2) {
            hCtx.drawImage(videoRef.current, 0, 0, 64, 64);
            const px = hCtx.getImageData(0, 0, 64, 64).data;
            let lum = 0;
            for (let i = 0; i < px.length; i += 4)
              lum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
            const covered = (lum / (64 * 64)) < 10;
            report('CAMERA_COVERED', covered, 'critical');
            pushStatus({ cameraCovered: covered });
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
      window.removeEventListener('beforeunload', flushInfractions);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      if (visibilityTimeout) clearTimeout(visibilityTimeout);

      const endMs = Date.now();
      activeInfractions.current.forEach((val, event) => {
        const dur = Math.round((endMs - val.startTime) / 1000);
        const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY';
        const isValid = (isSlowEvent && dur >= 4) || (!isSlowEvent && dur >= 2);
        if (isValid && !calibrationMode) {
          const snapshot = val.evidenceSnapshot || (dur >= 4 ? captureSnapshot(videoRef.current) : undefined);
          push(ref(rtdb, flagPath()), {
            event, 
            severity: val.severity,
            startTime: new Date(val.startTime).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationInSeconds: dur,
            ...(snapshot ? { evidenceSnapshot: snapshot } : {}),
          });
        }
      });
      activeInfractions.current.clear();

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cocoTimer !== null) clearInterval(cocoTimer);
      if (fmRaf !== null) cancelAnimationFrame(fmRaf);
      if (faceMeshInst) faceMeshInst.close();
      if (audioCtx) audioCtx.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, testId]);

  return null;
}
