'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag, Box, PhoneMeta } from '@/lib/proctoring';

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
  'cell phone': 0.48,
};

const LOOKALIKE: Record<string, number> = { 
  remote: 0.35, 
  laptop: 0.45 
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



const STATIC_SUPPRESS_MS = 10_000;  // fixed this long => candidate for suppression
const ANCHOR_DRIFT = 0.01;          // center may move 1% of frame (~6px @640) and still be "same spot"
const ANCHOR_SIZE_TOL = 0.10;
const ANCHOR_FORGET_MS = 3_000;     // flicker of up to 3s doesn't reset the timer

interface Anchor { 
  cx: number; 
  cy: number; 
  w: number; 
  h: number; 
  since: number; 
  lastSeen: number; 
}

function sameSpot(a: Anchor, b: Box, vw: number, vh: number) {
  const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  return (
    Math.abs(cx - a.cx) < ANCHOR_DRIFT * vw &&
    Math.abs(cy - a.cy) < ANCHOR_DRIFT * vh &&
    Math.abs(b[2] - a.w) / a.w < ANCHOR_SIZE_TOL &&
    Math.abs(b[3] - a.h) / a.h < ANCHOR_SIZE_TOL
  );
}


interface FBox { x: number; y: number; w: number; h: number } // normalized 0..1

const MIN_FACE_H = 0.06;            // existing floor
const EXTRA_MIN_RATIO = 0.4;        // extra face height >= 40% of the primary's
const EXTRA_MAX_OVERLAP = 0.3;      // max overlap with primary (fraction of the smaller box)
const EXTRA_ASPECT: [number, number] = [0.5, 1.2];
const EXTRA_MIN_TEXTURE = 12;       // luma std-dev floor
const EXTRA_STRONG_TEXTURE = 18;    // extra face with std-dev >= 18 is clearly textured second person
const GLOW_MIN_SAT = 0.02;          // >=2% of pixels near-white
const GLOW_RATIO = 4;               // and 4x the rolling baseline

function lmBox(lm: LM[]): FBox {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const pt of lm) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function overlapOfSmaller(a: FBox, b: FBox) {
  const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (iw <= 0 || ih <= 0) return 0;
  return (iw * ih) / Math.min(a.w * a.h, b.w * b.h);
}

function makeProbe(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return ctx ? { ctx, w, h } : null;
}
type Probe = NonNullable<ReturnType<typeof makeProbe>>;

// Whole-frame brightness stats on a 64x48 downscale (~3k pixels, negligible cost)
function frameStats(video: HTMLVideoElement, p: Probe) {
  p.ctx.drawImage(video, 0, 0, p.w, p.h);
  const d = p.ctx.getImageData(0, 0, p.w, p.h).data;
  let sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 235) sat++;
  }
  return { sat: sat / (p.w * p.h) };
}

// Luma std-dev inside a face box, 24x24 crop
function cropStd(video: HTMLVideoElement, p: Probe, b: FBox) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sx = Math.max(0, b.x * vw), sy = Math.max(0, b.y * vh);
  const sw = Math.min(vw - sx, b.w * vw), sh = Math.min(vh - sy, b.h * vh);
  if (sw < 4 || sh < 4) return 0;
  p.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, p.w, p.h);
  const d = p.ctx.getImageData(0, 0, p.w, p.h).data;
  const n = p.w * p.h;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += y; sum2 += y * y;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

// Largest face = primary (unchanged behaviour for NO_FACE and pose).
// Extras only count as confirmed MULTIPLE_FACES if clearly textured; ambiguous extras become POSSIBLE_EXTRA_FACE.
function validateFaces(all: LM[][], video: HTMLVideoElement, tex: Probe | null, phoneBoxes: FBox[]) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const sized = all
    .map((lm) => ({ lm, box: lmBox(lm), fH: Math.abs(lm[IDX_CHIN].y - lm[IDX_FOREHEAD].y) }))
    .filter((f) => f.fH >= MIN_FACE_H)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const rejected: string[] = [];
  const info: { box: FBox; tag: string }[] = [];
  if (sized.length === 0) return { faces: [] as LM[][], weakCount: 0, rejected, info };

  const [primary, ...rest] = sized;
  const pStd = tex ? cropStd(video, tex, primary.box) : -1;
  info.push({ box: primary.box, tag: `primary s${pStd.toFixed(0)}` });

  const strong = [];
  const weak = [];

  for (const f of rest) {
    const ratio = f.box.h / primary.box.h;
    const ov = overlapOfSmaller(f.box, primary.box);
    const aspect = (f.box.w * vw) / (f.box.h * vh);
    const std = tex ? cropStd(video, tex, f.box) : -1;
    const why =
      phoneBoxes.some((pb) => overlapOfSmaller(f.box, pb) > 0.5) ? 'on-phone'
      : ratio < EXTRA_MIN_RATIO ? 'small'
      : ov > EXTRA_MAX_OVERLAP ? 'overlap'
      : aspect < EXTRA_ASPECT[0] || aspect > EXTRA_ASPECT[1] ? 'aspect'
      : null;

    if (why) {
      rejected.push(why);
      info.push({ box: f.box, tag: `${why} r${ratio.toFixed(2)} o${ov.toFixed(2)} a${aspect.toFixed(2)} s${std.toFixed(0)}` });
    } else if (std >= EXTRA_STRONG_TEXTURE) {
      strong.push(f);
      info.push({ box: f.box, tag: `STRONG r${ratio.toFixed(2)} o${ov.toFixed(2)} a${aspect.toFixed(2)} s${std.toFixed(0)}` });
    } else {
      weak.push(f);
      info.push({ box: f.box, tag: `WEAK r${ratio.toFixed(2)} o${ov.toFixed(2)} a${aspect.toFixed(2)} s${std.toFixed(0)}` });
    }
  }

  return { faces: [primary.lm, ...strong.map((s) => s.lm)], weakCount: weak.length, rejected, info };
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

  const faceBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // normalized 0..1
  const glowRef = useRef({ base: -1, sat: 0, active: false, since: 0 });
  const lastPredsRef = useRef<{ preds: import('@tensorflow-models/coco-ssd').DetectedObject[]; t: number; vw: number; vh: number } | null>(null);

  const activeInfractions = useRef<Map<ProctoringEvent, { 
    startTime: number; 
    severity: Severity; 
    evidenceSnapshot?: string; 
    detection?: PhoneMeta;
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
    (event: ProctoringEvent, severity: Severity, evidence?: { snapshot?: string; detection?: PhoneMeta }) => {
      if (activeInfractions.current.has(event)) return;

      let snapshot = evidence?.snapshot;
      if (!snapshot && (event === 'MULTIPLE_FACES' || event === 'POSSIBLE_EXTRA_FACE' || event === 'PHONE_DETECTED' || event === 'CAMERA_COVERED')) {
        snapshot = captureSnapshot(videoRef.current);
      }

      activeInfractions.current.set(event, { 
        startTime: Date.now(), 
        severity, 
        evidenceSnapshot: snapshot,
        detection: evidence?.detection,
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
        ...(record.detection ? { detection: record.detection } : {}),
      };
      onViolation?.(flag);
      if (!calibrationMode) push(ref(rtdb, flagPath()), flag);
    },
    [calibrationMode, flagPath, onViolation, videoRef]
  );

  const report = useCallback(
    (event: ProctoringEvent, violating: boolean, severity: Severity) => {
      const h = getHys(event);
      // For SHOULDERS_OUT_OF_FRAME and NO_FACE, require sustained violation (~2.5s) before triggering
      // and clear quickly (~0.8s) once corrected
      const framesToStart = event === 'SHOULDERS_OUT_OF_FRAME' ? 30 : (event === 'NO_FACE' ? 24 : FRAMES_TO_START);
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
            ...(val.detection ? { detection: val.detection } : {}),
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
          try { await model.detect(videoRef.current, 20, 0.20); } catch { /* ok */ }
        }

        let detecting = false;
        let phoneStreak = 0;
        let phoneClearStreak = 0;
        const anchors: Anchor[] = [];
        const snapCanvas = document.createElement('canvas');

        const grabFrame = (v: HTMLVideoElement) => {
          const w = 320, h = Math.round((v.videoHeight / v.videoWidth) * w) || 240;
          if (snapCanvas.width !== w) snapCanvas.width = w;
          if (snapCanvas.height !== h) snapCanvas.height = h;
          snapCanvas.getContext('2d')?.drawImage(v, 0, 0, w, h);
        };

        const annotate = (p: import('@tensorflow-models/coco-ssd').DetectedObject, vw: number) => {
          const ctx = snapCanvas.getContext('2d');
          if (!ctx) return undefined;
          const s = snapCanvas.width / vw;
          const [bx, by, bw, bh] = p.bbox;
          ctx.strokeStyle = '#ff2200'; ctx.lineWidth = 2;
          ctx.strokeRect(bx * s, by * s, bw * s, bh * s);
          ctx.font = 'bold 11px monospace'; ctx.fillStyle = 'rgba(255,34,0,0.9)';
          ctx.fillText(`${p.class.toUpperCase()} ${(p.score * 100).toFixed(0)}%`,
                       bx * s + 2, by * s > 14 ? by * s - 3 : (by + bh) * s + 11);
          return snapCanvas.toDataURL('image/jpeg', 0.6);
        };

        cocoTimer = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || detecting) return;
          try {
            detecting = true;
            const video = videoRef.current;
            const vw = video.videoWidth, vh = video.videoHeight;
            const now = Date.now();

            grabFrame(video); // Exact triggering frame

            let preds: import('@tensorflow-models/coco-ssd').DetectedObject[] = [];
            try { 
              preds = await model.detect(video, 20, 0.20); 
              if (calibrationMode) {
                console.log('[COCO]', preds.map(p => `${p.class} ${(p.score * 100).toFixed(0)}% [${p.bbox.map(Math.round)}]`).join(' | ') || 'none');
              }
            } catch {
              /* ok */
            }

            const face = faceBoxRef.current;
            const behaviourAgrees =
              activeInfractions.current.has('HEAD_PITCH_DOWN') ||
              activeInfractions.current.has('GAZE_AWAY') ||
              activeInfractions.current.has('DUCKING_DOWN') ||
              glowRef.current.active;

            let best: { p: typeof preds[number]; staticMs: number } | null = null;
            let suppressedAny = false;

            for (const p of preds) {
              const nx = (p.bbox[0] + p.bbox[2] / 2) / vw;
              const ny = (p.bbox[1] + p.bbox[3] / 2) / vh;
              const nearFace = face && Math.abs(nx - (face.x + face.w / 2)) < face.w * 1.5 && Math.abs(ny - (face.y + face.h / 2)) < face.h * 1.5;
              const thr = PHONE_CLASSES[p.class] ?? ((glowRef.current.active || behaviourAgrees || nearFace) ? LOOKALIKE[p.class] : undefined);
              if (thr === undefined || p.score < thr) continue;

              const bboxAsBox: Box = [p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]];
              let a = anchors.find((x) => sameSpot(x, bboxAsBox, vw, vh));
              if (a) a.lastSeen = now;
              else {
                a = { cx: p.bbox[0] + p.bbox[2] / 2, cy: p.bbox[1] + p.bbox[3] / 2,
                      w: p.bbox[2], h: p.bbox[3], since: now, lastSeen: now };
                anchors.push(a);
              }
              const staticMs = now - a.since;

              // Unknown face => treat as lap/desk zone and on-face, i.e. never suppress (fail toward flagging)
              const belowChin = face ? ny > face.y + face.h : true;
              const onFace = face ? nx > face.x && nx < face.x + face.w && ny > face.y && ny < face.y + face.h : true;

              if (staticMs >= STATIC_SUPPRESS_MS && !belowChin && !onFace && !behaviourAgrees) {
                suppressedAny = true;
                continue;
              }
              if (!best || p.score > best.p.score) best = { p, staticMs };
            }

            for (let i = anchors.length - 1; i >= 0; i--) {
              if (now - anchors[i].lastSeen > ANCHOR_FORGET_MS) anchors.splice(i, 1);
            }

            // Audit trail: mark the open flag instead of silently dropping it
            if (suppressedAny) {
              const rec = activeInfractions.current.get('PHONE_DETECTED');
              if (rec?.detection) rec.detection.suppressedAsStatic = true;
            }

            if (best) {
              phoneStreak++;
              phoneClearStreak = 0;
              if (phoneStreak >= 3) {
                const rec = activeInfractions.current.get('PHONE_DETECTED');
                if (rec?.detection) {
                  rec.detection.maxStaticMs = Math.max(rec.detection.maxStaticMs, best.staticMs);
                } else {
                  openInfraction('PHONE_DETECTED', 'critical', {
                    snapshot: annotate(best.p, vw),
                    detection: {
                      score: Number(best.p.score.toFixed(3)),
                      box: [
                        Math.round(best.p.bbox[0]),
                        Math.round(best.p.bbox[1]),
                        Math.round(best.p.bbox[2]),
                        Math.round(best.p.bbox[3])
                      ],
                      frameW: vw, 
                      frameH: vh, 
                      maxStaticMs: best.staticMs,
                    },
                  });
                }
              }
            } else {
              phoneClearStreak++;
              phoneStreak = Math.max(0, phoneStreak - 1);
              if (phoneClearStreak >= 2) { 
                closeInfraction('PHONE_DETECTED'); 
                phoneClearStreak = 0; 
              }
            }

            // Save predictions for persistent per-frame rendering by FaceMesh (survives 83ms clearRect)
            lastPredsRef.current = { preds, t: Date.now(), vw: video.videoWidth, vh: video.videoHeight };
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
          minDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });

        const frameProbe = makeProbe(64, 48);
        const texProbe = makeProbe(24, 24);

        faceMesh.onResults((results: { multiFaceLandmarks: LM[][] }) => {
          if (!mounted) return;
          const video = videoRef.current;
          if (!video || video.videoWidth === 0) return;

          const rawCount = results.multiFaceLandmarks.length;

          // Build phoneBoxes from fresh COCO predictions (< 2s old) for phone-overlap veto
          const lp = lastPredsRef.current;
          const phoneBoxes: FBox[] = lp && Date.now() - lp.t < 2000
            ? lp.preds
                .filter((p) => ['cell phone', 'remote', 'laptop'].includes(p.class) && p.score >= 0.2)
                .map((p) => ({ x: p.bbox[0] / lp.vw, y: p.bbox[1] / lp.vh, w: p.bbox[2] / lp.vw, h: p.bbox[3] / lp.vh }))
            : [];

          const { faces: validFaces, weakCount, rejected, info } = validateFaces(results.multiFaceLandmarks, video, texProbe, phoneBoxes);
          if (calibrationMode && rawCount > 1) {
            console.log('[FACES]', info.map(i => i.tag).join(' | '));
          }
          const count = validFaces.length;

          // Glow = sudden jump in near-white pixels vs a slow baseline
          const g = glowRef.current;
          if (frameProbe) {
            const s = frameStats(video, frameProbe);
            const now = Date.now();
            if (g.base < 0) g.base = s.sat;
            g.sat = s.sat;
            g.active = s.sat > Math.max(GLOW_MIN_SAT, g.base * GLOW_RATIO);
            if (g.active) {
              if (!g.since) g.since = now;
              if (now - g.since > 45_000) { g.base = g.sat; g.since = 0; } // lasting change becomes the new normal
            } else {
              g.since = 0;
              g.base += (s.sat - g.base) * 0.02;
            }
          }

          report('NO_FACE', count === 0, 'medium');
          report('MULTIPLE_FACES', count > 1, 'critical');
          report('POSSIBLE_EXTRA_FACE', count === 1 && weakCount > 0, 'medium');
          // Light spike while face geometry breaks = a lit object in front of the lens
          report('FACE_OCCLUDED', g.active && (rawCount !== 1 || count === 0), 'medium');
          pushStatus({ faceDetected: count === 1 });
          if (count !== 1) {
            faceBoxRef.current = null;
          }

          if (overlayCanvasRef?.current) {
            const cv = overlayCanvasRef.current;
            const gx = cv.getContext('2d');
            const W = cv.width, H = cv.height;
            if (gx && W > 0 && H > 0 && count !== 1) {
              gx.fillStyle = 'rgba(255,50,50,0.15)';
              gx.fillRect(0, 0, W, H);
              gx.fillStyle = '#ff4444';
              gx.font = 'bold 13px monospace';
              gx.textAlign = 'center';
              const label = count === 0 
                ? (g.active ? 'FACE OCCLUDED (SCREEN GLOW)' : 'NO FACE DETECTED')
                : `${count} FACES (raw ${rawCount}, rej: ${rejected.join(',') || '-'})`;
              gx.fillText(label, W / 2, H / 2);
              gx.textAlign = 'left';
            }
          }

          if (count === 1) {
            const lm = validFaces[0];
            let minX = 1, minY = 1, maxX = 0, maxY = 0;
            for (const pt of lm) {
              if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
            }
            faceBoxRef.current = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

          if (overlayCanvasRef?.current) {
            const cv = overlayCanvasRef.current;
            const gx = cv.getContext('2d');

            // Persistent rendering of COCO predictions (redrawn each FaceMesh frame after clearRect for 1.2s)
            const lp = lastPredsRef.current;
            if (gx && lp && Date.now() - lp.t < 1200) {
              const face = faceBoxRef.current;
              const sx = cv.width / lp.vw, sy = cv.height / lp.vh;
              for (const p of lp.preds) {
                if (p.score < 0.28) continue;
                const [bx, by, bw, bh] = p.bbox;
                const cnx = (bx + bw / 2) / lp.vw, cny = (by + bh / 2) / lp.vh;
                const nearFace = face && Math.abs(cnx - (face.x + face.w / 2)) < face.w * 1.5 && Math.abs(cny - (face.y + face.h / 2)) < face.h * 1.5;
                const isCheat = p.class in PHONE_CLASSES || ((glowRef.current.active || nearFace) && p.class in LOOKALIKE);
                gx.strokeStyle = isCheat ? '#ff2200' : 'rgba(34,255,136,0.6)';
                gx.lineWidth = isCheat ? 2.5 : 1;
                gx.strokeRect(bx * sx, by * sy, bw * sx, bh * sy);
                gx.fillStyle = isCheat ? 'rgba(255,34,0,0.9)' : 'rgba(34,255,136,0.9)';
                gx.font = 'bold 12px monospace';
                gx.fillText(
                  `${p.class.toUpperCase()} ${(p.score * 100).toFixed(0)}%`,
                  bx * sx + 2,
                  by * sy > 14 ? by * sy - 4 : (by + bh) * sy + 12
                );
              }
            }

            // Draw every raw face candidate box with its stats in calibration mode
            if (calibrationMode && gx) {
              const fSize = Math.max(11, Math.round(cv.width / 45));
              gx.font = `${fSize}px monospace`;
              for (const { box, tag } of info) {
                gx.strokeStyle = tag.startsWith('primary') ? '#22ff88'
                  : tag.startsWith('STRONG') ? '#ff2200'
                  : tag.startsWith('WEAK') ? '#ffd400'
                  : '#888888';
                gx.lineWidth = 2;
                gx.strokeRect(box.x * cv.width, box.y * cv.height, box.w * cv.width, box.h * cv.height);
                gx.fillStyle = gx.strokeStyle;
                gx.fillText(tag, box.x * cv.width + 2, box.y * cv.height + fSize + 2);
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
          
          const track = audioStream?.getAudioTracks()[0];
          const isMuted = !track || track.readyState === 'ended' || track.enabled === false;
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
