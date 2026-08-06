'use client';

import { useEffect, useState, useRef } from 'react';

interface Props {
  isAligned: boolean;
  onCalibrationComplete: () => void;
  isHardwareReady: boolean;
}

export default function PreTestCalibration({ isAligned, onCalibrationComplete, isHardwareReady }: Props) {
  const [progress, setProgress] = useState(0);
  const animationRef = useRef<number | null>(null);
  const alignStartTime = useRef<number | null>(null);
  
  const REQUIRED_TIME_MS = 3000;

  useEffect(() => {
    if (!isHardwareReady) {
      setProgress(0);
      alignStartTime.current = null;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    if (!isAligned) {
      setProgress(0);
      alignStartTime.current = null;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    if (isAligned && alignStartTime.current === null) {
      alignStartTime.current = performance.now();
    }

    const tick = (time: number) => {
      if (alignStartTime.current) {
        const elapsed = time - alignStartTime.current;
        const currentProgress = Math.min((elapsed / REQUIRED_TIME_MS) * 100, 100);
        setProgress(currentProgress);

        if (currentProgress >= 100) {
          onCalibrationComplete();
          return; // Stop animation
        }
      }
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isAligned, isHardwareReady, onCalibrationComplete]);

  return (
    <div className="calibration-wrapper" style={{ marginTop: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.875rem' }}>
        <span style={{ color: isAligned ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
          {isAligned ? '✓ Face Aligned' : '⚠ Center your face in the camera'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>{Math.round(progress)}%</span>
      </div>
      <div 
        className="progress-bar-bg" 
        style={{ 
          height: '8px', 
          background: 'rgba(255,255,255,0.1)', 
          borderRadius: '4px', 
          overflow: 'hidden' 
        }}
      >
        <div 
          className="progress-bar-fill"
          style={{ 
            height: '100%', 
            width: `${progress}%`,
            background: isAligned ? 'var(--accent-green)' : 'var(--accent-red)',
            transition: 'width 0.1s linear, background-color 0.3s ease'
          }}
        />
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
        Hold still for 3 seconds to unlock the exam.
      </p>
    </div>
  );
}
