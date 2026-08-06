'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { isQuestionSetter, isSpectator } from '@/lib/adminUtils';

export default function RoleGuard({ children, requiredRole }: { children: React.ReactNode, requiredRole: 'Question Setter' | "Spectator's View" }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        const encodeEmail = (e: string) => e.replace(/\./g, ',');
        const key = encodeEmail(user.email.toLowerCase());
        
        const snap = await get(ref(rtdb, `personnel/${key}`));
        if (snap.exists()) {
          const role = snap.val().role;
          if (role === requiredRole) {
            setAuthorized(true);
            setChecking(false);
            return;
          }
        }
      }
      
      router.replace('/');
    });
    return () => unsub();
  }, [router, requiredRole]);

  if (checking) return <div className="loading-center"><div className="spinner" /></div>;
  if (!authorized) return null;

  return <>{children}</>;
}
