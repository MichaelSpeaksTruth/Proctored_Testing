'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import Image from 'next/image';
import {
  Settings,
  Users,
  Zap,
  Award,
  Activity,
  Shield,
  FileText,
  ChevronRight,
  MessageSquareQuote,
} from 'lucide-react';

interface TabItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  desc: string;
}

const ADMIN_TABS: TabItem[] = [
  {
    label: 'Team Coordination Corner',
    href: '/tcc',
    icon: <MessageSquareQuote size={18} color="#52b788" />,
    desc: 'Admin & setter live room, dispute resolution',
  },
  {
    label: 'Test Setup',
    href: '/admin/setup',
    icon: <Settings size={18} color="var(--text-secondary)" />,
    desc: 'Create sections, questions, and timers',
  },
  {
    label: 'Participants',
    href: '/admin/participants',
    icon: <Users size={18} color="var(--text-secondary)" />,
    desc: 'Upload and manage examinee emails',
  },
  {
    label: 'Personnel Management',
    href: '/admin/personnel',
    icon: <Shield size={18} color="var(--text-secondary)" />,
    desc: 'Manage Admin L1, Setters, Spectators & Activity Log',
  },
  {
    label: 'Control Panel',
    href: '/admin/control',
    icon: <Zap size={18} color="#ff6b6b" />,
    desc: 'Start, monitor, and end the live test',
  },
  {
    label: 'System Calibration',
    href: '/admin/calibration',
    icon: <Activity size={18} color="#52b788" />,
    desc: 'Test AI proctoring models and sensors',
  },
  {
    label: 'Global Audit Logs',
    href: '/admin/logs',
    icon: <FileText size={18} color="var(--text-secondary)" />,
    desc: 'Inspect, filter, and delete platform activity records',
  },
  {
    label: 'Results & Grading',
    href: '/admin/results',
    icon: <Award size={18} color="#f4a261" />,
    desc: 'Upload answer key, declare results, and review AI reports',
  },
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
    <main className="page-wrapper" style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        {/* Compact Navbar */}
        <nav
          style={{
            marginBottom: 'var(--space-md)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 16px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-xs)', overflow: 'hidden', flexShrink: 0 }}>
              <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={28} height={28} style={{ objectFit: 'cover' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="brand-name" style={{ fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                AeroSoc Admin
              </div>
              <div className="brand-sub desktop-only" style={{ fontSize: '0.625rem', letterSpacing: '0.08em' }}>
                BIT Mesra &middot; Examination Control
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span
              className="badge"
              style={{
                background: 'rgba(155, 34, 38, 0.25)',
                color: '#ff6b6b',
                border: '1px solid rgba(155, 34, 38, 0.6)',
                fontSize: '0.6875rem',
                fontWeight: 700,
                padding: '2px 8px',
              }}
            >
              Admin Sr.
            </span>
            <span className="desktop-only" style={{ fontSize: '0.78125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {email}
            </span>
            <button
              id="admin-signout"
              className="btn btn-outline btn-sm"
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              onClick={() => auth.signOut()}
            >
              Sign Out
            </button>
          </div>
        </nav>

        {/* Dashboard Title Strip */}
        <div
          className="flex justify-between items-center"
          style={{
            marginBottom: 'var(--space-md)',
            padding: '4px 2px',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Admin Dashboard
            </h1>
            <p style={{ fontSize: '0.78125rem', color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
              Manage examination lifecycle and coordination modules.
            </p>
          </div>

          <div className="desktop-only-flex" style={{ alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-xs)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {ADMIN_TABS.length} Modules Available
            </span>
          </div>
        </div>

        {/* High-Density Modular Navigation Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '12px',
          }}
        >
          {ADMIN_TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} style={{ textDecoration: 'none' }}>
              <div
                id={`admin-nav-${tab.label.toLowerCase().replace(/\s+/g, '-')}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  height: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-focus)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.background = 'var(--bg-card)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-xs)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {tab.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginBottom: 2,
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tab.label}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      lineHeight: 1.35,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tab.desc}
                  </div>
                </div>

                <ChevronRight size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} />
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
