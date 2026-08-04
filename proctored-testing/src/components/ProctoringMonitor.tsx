'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { ref, push } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { ProctoringEvent, Severity } from '@/lib/proctoring';

interface Props {
  uid: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onViolation?: (event: ProctoringEvent) => void;
  onLockTest?: () => void;
}

export default function ProctoringMonitor({ uid, videoRef, onViolation, onLockTest }: Props) {
  const pendingFlags = useRef<Map<ProctoringEvent, { severity: Severity; ts: string }>>(new Map());
  const flushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // States for fullscreen warning
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);
  const fullscreenExits = useRef(0);
  
  // Ref for camera covered logic
  const darkSinceRef = useRef<number | null>(null);

  const queueFlag = useCallback(
    (event: ProctoringEvent, severity: Severity) => {
      pendingFlags.current.set(event, { severity, ts: new Date().toISOString() });
      onViolation?.(event);
    },
    [onViolation]
  );

  useEffect(() => {
    // Flush buffered flags to RTDB every 5 seconds
    flushRef.current = setInterval(() => {
      if (pendingFlags.current.size === 0) return;
      const flagsRef = ref(rtdb, `proctoringFlags/${uid}`);
      pendingFlags.current.forEach(({ severity, ts }, event) => {
        push(flagsRef, { event, severity, timestamp: ts });
      });
      pendingFlags.current.clear();
    }, 5000);

    return () => {
      if (flushRef.current) clearInterval(flushRef.current);
    };
  }, [uid]);

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
      if (document.hidden) queueFlag('TAB_SWITCHED', 'high');
    };
    
    const handleFullscreen = () => {
      if (!document.fullscreenElement) {
        queueFlag('EXITED_FULLSCREEN', 'high');
        fullscreenExits.current += 1;
        
        if (fullscreenExits.current >= 2) {
           queueFlag('REPEATED_FULLSCREEN_EXIT', 'critical');
           if (onLockTest) onLockTest();
        } else {
           setShowFullscreenWarning(true);
        }
      } else {
        setShowFullscreenWarning(false);
      }
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
        
        cocoIntervalId = setInterval(async () => {
          if (!mounted || !videoRef.current || videoRef.current.readyState !== 4) return;
          try {
            const predictions = await model.detect(videoRef.current);
            const phoneDetected = predictions.some(p => p.class === 'cell phone' && p.score > 0.6);
            if (phoneDetected) {
              queueFlag('PHONE_DETECTED', 'critical');
            }
          } catch (e) {
            // Ignore inference errors on corrupted frames
          }
        }, 2000);
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
          if (count === 0) {
            queueFlag('NO_FACE_DETECTED', 'high');
          } else if (count > 1) {
            queueFlag('MULTIPLE_FACES', 'critical');
          }
        });

        faceMeshInstance = faceMesh;

        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && mounted) {
                await faceMesh.send({ image: videoRef.current });
              }
            },
            width: 320,
            height: 240,
          });
          camera.start();
        }
      } catch (err) {
        console.warn('MediaPipe failed to load, skipping face detection:', err);
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

        const checkAudioAndLuminance = () => {
          if (!mounted) return;
          
          // Audio Check
          analyser.getFloatTimeDomainData(dataArr);
          let sumSq = 0;
          for (let i = 0; i < bufLen; i++) sumSq += dataArr[i] * dataArr[i];
          const rms = Math.sqrt(sumSq / bufLen);
          if (rms > 0.15) queueFlag('LOUD_AUDIO', 'medium');
          
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
                if (!darkSinceRef.current) {
                  darkSinceRef.current = Date.now();
                } else if (Date.now() - darkSinceRef.current > 3000) {
                  queueFlag('CAMERA_COVERED', 'critical');
                }
             } else {
                darkSinceRef.current = null;
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
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cocoIntervalId !== null) clearInterval(cocoIntervalId);
      if (camera) camera.stop();
      if (faceMeshInstance) faceMeshInstance.close();
      if (audioContext) audioContext.close();
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    };
  }, [uid, videoRef, queueFlag, onLockTest]);

  if (showFullscreenWarning) {
     return (
       <div style={{
         position: 'fixed', inset: 0, zIndex: 99998,
         background: 'var(--bg-primary)',
         display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
         padding: 'var(--space-xl)', textAlign: 'center'
       }}>
          <h2 style={{ color: 'var(--accent-red-light)', fontSize: '2rem', marginBottom: 'var(--space-md)' }}>
            Fullscreen Exited
          </h2>
          <p style={{ fontSize: '1.125rem', color: 'var(--text-primary)', marginBottom: 'var(--space-xl)', maxWidth: 500 }}>
            You have left fullscreen mode. Please return to fullscreen immediately. 
            <br/><br/>
            <strong>1 warning remaining.</strong> If you exit again, your exam will be terminated.
          </p>
          <button 
             className="btn btn-danger btn-lg" 
             onClick={() => document.documentElement.requestFullscreen().catch(console.error)}
          >
             Return to Fullscreen
          </button>
       </div>
     );
  }

  return null;
}
