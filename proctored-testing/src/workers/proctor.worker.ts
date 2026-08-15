/// <reference lib="webworker" />

// =============================================================================
// ZERO-GC WEB WORKER PROCTORING ENGINE
// Offloads TF.js (COCO-SSD), MediaPipe FaceMesh, and Custom Rect Detector
// from the main thread to guarantee 100% UI responsiveness.
// =============================================================================

import type { FaceMesh } from '@mediapipe/face_mesh';
import type { ObjectDetection } from '@tensorflow-models/coco-ssd';

// Define expected message payload types
type WorkerMessage = 
  | { type: 'INIT'; canvas: OffscreenCanvas; isMobile: boolean }
  | { type: 'PROCESS_FRAME'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'CALIBRATION_MODE'; active: boolean };

// Internal pre-allocated structs for Zero-GC
interface RectResult {
  detected: boolean;
  score: number;
  bbox: { x: number; y: number; w: number; h: number };
  reason: string;
}

// Global pre-allocations to avoid GC spikes inside the inference loop
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
let canvasW = 640;
let canvasH = 480;
let isMobileMode = false;
let calibrationActive = false;

// Models
let faceMeshModel: FaceMesh | null = null;
let cocoModel: ObjectDetection | null = null;

// Rectangle Detector Pre-allocations
const RECT_W = 160;
const RECT_H = 120;
const rectCanvas = new OffscreenCanvas(RECT_W, RECT_H);
const rectCtx = rectCanvas.getContext('2d', { willReadFrequently: true })!;
const gray = new Uint8Array(RECT_W * RECT_H);
const edges = new Uint8Array(RECT_W * RECT_H);
const rowE = new Int32Array(RECT_H);
const colE = new Int32Array(RECT_W);
const smoothRow = new Int32Array(RECT_H);
const smoothCol = new Int32Array(RECT_W);
const hLines = new Int32Array(RECT_H);
const vLines = new Int32Array(RECT_W);
const preallocRectResult: RectResult = { detected: false, score: 0, bbox: { x: 0, y: 0, w: 0, h: 0 }, reason: '' };

// COCO-SSD Pre-allocations
const DETECT_W = 416;
const DETECT_H = 416;
const cocoCanvas = new OffscreenCanvas(DETECT_W, DETECT_H);
const cocoCtx = cocoCanvas.getContext('2d', { willReadFrequently: true })!;
let lastCocoRun = 0;
const PHONE_CLASSES: Record<string, number> = { 'cell phone': 0.28, 'remote': 0.32, 'laptop': 0.38, 'book': 0.42 };

// MediaPipe Pre-allocations
const IDX_NOSE_TIP = 4, IDX_FOREHEAD = 10, IDX_CHIN = 152, IDX_NOSE_BRIDGE = 168, IDX_LEFT_EAR = 234, IDX_RIGHT_EAR = 454;
let lastAlignment = false;

// Hysteresis Counters (pre-allocated)
const hys = {
  PHONE_DETECTED: { v: 0, c: 0 },
  MULTIPLE_FACES: { v: 0, c: 0 },
  GAZE_AWAY: { v: 0, c: 0 },
  HEAD_PITCH_DOWN: { v: 0, c: 0 },
  DUCKING_DOWN: { v: 0, c: 0 },
  SHOULDERS_OUT_OF_FRAME: { v: 0, c: 0 },
};
const FRAMES_TO_START = 14;
const FRAMES_TO_CLEAR = 20;

const activeInfractions = new Map<string, number>();

function report(event: keyof typeof hys, violating: boolean, severity: string) {
  const h = hys[event];
  if (violating) {
    h.v++;
    h.c = 0;
    if (h.v === FRAMES_TO_START && !activeInfractions.has(event)) {
      activeInfractions.set(event, Date.now());
      self.postMessage({ type: 'VIOLATION_START', event, severity });
    }
  } else {
    h.c++;
    h.v = Math.max(0, h.v - 2);
    if (h.c >= FRAMES_TO_CLEAR && activeInfractions.has(event)) {
      activeInfractions.delete(event);
      self.postMessage({ type: 'VIOLATION_CLEAR', event });
      h.v = 0;
      h.c = 0;
    }
  }
}

// ── 1. Init TF.js and MediaPipe ────────────────────────────────────────────────
async function initModels() {
  try {
    // Dynamic import to prevent SSR/bundle issues
    const tf = await import('@tensorflow/tfjs');
    
    // WebGPU > WebGL > WASM > CPU (Strict hardware accel fallback)
    const backends = ['webgpu', 'webgl', 'wasm', 'cpu'] as const;
    for (const backend of backends) {
      try {
        await tf.setBackend(backend);
        await tf.ready();
        console.log(`[Worker] TF.js running on ${backend}`);
        break;
      } catch (e) { /* ignore */ }
    }

    if (!isMobileMode) {
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      cocoModel = await cocoSsd.load({ base: 'mobilenet_v2' });
    }

    const { FaceMesh } = await import('@mediapipe/face_mesh');
    faceMeshModel = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    });

    faceMeshModel.setOptions({
      maxNumFaces: 4,
      refineLandmarks: true,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });

    faceMeshModel.onResults(processFaceMeshResults);
  } catch (err) {
    console.error('[Worker] Model Init Error:', err);
  }
}

// ── 2. Zero-GC Rectangle Detector ─────────────────────────────────────────────
function detectRectangleZeroGC(bitmap: ImageBitmap) {
  rectCtx.drawImage(bitmap, 0, 0, RECT_W, RECT_H);
  const { data } = rectCtx.getImageData(0, 0, RECT_W, RECT_H);

  // Grayscale (in-place)
  for (let i = 0; i < RECT_W * RECT_H; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }

  // Sobel (in-place)
  for (let y = 1; y < RECT_H - 1; y++) {
    for (let x = 1; x < RECT_W - 1; x++) {
      const i = y * RECT_W + x;
      const gx = -gray[i - RECT_W - 1] - 2 * gray[i - 1] - gray[i + RECT_W - 1] +
                  gray[i - RECT_W + 1] + 2 * gray[i + 1] + gray[i + RECT_W + 1];
      const gy = -gray[i - RECT_W - 1] - 2 * gray[i - RECT_W] - gray[i - RECT_W + 1] +
                  gray[i + RECT_W - 1] + 2 * gray[i + RECT_W] + gray[i + RECT_W + 1];
      edges[i] = Math.sqrt(gx * gx + gy * gy) > 40 ? 1 : 0;
    }
  }

  // Reset counters
  rowE.fill(0); colE.fill(0);
  smoothRow.fill(0); smoothCol.fill(0);
  hLines.fill(0); vLines.fill(0);

  for (let y = 0; y < RECT_H; y++) {
    for (let x = 0; x < RECT_W; x++) {
      if (edges[y * RECT_W + x]) {
        rowE[y]++; colE[x]++;
      }
    }
  }

  for (let y = 2; y < RECT_H - 2; y++) smoothRow[y] = rowE[y-2] + rowE[y-1] + rowE[y] + rowE[y+1] + rowE[y+2];
  for (let x = 2; x < RECT_W - 2; x++) smoothCol[x] = colE[x-2] + colE[x-1] + colE[x] + colE[x+1] + colE[x+2];

  let hIdx = 0;
  let vIdx = 0;
  for (let y = 4; y < RECT_H - 4; y++) {
    if (smoothRow[y] >= RECT_W * 0.15 && (hIdx === 0 || y - hLines[hIdx - 1] > 4)) hLines[hIdx++] = y;
  }
  for (let x = 4; x < RECT_W - 4; x++) {
    if (smoothCol[x] >= RECT_H * 0.15 && (vIdx === 0 || x - vLines[vIdx - 1] > 4)) vLines[vIdx++] = x;
  }

  preallocRectResult.detected = false;
  preallocRectResult.score = 0;
  
  if (hIdx < 2 || vIdx < 2) return;

  let bestScore = 0;
  let bestTop = 0, bestBottom = 0, bestLeft = 0, bestRight = 0, bestMeanL = 0;

  for (let i = 0; i < hIdx - 1; i++) {
    for (let j = i + 1; j < hIdx; j++) {
      for (let k = 0; k < vIdx - 1; k++) {
        for (let l = k + 1; l < vIdx; l++) {
          const top = hLines[i], bottom = hLines[j];
          const left = vLines[k], right = vLines[l];
          const rectH = bottom - top;
          const rectW = right - left;
          
          if (rectW < 12 || rectH < 12) continue;
          
          const areaFraction = (rectH / RECT_H) * (rectW / RECT_W);
          const aspect = rectW / rectH;
          const isPhoneAspect = (aspect >= 0.30 && aspect <= 0.85) || (aspect >= 1.15 && aspect <= 3.0);
          
          if (!isPhoneAspect || areaFraction < 0.05) continue;
          
          let sumL = 0, sumSq = 0, n = 0;
          for (let sy = top + 2; sy < bottom - 2; sy += 3) {
            for (let sx = left + 2; sx < right - 2; sx += 3) {
              const lum = gray[sy * RECT_W + sx];
              sumL += lum; sumSq += lum * lum; n++;
            }
          }
          if (n === 0) continue;
          
          const meanL = sumL / n;
          const variance = (sumSq / n) - (meanL * meanL);
          const uniformityScore = Math.max(0, 1 - variance / 2500);
          const darknessScore = Math.max(0, 1 - meanL / 160);
          const baseScore = uniformityScore * 0.7 + darknessScore * 0.3;
          
          if (baseScore > bestScore) {
             bestScore = baseScore;
             bestTop = top; bestBottom = bottom; bestLeft = left; bestRight = right; bestMeanL = meanL;
          }
        }
      }
    }
  }

  if (bestScore === 0) return;

  let borderEdges = 0;
  for (let x = bestLeft; x <= bestRight; x++) {
    if (edges[bestTop * RECT_W + x]) borderEdges++;
    if (edges[bestBottom * RECT_W + x]) borderEdges++;
  }
  for (let y = bestTop; y <= bestBottom; y++) {
    if (edges[y * RECT_W + bestLeft]) borderEdges++;
    if (edges[y * RECT_W + bestRight]) borderEdges++;
  }
  const expectedBorder = (bestRight - bestLeft) * 2 + (bestBottom - bestTop) * 2;
  const borderDensity = borderEdges / expectedBorder;

  let maxLensScore = 0;
  const rh = bestBottom - bestTop;
  for (let cy = bestTop + 2; cy <= bestBottom - 5; cy++) {
    if (cy > bestTop + rh * 0.35 && cy < bestBottom - rh * 0.35) continue;
    for (let cx = bestLeft + 2; cx <= bestRight - 5; cx++) {
      let centerSum = 0, edgeHits = 0;
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = 0; dx <= 2; dx++) {
          centerSum += gray[(cy + dy) * RECT_W + (cx + dx)];
          if (edges[(cy + dy) * RECT_W + (cx + dx)]) edgeHits++;
        }
      }
      const centerMean = centerSum / 9;
      const contrast = Math.abs(centerMean - bestMeanL);
      if (contrast > 12 && edgeHits >= 3) {
        const score = (contrast / 40) * (edgeHits / 6);
        if (score > maxLensScore) maxLensScore = score;
      }
    }
  }

  const lensBoost = Math.min(1.0, maxLensScore) * 0.35;
  const finalScore = (bestScore * 0.5) + (Math.min(1, borderDensity / 0.3) * 0.5) + lensBoost;
  
  preallocRectResult.detected = finalScore >= 0.52 && borderDensity > 0.08;
  preallocRectResult.score = finalScore;
  preallocRectResult.bbox.x = bestLeft / RECT_W;
  preallocRectResult.bbox.y = bestTop / RECT_H;
  preallocRectResult.bbox.w = (bestRight - bestLeft) / RECT_W;
  preallocRectResult.bbox.h = (bestBottom - bestTop) / RECT_H;
  
  // Render rect to offscreen canvas
  if (offscreenCtx) {
    const cx = preallocRectResult.bbox.x * canvasW;
    const cy = preallocRectResult.bbox.y * canvasH;
    const cw = preallocRectResult.bbox.w * canvasW;
    const ch = preallocRectResult.bbox.h * canvasH;
    offscreenCtx.strokeStyle = preallocRectResult.detected ? '#ff2200' : `rgba(255,180,0,${preallocRectResult.score.toFixed(2)})`;
    offscreenCtx.lineWidth = preallocRectResult.detected ? 3 : 1.5;
    offscreenCtx.setLineDash(preallocRectResult.detected ? [] : [6, 4]);
    offscreenCtx.strokeRect(cx, cy, cw, ch);
    offscreenCtx.setLineDash([]);
  }
  
  report('PHONE_DETECTED', preallocRectResult.detected, 'critical');
}

// ── 3. FaceMesh Processor ──────────────────────────────────────────────────────
function processFaceMeshResults(results: any) {
  if (!offscreenCtx) return;
  const count = results.multiFaceLandmarks ? results.multiFaceLandmarks.length : 0;
  
  self.postMessage({ type: 'STATUS', faceDetected: count === 1 });
  report('MULTIPLE_FACES', count > 1, 'critical');

  if (count !== 1) {
    offscreenCtx.fillStyle = 'rgba(255,50,50,0.15)';
    offscreenCtx.fillRect(0, 0, canvasW, canvasH);
    return;
  }

  const lm = results.multiFaceLandmarks[0];
  const noseTip = lm[IDX_NOSE_TIP];
  const leftEar = lm[IDX_LEFT_EAR];
  const rightEar = lm[IDX_RIGHT_EAR];
  const forehead = lm[IDX_FOREHEAD];
  const chin = lm[IDX_CHIN];

  const faceW = rightEar.x - leftEar.x;
  const yawRatio = faceW > 0.01 ? (noseTip.x - leftEar.x) / faceW : 0.5;
  const faceH = chin.y - forehead.y;
  const pitchRatio = faceH > 0.01 ? (noseTip.y - forehead.y) / faceH : 0.5;
  const yawDeg = (yawRatio - 0.5) * 90;
  const pitchDeg = (pitchRatio - 0.5) * 90;
  const gazeAway = Math.abs(yawDeg) > 28 || pitchDeg > 20 || pitchDeg < -18;

  report('GAZE_AWAY', gazeAway, 'medium');

  const headPitchDegrees = Math.atan2(forehead.z - chin.z, chin.y - forehead.y) * (180 / Math.PI);
  
  const dUpper = Math.abs(noseTip.y - lm[IDX_NOSE_BRIDGE].y);
  const dLower = Math.abs(chin.y - noseTip.y);
  const faceRatio = dUpper > 0.001 ? dLower / dUpper : 1.0;
  const isOutOfFrame = forehead.y < 0.02 && chin.y > 0.2;
  
  const headMass = Math.abs(forehead.y - noseTip.y);
  const lowerMass = Math.abs(chin.y - noseTip.y);
  const headVsChinRatio = lowerMass > 0.001 ? headMass / lowerMass : 1.0;
  
  const isDucking = (chin.y > 0.95 && forehead.y < 0.95) || (headVsChinRatio > 1.35);
  const isShouldersOut = chin.y > 0.85;
  const isPitchDown = headPitchDegrees < -15 || pitchDeg > 0.5 || faceRatio < 0.75 || isOutOfFrame;
  
  report('HEAD_PITCH_DOWN', isPitchDown, 'critical');
  report('DUCKING_DOWN', isDucking, 'critical');
  report('SHOULDERS_OUT_OF_FRAME', isShouldersOut, 'high');

  // Render
  offscreenCtx.fillStyle = gazeAway ? 'rgba(255,120,0,0.85)' : 'rgba(0,255,120,0.85)';
  for (let i = 0; i < lm.length; i += 4) {
    offscreenCtx.beginPath();
    offscreenCtx.arc(lm[i].x * canvasW, lm[i].y * canvasH, 1.2, 0, Math.PI * 2);
    offscreenCtx.fill();
  }

  if (calibrationActive) {
    const isCenteredX = noseTip.x > 0.35 && noseTip.x < 0.65;
    const isCenteredY = noseTip.y > 0.35 && noseTip.y < 0.65;
    const isProximityGood = (chin.y - forehead.y) > 0.25;
    const isAligned = isCenteredX && isCenteredY && isProximityGood;
    if (lastAlignment !== isAligned) {
      lastAlignment = isAligned;
      self.postMessage({ type: 'ALIGNMENT', aligned: isAligned });
    }
  }
}

// ── 4. Main Event Listener ─────────────────────────────────────────────────────
self.addEventListener('message', async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.type === 'INIT') {
    offscreenCtx = msg.canvas.getContext('2d', { alpha: true, desynchronized: true });
    canvasW = msg.canvas.width;
    canvasH = msg.canvas.height;
    isMobileMode = msg.isMobile;
    await initModels();
  } else if (msg.type === 'CALIBRATION_MODE') {
    calibrationActive = msg.active;
  } else if (msg.type === 'PROCESS_FRAME') {
    if (!offscreenCtx || !msg.bitmap) return;
    const bmp = msg.bitmap;
    
    if (canvasW !== bmp.width || canvasH !== bmp.height) {
      canvasW = bmp.width;
      canvasH = bmp.height;
      offscreenCtx.canvas.width = canvasW;
      offscreenCtx.canvas.height = canvasH;
    }
    
    // Clear canvas
    offscreenCtx.clearRect(0, 0, canvasW, canvasH);
    
    // 1. Process FaceMesh
    if (faceMeshModel) {
      // FaceMesh requires a canvas element or video. In worker, we can send ImageBitmap directly!
      await faceMeshModel.send({ image: bmp as any });
    }

    // 2. Process Custom Rectangle (Zero GC)
    detectRectangleZeroGC(bmp);

    // 3. Process COCO-SSD (throttled)
    if (cocoModel && !isMobileMode && msg.timestamp - lastCocoRun > 1400) {
      lastCocoRun = msg.timestamp;
      cocoCtx.drawImage(bmp, 0, 0, DETECT_W, DETECT_H);
      const preds = await cocoModel.detect(cocoCanvas as any);
      let cocoDetected = false;
      for (const p of preds) {
        if (p.score >= (PHONE_CLASSES[p.class] || 1.0)) {
          cocoDetected = true;
          offscreenCtx.strokeStyle = '#ff2200';
          offscreenCtx.strokeRect(p.bbox[0] * (canvasW/DETECT_W), p.bbox[1] * (canvasH/DETECT_H), p.bbox[2] * (canvasW/DETECT_W), p.bbox[3] * (canvasH/DETECT_H));
        }
      }
      if (cocoDetected) report('PHONE_DETECTED', true, 'critical');
    }

    // Explicitly release the bitmap from memory to prevent GC spikes
    bmp.close();
  }
});
