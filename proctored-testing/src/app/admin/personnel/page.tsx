'use client';

import { useState, useEffect } from 'react';
import { rtdb } from '@/lib/firebase';
import { ref, get, set, remove } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';

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

function PersonnelManagement() {
  const [requests, setRequests] = useState<PersonnelRequest[]>([]);
  const [approvedPersonnel, setApprovedPersonnel] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    const [reqSnap, perSnap] = await Promise.all([
      get(ref(rtdb, 'personnel_requests')),
      get(ref(rtdb, 'personnel'))
    ]);
    
    const reqVal = reqSnap.val();
    if (reqVal) {
      const parsed: PersonnelRequest[] = Object.keys(reqVal).map(key => ({
        id: key,
        ...reqVal[key]
      }));
      setRequests(parsed);
    } else {
      setRequests([]);
    }

    const perVal = perSnap.val();
    if (perVal) {
      const parsed = Object.keys(perVal).map(key => ({
        id: key,
        ...perVal[key]
      }));
      setApprovedPersonnel(parsed);
    } else {
      setApprovedPersonnel([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();
  }, []);

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
        approvedAt: new Date().toISOString()
      });
      // Remove from requests
      await remove(ref(rtdb, `personnel_requests/${req.id}`));
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
      setMsg(`Revoked access for ${name}`);
      await fetchRequests();
    } catch (e) {
      console.error(e);
      setMsg('Error revoking access');
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Personnel Management</h1>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}

        <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Pending Applications</h3>
          
          {loading ? (
            <p>Loading...</p>
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
                      <td>{req.name}</td>
                      <td>{req.email}</td>
                      <td>{req.rollNumber}</td>
                      <td>{req.position}</td>
                      <td><span className="badge badge-gray">{req.role}</span></td>
                      <td>
                        <div className="flex gap-sm">
                          <button className="btn btn-success btn-sm" onClick={() => handleApprove(req)}>Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleReject(req)}>Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Approved Personnel</h3>
          {loading ? (
            <p>Loading...</p>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedPersonnel.map(person => (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>{person.email}</td>
                      <td>{person.position}</td>
                      <td><span className="badge badge-gray">{person.role}</span></td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => handleRevoke(person.id, person.name)}>Revoke Access</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function PersonnelPage() {
  return <AdminGuard><PersonnelManagement /></AdminGuard>;
}
