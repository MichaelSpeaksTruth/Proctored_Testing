'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ApprovedPersonnelInfo,
  getApprovedPersonnelList,
  raiseDisputeFromLog,
} from '@/lib/tccService';
import { AuditEvent } from '@/lib/auditLogger';
import { Users, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import BackButton from '@/components/BackButton';

interface RaiseDisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: AuditEvent | null;
  currentUser: ApprovedPersonnelInfo | null;
  onDisputeCreated?: (sessionId: string) => void;
}

export default function RaiseDisputeModal({
  isOpen,
  onClose,
  event,
  currentUser,
  onDisputeCreated,
}: RaiseDisputeModalProps) {
  const router = useRouter();
  const [allPersonnel, setAllPersonnel] = useState<ApprovedPersonnelInfo[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<ApprovedPersonnelInfo[]>([]);
  const [disputeReason, setDisputeReason] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('high');
  const [loadingPersonnel, setLoadingPersonnel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPersonnelList, setShowPersonnelList] = useState(false);
  const modalCardRef = useRef<HTMLDivElement>(null);

  // Outside-click & Escape dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (
        !submitting &&
        modalCardRef.current &&
        target &&
        !modalCardRef.current.contains(target)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, submitting, onClose]);

  useEffect(() => {
    if (isOpen) {
      setDisputeReason('');
      setPriority('high');
      setErrorMsg(null);
      setSelectedPersonnel([]);
      setShowPersonnelList(false);

      setLoadingPersonnel(true);
      getApprovedPersonnelList()
        .then((list) => {
          setAllPersonnel(list);
        })
        .catch((err) => {
          console.error('Failed to load personnel list:', err);
        })
        .finally(() => {
          setLoadingPersonnel(false);
        });
    }
  }, [isOpen]);

  if (!isOpen || !event) return null;

  const initiatorEmail = (event.actorEmail || '').trim().toLowerCase();
  const currentEmail = (currentUser?.email || '').trim().toLowerCase();

  // Additional personnel who aren't the initiator or current user
  const availableAdditionalPersonnel = allPersonnel.filter(
    (p) => p.email.toLowerCase() !== initiatorEmail && p.email.toLowerCase() !== currentEmail
  );

  const toggleSelectPersonnel = (person: ApprovedPersonnelInfo) => {
    if (selectedPersonnel.some((p) => p.encodedEmail === person.encodedEmail)) {
      setSelectedPersonnel((prev) => prev.filter((p) => p.encodedEmail !== person.encodedEmail));
    } else {
      setSelectedPersonnel((prev) => [...prev, person]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setErrorMsg('Unauthorized: You must be signed in as Admin Sr. or Admin L1.');
      return;
    }
    if (!disputeReason.trim()) {
      setErrorMsg('Please specify the dispute reason.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const detailsSnippet = event.details
        ? Object.entries(event.details)
            .filter(([_, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}: ${v}`)
            .join(' | ')
        : undefined;

      const sessionId = await raiseDisputeFromLog({
        raiser: currentUser,
        disputeReason: disputeReason.trim(),
        priority,
        logItem: {
          id: event.id,
          timestamp: event.timestamp,
          actorEmail: event.actorEmail,
          actorName: event.actorName,
          actorRole: event.actorRole,
          action: event.action,
          actionLabel: event.actionLabel || event.action,
          targetTitle: event.targetTitle,
          detailsSnippet,
        },
        additionalSelectedParticipants: selectedPersonnel,
      });

      if (onDisputeCreated) {
        onDisputeCreated(sessionId);
      }

      onClose();
      // Seamlessly redirect raiser directly to the new TCC session with zero AI slop
      router.push(`/tcc?session=${sessionId}`);
    } catch (err: any) {
      console.error('Failed to raise dispute:', err);
      setErrorMsg(err?.message || 'Failed to raise dispute. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        ref={modalCardRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 540,
          background: '#0d0f12',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '12px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
          padding: '20px',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Header Bar with BackButton */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BackButton onClick={onClose} />
            <h2 style={{ fontSize: '1.1875rem', fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Dispute Log Activity
            </h2>
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            #{event.id.slice(-6)}
          </span>
        </div>

        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(155, 34, 38, 0.2)',
              border: '1px solid rgba(155, 34, 38, 0.5)',
              color: '#ff6b6b',
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Target Activity Summary */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: '0.8125rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>{event.actionLabel || event.action}</span>
                <strong style={{ color: '#ffffff' }}>{event.targetTitle}</strong>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Initiator: <strong style={{ color: '#ffffff' }}>{event.actorName || event.actorEmail}</strong> ({event.actorRole})
            </div>
          </div>

          {/* Involved Parties Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              padding: '4px 2px',
            }}
          >
            <div>
              Auto-Pinged: <strong style={{ color: '#ff6b6b' }}>{event.actorName || event.actorEmail}</strong>
            </div>
            <div>
              Raiser: <strong style={{ color: 'var(--text-primary)' }}>{currentUser?.name || 'You'}</strong>
            </div>
          </div>

          {/* Reason / Grounds */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Dispute Grounds <span style={{ color: '#ff6b6b' }}>*</span>
              </label>

              {/* Priority Pills */}
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['high', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      border: priority === p ? '1px solid #ff6b6b' : '1px solid rgba(255, 255, 255, 0.12)',
                      background: priority === p ? 'rgba(155, 34, 38, 0.35)' : 'transparent',
                      color: priority === p ? '#ff6b6b' : 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="input"
              rows={3}
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="State the reason or required clarification..."
              required
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                resize: 'vertical',
                background: '#090b0e',
                borderColor: 'rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                padding: '8px 10px',
              }}
            />
          </div>

          {/* Optional Additional Citizens */}
          {availableAdditionalPersonnel.length > 0 && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => setShowPersonnelList(!showPersonnelList)}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Users size={13} />
                  <span>
                    Additional Citizens ({selectedPersonnel.length} added)
                  </span>
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-green-light)', fontWeight: 600 }}>
                  {showPersonnelList ? 'Hide' : '+ Manage'}
                </span>
              </div>

              {showPersonnelList && (
                <div
                  className="custom-scrollbar"
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    background: '#090b0e',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: 4,
                    marginTop: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {loadingPersonnel ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '6px 8px' }}>
                      Loading citizens...
                    </div>
                  ) : (
                    availableAdditionalPersonnel.map((person) => {
                      const isSelected = selectedPersonnel.some((p) => p.encodedEmail === person.encodedEmail);
                      return (
                        <div
                          key={person.encodedEmail}
                          onClick={() => toggleSelectPersonnel(person)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                            border: isSelected ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid transparent',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              style={{ accentColor: '#22c55e', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.8125rem', color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {person.name}
                            </span>
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                              ({person.role})
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Form Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={submitting}
              style={{ fontSize: '0.8125rem', padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting || !disputeReason.trim()}
              style={{
                fontSize: '0.8125rem',
                fontWeight: 700,
                padding: '7px 18px',
                background: '#d90429',
                borderColor: '#ef233c',
              }}
            >
              {submitting ? 'Creating...' : 'Open Dispute in TCC'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
