'use client';

import { useState, useEffect } from 'react';
import {
  ApprovedPersonnelInfo,
  getApprovedPersonnelList,
  raiseDisputeFromLog,
} from '@/lib/tccService';
import { AuditEvent } from '@/lib/auditLogger';
import { AlertTriangle, Users, CheckCircle, X, ShieldAlert, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDisputeReason('');
      setPriority('high');
      setErrorMsg(null);
      setCreatedSessionId(null);
      setSelectedPersonnel([]);

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

  // Filter out initiator and current user from selectable additional parties list
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

  const selectAll = () => {
    setSelectedPersonnel(availableAdditionalPersonnel);
  };

  const deselectAll = () => {
    setSelectedPersonnel([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setErrorMsg('Unauthorized: You must be signed in as Admin Sr. or Admin L1.');
      return;
    }
    if (!disputeReason.trim()) {
      setErrorMsg('Please specify the dispute reason and requirements.');
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

      setCreatedSessionId(sessionId);
      if (onDisputeCreated) {
        onDisputeCreated(sessionId);
      }
    } catch (err: any) {
      console.error('Failed to raise dispute:', err);
      setErrorMsg(err?.message || 'Failed to raise dispute. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    if (role.includes('Admin Sr.')) {
      return {
        background: 'rgba(155, 34, 38, 0.2)',
        color: '#ff6b6b',
        border: '1px solid rgba(155, 34, 38, 0.5)',
      };
    }
    if (role === 'Admin L1') {
      return {
        background: 'rgba(33, 150, 243, 0.15)',
        color: '#64b5f6',
        border: '1px solid rgba(33, 150, 243, 0.4)',
      };
    }
    return {
      background: 'rgba(45, 106, 79, 0.2)',
      color: '#52b788',
      border: '1px solid rgba(45, 106, 79, 0.5)',
    };
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-md)',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--space-lg)',
          position: 'relative',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={submitting}
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          title="Close modal"
        >
          <X size={20} />
        </button>

        {createdSessionId ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-lg) 0' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(45, 106, 79, 0.2)',
                border: '2px solid var(--accent-green-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto var(--space-md)',
                color: 'var(--accent-green-light)',
              }}
            >
              <CheckCircle size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: 8, color: 'var(--white)' }}>
              Dispute Session Created &amp; Initiator Pinged!
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)' }}>
              A high-priority TCC dispute session has been generated. The log initiator (
              <strong style={{ color: 'var(--white)' }}>{event.actorName}</strong>) has been alerted and
              pinged directly by default, along with your selected parties.
            </p>
            <div className="flex gap-md justify-center">
              <button
                className="btn btn-outline"
                onClick={onClose}
              >
                Close Window
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  router.push(`/tcc?session=${createdSessionId}`);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--accent-red)',
                  borderColor: 'var(--accent-red-light)',
                }}
              >
                <span>Open in Team Coordination Corner</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {/* Header */}
            <div>
              <div className="flex items-center gap-xs" style={{ marginBottom: 4 }}>
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
                  <ShieldAlert size={12} style={{ marginRight: 4, display: 'inline' }} />
                  AUTHORITY DISPUTE ACTION
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Log #{event.id.slice(-6)}
                </span>
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--white)' }}>
                Raise Dispute on Activity Log
              </h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
                This creates an official Team Coordination Corner (TCC) conversation session, pings the log initiator directly, and indexes it within the personnel&apos;s past 50 sessions.
              </p>
            </div>

            {errorMsg && (
              <div
                className="alert alert-danger"
                style={{
                  padding: '8px 12px',
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Target Log Summary Card */}
            <div
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-sm) var(--space-md)',
                fontSize: '0.8125rem',
              }}
            >
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Disputed Log Activity
              </div>
              <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                <div className="flex items-center gap-xs">
                  <span className="badge badge-gray">{event.actionLabel || event.action}</span>
                  <strong style={{ color: 'var(--white)', fontSize: '0.875rem' }}>{event.targetTitle}</strong>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              {event.details?.testTitle && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  Test context: <em>{event.details.testTitle}</em>
                </div>
              )}
            </div>

            {/* Default Involved Parties */}
            <div
              style={{
                background: 'rgba(155, 34, 38, 0.08)',
                border: '1px solid rgba(155, 34, 38, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-sm) var(--space-md)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ff6b6b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} />
                <span>Default Involved Parties (Auto-Included &amp; Pinged):</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                {/* Log Initiator */}
                <div
                  style={{
                    background: 'var(--bg-primary)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid rgba(155, 34, 38, 0.5)',
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
                    <span style={{ fontSize: '0.6875rem', color: '#ff6b6b', fontWeight: 700 }}>
                      LOG INITIATOR (PINGED)
                    </span>
                    <span className="badge" style={{ ...getRoleBadgeStyle(event.actorRole), fontSize: '0.625rem', padding: '1px 6px' }}>
                      {event.actorRole}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--white)', fontSize: '0.8125rem' }}>
                    {event.actorName || event.actorEmail}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {event.actorEmail}
                  </div>
                </div>

                {/* Raiser */}
                <div
                  style={{
                    background: 'var(--bg-primary)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      DISPUTE RAISER (YOU)
                    </span>
                    <span className="badge" style={{ ...getRoleBadgeStyle(currentUser?.role || ''), fontSize: '0.625rem', padding: '1px 6px' }}>
                      {currentUser?.role}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--white)', fontSize: '0.8125rem' }}>
                    {currentUser?.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {currentUser?.email}
                  </div>
                </div>
              </div>
            </div>

            {/* Select Additional Parties to Involve */}
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Users size={14} />
                  <span>Select Additional Parties to Involve ({selectedPersonnel.length} added):</span>
                </label>
                {availableAdditionalPersonnel.length > 0 && (
                  <div className="flex gap-xs">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={selectAll}
                      style={{ fontSize: '0.6875rem', padding: '2px 6px' }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={deselectAll}
                      style={{ fontSize: '0.6875rem', padding: '2px 6px' }}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {loadingPersonnel ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                  Loading eligible personnel...
                </div>
              ) : availableAdditionalPersonnel.length === 0 ? (
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-primary)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border)',
                  }}
                >
                  No other approved personnel registered yet. Only you and the log initiator will be enrolled.
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border)',
                    padding: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {availableAdditionalPersonnel.map((person) => {
                    const isChecked = selectedPersonnel.some((p) => p.encodedEmail === person.encodedEmail);
                    return (
                      <label
                        key={person.encodedEmail}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-xs)',
                          cursor: 'pointer',
                          background: isChecked ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                          transition: 'background var(--transition-fast)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectPersonnel(person)}
                          style={{ cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="flex items-center gap-xs">
                            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--white)' }}>
                              {person.name}
                            </span>
                            <span
                              className="badge"
                              style={{ ...getRoleBadgeStyle(person.role), fontSize: '0.625rem', padding: '1px 6px' }}
                            >
                              {person.role}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {person.email}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dispute Priority & Reason */}
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Dispute Priority:
                </label>
                <div className="flex gap-xs">
                  {(['normal', 'high', 'urgent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`btn btn-sm ${priority === p ? 'btn-primary' : 'btn-ghost'}`}
                      style={{
                        fontSize: '0.75rem',
                        padding: '3px 8px',
                        textTransform: 'capitalize',
                        background:
                          priority === p
                            ? p === 'urgent'
                              ? '#d90429'
                              : p === 'high'
                              ? 'var(--accent-red)'
                              : 'var(--accent-amber)'
                            : undefined,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                Reason &amp; Demanded Rectification <span style={{ color: '#ff6b6b' }}>*</span>:
              </label>
              <textarea
                className="input"
                rows={4}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="State clearly why this action is disputed, any questions or issues found, and what resolution is required..."
                required
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-sm" style={{ marginTop: 'var(--space-xs)' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !disputeReason.trim()}
                style={{
                  background: 'var(--accent-red)',
                  borderColor: 'var(--accent-red-light)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {submitting ? 'Creating Dispute & Pinging...' : 'Raise Dispute & Ping Parties'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
