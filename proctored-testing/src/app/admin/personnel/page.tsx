'use client';

import { useState, useEffect, useCallback } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, get, set, remove } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import EventsAuditView from '@/components/EventsAuditView';
import { logAuditEvent } from '@/lib/auditLogger';

interface PersonnelRequest {
  id: string; // encoded email key
  uid: string;
  name: string;
  position: string;
  rollNumber: string;
  email: string;
  mobileNumber: string;
  role: string;
  status: string;
  appliedAt: string;
}

interface ApprovedPersonnel {
  id: string;
  uid?: string;
  name: string;
  email: string;
  position: string;
  role: string;
  approvedAt?: string;
}

function PersonnelManagement() {
  const [activeTab, setActiveTab] = useState<'personnel' | 'events'>('personnel');
  const [requests, setRequests] = useState<PersonnelRequest[]>([]);
  const [approvedPersonnel, setApprovedPersonnel] = useState<ApprovedPersonnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const getAdminActor = () => {
    const user = auth.currentUser;
    const actorEmail = user?.email || process.env.NEXT_PUBLIC_ADMIN_1 || 'admin@aerosoc';
    const actorName = `${user?.displayName || 'Admin'} (Admin Sr.)`;
    return { actorEmail, actorName, actorRole: 'Admin Sr.' as const };
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const [reqSnap, perSnap] = await Promise.all([
      get(ref(rtdb, 'personnel_requests')),
      get(ref(rtdb, 'personnel')),
    ]);

    const reqVal = reqSnap.val();
    if (reqVal) {
      const parsed: PersonnelRequest[] = Object.keys(reqVal).map(key => ({
        id: key,
        ...reqVal[key],
      }));
      setRequests(parsed);
    } else {
      setRequests([]);
    }

    const perVal = perSnap.val();
    if (perVal) {
      const parsed: ApprovedPersonnel[] = Object.keys(perVal).map(key => ({
        id: key,
        ...perVal[key],
      }));
      setApprovedPersonnel(parsed);
    } else {
      setApprovedPersonnel([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = async (req: PersonnelRequest) => {
    setLoading(true);
    try {
      // Add to personnel
      await set(ref(rtdb, `personnel/${req.id}`), {
        uid: req.uid,
        name: req.name,
        email: req.email,
        role: req.role,
        position: req.position,
        approvedAt: new Date().toISOString(),
      });

      // Remove from requests
      await remove(ref(rtdb, `personnel_requests/${req.id}`));

      // Audit Log
      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'APPROVE_PERSONNEL',
        actionLabel: 'Approved Personnel Request',
        targetTitle: `${req.name} (${req.role})`,
        details: {
          personnelEmail: req.email,
          personnelName: req.name,
          grantedRole: req.role,
          position: req.position,
        },
      });

      setMsg(`Approved ${req.name} as ${req.role}.`);
      await fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMsg(`Failed to approve request: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (req: PersonnelRequest) => {
    if (!confirm(`Are you sure you want to reject the application for ${req.name}?`)) return;
    setLoading(true);
    try {
      await remove(ref(rtdb, `personnel_requests/${req.id}`));

      // Audit Log
      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'REJECT_PERSONNEL',
        actionLabel: 'Rejected Personnel Request',
        targetTitle: `${req.name} (${req.role})`,
        details: {
          personnelEmail: req.email,
          personnelName: req.name,
          rejectedRole: req.role,
        },
      });

      setMsg(`Rejected application for ${req.name}.`);
      await fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMsg(`Failed to reject request: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Revoke access for ${name}? They will lose permissions immediately.`)) return;
    setLoading(true);
    try {
      const snap = await get(ref(rtdb, `personnel/${id}`));
      const personData = snap.val();

      await remove(ref(rtdb, `personnel/${id}`));

      // Audit Log
      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'REVOKE_PERSONNEL',
        actionLabel: 'Revoked Personnel Role',
        targetTitle: `${name}`,
        details: {
          personnelEmail: personData?.email || id,
          personnelName: name,
          revokedRole: personData?.role,
        },
      });

      setMsg(`Access revoked for ${name}.`);
      await fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMsg(`Failed to revoke access: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderRoleBadge = (role: string) => {
    if (role === 'Admin L1') {
      return (
        <span
          className="badge badge-gray"
          style={{
            borderRadius: '2px',
            padding: '2px 7px',
            fontSize: '0.6875rem',
            whiteSpace: 'nowrap',
          }}
        >
          Admin L1
        </span>
      );
    }
    if (role === 'Question Setter') {
      return (
        <span
          className="badge badge-green"
          style={{
            borderRadius: '2px',
            padding: '2px 7px',
            fontSize: '0.6875rem',
            whiteSpace: 'nowrap',
          }}
        >
          Question Setter
        </span>
      );
    }
    if (role === "Spectator's View") {
      return (
        <span
          className="badge badge-amber"
          style={{
            borderRadius: '2px',
            padding: '2px 7px',
            fontSize: '0.6875rem',
            whiteSpace: 'nowrap',
          }}
        >
          Spectator&apos;s View
        </span>
      );
    }
    return (
      <span
        className="badge badge-gray"
        style={{
          borderRadius: '2px',
          padding: '2px 7px',
          fontSize: '0.6875rem',
          whiteSpace: 'nowrap',
        }}
      >
        {role}
      </span>
    );
  };

  return (
    <main style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        {/* Navigation & Title */}
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            &larr; Back
          </Link>
          <div>
            <h1 style={{ fontSize: '1.5rem', margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Personnel &amp; RBAC Management
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 4 }}>
              Administer role allocations and inspect activity audit logs.
            </p>
          </div>
        </div>

        {/* Tab switch bar */}
        <div
          className="flex gap-sm"
          style={{
            marginBottom: 'var(--space-lg)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 'var(--space-sm)',
            overflowX: 'auto',
          }}
        >
          <button
            className={`btn btn-sm ${activeTab === 'personnel' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('personnel')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Personnel &amp; Requests {requests.length > 0 && `(${requests.length} pending)`}
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'events' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('events')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Events View (Activity Log)
          </button>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-md)' }}>{msg}</div>}

        {activeTab === 'events' ? (
          <EventsAuditView embeddedInAdmin={true} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            {/* Pending Applications Card */}
            <div className="card">
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Pending Applications</h3>
                <span className="badge badge-gray">{requests.length} Pending</span>
              </div>
              
              {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading applications...</p>
              ) : requests.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No pending personnel requests.</p>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="table-responsive desktop-only">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Roll Number</th>
                          <th>Position</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Role Requested</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map(req => (
                          <tr key={req.id}>
                            <td style={{ fontWeight: 600 }}>{req.name}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{req.email}</td>
                            <td>{req.rollNumber}</td>
                            <td>{req.position}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{renderRoleBadge(req.role)}</td>
                            <td>
                              <div className="flex gap-sm">
                                <button className="btn btn-success btn-sm" onClick={() => handleApprove(req)}>
                                  Approve
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={() => handleReject(req)}>
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {requests.map(req => (
                      <div
                        key={req.id}
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                        }}
                      >
                        <div className="flex justify-between items-start" style={{ gap: 8, marginBottom: 6 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                              {req.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {req.position || 'Applicant'} &middot; {req.rollNumber || '—'}
                            </div>
                          </div>
                          <div>{renderRoleBadge(req.role)}</div>
                        </div>

                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.78125rem',
                            color: 'var(--text-secondary)',
                            wordBreak: 'break-all',
                            marginBottom: 10,
                          }}
                        >
                          {req.email}
                        </div>

                        <div className="flex gap-sm">
                          <button
                            className="btn btn-success btn-sm"
                            style={{ flex: 1 }}
                            onClick={() => handleApprove(req)}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ flex: 1 }}
                            onClick={() => handleReject(req)}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Approved Personnel Card */}
            <div className="card">
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Approved Personnel (Club Members)</h3>
                <span className="badge badge-gray">{approvedPersonnel.length} Active</span>
              </div>

              {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading personnel...</p>
              ) : approvedPersonnel.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No approved personnel yet.</p>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="table-responsive desktop-only">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Position</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Role</th>
                          <th>Approved On</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvedPersonnel.map(person => (
                          <tr key={person.id}>
                            <td style={{ fontWeight: 600 }}>{person.name}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{person.email}</td>
                            <td>{person.position || '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{renderRoleBadge(person.role)}</td>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {person.approvedAt ? new Date(person.approvedAt).toLocaleDateString() : '—'}
                            </td>
                            <td>
                              <button className="btn btn-danger btn-sm" onClick={() => handleRevoke(person.id, person.name)}>
                                Revoke Access
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {approvedPersonnel.map(person => (
                      <div
                        key={person.id}
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                        }}
                      >
                        <div className="flex justify-between items-start" style={{ gap: 8, marginBottom: 4 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                              {person.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {person.position || 'Club Member'}
                            </div>
                          </div>
                          <div>{renderRoleBadge(person.role)}</div>
                        </div>

                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.78125rem',
                            color: 'var(--text-secondary)',
                            wordBreak: 'break-all',
                            marginBottom: 8,
                          }}
                        >
                          {person.email}
                        </div>

                        <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            {person.approvedAt ? `Approved: ${new Date(person.approvedAt).toLocaleDateString()}` : ''}
                          </span>
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            onClick={() => handleRevoke(person.id, person.name)}
                          >
                            Revoke Access
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PersonnelPage() {
  return (
    <AdminGuard>
      <PersonnelManagement />
    </AdminGuard>
  );
}
