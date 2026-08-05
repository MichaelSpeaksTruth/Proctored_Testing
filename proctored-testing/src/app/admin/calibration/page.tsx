'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import AdminGuard from '@/components/AdminGuard';
import WebcamFeed from '@/components/WebcamFeed';
import ProctoringMonitor from '@/components/ProctoringMonitor';
import { ProctoringEvent, DurationFlag } from '@/lib/proctoring';
import Link from 'next/link';

const EVENT_META: Record<ProctoringEvent, { label: string; color: string }> = {
  INVALID_FACE_COUNT: { label: 'Face Count', color: '#f4a261' },
  TAB_SWITCHED:       { label: 'Tab Switch', color: '#e63946' },
  LEFT_FULLSCREEN:    { label: 'Fullscreen Exit', color: '#e63946' },
  LOUD_AUDIO:         { label: 'Loud Audio', color: '#f4a261' },
  CAMERA_COVERED:     { label: 'Camera Covered', color: '#e63946' },
  PHONE_DETECTED:     { label: 'Phone Detected', color: '#e63946' },
  GAZE_AWAY:          { label: 'Gaze Away', color: '#ffd166' },
};

function CalibrationContent() {
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [flags, setFlags] = useState<{ id: number; flag: DurationFlag }[]>([]);
  const flagsEndRef = useRef<HTMLDivElement>(null);

  const requestPermissions = async () => {
    setRequestingPermissions(true);
    setPermError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setPermissionsGranted(true);
    } catch (err: unknown) {
      setPermError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequestingPermissions(false);
    }
  };

  const handleViolation = useCallback((flag: DurationFlag) => {
    setFlags(prev => [...prev, { id: Date.now() + Math.random(), flag }]);
  }, []);

  useEffect(() => {
    flagsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [flags]);

  useEffect(() => () => { stream?.getTracks().forEach(t => t.stop()); }, [stream]);

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1100, paddingTop: 'var(--space-2xl)' }}>

        {/* Header */}
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2xl)' }}>
          <div>
            <h1 style={{ marginBottom: 'var(--space-sm)' }}>System Calibration</h1>
            <p>Test all AI proctoring models locally — no flags are written to the database in this mode.</p>
          </div>
          <Link href="/admin">
            <button className="btn btn-outline">← Dashboard</button>
          </Link>
        </div>

        {!permissionsGranted ? (
          <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ marginBottom: 'var(--space-sm)' }}>Start Calibration</h2>
            <p style={{ marginBottom: 'var(--space-xl)', color: 'var(--text-muted)' }}>
              Camera and microphone access is required to run the proctoring stack locally.
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
              {requestingPermissions ? 'Requesting…' : 'Grant Permissions & Start'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xl)', alignItems: 'start' }}>

            {/* ── Left: Camera + Canvas overlay ── */}
            <div className="card" style={{ padding: 'var(--space-md)' }}>
              <div style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4/3',
                background: '#000',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}>
                {/* Raw video feed */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {/* Canvas overlay for mesh/object boxes */}
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'none',
                  }}
                />
                {/* Live badge */}
                <div style={{
                  position: 'absolute', bottom: 10, left: 10,
                  background: 'rgba(0,0,0,0.65)', padding: '3px 8px',
                  borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span className="webcam-status-dot" style={{ margin: 0 }} />
                  <span style={{ color: '#fff', fontSize: '0.75rem', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
                    LIVE CAMERA
                  </span>
                </div>
              </div>

              {/* Mount ProctoringMonitor */}
              <ProctoringMonitor
                uid="admin_calibration"
                videoRef={videoRef}
                onViolation={handleViolation}
                calibrationMode={true}
                overlayCanvasRef={overlayCanvasRef}
              />

              {/* Legend */}
              <div style={{ marginTop: 'var(--space-md)', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>Active Models:</strong>{' '}
                MediaPipe FaceMesh (w/ iris refinement) · COCO-SSD MobileNetV2 · Web Audio API<br />
                <em>Hysteresis: 14 frames to start, 20 to clear — eliminates false positives.</em><br />
                <em>To test: switch tabs, exit fullscreen (F11), cover camera, talk, or show a phone.</em>
              </div>
            </div>

            {/* ── Right: Live Flag Terminal ── */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h3>Live Flag Feed</h3>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setFlags([])}
                  style={{ fontSize: '0.75rem' }}
                >
                  Clear
                </button>
              </div>

              {/* Event legend pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--space-md)' }}>
                {Object.entries(EVENT_META).map(([k, v]) => (
                  <span key={k} style={{
                    fontSize: '0.6875rem', padding: '2px 7px',
                    borderRadius: 100, border: `1px solid ${v.color}44`,
                    color: v.color, background: `${v.color}11`,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {v.label}
                  </span>
                ))}
              </div>

              {/* Terminal scroll area */}
              <div style={{
                flex: 1,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-md)',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem',
              }}>
                {flags.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)' }}>
                    Waiting for events…<br /><br />
                    The improved engine uses <strong style={{ color: 'var(--text-secondary)' }}>hysteresis</strong> —
                    a violation must persist for ~½s before it is logged, and must resolve for ~⅔s before it clears.
                    This eliminates single-frame false positives.
                  </div>
                ) : (
                  flags.slice().reverse().map(f => {
                    const meta = EVENT_META[f.flag.event] ?? { label: f.flag.event, color: '#888' };
                    const time = new Date(f.flag.endTime).toLocaleTimeString();
                    return (
                      <div key={f.id} style={{
                        marginBottom: 10, paddingBottom: 10,
                        borderBottom: '1px solid var(--border)',
                        display: 'grid',
                        gridTemplateColumns: '80px 1fr auto',
                        gap: 8, alignItems: 'center',
                      }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{time}</span>
                        <span style={{
                          fontWeight: 700, color: meta.color,
                          fontSize: '0.8125rem',
                        }}>
                          {meta.label}
                        </span>
                        <span style={{
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          padding: '1px 6px', borderRadius: 4,
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {f.flag.durationInSeconds}s
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={flagsEndRef} />
              </div>

              {/* Stats bar */}
              {flags.length > 0 && (
                <div style={{
                  marginTop: 'var(--space-md)',
                  display: 'flex', gap: 'var(--space-md)',
                  fontSize: '0.75rem', color: 'var(--text-muted)',
                }}>
                  <span>Total events: <strong style={{ color: 'var(--text-primary)' }}>{flags.length}</strong></span>
                  <span>Critical: <strong style={{ color: '#e63946' }}>
                    {flags.filter(f => f.flag.severity === 'critical').length}
                  </strong></span>
                  <span>Warnings: <strong style={{ color: '#f4a261' }}>
                    {flags.filter(f => f.flag.severity !== 'critical').length}
                  </strong></span>
                </div>
              )}
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
