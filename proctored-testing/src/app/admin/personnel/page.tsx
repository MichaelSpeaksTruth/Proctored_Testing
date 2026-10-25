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

  const supremeAdmins = [
    process.env.NEXT_PUBLIC_ADMIN_1,
    process.env.NEXT_PUBLIC_ADMIN_2,
  ].filter(Boolean) as string[];

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

      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'APPROVE_PERSONNEL',
        actionLabel: 'Approved Personnel Access',
        targetTitle: `${req.name} (${req.role})`,
        details: {
          targetEmail: req.email,
          targetRole: req.role,
          targetName: req.name,
        },
      });

      setMsg(`Approved ${req.name} as ${req.role}`);
      await fetchRequests();
    } catch (e) {
      console.error(e);
      setMsg('Error approving request');
      setLoading(false);
    }
  };

  const handleReject = async (req: PersonnelRequest) => {
    if (!confirm(`Are you sure you want to reject ${req.name}?`)) return;
    setLoading(true);
    try {
      await remove(ref(rtdb, `personnel_requests/${req.id}`));

      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'REJECT_PERSONNEL',
        actionLabel: 'Rejected Personnel Request',
        targetTitle: `${req.name} (${req.role})`,
        details: {
          targetEmail: req.email,
          targetRole: req.role,
          targetName: req.name,
        },
      });

      setMsg(`Rejected application for ${req.name}`);
      await fetchRequests();
    } catch (e) {
      console.error(e);
      setMsg('Error rejecting request');
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke personnel access for ${name}?`)) return;
    setLoading(true);
    try {
      await remove(ref(rtdb, `personnel/${id}`));

      const { actorEmail, actorName, actorRole } = getAdminActor();
      await logAuditEvent({
        actorEmail,
        actorName,
        actorRole,
        action: 'REVOKE_PERSONNEL',
        actionLabel: 'Revoked Personnel Access',
        targetTitle: name,
        details: {
          targetPersonnelId: id,
          targetName: name,
        },
      });

      setMsg(`Revoked access for ${name}`);
      await fetchRequests();
    } catch (e) {
      console.error(e);
      setMsg('Error revoking access');
      setLoading(false);
    }
  };

  const renderRoleBadge = (role: string) => {
    if (role === 'Admin L1') {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(33, 150, 243, 0.2)',
            color: '#64b5f6',
            border: '1px solid rgba(33, 150, 243, 0.5)',
            fontWeight: 600,
          }}
        >
          Admin L1
        </span>
      );
    }
    if (role === 'Question Setter') {
      return <span className="badge badge-green">Question Setter</span>;
    }
    if (role === "Spectator's View") {
      return <span className="badge badge-amber">Spectator&apos;s View</span>;
    }
    return <span className="badge badge-gray">{role}</span>;
  };

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        {/* Navigation & Title */}
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <div>
            <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Personnel & RBAC Management</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
              Administer role allocations, supreme admin credentials (Admin Sr.), and inspect audit activity logs.
            </p>
          </div>
        </div>

        {/* Supreme Admin (Admin Sr.) Header Card */}
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-xl)',
            borderLeft: '4px solid #ff6b6b',
            background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-secondary) 100%)',
          }}
        >
          <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <div className="flex items-center gap-sm">
                <span
                  className="badge"
                  style={{
                    background: 'rgba(155, 34, 38, 0.3)',
                    color: '#ff6b6b',
                    border: '1px solid rgba(155, 34, 38, 0.7)',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  SUPREME ADMIN LEVEL (Admin Sr.)
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Platform Root Authority
                </span>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 8 }}>
                Identified in system audit logs as <strong>Admin Sr.</strong> Has absolute permission over all test configs, results, and personnel RBAC.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-md)',
              flexWrap: 'wrap',
              marginTop: 'var(--space-md)',
            }}
          >
            {supremeAdmins.map((admEmail, idx) => (
              <div
                key={admEmail}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Admin Sr. #{idx + 1}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                      color: 'var(--white)',
                    }}
                  >
                    {admEmail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab switch bar */}
        <div
          className="flex gap-sm"
          style={{
            marginBottom: 'var(--space-xl)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 'var(--space-sm)',
          }}
        >
          <button
            className={`btn btn-sm ${activeTab === 'personnel' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('personnel')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            Personnel & Requests {requests.length > 0 && `(${requests.length} pending)`}
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'events' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('events')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            Events View (Activity Log)
          </button>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}

        {activeTab === 'events' ? (
          <EventsAuditView embeddedInAdmin={true} />
        ) : (
          <>
            {/* Pending Applications Card */}
            <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h3 style={{ margin: 0 }}>Pending Applications</h3>
                <span className="badge badge-gray">{requests.length} Pending</span>
              </div>
              
              {loading ? (
                <p>Loading applications...</p>
              ) : requests.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No pending personnel requests.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Roll Number</th>
                        <th>Position</th>
                        <th>Role Requested</th>
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
                          <td>{renderRoleBadge(req.role)}</td>
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
              )}
            </div>

            {/* Approved Personnel Card */}
            <div className="card">
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h3 style={{ margin: 0 }}>Approved Personnel (Club Members)</h3>
                <span className="badge badge-gray">{approvedPersonnel.length} Active</span>
              </div>

              {loading ? (
                <p>Loading personnel...</p>
              ) : approvedPersonnel.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No approved personnel yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Position</th>
                        <th>Role</th>
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
                          <td>{renderRoleBadge(person.role)}</td>
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
              )}
            </div>
          </>
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
