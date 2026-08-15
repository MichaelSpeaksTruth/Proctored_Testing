'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag } from '@/lib/proctoring';

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
  /** Parent's MediaStream — audio track is reused to avoid opening a second getUserMedia session (Android fix) */
  stream?: MediaStream | null;
  /** When true, skips heavy ML models (COCO-SSD) to prevent OOM on low-RAM Android devices */
  isMobile?: boolean;
}

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
  const activeInfractions = useRef<Map<ProctoringEvent, { startTime: number; severity: Severity }>>(new Map());
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => { isSubmittingRef.current = isSubmitting; }, [isSubmitting]);

  const isMobileRef = useRef(isMobile);
  const streamRef = useRef<MediaStream | null>(stream ?? null);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  useEffect(() => { streamRef.current = stream ?? null; }, [stream]);

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

  const flagPath = useCallback(() => {
    if (calibrationMode) return `proctoringFlags/calibration`;
    return testId ? `proctoringFlags/${uid}/${testId}/flags` : `proctoringFlags/${uid}/flags`;
  }, [uid, testId, calibrationMode]);

  const openInfraction = useCallback((event: ProctoringEvent, severity: Severity) => {
    if (activeInfractions.current.has(event)) return;
    activeInfractions.current.set(event, { startTime: Date.now(), severity });
    onViolationStart?.(event, severity);
  }, [onViolationStart]);

  const closeInfraction = useCallback((event: ProctoringEvent) => {
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
    onViolation?.(flag);
    if (!calibrationMode) push(ref(rtdb, flagPath()), flag);
  }, [calibrationMode, flagPath, onViolation]);

  useEffect(() => {
    let mounted = true;
    let audioCtx: AudioContext | null = null;
    let audioStream: MediaStream | null = null;
    let worker: Worker | null = null;
    let rafId: number | null = null;
    let lastFrameTime = 0;

    // ── 1. Tab & Window monitoring ────────────────────────────────────────────
    let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (isSubmittingRef.current) return;
      if (document.hidden) {
        if (visibilityTimeout) { clearTimeout(visibilityTimeout); visibilityTimeout = null; }
        openInfraction('TAB_SWITCHED', 'critical');
      } else {
        const buffer = isMobileRef.current ? 3000 : 1500;
        visibilityTimeout = setTimeout(() => { closeInfraction('TAB_SWITCHED'); }, buffer);
      }
    };

    const onFullscreen = () => {
      if (isSubmittingRef.current) return;
      if (!document.fullscreenElement) { openInfraction('LEFT_FULLSCREEN', 'high'); }
      else { closeInfraction('LEFT_FULLSCREEN'); }
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

    // Global catch for Web Worker crashes
    const workerErrorMsg = (e: ErrorEvent) => {
      console.error('Worker error', e);
      openInfraction('CAMERA_COVERED', 'critical');
    };

    // ── 2. Initialize Web Worker ─────────────────────────────────────────────
    if (overlayCanvasRef?.current) {
      try {
        worker = new Worker(new URL('../workers/proctor.worker.ts', import.meta.url), { type: 'module' });
        worker.addEventListener('error', workerErrorMsg);
        
        worker.addEventListener('message', (e) => {
          const msg = e.data;
          if (msg.type === 'VIOLATION_START') {
            openInfraction(msg.event, msg.severity);
          } else if (msg.type === 'VIOLATION_CLEAR') {
            closeInfraction(msg.event);
          } else if (msg.type === 'STATUS') {
            pushStatus({ faceDetected: msg.faceDetected });
          } else if (msg.type === 'ALIGNMENT') {
            onAlignmentUpdate?.(msg.aligned);
          }
        });

        const offscreen = overlayCanvasRef.current.transferControlToOffscreen();
        worker.postMessage({ type: 'INIT', canvas: offscreen, isMobile: isMobileRef.current }, [offscreen]);
        worker.postMessage({ type: 'CALIBRATION_MODE', active: calibrationMode });

      } catch (e) {
        console.error('Failed to init worker', e);
      }
    }

    // ── 3. Throttled Frame Extraction (10-15 FPS) ────────────────────────────
    const processFrame = async () => {
      if (!mounted || !videoRef.current || !worker) return;
      const video = videoRef.current;
      
      if (video.readyState >= 2 && !video.paused && !video.ended) {
        const now = Date.now();
        // Target 12 FPS (83ms delta) to save CPU
        if (now - lastFrameTime >= 83) {
          lastFrameTime = now;
          try {
            // Zero-copy frame transfer to worker
            const bitmap = await createImageBitmap(video);
            worker.postMessage({ type: 'PROCESS_FRAME', bitmap, timestamp: now }, [bitmap]);
          } catch (e) {
            // Suppress createImageBitmap errors (usually happens when tab is hidden or closing)
          }
        }
      }
      rafId = requestAnimationFrame(processFrame);
    };
    
    if (videoRef.current) {
      processFrame();
    }

    // ── 4. Audio + Camera-covered ─────────────────────────────────────────────
    const initAudio = async () => {
      if (!mounted) return;
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
        let quietFrames = 0;

        const tick = () => {
          if (!mounted) return;
          analyser.getFloatTimeDomainData(timeBuf);
          let sumSq = 0;
          for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
          const rms = Math.sqrt(sumSq / timeBuf.length);
          
          if (rms < 0.0005) quietFrames++; else quietFrames = 0;
          const micWorking = quietFrames < 180; // ~3 seconds at 60fps
          
          pushStatus({ micWorking });
          if (!micWorking) {
            openInfraction('MIC_MUTED', 'critical');
          } else {
            closeInfraction('MIC_MUTED');
          }
          requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        pushStatus({ micWorking: false });
        openInfraction('MIC_MUTED', 'critical');
      }
    };
    initAudio();

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('beforeunload', flushInfractions);
      if (visibilityTimeout) clearTimeout(visibilityTimeout);
      if (rafId) cancelAnimationFrame(rafId);
      if (worker) {
        worker.terminate();
      }
      if (audioCtx) audioCtx.close().catch(() => {});
      flushInfractions();
    };
  }, [
    uid,
    calibrationMode,
    onAlignmentUpdate,
    openInfraction,
    closeInfraction,
    pushStatus,
    videoRef,
    overlayCanvasRef,
    flagPath,
  ]);

  return null;
}
