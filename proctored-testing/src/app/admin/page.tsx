'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import Image from 'next/image';

import { Settings, Users, Zap, Award, Activity, Shield } from 'lucide-react';

const ADMIN_TABS = [
  { label: 'System Calibration', href: '/admin/calibration', icon: <Activity size={24} color="var(--accent-green)" />, desc: 'Test AI proctoring models and sensors' },
  { label: 'Test Setup', href: '/admin/setup', icon: <Settings size={24} color="var(--text-muted)" />, desc: 'Create sections, questions, and timers' },
  { label: 'Participants', href: '/admin/participants', icon: <Users size={24} color="var(--text-muted)" />, desc: 'Upload and manage examinee emails' },
  { label: 'Personnel Management', href: '/admin/personnel', icon: <Shield size={24} color="var(--text-muted)" />, desc: 'Manage Admin L1, Setters, Spectators & Activity Log' },
  { label: 'Control Panel', href: '/admin/control', icon: <Zap size={24} color="var(--accent-red)" />, desc: 'Start, monitor, and end the live test' },
  { label: 'Results & Grading', href: '/admin/results', icon: <Award size={24} color="var(--accent-amber)" />, desc: 'Upload answer key, declare results, and review AI proctoring reports' },
];

function AdminHomeContent() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setEmail(u?.email || null);
    });
    return () => unsub();
  }, []);

  return (
    <main className="page-wrapper" style={{ minHeight: '100vh', padding: 'var(--space-md) 0' }}>
      <div className="container">
      {/* Navbar */}
      <nav className="navbar" style={{ marginBottom: 'var(--space-2xl)', borderRadius: 'var(--radius-lg)' }}>
        <div className="brand">
          <div style={{ width: 32, height: 32, borderRadius: '4px', overflow: 'hidden' }}>
            <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={32} height={32} style={{ objectFit: 'cover' }} />
          </div>
          <div>
            <div className="brand-name">AeroSoc Admin</div>
            <div className="brand-sub">BIT Mesra · Examination Control</div>
          </div>
        </div>
        <div className="flex items-center gap-md navbar-actions">
          <span
            className="badge"
            style={{
              background: 'rgba(155, 34, 38, 0.25)',
              color: '#ff6b6b',
              border: '1px solid rgba(155, 34, 38, 0.6)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            Admin Sr.
          </span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {email}
          </span>
          <button
            id="admin-signout"
            className="btn btn-outline btn-sm"
            onClick={() => auth.signOut()}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={{ marginBottom: 'var(--space-2xl)' }}>
          <h1 style={{ marginBottom: 'var(--space-sm)' }}>Admin Dashboard</h1>
          <p>Manage the examination lifecycle from setup to results declaration.</p>
        </div>

        <div className="grid-2" style={{ gap: 'var(--space-lg)' }}>
          {ADMIN_TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} style={{ textDecoration: 'none' }}>
              <div
                className="card"
                id={`admin-nav-${tab.label.toLowerCase().replace(/\s+/g, '-')}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-lg)',
                  cursor: 'pointer',
                  transition: 'border-color 200ms ease',
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    flexShrink: 0,
                  }}
                >
                  {tab.icon}
                </div>
                <div>
                  <h3 style={{ marginBottom: 4 }}>{tab.label}</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{tab.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminHomeContent />
    </AdminGuard>
  );
}
