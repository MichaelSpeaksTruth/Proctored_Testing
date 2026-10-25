'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { isAdmin, PersonnelRole } from '@/lib/adminUtils';

interface RoleGuardProps {
  children: React.ReactNode;
  requiredRole: PersonnelRole | PersonnelRole[];
}

export default function RoleGuard({ children, requiredRole }: RoleGuardProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        // Supreme admins always have full access across all role views
        if (isAdmin(user.email)) {
          setAuthorized(true);
          setChecking(false);
          return;
        }

        const encodeEmail = (e: string) => e.replace(/\./g, ',');
        const key = encodeEmail(user.email.toLowerCase());
        
        try {
          const snap = await get(ref(rtdb, `personnel/${key}`));
          if (snap.exists()) {
            const role = snap.val().role as PersonnelRole;
            const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
            
            if (allowedRoles.includes(role)) {
              setAuthorized(true);
              setChecking(false);
              return;
            }
          }
        } catch (err) {
          console.error('RoleGuard error checking personnel role:', err);
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
