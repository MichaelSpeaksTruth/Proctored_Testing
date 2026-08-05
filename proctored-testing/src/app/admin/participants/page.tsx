'use client';

import { useState, useEffect } from 'react';
import { rtdb } from '@/lib/firebase';
import { ref, get, set, remove } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';

interface Participant {
  email: string;
  name?: string;
  allowed: boolean;
}

function ParticipantsContent() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const PAGE_SIZE = 25;

  const encodeEmail = (e: string) => e.replace(/\./g, ',');
  const decodeEmail = (e: string) => e.replace(/,/g, '.');

  const fetchParticipants = async () => {
    const snap = await get(ref(rtdb, 'participants'));
    const val = snap.val();
    if (!val) {
      setParticipants([]);
      return;
    }
    const parsed = Object.keys(val).map(key => ({
      email: decodeEmail(key),
      ...(val[key] as { allowed: boolean; name?: string })
    }));
    setParticipants(parsed);
  };

  useEffect(() => { fetchParticipants(); }, []);

  const addParticipant = async (name: string, email: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedName) return false;
    const key = encodeEmail(trimmedEmail);
    // Merge name and email in the existing participant record if it exists, or create a new one
    await set(ref(rtdb, `participants/${key}`), { email: trimmedEmail, name: trimmedName, allowed: true });
    return true;
  };

  const handleManualAdd = async () => {
    setLoading(true);
    setMsg(null);
    setError(null);
    const lines = emailInput.split('\n').map((e) => e.trim()).filter(Boolean);
    let count = 0;
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const email = parts[1].trim();
        if (await addParticipant(name, email)) count++;
      }
    }
    if (count === 0 && lines.length > 0) {
       setError('Failed to add participants. Ensure format is "Name, Email" and Name is provided.');
    } else {
       setMsg(`Added ${count} participant(s).`);
    }
    setEmailInput('');
    await fetchParticipants();
    setLoading(false);
  };

  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setLoading(true);
    setMsg(null);
    setError(null);
    try {
      const { read, utils } = await import('xlsx');
      const buffer = await csvFile.arrayBuffer();
      const wb = read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<{ email?: string; Email?: string; name?: string; Name?: string }>(sheet);
      let count = 0;
      for (const row of rows) {
        const email = String(row.email || row.Email || '').trim().toLowerCase();
        const name = String(row.name || row.Name || '').trim();
        if (await addParticipant(name, email)) count++;
      }
      setMsg(`Imported ${count} participant(s) from file.`);
      await fetchParticipants();
    } catch (e) {
      setError('Failed to parse file. Ensure it has an "email" column.');
    } finally {
      setLoading(false);
      setCsvFile(null);
    }
  };

  const handleRemove = async (email: string) => {
    const key = encodeEmail(email);
    await remove(ref(rtdb, `participants/${key}`));
    setParticipants((prev) => prev.filter((p) => p.email !== email));
  };

  const handleSaveEdit = async (oldEmail: string) => {
    const newEmailTrimmed = editForm.email.trim().toLowerCase();
    const newNameTrimmed = editForm.name.trim();

    if (!newEmailTrimmed || !newEmailTrimmed.includes('@')) {
      setError('Invalid email format during edit.');
      return;
    }
    
    setLoading(true);
    setError(null);
    setMsg(null);
    
    if (newEmailTrimmed !== oldEmail) {
      const oldKey = encodeEmail(oldEmail);
      await remove(ref(rtdb, `participants/${oldKey}`));
    }
    
    const newKey = encodeEmail(newEmailTrimmed);
    await set(ref(rtdb, `participants/${newKey}`), { email: newEmailTrimmed, name: newNameTrimmed, allowed: true });
    
    setEditingEmail(null);
    setMsg('Participant updated successfully.');
    await fetchParticipants();
    setLoading(false);
  };

  const totalPages = Math.ceil(participants.length / PAGE_SIZE);
  const pageData = participants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Participant Management</h1>
        </div>

        <div className="grid-2" style={{ gap: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
          {/* Manual add */}
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Add Manually</h3>
            <div className="form-group">
              <label htmlFor="email-input">Name and Email (one per line, comma separated)</label>
              <textarea
                id="email-input"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="John Doe, student1@example.com&#10;Jane Smith, student2@example.com"
                rows={5}
              />
            </div>
            <button id="add-emails-btn" className="btn btn-primary" onClick={handleManualAdd} disabled={loading || !emailInput.trim()}>
              {loading ? 'Adding...' : 'Add Participants'}
            </button>
          </div>

          {/* CSV upload */}
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Import CSV / XLSX</h3>
            <p style={{ fontSize: '0.875rem', marginBottom: 'var(--space-md)' }}>
              Upload a CSV or Excel file with a <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>name</code> and an <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>email</code> column.
            </p>
            <div className="form-group">
              <label htmlFor="csv-upload">Select File</label>
              <input
                id="csv-upload"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
            </div>
            <button id="import-csv-btn" className="btn btn-primary" onClick={handleCsvUpload} disabled={loading || !csvFile}>
              {loading ? 'Importing...' : 'Import File'}
            </button>
          </div>
        </div>

        {msg && <div className="alert alert-success">{msg}</div>}
        {error && <div className="alert alert-danger">{error}</div>}

        {/* Participants list */}
        <div className="card">
          <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
            <h3>Registered Participants</h3>
            <span className="badge badge-gray">{participants.length} total</span>
          </div>
          <table id="participants-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageData.map((p, idx) => {
                const isEditing = editingEmail === p.email;
                return (
                  <tr key={p.email}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{page * PAGE_SIZE + idx + 1}</td>
                    {isEditing ? (
                      <>
                        <td>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="input"
                            style={{ padding: '4px 8px', width: '100%' }}
                            placeholder="Name"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={editForm.email}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            className="input"
                            style={{ padding: '4px 8px', width: '100%', fontFamily: 'var(--font-mono)' }}
                          />
                        </td>
                        <td><span className="badge badge-amber">Editing</span></td>
                        <td>
                          <div className="flex gap-sm">
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleSaveEdit(p.email)}
                              disabled={loading}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingEmail(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontWeight: 500 }}>{p.name || '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{p.email}</td>
                        <td><span className="badge badge-green">Approved</span></td>
                        <td>
                          <div className="flex gap-sm">
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setEditingEmail(p.email);
                                setEditForm({ name: p.name || '', email: p.email });
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              id={`remove-${p.email}`}
                              style={{ color: 'var(--accent-red-light)' }}
                              onClick={() => handleRemove(p.email)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-lg)' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, participants.length)} of {participants.length}
              </span>
              <div className="flex gap-sm">
                <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
                <button className="btn btn-outline btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ParticipantsPage() {
  return <AdminGuard><ParticipantsContent /></AdminGuard>;
}
