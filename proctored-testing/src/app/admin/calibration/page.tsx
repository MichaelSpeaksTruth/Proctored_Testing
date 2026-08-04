'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import AdminGuard from '@/components/AdminGuard';
import WebcamFeed from '@/components/WebcamFeed';
import ProctoringMonitor from '@/components/ProctoringMonitor';
import { ProctoringEvent } from '@/lib/proctoring';
import Link from 'next/link';

function CalibrationContent() {
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [flags, setFlags] = useState<{ id: number; time: string; event: ProctoringEvent }[]>([]);
  const flagsEndRef = useRef<HTMLDivElement>(null);

  const requestPermissions = async () => {
    setRequestingPermissions(true);
    setPermError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      setPermissionsGranted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setPermError(message);
    } finally {
      setRequestingPermissions(false);
    }
  };

  const handleViolation = useCallback((event: ProctoringEvent) => {
    setFlags(prev => [
      ...prev,
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), event }
    ]);
  }, []);

  useEffect(() => {
    if (flagsEndRef.current) {
      flagsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [flags]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [stream]);

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1000, paddingTop: 'var(--space-2xl)' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2xl)' }}>
          <div>
            <h1 style={{ marginBottom: 'var(--space-sm)' }}>System Calibration</h1>
            <p>Locally test AI models, microphone, and camera metrics without affecting production tests.</p>
          </div>
          <Link href="/admin">
            <button className="btn btn-outline">← Back to Dashboard</button>
          </Link>
        </div>

        {!permissionsGranted ? (
          <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ marginBottom: 'var(--space-sm)' }}>Start Calibration</h2>
            <p style={{ marginBottom: 'var(--space-xl)', color: 'var(--text-muted)' }}>
              Enable your camera and microphone to mount the local ProctoringMonitor instance.
            </p>
            {permError && (
              <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)' }}>
                {permError}
              </div>
            )}
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={requestPermissions}
              disabled={requestingPermissions}
            >
              {requestingPermissions ? 'Requesting...' : 'Grant Permissions'}
            </button>
          </div>
        ) : (
          <div className="grid-2" style={{ gap: 'var(--space-xl)', alignItems: 'start' }}>
            {/* Left: Camera Feed */}
            <div className="card" style={{ padding: 'var(--space-md)' }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <WebcamFeed ref={videoRef} stream={stream} />
                
                {/* Mount the monitor locally! */}
                <ProctoringMonitor
                  uid="admin_calibration"
                  videoRef={videoRef}
                  onViolation={handleViolation}
                  calibrationMode={true}
                />
              </div>
              <div style={{ marginTop: 'var(--space-md)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                <strong>Active Models:</strong> FaceMesh, Web Audio API, COCO-SSD.<br/>
                <em>Note: To test fullscreen exit, press F11 or use your browser's fullscreen toggle.</em>
              </div>
            </div>

            {/* Right: Flag Terminal */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 400 }}>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Live Flag Feed</h3>
              <div 
                style={{ 
                  flex: 1, 
                  background: 'var(--bg-primary)', 
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', 
                  padding: 'var(--space-md)',
                  overflowY: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem'
                }}
              >
                {flags.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)' }}>Waiting for proctoring events... Try covering the camera, talking loudly, or showing a phone.</div>
                ) : (
                  flags.map(f => (
                    <div key={f.id} style={{ marginBottom: 4, display: 'flex', gap: 'var(--space-sm)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>[{f.time}]</span>
                      <span style={{ color: f.event.includes('PHONE') || f.event.includes('MULTIPLE') || f.event.includes('COVERED') ? 'var(--accent-red-light)' : 'var(--accent-amber-light)' }}>
                        {f.event}
                      </span>
                    </div>
                  ))
                )}
                <div ref={flagsEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function CalibrationPage() {
  return (
    <AdminGuard>
      <CalibrationContent />
    </AdminGuard>
  );
}
