'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { isAdmin } from '@/lib/adminUtils';

export default function StudentGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        router.replace('/');
        return;
      }
      if (isAdmin(user.email)) {
        router.replace('/admin');
        return;
      }
      // Check participant list
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const key = encodeEmail(user.email.toLowerCase());
      
      const snap = await get(ref(rtdb, `participants/${key}`));
      if (!snap.exists() || snap.val()?.allowed !== true) {
        setError(`Your email (${user.email}) is not registered for this exam. Please contact the admin.`);
        setChecking(false);
        return;
      }
      setChecking(false);
    });
    return () => unsub();
  }, [router]);

  if (checking && !error) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <p>Verifying access…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-center">
        <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h3 style={{ color: 'var(--accent-red-light)', marginBottom: 12 }}>Access Denied</h3>
          <p>{error}</p>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 24 }} onClick={() => auth.signOut().then(() => router.replace('/'))}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
