'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { ref, get, update, set } from 'firebase/database';
import { isAdmin, isQuestionSetter, isSpectator } from '@/lib/adminUtils';
import Image from 'next/image';

type Mode = 'candidate' | 'personnel' | 'apply';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('candidate');
  
  // Application form state
  const [applyUser, setApplyUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    position: '',
    rollNumber: '',
    email: '',
    confirmEmail: '',
    mobileNumber: '',
    role: 'Question Setter'
  });
  const [applySuccess, setApplySuccess] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (isAdmin(user.email)) {
          router.replace('/admin');
          return;
        }
        
        const encodeEmail = (e: string) => e.replace(/\./g, ',');
        const key = encodeEmail(user.email!.toLowerCase());

        // Check if they are personnel
        const personnelSnap = await get(ref(rtdb, `personnel/${key}`));
        if (personnelSnap.exists()) {
          const pData = personnelSnap.val();
          if (isQuestionSetter(pData.role)) {
            router.replace('/question-setter');
            return;
          } else if (isSpectator(pData.role)) {
            router.replace('/spectator');
            return;
          }
        }
        
        // Check if they are in candidate participants list
        const pSnap = await get(ref(rtdb, `participants/${key}`));
        if (pSnap.exists() && pSnap.val()?.allowed === true) {
          const val = pSnap.val();
          const tests = val.tests || {};
          const testIds = Object.keys(tests);
          if (testIds.length === 1) {
            localStorage.setItem('pt_selected_test', testIds[0]);
            const subSnap = await get(ref(rtdb, `submissions/${testIds[0]}/${user.uid}`));
            if (subSnap.exists()) {
              router.replace('/student-dashboard');
            } else {
              router.replace('/waiting-room');
            }
          } else {
            router.replace('/select-test');
          }
          return;
        }

        // If neither, just stay on page, maybe they want to apply
        setChecking(false);
      } else {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleGoogleSignIn = async (signInMode: 'candidate' | 'personnel' | 'apply') => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (isAdmin(user.email)) {
        router.replace('/admin');
        return;
      }

      if (!user.email) throw new Error('No email found on Google account.');
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const key = encodeEmail(user.email.toLowerCase());

      if (signInMode === 'candidate') {
        const pSnap = await get(ref(rtdb, `participants/${key}`));
        if (!pSnap.exists() || pSnap.val()?.allowed !== true) {
          await auth.signOut();
          setError(`Your email is not listed in the participants list. Please contact club administration.`);
          setLoading(false);
          return;
        }
        try {
          await update(ref(rtdb, `participants/${key}`), { uid: user.uid });
        } catch (e) {
          console.warn('Could not update participant uid (likely permission denied, which is fine):', e);
        }
        
        const val = pSnap.val();
        const tests = val.tests || {};
        let testIds = Object.keys(tests);

        if (testIds.length > 1) {
          const testsSnap = await get(ref(rtdb, 'tests'));
          const testsVal = testsSnap.val() || {};
          testIds = testIds.filter(tid => testsVal[tid]);
        }

        if (testIds.length === 1) {
          localStorage.setItem('pt_selected_test', testIds[0]);
          const subSnap = await get(ref(rtdb, `submissions/${testIds[0]}/${user.uid}`));
          if (subSnap.exists()) {
            router.replace('/student-dashboard');
          } else {
            router.replace('/waiting-room');
          }
        } else {
          router.replace('/select-test');
        }
      } else if (signInMode === 'personnel') {
        const personnelSnap = await get(ref(rtdb, `personnel/${key}`));
        if (personnelSnap.exists()) {
          const role = personnelSnap.val().role;
          if (isQuestionSetter(role)) router.replace('/question-setter');
          else if (isSpectator(role)) router.replace('/spectator');
          return;
        }
        
        const requestSnap = await get(ref(rtdb, `personnel_requests/${key}`));
        if (requestSnap.exists()) {
          await auth.signOut();
          setError(`Admin verifying your credentials please wait for some time`);
          setLoading(false);
          return;
        }
        
        await auth.signOut();
        setError(`Not allowed`);
        setLoading(false);
      } else if (signInMode === 'apply') {
        // Just set the user for the form
        setApplyUser(user);
        setFormData(prev => ({ ...prev, email: user.email!, name: user.displayName || '' }));
        setLoading(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      if (!message.includes('popup-closed')) setError(message);
      setLoading(false);
    }
  };

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyUser || !applyUser.email) return;
    if (formData.email !== formData.confirmEmail) {
      setError('Emails do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const key = encodeEmail(applyUser.email.toLowerCase());
      await set(ref(rtdb, `personnel_requests/${key}`), {
        uid: applyUser.uid,
        name: formData.name,
        position: formData.position,
        rollNumber: formData.rollNumber,
        email: formData.email,
        mobileNumber: formData.mobileNumber,
        role: formData.role,
        status: 'pending',
        appliedAt: new Date().toISOString()
      });
      setApplySuccess(true);
      await auth.signOut();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Application failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      <div className="landing-layout">
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: '50%',
              border: '2px solid var(--border-light)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto var(--space-lg)',
              background: 'var(--bg-card)', fontSize: '2rem', overflow: 'hidden',
            }}
          >
            <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={72} height={72} style={{ objectFit: 'cover' }} />
          </div>
          <div style={{ fontSize: '0.6875rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
            BIT Mesra
          </div>
          <h1 style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--white)', lineHeight: 1.1, marginBottom: 'var(--space-sm)' }}>
            AeroSoc
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
            Aerospace Society · Official Examination Portal
          </p>
        </div>

        <div className="card landing-card-mobile" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
          {mode === 'candidate' && (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)' }}>Candidate Sign In</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)' }}>
                Use your registered Google account to access the examination portal. Only pre-approved candidates may sign in.
              </p>
              {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)', textAlign: 'left' }}>{error}</div>}
              
              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleGoogleSignIn('candidate')}
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', gap: 12 }}
              >
                {loading ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : 'START TEST'}
              </button>

              <div className="divider" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />
              <div className="flex-col gap-sm">
                <button className="btn btn-ghost" onClick={() => { setError(null); setMode('personnel'); }}>
                  Club Personnel Login
                </button>
                <button className="btn btn-ghost" onClick={() => { setError(null); setMode('apply'); }} style={{ color: 'var(--accent-blue)' }}>
                  Seek Permission: Club Personnel Only
                </button>
              </div>
            </>
          )}

          {mode === 'personnel' && (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)' }}>Personnel Login</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
                Sign in to access your authorized dashboard.
              </p>
              {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)', textAlign: 'left' }}>{error}</div>}
              
              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleGoogleSignIn('personnel')}
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', gap: 12 }}
              >
                {loading ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : 'Continue with Google'}
              </button>

              <div className="divider" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />
              <button className="btn btn-ghost" onClick={() => { setError(null); setMode('candidate'); }}>
                ← Back to Candidate Login
              </button>
            </>
          )}

          {mode === 'apply' && (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)' }}>Seek Permission</h2>
              {applySuccess ? (
                <div className="alert alert-success" style={{ textAlign: 'left' }}>
                  Application submitted successfully. Please wait for admin approval.
                  <div style={{ marginTop: 'var(--space-md)', textAlign: 'center' }}>
                    <button className="btn btn-ghost" onClick={() => { setApplySuccess(false); setMode('candidate'); }}>Return to Login</button>
                  </div>
                </div>
              ) : (
                <>
                  {!applyUser ? (
                    <>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
                        Please verify your identity with Google first before applying.
                      </p>
                      {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)', textAlign: 'left' }}>{error}</div>}
                      <button
                        className="btn btn-primary btn-lg"
                        onClick={() => handleGoogleSignIn('apply')}
                        disabled={loading}
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        {loading ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : 'Verify with Google'}
                      </button>
                    </>
                  ) : (
                    <form onSubmit={handleApplySubmit} style={{ textAlign: 'left' }}>
                      {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}
                      
                      <div className="form-group">
                        <label>Name</label>
                        <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                      </div>
                      <div className="form-group">
                        <label>Position in Club</label>
                        <input required value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})} />
                      </div>
                      <div className="form-group">
                        <label>Roll Number</label>
                        <input required value={formData.rollNumber} onChange={e => setFormData({...formData, rollNumber: e.target.value})} />
                      </div>
                      <div className="form-group">
                        <label>Email (from Google)</label>
                        <input required value={formData.email} disabled />
                      </div>
                      <div className="form-group">
                        <label>Confirm Email</label>
                        <input 
                          required 
                          value={formData.confirmEmail} 
                          onChange={e => setFormData({...formData, confirmEmail: e.target.value})} 
                          onPaste={e => e.preventDefault()}
                          onDrop={e => e.preventDefault()}
                          autoComplete="off"
                        />
                      </div>
                      <div className="form-group">
                        <label>Mobile Number</label>
                        <input required value={formData.mobileNumber} onChange={e => setFormData({...formData, mobileNumber: e.target.value})} />
                      </div>
                      <div className="form-group">
                        <label>Seek permission for</label>
                        <select required value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                          <option value="Question Setter">Question Setter</option>
                          <option value="Spectator's View">Spectator&#39;s View</option>
                        </select>
                      </div>

                      <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--space-md)' }} disabled={loading}>
                        {loading ? 'Submitting...' : 'Submit Application'}
                      </button>
                    </form>
                  )}
                  <div className="divider" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />
                  <button className="btn btn-ghost" onClick={() => { setError(null); setMode('candidate'); setApplyUser(null); }} style={{ width: '100%' }}>
                    ← Back to Candidate Login
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <div style={{ width: '100%', textAlign: 'center', fontSize: '0.75rem', color: 'white', letterSpacing: '0.04em', marginTop: 'var(--space-lg)' }}>
          AEROSPACE SOCIETY · BIT MESRA · RANCHI
        </div>
      </div>
    </main>
  );
}

