'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { isAdmin } from '@/lib/adminUtils';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (isAdmin(user.email)) {
          router.replace('/admin');
        } else {
          router.replace('/waiting-room');
        }
      } else {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleGoogleSignIn = async () => {
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

      // Verify participant
      if (!user.email) throw new Error('No email found on Google account.');
      const pSnap = await getDoc(doc(db, 'participants', user.email));
      if (!pSnap.exists() || pSnap.data()?.allowed !== true) {
        await auth.signOut();
        setError(
          `Your email (${user.email}) is not registered for this examination. Please contact the administrators.`
        );
        setLoading(false);
        return;
      }

      router.replace('/waiting-room');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      if (!message.includes('popup-closed')) {
        setError(message);
      }
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
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-2xl)' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            border: '2px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto var(--space-lg)',
            background: 'var(--bg-card)',
            fontSize: '2rem',
          }}
        >
          
        </div>
        <div
          style={{
            fontSize: '0.6875rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-sm)',
          }}
        >
          BIT Mesra
        </div>
        <h1
          style={{
            fontSize: '2.75rem',
            fontWeight: 800,
            letterSpacing: '-0.04em',
            color: 'var(--white)',
            lineHeight: 1.1,
            marginBottom: 'var(--space-sm)',
          }}
        >
          AeroSoc
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
          Aeronautical Society · Official Examination Portal
        </p>
      </div>

      {/* Login Card */}
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)' }}>Candidate Sign In</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
          Use your registered Google account to access the examination portal. Only pre-approved
          candidates may sign in.
        </p>

        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)', textAlign: 'left' }}>
            {error}
          </div>
        )}

        <button
          id="google-signin-btn"
          className="btn btn-primary btn-lg"
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center', gap: 12 }}
        >
          {loading ? (
            <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
              <path fill="#34A853" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
              <path fill="#FBBC05" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
              <path fill="#EA4335" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
            </svg>
          )}
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>

        <div className="divider" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />

        <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          By signing in, you agree to abide by the examination code of conduct. Your webcam and
          microphone will be required. This session is monitored.
        </p>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 'var(--space-2xl)',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        AERONAUTICAL SOCIETY · BIT MESRA · RANCHI
      </div>
    </main>
  );
}
