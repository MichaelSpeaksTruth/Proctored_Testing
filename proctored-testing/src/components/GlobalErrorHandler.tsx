'use client';

import { useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';

export default function GlobalErrorHandler() {
  useEffect(() => {
    const handleUnhandledRejection = async (event: PromiseRejectionEvent) => {
      const errorMsg = event.reason?.message || event.reason?.toString() || '';
      
      // If Firebase returns a permission denied error, the user likely has 
      // stale credentials or their role was revoked. We must purge and logout.
      if (
        errorMsg.toLowerCase().includes('permission denied') || 
        errorMsg.toLowerCase().includes('missing or insufficient permissions')
      ) {
        console.warn('Permission denied detected. Purging session and forcing logout.');
        
        try {
          // 1. Purge all local storage states (test answers, cache)
          localStorage.clear();
          sessionStorage.clear();
          
          // 2. Sign out of Firebase
          await signOut(auth);
        } catch (e) {
          console.error('Error during forced logout:', e);
        } finally {
          // 3. Force hard redirect to home page
          window.location.href = '/';
        }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
