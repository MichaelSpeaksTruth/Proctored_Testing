'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag } from '@/lib/proctoring';

// ── Hysteresis ────────────────────────────────────────────────────────────────
const FRAMES_TO_START = 14;
const FRAMES_TO_CLEAR = 20;

// MediaPipe FaceMesh landmark indices (out of 468)
const IDX_NOSE_TIP  = 4;
const IDX_FOREHEAD  = 10;
const IDX_CHIN      = 152;
const IDX_LEFT_EAR  = 234;
const IDX_RIGHT_EAR = 454;

// COCO-SSD classes that indicate a device is present
const PHONE_CLASSES: Record<string, number> = {
  'cell phone': 0.28,
  'remote':     0.32,
  'laptop':     0.38,
  'book':       0.42,
};

// =============================================================================
// Custom Rectangle / Phone Detector
// Uses Sobel edge detection + projection analysis — no ML model required.
// Detects ANY large rectangular object with phone-like dimensions even when
// COCO-SSD fails to classify it (e.g. phone seen from the back).
// =============================================================================
interface RectResult {
  detected: boolean;
  score: number;
  bbox?: { x: number; y: number; w: number; h: number };
  reason?: string;
}

function detectRectangle(
  videoEl: HTMLVideoElement,
  workCanvas: HTMLCanvasElement
): RectResult {
  const W = 160, H = 120;
  workCanvas.width  = W;
  workCanvas.height = H;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || videoEl.readyState < 2 || videoEl.videoWidth === 0)
    return { detected: false, score: 0 };

  ctx.drawImage(videoEl, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  // 1. Grayscale
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }

  // 2. Sobel Edge Detection
  const edges = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx =
        -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1] +
         gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
      const gy =
        -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1] +
         gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
      edges[i] = Math.sqrt(gx * gx + gy * gy) > 35 ? 1 : 0;
    }
  }

  // 3. Projection — count edge pixels per row / column
  const rowE = new Int32Array(H);
  const colE = new Int32Array(W);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (edges[y * W + x]) { rowE[y]++; colE[x]++; }

  // 4. Find strong line candidates (at least 22% of span)
  const hLines: number[] = [];
  const vLines: number[] = [];
  for (let y = 2; y < H - 2; y++)
    if (rowE[y] >= W * 0.22 && (hLines.length === 0 || y - hLines[hLines.length - 1] > 6))
      hLines.push(y);
  for (let x = 2; x < W - 2; x++)
    if (colE[x] >= H * 0.22 && (vLines.length === 0 || x - vLines[vLines.length - 1] > 6))
      vLines.push(x);

  if (hLines.length < 2 || vLines.length < 2)
    return { detected: false, score: 0 };

  // Outermost lines form the bounding rectangle
  const top    = hLines[0];
  const bottom = hLines[hLines.length - 1];
  const left   = vLines[0];
  const right  = vLines[vLines.length - 1];

  const rectH = bottom - top;
  const rectW = right  - left;
  if (rectW < 8 || rectH < 8) return { detected: false, score: 0 };

  const areaFraction = (rectH / H) * (rectW / W);
  const aspect       = rectW / rectH;

  // 5. Phone-like aspect ratio
  // Portrait smartphone: 0.36–0.73 | Landscape: 1.40–2.60 | Tablet: 0.65–0.80
  const isPhoneAspect =
    (aspect >= 0.36 && aspect <= 0.73) ||
    (aspect >= 1.40 && aspect <= 2.60);

  if (!isPhoneAspect || areaFraction < 0.08)
    return { detected: false, score: 0, reason: `aspect=${aspect.toFixed(2)} area=${(areaFraction * 100).toFixed(0)}%` };

  // 6. Internal uniformity (phone back/screen = single consistent surface)
  let sumL = 0, sumSq = 0, n = 0;
  for (let sy = top + 2; sy < bottom - 2; sy += 4) {
    for (let sx = left + 2; sx < right - 2; sx += 4) {
      const lum = gray[sy * W + sx];
      sumL  += lum;
      sumSq += lum * lum;
      n++;
    }
  }
  const meanL    = n > 0 ? sumL / n : 128;
  const variance = n > 0 ? sumSq / n - meanL * meanL : 9999;
  const uniformityScore = Math.max(0, 1 - variance / 3500);

  // 7. Darkness bias — phone backs/screens are often dark
  const darknessScore = Math.max(0, 1 - meanL / 160);

  // 8. Coverage boost
  const coverageScore = Math.min(1, areaFraction / 0.25);

  // 9. Corner edge confirmation
  const corners = [
    [top, left], [top, right - 1], [bottom - 1, left], [bottom - 1, right - 1],
  ] as const;
  const cornerHits = corners.filter(([cy, cx]) => edges[cy * W + cx]).length;
  const cornerScore = cornerHits / 4;

  // Final weighted score
  const score =
    uniformityScore * 0.30 +
    darknessScore   * 0.10 +
    coverageScore   * 0.35 +
    cornerScore     * 0.25;

  const detected = score >= 0.42 && areaFraction >= 0.10;

  return {
    detected,
    score,
    bbox: { x: left / W, y: top / H, w: rectW / W, h: rectH / H },
    reason: `score=${score.toFixed(2)} area=${(areaFraction * 100).toFixed(0)}% AR=${aspect.toFixed(2)} var=${variance.toFixed(0)}`,
  };
}
// =============================================================================

interface Props {
  uid: string;
  testId?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onViolation?: (flag: DurationFlag) => void;
  calibrationMode?: boolean;
  overlayCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

type LM = { x: number; y: number; z: number };

export default function ProctoringMonitor({
  uid,
  testId,
  videoRef,
  onViolation,
  calibrationMode = false,
  overlayCanvasRef,
}: Props) {

  const activeInfractions = useRef<Map<ProctoringEvent, { startTime: number; severity: Severity }>>(
    new Map()
  );
  const hys = useRef<Map<ProctoringEvent, { v: number; c: number }>>(new Map());
  const getHys = (e: ProctoringEvent) => {
    if (!hys.current.has(e)) hys.current.set(e, { v: 0, c: 0 });
    return hys.current.get(e)!;
  };

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
      if (!calibrationMode) push(ref(rtdb, flagPath()), flag);
    },
    [calibrationMode, flagPath, onViolation]
  );

  const report = useCallback(
    (event: ProctoringEvent, violating: boolean, severity: Severity) => {
      const h = getHys(event);
      if (violating) {
        h.v++;
        h.c = 0;
        if (h.v >= FRAMES_TO_START) openInfraction(event, severity);
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
    let camera: { start: () => void; stop: () => void } | null = null;
    let audioCtx: AudioContext | null = null;
    let audioStream: MediaStream | null = null;
    let faceMeshInst: { close: () => void } | null = null;
    let rafId: number | null = null;
    let cocoTimer: ReturnType<typeof setInterval> | null = null;
    let rectTimer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    let ambientBaseline = 0.06;
    let calibFrames = 0;
    let calibSum = 0;
    const CALIB_FRAMES = 60;

    // ── 1. Tab Switch & Fullscreen ────────────────────────────────────────────
    const onVisibility = () => {
      if (document.hidden) openInfraction('TAB_SWITCHED', 'critical');
      else closeInfraction('TAB_SWITCHED');
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) openInfraction('LEFT_FULLSCREEN', 'high');
      else closeInfraction('LEFT_FULLSCREEN');
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);

    // ── 2a. Custom Rectangle Detector (runs every 600ms — fast, no model load) ──
    const workCanvas = document.createElement('canvas');

    rectTimer = setInterval(() => {
      if (!mounted || !videoRef.current || videoRef.current.readyState < 2) return;
      const result = detectRectangle(videoRef.current, workCanvas);

      // Draw result on overlay canvas
      if (overlayCanvasRef?.current && videoRef.current.videoWidth > 0) {
        const cv = overlayCanvasRef.current;
        const gx = cv.getContext('2d');
        if (gx && result.bbox) {
          const { x, y, w, h } = result.bbox;
          const cx = x * cv.width, cy = y * cv.height;
          const cw = w * cv.width, ch = h * cv.height;
          gx.strokeStyle = result.detected ? '#ff2200' : `rgba(255,180,0,${result.score.toFixed(2)})`;
          gx.lineWidth   = result.detected ? 3 : 1.5;
          gx.setLineDash(result.detected ? [] : [6, 4]);
          gx.strokeRect(cx, cy, cw, ch);
          gx.setLineDash([]);
          if (result.detected) {
            gx.fillStyle = 'rgba(255,34,0,0.85)';
            gx.font = 'bold 13px monospace';
            gx.fillText(`RECT OBJECT ${(result.score * 100).toFixed(0)}%`, cx + 2, cy > 18 ? cy - 4 : cy + ch + 14);
          } else if (result.score > 0.25) {
            gx.fillStyle = 'rgba(255,180,0,0.7)';
            gx.font = '11px monospace';
            gx.fillText(`rect? ${(result.score * 100).toFixed(0)}%`, cx + 2, cy > 14 ? cy - 4 : cy + ch + 12);
          }
        }
      }

      report('PHONE_DETECTED', result.detected, 'critical');
    }, 600);

    // ── 2b. COCO-SSD Object Detection (secondary, slower) ─────────────────────
    const DETECT_W = 416, DETECT_H = 416;
    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = DETECT_W;
    detectCanvas.height = DETECT_H;
    const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });

    const initCoco = async () => {
      if (!mounted) return;
      try {
        const tf = await import('@tensorflow/tfjs');
        await tf.setBackend('webgl');
        await tf.ready();
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        const model = await cocoSsd.load({ base: 'mobilenet_v2' });

        // Warm-up inference
        if (mounted && videoRef.current && videoRef.current.readyState === 4) {
          try { await model.detect(videoRef.current); } catch { /* ok */ }
        }

        let detecting = false;
        cocoTimer = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || detecting) return;
          try {
            detecting = true;
            if (detectCtx && videoRef.current.videoWidth > 0) {
              detectCtx.filter = 'contrast(1.15) brightness(1.05)';
              detectCtx.drawImage(videoRef.current, 0, 0, DETECT_W, DETECT_H);
              detectCtx.filter = 'none';
            }
            const preds = await model.detect(detectCanvas);
            const predsNative = await model.detect(videoRef.current);
            const all = [...preds, ...predsNative];

            // Draw COCO boxes (don't clear — FaceMesh draws first)
            if (overlayCanvasRef?.current && videoRef.current.videoWidth > 0) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              if (gx) {
                const sx = cv.width / videoRef.current.videoWidth;
                const sy = cv.height / videoRef.current.videoHeight;
                predsNative.forEach((p) => {
                  if (p.score < 0.22) return;
                  const isCheat = p.class in PHONE_CLASSES;
                  const [bx, by, bw, bh] = p.bbox;
                  gx.strokeStyle = isCheat ? '#ff2200' : '#22ff88';
                  gx.lineWidth   = isCheat ? 2.5 : 1;
                  gx.strokeRect(bx * sx, by * sy, bw * sx, bh * sy);
                  gx.fillStyle = isCheat ? 'rgba(255,34,0,0.85)' : 'rgba(34,255,136,0.7)';
                  gx.font = `bold ${isCheat ? 12 : 10}px monospace`;
                  gx.fillText(
                    `${p.class} ${(p.score * 100).toFixed(0)}%`,
                    bx * sx + 2,
                    by * sy > 14 ? by * sy - 4 : by * sy + bh * sy + 12
                  );
                });
              }
            }

            const cocoDetected = all.some((p) => {
              const thr = PHONE_CLASSES[p.class];
              return thr !== undefined && p.score >= thr;
            });

            // Only override the rect detector's result if COCO is confident
            if (cocoDetected) openInfraction('PHONE_DETECTED', 'critical');
          } catch {
            /* suppress */
          } finally {
            detecting = false;
          }
        }, 1400);
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
          refineLandmarks: true,
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });

        faceMesh.onResults((results: { multiFaceLandmarks: LM[][] }) => {
          if (!mounted) return;
          const count = results.multiFaceLandmarks.length;
          report('INVALID_FACE_COUNT', count !== 1, count === 0 ? 'medium' : 'critical');

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
                count === 0 ? '⚠ NO FACE DETECTED' : `⚠ ${count} FACES`,
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
            const gazeAway   = Math.abs(yawDeg) > 28 || pitchDeg > 30 || pitchDeg < -18;

            report('GAZE_AWAY', gazeAway, 'medium');

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
                    ? `⚠ GAZE AWAY  Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`
                    : `✓ FACE OK    Y:${yawDeg.toFixed(0)}° P:${pitchDeg.toFixed(0)}°`,
                  6, H - 8
                );
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
                if (overlayCanvasRef?.current && videoRef.current.videoWidth > 0) {
                  const cv = overlayCanvasRef.current;
                  if (cv.width !== videoRef.current.videoWidth) cv.width = videoRef.current.videoWidth;
                  if (cv.height !== videoRef.current.videoHeight) cv.height = videoRef.current.videoHeight;
                  cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
                }
                await faceMesh.send({ image: videoRef.current });
              } catch { /* suppress */ } finally {
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

    // ── 4. Audio + Camera-covered ─────────────────────────────────────────────
    const initAudio = async () => {
      if (!mounted) return;
      const hiddenCv = document.createElement('canvas');
      hiddenCv.width = 64; hiddenCv.height = 64;
      const hCtx = hiddenCv.getContext('2d', { willReadFrequently: true });

      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        audioCtx.createMediaStreamSource(audioStream).connect(analyser);

        const timeBuf = new Float32Array(analyser.frequencyBinCount);
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);
        let quietFrames = 0;

        const tick = () => {
          if (!mounted) return;
          analyser.getFloatTimeDomainData(timeBuf);
          let sumSq = 0;
          for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
          const rms = Math.sqrt(sumSq / timeBuf.length);

          if (calibFrames < CALIB_FRAMES) {
            calibSum += rms; calibFrames++;
            if (calibFrames === CALIB_FRAMES)
              ambientBaseline = Math.max(0.045, Math.min(0.14, (calibSum / CALIB_FRAMES) * 3.2));
          } else {
            analyser.getByteFrequencyData(freqBuf);
            const binHz = (audioCtx!.sampleRate / 2) / freqBuf.length;
            const lo = Math.floor(300  / binHz);
            const hi = Math.min(Math.floor(3500 / binHz), freqBuf.length - 1);
            let sp = 0;
            for (let i = lo; i <= hi; i++) sp += freqBuf[i];
            const isLoud = rms > ambientBaseline || sp / (hi - lo + 1) > 72;
            if (isLoud) { openInfraction('LOUD_AUDIO', 'medium'); quietFrames = 0; }
            else { quietFrames++; if (quietFrames > 40) closeInfraction('LOUD_AUDIO'); }
          }

          // Camera covered
          if (hCtx && videoRef.current && videoRef.current.readyState === 4) {
            hCtx.drawImage(videoRef.current, 0, 0, 64, 64);
            const px = hCtx.getImageData(0, 0, 64, 64).data;
            let lum = 0;
            for (let i = 0; i < px.length; i += 4)
              lum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
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

      const endMs = Date.now();
      activeInfractions.current.forEach((val, event) => {
        const dur = Math.round((endMs - val.startTime) / 1000);
        if (dur >= 1 && !calibrationMode) {
          push(ref(rtdb, flagPath()), {
            event, severity: val.severity,
            startTime: new Date(val.startTime).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationInSeconds: dur,
          });
        }
      });
      activeInfractions.current.clear();

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cocoTimer !== null) clearInterval(cocoTimer);
      if (rectTimer !== null) clearInterval(rectTimer);
      if (camera) camera.stop();
      if (faceMeshInst) faceMeshInst.close();
      if (audioCtx) audioCtx.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, testId]);

  return null;
}
