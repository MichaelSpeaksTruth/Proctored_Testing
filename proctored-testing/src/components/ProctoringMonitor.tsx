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
const IDX_NOSE_BRIDGE = 168;
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
// Uses Sobel edge detection + projection analysis - no ML model required.
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
      edges[i] = Math.sqrt(gx * gx + gy * gy) > 40 ? 1 : 0;
    }
  }

  // 3. Projection with smoothing for tilted edges
  const rowE = new Int32Array(H);
  const colE = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (edges[y * W + x]) {
        rowE[y]++; colE[x]++;
      }
    }
  }

  const smoothRow = new Int32Array(H);
  const smoothCol = new Int32Array(W);
  for (let y = 2; y < H - 2; y++) smoothRow[y] = rowE[y-2] + rowE[y-1] + rowE[y] + rowE[y+1] + rowE[y+2];
  for (let x = 2; x < W - 2; x++) smoothCol[x] = colE[x-2] + colE[x-1] + colE[x] + colE[x+1] + colE[x+2];

  // 4. Find all candidate line positions (threshold: ~15% of width/height over 5 pixels)
  const hLines: number[] = [];
  const vLines: number[] = [];
  for (let y = 4; y < H - 4; y++)
    if (smoothRow[y] >= W * 0.15 && (hLines.length === 0 || y - hLines[hLines.length - 1] > 4))
      hLines.push(y);
  for (let x = 4; x < W - 4; x++)
    if (smoothCol[x] >= H * 0.15 && (vLines.length === 0 || x - vLines[vLines.length - 1] > 4))
      vLines.push(x);

  if (hLines.length < 2 || vLines.length < 2) return { detected: false, score: 0 };

  // 5. Exhaustive search over all bounding boxes formed by these lines
  let bestScore = 0;
  let bestRect = null;

  for (let i = 0; i < hLines.length - 1; i++) {
    for (let j = i + 1; j < hLines.length; j++) {
      for (let k = 0; k < vLines.length - 1; k++) {
        for (let l = k + 1; l < vLines.length; l++) {
          const top = hLines[i], bottom = hLines[j];
          const left = vLines[k], right = vLines[l];
          const rectH = bottom - top;
          const rectW = right - left;
          
          if (rectW < 12 || rectH < 12) continue;
          
          const areaFraction = (rectH / H) * (rectW / W);
          const aspect = rectW / rectH;
          
          // Relaxed phone aspect ratio (portrait: 0.3-0.85, landscape: 1.15-3.0)
          const isPhoneAspect = (aspect >= 0.30 && aspect <= 0.85) || (aspect >= 1.15 && aspect <= 3.0);
          if (!isPhoneAspect || areaFraction < 0.05) continue;
          
          let sumL = 0, sumSq = 0, n = 0;
          for (let sy = top + 2; sy < bottom - 2; sy += 3) {
            for (let sx = left + 2; sx < right - 2; sx += 3) {
              const lum = gray[sy * W + sx];
              sumL += lum; sumSq += lum * lum; n++;
            }
          }
          if (n === 0) continue;
          
          const meanL = sumL / n;
          const variance = (sumSq / n) - (meanL * meanL);
          
          // Phone backs are uniform (variance < 1500) and dark (mean < 130)
          const uniformityScore = Math.max(0, 1 - variance / 2500);
          const darknessScore = Math.max(0, 1 - meanL / 160);
          
          const baseScore = uniformityScore * 0.7 + darknessScore * 0.3;
          if (baseScore > bestScore) {
             bestScore = baseScore;
             bestRect = { top, bottom, left, right, baseScore, areaFraction, aspect, variance, meanL };
          }
        }
      }
    }
  }

  if (!bestRect) return { detected: false, score: 0 };

  // 6. Verify border edge density
  let borderEdges = 0;
  for (let x = bestRect.left; x <= bestRect.right; x++) {
    if (edges[bestRect.top * W + x]) borderEdges++;
    if (edges[bestRect.bottom * W + x]) borderEdges++;
  }
  for (let y = bestRect.top; y <= bestRect.bottom; y++) {
    if (edges[y * W + bestRect.left]) borderEdges++;
    if (edges[y * W + bestRect.right]) borderEdges++;
  }
  const expectedBorder = (bestRect.right - bestRect.left) * 2 + (bestRect.bottom - bestRect.top) * 2;
  const borderDensity = borderEdges / expectedBorder;

  // 7. Detect Camera Lens (Circles on the rectangle)
  let maxLensScore = 0;
  const rh = bestRect.bottom - bestRect.top;
  const scanTop = bestRect.top + 2;
  const scanBottom = bestRect.bottom - 5;
  const scanLeft = bestRect.left + 2;
  const scanRight = bestRect.right - 5;

  for (let cy = scanTop; cy <= scanBottom; cy++) {
    // Only search the top 35% and bottom 35% (corners) for camera lenses
    if (cy > bestRect.top + rh * 0.35 && cy < bestRect.bottom - rh * 0.35) continue;
    
    for (let cx = scanLeft; cx <= scanRight; cx++) {
      let centerSum = 0;
      let edgeHits = 0;
      // Evaluate a 3x3 inner patch for circular features
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = 0; dx <= 2; dx++) {
          centerSum += gray[(cy + dy) * W + (cx + dx)];
          if (edges[(cy + dy) * W + (cx + dx)]) edgeHits++;
        }
      }
      const centerMean = centerSum / 9;
      // Camera lenses stand out with high local contrast compared to the phone body
      const contrast = Math.abs(centerMean - bestRect.meanL);
      if (contrast > 12 && edgeHits >= 3) {
        const score = (contrast / 40) * (edgeHits / 6);
        if (score > maxLensScore) maxLensScore = score;
      }
    }
  }

  const lensBoost = Math.min(1.0, maxLensScore) * 0.35;

  // Final score requires both internal uniformity and external edges, boosted by camera presence
  const finalScore = (bestRect.baseScore * 0.5) + (Math.min(1, borderDensity / 0.3) * 0.5) + lensBoost;
  
  // With the smart lens detector, we can drop the density requirement slightly
  const detected = finalScore >= 0.52 && borderDensity > 0.08 && bestRect.areaFraction >= 0.06;

  return {
    detected,
    score: finalScore,
    bbox: { x: bestRect.left / W, y: bestRect.top / H, w: (bestRect.right - bestRect.left) / W, h: (bestRect.bottom - bestRect.top) / H },
    reason: `S=${finalScore.toFixed(2)} (cam=${lensBoost.toFixed(2)}, base=${bestRect.baseScore.toFixed(2)}, bdr=${borderDensity.toFixed(2)})`,
  };
}
// =============================================================================

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
}: Props) {

  const activeInfractions = useRef<Map<ProctoringEvent, { startTime: number; severity: Severity; snapshotBase64?: string }>>(
    new Map()
  );
  
  const lastAlignment = useRef(false);
  // Keep a ref of isSubmitting to avoid re-binding event listeners
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

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

  const captureSnapshot = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) return undefined;
    try {
      const cv = document.createElement('canvas');
      cv.width = 320;
      cv.height = 240;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, cv.width, cv.height);
        return cv.toDataURL('image/jpeg', 0.4);
      }
    } catch (e) {
      console.warn('Failed to capture snapshot', e);
    }
    return undefined;
  }, [videoRef]);

  const openInfraction = useCallback(
    (event: ProctoringEvent, severity: Severity) => {
      if (activeInfractions.current.has(event)) return;
      let snapshotBase64 = undefined;
      if (severity === 'critical' || severity === 'high') {
        snapshotBase64 = captureSnapshot();
      }
      activeInfractions.current.set(event, { startTime: Date.now(), severity, snapshotBase64 });
      onViolationStart?.(event, severity);
    },
    [onViolationStart, captureSnapshot]
  );

  const closeInfraction = useCallback(
    (event: ProctoringEvent) => {
      const record = activeInfractions.current.get(event);
      if (!record) return;
      const endMs = Date.now();
      const durationInSeconds = Math.round((endMs - record.startTime) / 1000);
      activeInfractions.current.delete(event);
      onViolationClear?.(event);
      
      const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN';
      if (isSlowEvent && durationInSeconds < 5) return;
      if (!isSlowEvent && durationInSeconds < 1) return;
      
      const flag: DurationFlag = {
        event,
        severity: record.severity,
        startTime: new Date(record.startTime).toISOString(),
        endTime: new Date(endMs).toISOString(),
        durationInSeconds,
      };
      if (record.snapshotBase64) {
        flag.snapshotBase64 = record.snapshotBase64;
      }
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
    let faceMeshInst: { close: () => void } | null = null;
    let rafId: number | null = null;
    let cocoTimer: ReturnType<typeof setInterval> | null = null;
    let rectTimer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    let ambientBaseline = 0.06;
    let calibFrames = 0;
    let calibSum = 0;
    const CALIB_FRAMES = 60;

    // ── 1. Tab & Window monitoring ────────────────────────────────────────────
    let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (isSubmittingRef.current) return;
      if (document.hidden) {
        if (visibilityTimeout) { clearTimeout(visibilityTimeout); visibilityTimeout = null; }
        openInfraction('TAB_SWITCHED', 'critical');
      } else {
        visibilityTimeout = setTimeout(() => {
          closeInfraction('TAB_SWITCHED');
        }, 1500); // 1.5s buffer against micro-stutters
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
        const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN';
        const isValid = (isSlowEvent && dur >= 5) || (!isSlowEvent && dur >= 1);
        if (isValid && !calibrationMode) {
          push(ref(rtdb, flagPath()), {
            event, severity: val.severity,
            startTime: new Date(val.startTime).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationInSeconds: dur,
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

    // ── 2a. Custom Rectangle Detector (runs every 600ms - fast, no model load) ──
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

            // Draw COCO boxes (don't clear - FaceMesh draws first)
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
            const gazeAway   = Math.abs(yawDeg) > 28 || pitchDeg > 20 || pitchDeg < -18;

            report('GAZE_AWAY', gazeAway, 'medium');

            // ── Head Pitch (Looking at lap) ──
            const calculateHeadPitch = (landmarks: LM[]) => {
              const f = landmarks[IDX_FOREHEAD];
              const c = landmarks[IDX_CHIN];
              const theta = Math.atan2(f.z - c.z, c.y - f.y);
              return theta * (180 / Math.PI);
            };
            const headPitchDegrees = calculateHeadPitch(lm);
            
            // 2D Proportion Ratio
            const noseTipPt = lm[IDX_NOSE_TIP];
            const chinPt = lm[IDX_CHIN];
            const noseBridgePt = lm[IDX_NOSE_BRIDGE];
            const dUpper = Math.abs(noseTipPt.y - noseBridgePt.y);
            const dLower = Math.abs(chinPt.y - noseTipPt.y);
            const faceRatio = dUpper > 0.001 ? dLower / dUpper : 1.0;
            
            // Boundary Check
            const foreheadPt = lm[IDX_FOREHEAD];
            const isOutOfFrame = foreheadPt.y < 0.02 && chinPt.y > 0.2;
            
            // "Head versus chin relation" (Ducking by extreme pitch)
            const headMass = Math.abs(foreheadPt.y - noseTipPt.y);
            const lowerMass = Math.abs(chinPt.y - noseTipPt.y);
            const headVsChinRatio = lowerMass > 0.001 ? headMass / lowerMass : 1.0;
            
            // Flag if the chin physically drops out of frame OR if the head proportion balloons
            const isDucking = (chinPt.y > 0.95 && foreheadPt.y < 0.95) || (headVsChinRatio > 1.35);

            // Dynamic Shoulder Alignment Proxy: If chin drops below 0.85 of frame, shoulders are too low/out
            const isShouldersOut = chinPt.y > 0.85;

            const PITCH_DOWN_THRESHOLD = -15; // Tightened threshold for looking down at lap
            const isPitchDown = headPitchDegrees < PITCH_DOWN_THRESHOLD || pitchDeg > 0.5 || faceRatio < 0.75 || isOutOfFrame;
            
            report('HEAD_PITCH_DOWN', isPitchDown, 'critical');
            report('DUCKING_DOWN', isDucking, 'critical');
            report('SHOULDERS_OUT_OF_FRAME', isShouldersOut, 'high');

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
                  gx.fillText(`FACE HIDDEN (DUCK RATIO: ${headVsChinRatio.toFixed(2)})`, 6, H - 40);
                }
                
                // ── Calibration Geometric Centering ──
                if (calibrationMode) {
                  const isCenteredX = noseTip.x > 0.35 && noseTip.x < 0.65;
                  const isCenteredY = noseTip.y > 0.35 && noseTip.y < 0.65;
                  const isProximityGood = (chin.y - forehead.y) > 0.25;
                  
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
          const processFrame = async () => {
            if (!videoRef.current || !mounted || !faceMeshInst) return;
            
            const video = videoRef.current;
            if (video.readyState >= 2 && !video.paused && !video.ended) {
              if (!processing) {
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
          
          // Software check: verify the stream has an active audio track instead of relying on a strict RMS threshold
          // which can cause issues with device noise gates (e.g. on iPhones requiring shouting).
          const isMuted = !audioStream || audioStream.getAudioTracks().length === 0 || audioStream.getAudioTracks()[0].readyState !== 'live';
          report('MIC_MUTED', isMuted, 'critical');
          pushStatus({ micWorking: !isMuted });

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
            report('LOUD_AUDIO', isLoud, 'medium');
          }

          // Camera covered
          if (hCtx && videoRef.current && videoRef.current.readyState >= 2) {
            hCtx.drawImage(videoRef.current, 0, 0, 64, 64);
            const px = hCtx.getImageData(0, 0, 64, 64).data;
            let lum = 0;
            for (let i = 0; i < px.length; i += 4)
              lum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
            const covered = (lum / (64 * 64)) < 12;
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
        const isValid = (event === 'HEAD_PITCH_DOWN' && dur >= 5) || (event !== 'HEAD_PITCH_DOWN' && dur >= 1);
        if (isValid && !calibrationMode) {
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
      if (fmRaf !== null) cancelAnimationFrame(fmRaf);
      if (faceMeshInst) faceMeshInst.close();
      if (audioCtx) audioCtx.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, testId]);

  return null;
}
