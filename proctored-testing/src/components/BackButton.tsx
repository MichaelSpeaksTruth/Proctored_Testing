'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export interface BackButtonProps {
  fallbackUrl?: string;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function BackButton({ fallbackUrl, onClick, className = '', style }: BackButtonProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) {
      onClick();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 2) {
      router.back();
    } else if (fallbackUrl) {
      router.push(fallbackUrl);
    } else {
      router.back();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`back-btn-unified ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: '6px',
        color: '#ffffff',
        fontSize: '0.8125rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        cursor: 'pointer',
        transition: 'all 120ms cubic-bezier(0.4, 0, 0.2, 1)',
        userSelect: 'none',
        flexShrink: 0,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
        lineHeight: 1,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        e.currentTarget.style.transform = 'translateX(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)';
        e.currentTarget.style.transform = 'translateX(0)';
      }}
      title="Back"
      aria-label="Back"
    >
      <ArrowLeft size={15} strokeWidth={2.4} />
      <span>Back</span>
    </button>
  );
}
