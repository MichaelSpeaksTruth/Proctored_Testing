'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import { Clock, CheckCircle, XCircle, Check } from 'lucide-react';
import Image from 'next/image';

function WaitingRoomContent() {
  const router = useRouter();
  const [user, setUser] = useState<{ displayName: string | null; email: string | null } | null>(null);
  const [testStatus, setTestStatus] = useState<string>('pending');
  const [scheduledStart, setScheduledStart] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUser({ displayName: u.displayName, email: u.email });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const selectedTestId = localStorage.getItem('pt_selected_test');
    
    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      
      // If a different test is currently active/scheduled globally, ignore it
      if (data.activeTestId && selectedTestId && data.activeTestId !== selectedTestId) {
        setTestStatus('pending');
        return;
      }
      
      setTestStatus(data.status || 'pending');
      setScheduledStart(data.scheduledStart || null);
      if (data.status === 'active' && data.activeTestId === selectedTestId) {
        router.replace('/test');
      }
    });
    return () => unsub();
  }, [router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-xl)',
      }}
    >
      <div className="card" style={{ maxWidth: 960, width: '100%', padding: 'var(--space-xl)', margin: 'auto' }}>
        <div className="grid-2" style={{ gap: 'var(--space-xl)', alignItems: 'center' }}>
          
          {/* Left Column - Status */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, margin: '0 auto var(--space-md)', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--border-light)' }}>
              <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={72} height={72} style={{ objectFit: 'cover' }} />
            </div>
            <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-xs)', letterSpacing: '-0.02em' }}>Waiting Room</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', fontSize: '0.9375rem' }}>
              Welcome, <strong style={{ color: 'var(--text-primary)' }}>{user?.displayName || user?.email}</strong>.
            </p>

            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-lg)',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Subtle animated glow behind status */}
              {testStatus === 'active' && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '100%', height: '100%', background: 'radial-gradient(circle, rgba(82, 183, 136, 0.15) 0%, transparent 70%)', zIndex: 0, animation: 'pulse 2s infinite' }} />
              )}
              
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div
                  style={{
                    fontSize: '0.6875rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    marginBottom: 8,
                  }}
                >
                  Test Status
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: testStatus === 'active' ? '#52b788' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                >
                  {testStatus === 'pending' && <><Clock size={20} /> Waiting for Admin</>}
                  {testStatus === 'active' && <><CheckCircle size={20} /> Test Active - Redirecting...</>}
                  {testStatus === 'ended' && <><XCircle size={20} /> Test Ended</>}
                </div>

                {scheduledStart && testStatus === 'pending' && (
                  <div style={{ marginTop: 'var(--space-sm)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Scheduled start:{' '}
                    <strong style={{ color: 'var(--text-secondary)' }}>
                      {new Date(scheduledStart).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Instructions */}
          <div style={{ textAlign: 'left', background: 'var(--bg-secondary)', padding: 'var(--space-lg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.9375rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={18} color="var(--text-muted)" /> Before You Begin
            </h3>
            
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                'Ensure you are in a well-lit, quiet room',
                'Your webcam and microphone will be required',
                'The test must run in fullscreen mode',
                'Do not switch tabs or minimize the window',
                'Keep your face clearly visible in the webcam',
                'Multiple faces in the frame will be flagged',
              ].map((rule, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <div style={{ marginTop: 2 }}><Check size={14} color="var(--accent-green-light)" /></div>
                  {rule}
                </li>
              ))}
            </ul>
            
            <div className="divider" style={{ margin: 'var(--space-lg) 0 var(--space-md)' }} />
            
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                className="btn btn-ghost btn-sm"
                id="signout-waiting"
                onClick={() => auth.signOut()}
                style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}
              >
                ← Sign out and return home
              </button>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

export default function WaitingRoomPage() {
  return (
    <StudentGuard>
      <WaitingRoomContent />
    </StudentGuard>
  );
}
