'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity, DurationFlag } from '@/lib/proctoring';

interface Props {
  uid: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onViolation?: (flag: DurationFlag) => void;
  calibrationMode?: boolean;
}

export default function ProctoringMonitor({ uid, videoRef, onViolation, calibrationMode = false }: Props) {
  // Track ongoing infractions to log their duration. event -> { startTime, severity }
  const activeInfractions = useRef<Map<ProctoringEvent, { startTime: number; severity: Severity }>>(new Map());

  const startInfraction = useCallback((event: ProctoringEvent, severity: Severity) => {
    if (!activeInfractions.current.has(event)) {
      activeInfractions.current.set(event, { startTime: Date.now(), severity });
    }
  }, []);

  const endInfraction = useCallback((event: ProctoringEvent) => {
    const record = activeInfractions.current.get(event);
    if (record) {
      const endTimeMs = Date.now();
      const durationInSeconds = Math.round((endTimeMs - record.startTime) / 1000);
      
      activeInfractions.current.delete(event);
      
      // Only log if it lasted at least 1 second (filters out blips)
      if (durationInSeconds >= 1) {
        const flag: DurationFlag = {
          event,
          severity: record.severity,
          startTime: new Date(record.startTime).toISOString(),
          endTime: new Date(endTimeMs).toISOString(),
          durationInSeconds
        };
        
        onViolation?.(flag);
        
        if (!calibrationMode) {
          const flagsRef = ref(rtdb, `proctoringFlags/${uid}`);
          push(flagsRef, flag);
        }
      }
    }
  }, [uid, onViolation, calibrationMode]);

  useEffect(() => {
    let camera: { start: () => void; stop: () => void } | null = null;
    let audioContext: AudioContext | null = null;
    let audioStream: MediaStream | null = null;
    let faceMeshInstance: { close: () => void } | null = null;
    let rafId: number | null = null;
    let cocoIntervalId: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    // ── 1. Fullscreen & Visibility ────────────────────────────────────
    const handleVisibility = () => {
      if (document.hidden) startInfraction('TAB_SWITCHED', 'critical');
      else endInfraction('TAB_SWITCHED');
    };
    
    const handleFullscreen = () => {
      if (!document.fullscreenElement) startInfraction('LEFT_FULLSCREEN', 'high');
      else endInfraction('LEFT_FULLSCREEN');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', handleFullscreen);

    // ── 2. Object Detection (Phone) using COCO-SSD ────────────────────
    const initObjectDetection = async () => {
      if (!mounted) return;
      try {
        await import('@tensorflow/tfjs');
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        
        let isDetecting = false;
        
        cocoIntervalId = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4 || isDetecting) return;
          try {
            isDetecting = true;
            const predictions = await model.detect(videoRef.current);
            const phoneDetected = predictions.some(p => 
              (p.class === 'cell phone' || p.class === 'remote' || p.class === 'laptop') && p.score > 0.55
            );
            if (phoneDetected) {
              startInfraction('PHONE_DETECTED', 'critical');
            } else {
              endInfraction('PHONE_DETECTED');
            }
          } catch (e) {
            // Ignore inference errors
          } finally {
            isDetecting = false;
          }
        }, 3000); // Check every 3 seconds to vastly reduce CPU/GPU load
      } catch (err) {
        console.warn('COCO-SSD failed to load:', err);
      }
    };
    initObjectDetection();

    // ── 3. Face detection via MediaPipe ───────────────────────────────
    const initFaceMesh = async () => {
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
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results: { multiFaceLandmarks: unknown[][] }) => {
          if (!mounted) return;
          const count = results.multiFaceLandmarks.length;
          if (count !== 1) {
            startInfraction('INVALID_FACE_COUNT', count === 0 ? 'medium' : 'critical');
          } else {
            endInfraction('INVALID_FACE_COUNT');
          }
        });

        faceMeshInstance = faceMesh;

        let isProcessingFace = false;

        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && mounted && !isProcessingFace) {
                try {
                  isProcessingFace = true;
                  await faceMesh.send({ image: videoRef.current });
                } catch (e) {
                  // Catch frame errors
                } finally {
                  isProcessingFace = false;
                }
              }
            },
            width: 320,
            height: 240,
          });
          camera.start();
        }
      } catch (err) {
        console.warn('MediaPipe failed to load:', err);
      }
    };
    initFaceMesh();

    // ── 4. Audio + Camera Covered Check ───────────────────────────────
    const initAudioAndVideoAnalysis = async () => {
      if (!mounted) return;
      
      const hiddenCanvas = document.createElement('canvas');
      hiddenCanvas.width = 64;
      hiddenCanvas.height = 64;
      const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
      
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const src = audioContext.createMediaStreamSource(audioStream);
        src.connect(analyser);
        analyser.fftSize = 256;
        const bufLen = analyser.frequencyBinCount;
        const dataArr = new Float32Array(bufLen);

        let framesSinceLoud = 0;

        const checkAudioAndLuminance = () => {
          if (!mounted) return;
          
          // Audio Check
          analyser.getFloatTimeDomainData(dataArr);
          let sumSq = 0;
          for (let i = 0; i < bufLen; i++) sumSq += dataArr[i] * dataArr[i];
          const rms = Math.sqrt(sumSq / bufLen);
          
          if (rms > 0.15) {
            startInfraction('LOUD_AUDIO', 'medium');
            framesSinceLoud = 0;
          } else {
            framesSinceLoud++;
            // Delay ending the audio infraction slightly to bundle words together
            if (framesSinceLoud > 60) endInfraction('LOUD_AUDIO'); 
          }
          
          // Camera Covered Check (Luminance)
          if (ctx && videoRef.current && videoRef.current.readyState === 4) {
             ctx.drawImage(videoRef.current, 0, 0, 64, 64);
             const frameData = ctx.getImageData(0, 0, 64, 64).data;
             let totalBrightness = 0;
             for (let i = 0; i < frameData.length; i += 4) {
               totalBrightness += (frameData[i] * 0.299 + frameData[i+1] * 0.587 + frameData[i+2] * 0.114);
             }
             const avgBrightness = totalBrightness / (64 * 64);
             
             if (avgBrightness < 15) {
                startInfraction('CAMERA_COVERED', 'critical');
             } else {
                endInfraction('CAMERA_COVERED');
             }
          }

          rafId = requestAnimationFrame(checkAudioAndLuminance);
        };
        checkAudioAndLuminance();
      } catch (err) {
        console.warn('Microphone access failed:', err);
      }
    };
    initAudioAndVideoAnalysis();

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleFullscreen);
      
      // Cleanup infractions that were active when unmounted
      const endMs = Date.now();
      activeInfractions.current.forEach((val, event) => {
         const dur = Math.round((endMs - val.startTime) / 1000);
         if (dur >= 1 && !calibrationMode) {
           push(ref(rtdb, `proctoringFlags/${uid}`), {
             event, severity: val.severity, startTime: new Date(val.startTime).toISOString(), endTime: new Date(endMs).toISOString(), durationInSeconds: dur
           });
         }
      });
      activeInfractions.current.clear();

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cocoIntervalId !== null) clearInterval(cocoIntervalId);
      if (camera) camera.stop();
      if (faceMeshInstance) faceMeshInstance.close();
      if (audioContext) audioContext.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  }, [uid, videoRef, startInfraction, endInfraction, calibrationMode]);

  return null;
}
