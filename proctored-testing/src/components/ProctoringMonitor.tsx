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
  'cell phone': 0.30,
  'remote':     0.34,
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


interface RectResult {
  detected: boolean;
  score: number;
  bbox?: { x: number; y: number; w: number; h: number };
  overlapFacePercent?: number;
  reason?: string;
}

/**
 * Geometric Rectangular Obstruction Detector
 * Analyzes whether an external rectangular object (phone/slate/card) is obscuring or occluding
 * any portion of the candidate's facial bounding region.
 * Uses Sobel edge detection & line projection on a downscaled canvas (160x120) for 0ms ML overhead.
 */
function detectRectangularObstruction(
  videoEl: HTMLVideoElement,
  workCanvas: HTMLCanvasElement,
  faceBox: { minX: number; minY: number; maxX: number; maxY: number } | null
): RectResult {
  const W = 160, H = 120;
  workCanvas.width = W;
  workCanvas.height = H;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
    return { detected: false, score: 0 };
  }

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
      edges[i] = Math.sqrt(gx * gx + gy * gy) > 36 ? 1 : 0;
    }
  }

  // 3. Line Projections
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

  // 4. Candidate line coordinates
  const hLines: number[] = [];
  const vLines: number[] = [];
  for (let y = 4; y < H - 4; y++) {
    if (smoothRow[y] >= W * 0.14 && (hLines.length === 0 || y - hLines[hLines.length - 1] > 3)) {
      hLines.push(y);
    }
  }
  for (let x = 4; x < W - 4; x++) {
    if (smoothCol[x] >= H * 0.14 && (vLines.length === 0 || x - vLines[vLines.length - 1] > 3)) {
      vLines.push(x);
    }
  }

  if (hLines.length < 2 || vLines.length < 2) return { detected: false, score: 0 };

  // Face bounding box converted to WxH coordinates
  const fb = faceBox ? {
    minX: Math.floor(faceBox.minX * W),
    minY: Math.floor(faceBox.minY * H),
    maxX: Math.ceil(faceBox.maxX * W),
    maxY: Math.ceil(faceBox.maxY * H)
  } : null;
  const faceArea = fb ? Math.max(1, (fb.maxX - fb.minX) * (fb.maxY - fb.minY)) : 1;

  let bestScore = 0;
  let bestRect: {
    top: number; bottom: number; left: number; right: number;
    baseScore: number; areaFraction: number; aspect: number; overlapPercent: number;
  } | null = null;

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
          // Typical phone dimensions in hand (portrait 0.28-0.90, landscape 1.10-3.2)
          const isPhoneAspect = (aspect >= 0.28 && aspect <= 0.90) || (aspect >= 1.10 && aspect <= 3.2);
          if (!isPhoneAspect || areaFraction < 0.04) continue;

          // Check intersection / overlap with candidate's face region
          let overlapFaceArea = 0;
          if (fb) {
            const ox = Math.max(0, Math.min(right, fb.maxX) - Math.max(left, fb.minX));
            const oy = Math.max(0, Math.min(bottom, fb.maxY) - Math.max(top, fb.minY));
            overlapFaceArea = ox * oy;
          }

          const overlapPercent = fb ? (overlapFaceArea / faceArea) * 100 : 0;
          const isTouchingFace = fb ? (
            left <= fb.maxX + 4 && right >= fb.minX - 4 &&
            top <= fb.maxY + 4 && bottom >= fb.minY - 4
          ) : true;

          // When candidate face is visible, require the rectangle to obstruct/intersect or touch the face
          if (fb && !isTouchingFace && overlapPercent < 2) continue;

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
          const uniformityScore = Math.max(0, 1 - variance / 2800);
          const darknessScore = Math.max(0, 1 - meanL / 175);
          const baseScore = uniformityScore * 0.65 + darknessScore * 0.35;

          // Score boost if it is directly obscuring the face
          const obstructionBoost = Math.min(0.35, (overlapPercent / 20) * 0.35);
          const totalCandidateScore = baseScore + obstructionBoost;

          if (totalCandidateScore > bestScore) {
            bestScore = totalCandidateScore;
            bestRect = { top, bottom, left, right, baseScore, areaFraction, aspect, overlapPercent };
          }
        }
      }
    }
  }

  if (!bestRect) return { detected: false, score: 0 };

  // Perimeter edge continuity check
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

  // Final score: edge borders + uniformity
  const finalScore = (bestRect.baseScore * 0.5) + (Math.min(1, borderDensity / 0.28) * 0.5);

  // Detected if:
  // 1. Any rectangular object obscuring any portion (>= 3%) of the face region (score >= 0.38)
  // 2. OR a strong rectangular object held near face (score >= 0.48, borderDensity >= 0.08)
  const isObstructing = (bestRect.overlapPercent >= 3 && finalScore >= 0.38) || (finalScore >= 0.48 && borderDensity >= 0.08);

  return {
    detected: isObstructing,
    score: finalScore,
    overlapFacePercent: bestRect.overlapPercent,
    bbox: {
      x: bestRect.left / W,
      y: bestRect.top / H,
      w: (bestRect.right - bestRect.left) / W,
      h: (bestRect.bottom - bestRect.top) / H,
    },
    reason: `Obstruction=${bestRect.overlapPercent.toFixed(1)}% Score=${finalScore.toFixed(2)}`,
  };
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
  
  const faceBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
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
      
      const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY' || event === 'NO_FACE' || event === 'SHOULDERS_OUT_OF_FRAME';
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
      // For SHOULDERS_OUT_OF_FRAME, require sustained violation (~2.5s) before triggering the blocking modal
      // and clear quickly (~0.8s) once corrected
      const framesToStart = event === 'SHOULDERS_OUT_OF_FRAME' ? 30 : FRAMES_TO_START;
      const framesToClear = event === 'SHOULDERS_OUT_OF_FRAME' ? 10 : FRAMES_TO_CLEAR;

      if (violating) {
        h.v++;
        h.c = 0;
        if (h.v === framesToStart) openInfraction(event, severity);
      } else {
        h.c++;
        h.v = Math.max(0, h.v - 2);
        if (h.c >= framesToClear) {
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
      if (isSubmittingRef.current || isMobileRef.current) return;
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
        const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY' || event === 'NO_FACE' || event === 'SHOULDERS_OUT_OF_FRAME';
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

    // ── 2. Universal Verified AI Object Detection (COCO-SSD Lite) ──────────────
    // Runs on ALL devices (4GB RAM, low-end PCs, mobile, desktop) using the ultra-lightweight
    // quantized 'lite_mobilenet_v2' model to guarantee 100% identical rules for all candidates.
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
        // 'lite_mobilenet_v2' is quantized and ultra-lean (~3MB weight payload, ~20MB RAM)
        const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

        if (mounted && videoRef.current && videoRef.current.readyState === 4) {
          try { await model.detect(videoRef.current); } catch { /* ok */ }
        }

        let detecting = false;
        let phoneStreak = 0;
        let phoneClearStreak = 0;
        const workCanvas = document.createElement('canvas');

        cocoTimer = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || detecting) return;
          try {
            detecting = true;
            const video = videoRef.current;
            
            // Detect on native video element directly to maintain 100% native aspect ratio and resolution
            let preds: import('@tensorflow-models/coco-ssd').DetectedObject[] = [];
            tf.engine().startScope();
            try {
              preds = await model.detect(video);
            } finally {
              tf.engine().endScope();
            }

            const cocoPhone = preds.some((p) => {
              const thr = PHONE_CLASSES[p.class];
              return thr !== undefined && p.score >= thr;
            });

            // Fast geometric rectangular obstruction detection (any rectangular object occluding face)
            const rectResult = detectRectangularObstruction(video, workCanvas, faceBoxRef.current);
            const rectObstructing = rectResult.detected;

            const phoneDetected = cocoPhone || rectObstructing;

            // Dedicated fast-response streak debouncer (2 consecutive detections @ 800ms = 1.6s)
            if (phoneDetected) {
              phoneStreak++;
              phoneClearStreak = 0;
              if (phoneStreak >= 2) {
                openInfraction('PHONE_DETECTED', 'critical');
              }
            } else {
              phoneClearStreak++;
              phoneStreak = Math.max(0, phoneStreak - 1);
              if (phoneClearStreak >= 2) {
                closeInfraction('PHONE_DETECTED');
                phoneClearStreak = 0;
              }
            }

            // Draw bounding boxes on overlay canvas for active visual verification
            if (overlayCanvasRef?.current && video.videoWidth > 0) {
              const cv = overlayCanvasRef.current;
              const gx = cv.getContext('2d');
              if (gx) {
                const sx = cv.width / video.videoWidth;
                const sy = cv.height / video.videoHeight;
                preds.forEach((p) => {
                  if (p.score < 0.28) return;
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

                if (rectResult.bbox && (rectResult.detected || (rectResult.score > 0.35 && (rectResult.overlapFacePercent || 0) > 0))) {
                  const rb = rectResult.bbox;
                  const rx = rb.x * cv.width;
                  const ry = rb.y * cv.height;
                  const rw = rb.w * cv.width;
                  const rh = rb.h * cv.height;
                  gx.strokeStyle = rectResult.detected ? '#ff0055' : 'rgba(255,160,0,0.6)';
                  gx.lineWidth = rectResult.detected ? 2.5 : 1.2;
                  gx.setLineDash(rectResult.detected ? [] : [4, 4]);
                  gx.strokeRect(rx, ry, rw, rh);
                  gx.setLineDash([]);
                  if (rectResult.detected) {
                    gx.fillStyle = 'rgba(255,0,85,0.9)';
                    gx.font = 'bold 12px monospace';
                    gx.fillText(
                      `RECT OBSTRUCTION ${(rectResult.overlapFacePercent || 0).toFixed(0)}% FACE`,
                      rx + 2,
                      ry > 16 ? ry - 4 : ry + rh + 14
                    );
                  }
                }
              }
            }
          } catch {
            /* suppress */
          } finally {
            detecting = false;
          }
        }, 800);
      } catch (e) {
        console.warn('[Proctor] COCO-SSD load failed:', e);
      }
    };

    // Initialize for ALL candidates on ALL devices equally
    initCoco();

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
          // Filter out tiny background faces (e.g. wall photos, poster images < 9% frame height)
          const validFaces = results.multiFaceLandmarks.filter(faceLm => {
            const fH = Math.abs(faceLm[IDX_CHIN].y - faceLm[IDX_FOREHEAD].y);
            return fH >= 0.09;
          });
          const count = validFaces.length;
          report('NO_FACE', count === 0, 'medium');
          report('MULTIPLE_FACES', count > 1, 'critical');
          pushStatus({ faceDetected: count === 1 });
          if (count === 0) {
            // If face suddenly drops out, retain faceBox briefly so an obstruction held right over the face is flagged
            setTimeout(() => {
              if (mounted && activeInfractions.current.has('NO_FACE')) {
                faceBoxRef.current = null;
              }
            }, 1500);
          }

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
            const lm = validFaces[0];

            // Compute facial bounding box for obstruction tracking
            let minX = 1, minY = 1, maxX = 0, maxY = 0;
            for (let i = 0; i < lm.length; i++) {
              if (lm[i].x < minX) minX = lm[i].x;
              if (lm[i].x > maxX) maxX = lm[i].x;
              if (lm[i].y < minY) minY = lm[i].y;
              if (lm[i].y > maxY) maxY = lm[i].y;
            }
            faceBoxRef.current = { minX, minY, maxX, maxY };
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
            
            // Forehead, nose, and chin landmarks
            const foreheadPt = lm[IDX_FOREHEAD];
            const noseTipPt  = lm[IDX_NOSE_TIP];
            const chinPt     = lm[IDX_CHIN];

            // Ducking: only when the face physically sinks below the bottom of the camera frame
            // (Eliminated headVsChinRatio which falsely fired when a phone or hand occluded the lower face)
            const isDucking = chinPt.y > 0.97 && foreheadPt.y > 0.65;

            // Peeking / Looking Down Check:
            // When a student peeks down to read questions, options, or scratchpad notes,
            // their head pitches forward/down (headPitchDegrees < -14° or pitchDeg > 6°).
            const isPeekingDown = headPitchDegrees < -14 || pitchDeg > 6;

            // Looking Down (Calibrated Midpoint between the tough 1-month-ago and loose variants):
            // Catches sustained lap looking without triggering on standard upright screen viewing.
            const isPitchDown = headPitchDegrees < -20 || (headPitchDegrees < -16 && pitchDeg > 8);

            // Dynamic Shoulder Alignment (Screen Extended / Tilted Back at Ceiling):
            // Only fires when the camera is physically tilted up at the ceiling:
            // - Nose tip must be pushed into the bottom third of the frame (noseTip.y > 0.64)
            // - Forehead is pushed down (foreheadPt.y > 0.46, top 46%+ of image is ceiling)
            // - Chin is pushed to the bottom border (chinPt.y > 0.90)
            // - Candidate is looking at the screen (!isPeekingDown)
            const isShouldersOut = !isPeekingDown && noseTipPt.y > 0.64 && foreheadPt.y > 0.46 && chinPt.y > 0.90;
            
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

                if (isShouldersOut) {
                  gx.fillStyle = '#ff8800';
                  gx.fillText(`SCREEN TILTED BACK (ALIGN REQUIRED)`, 6, H - 56);
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
        const isSlowEvent = event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'GAZE_AWAY' || event === 'NO_FACE' || event === 'SHOULDERS_OUT_OF_FRAME';
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
