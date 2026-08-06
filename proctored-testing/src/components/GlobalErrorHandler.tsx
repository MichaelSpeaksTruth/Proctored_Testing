'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import Link from 'next/link';

export default function GlobalErrorHandler() {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleUnhandledRejection = async (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || event.reason?.toString() || '';
      
      // If Firebase returns a permission denied error, the user likely has 
      // stale credentials or their role was revoked. We must purge and logout.
      if (
        msg.toLowerCase().includes('permission denied') || 
        msg.toLowerCase().includes('missing or insufficient permissions')
      ) {
        console.warn('Permission denied detected. Purging session and forcing logout.');
        event.preventDefault(); // Stop it from bubbling further if possible
        
        setErrorMsg(msg);
        
        try {
          // 1. Purge all local storage states (test answers, cache)
          localStorage.clear();
          sessionStorage.clear();
          
          // 2. Sign out of Firebase
          await signOut(auth);
        } catch (e) {
          console.error('Error during forced logout:', e);
        }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  if (errorMsg) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999, 
        backgroundColor: 'rgba(0,0,0,0.9)', 
        display: 'flex', flexDirection: 'column', 
        alignItems: 'center', justifyContent: 'center',
        padding: '2rem'
      }}>
        <div className="card" style={{ maxWidth: '500px', width: '100%', textAlign: 'center', border: '1px solid var(--accent-red)' }}>
          <h2 style={{ color: 'var(--accent-red)', marginBottom: '1rem' }}>Access Denied</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            A permission error occurred. Your session has been safely cleared.
          </p>
          <div style={{
            backgroundColor: 'rgba(255, 50, 50, 0.1)',
            padding: '1rem',
            borderRadius: '4px',
            fontFamily: 'monospace',
            color: 'var(--accent-red-light)',
            marginBottom: '2rem',
            wordBreak: 'break-word',
            textAlign: 'left'
          }}>
            {errorMsg}
          </div>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => window.location.href = '/'}
          >
            Redirect to Home Screen
          </button>
        </div>
      </div>
    );
  }

  return null;
}
