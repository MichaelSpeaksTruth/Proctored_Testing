'use client';

import { useState, useEffect } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, get, set, remove } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { logAuditEvent } from '@/lib/auditLogger';

interface Participant {
  email: string;
  name?: string;
  allowed: boolean;
  tests?: Record<string, boolean>;
}

interface TestOption {
  id: string;
  title: string;
}

function ParticipantsContent() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
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

  const fetchTests = async () => {
    try {
      const res = await fetch('/api/tests-list');
      const testsArr = await res.json();
      if (Array.isArray(testsArr)) setTests(testsArr);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { 
    fetchTests(); 
    
    import('firebase/database').then(({ onValue }) => {
      const unsub = onValue(ref(rtdb, 'participants'), (snap) => {
        const val = snap.val();
        if (!val) {
          setParticipants([]);
          setError(null);
          return;
        }
        const parsed = Object.keys(val).map(key => ({
          email: decodeEmail(key),
          ...(val[key] as { allowed: boolean; name?: string; tests?: Record<string, boolean> })
        }));
        setParticipants(parsed);
        setError(null);
      }, (err) => {
        console.error("Failed to fetch participants:", err);
        setError("Failed to load participants: " + err.message);
      });
      
      return () => unsub();
    });
  }, []);

  const addParticipant = async (name: string, email: string) => {
    if (!selectedTestId) return false;
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedName) return false;
    const key = encodeEmail(trimmedEmail);
    
    const existingSnap = await get(ref(rtdb, `participants/${key}`));
    const existing = existingSnap.val() || {};
    
    const newTests = { ...(existing.tests || {}), [selectedTestId]: true };
    
    await set(ref(rtdb, `participants/${key}`), { 
      ...existing,
      email: trimmedEmail, 
      name: trimmedName, 
      allowed: true,
      tests: newTests
    });
    return true;
  };

  const handleManualAdd = async () => {
    if (!selectedTestId) {
      setError('Please select a test first.');
      return;
    }
    setLoading(true);
    setError(null);
    setMsg(null);

    const lines = emailInput.split('\n');
    let addedCount = 0;
    let duplicateCount = 0;
    const seenEmails = new Set<string>();

    for (const line of lines) {
      const parts = line.split(',');
      let name = '';
      let email = '';

      if (parts.length >= 2) {
        name = parts[0];
        email = parts.slice(1).join(',').trim().toLowerCase();
      } else if (parts.length === 1 && parts[0].includes('@')) {
        email = parts[0].trim().toLowerCase();
        name = email.split('@')[0];
      }

      if (email && email.includes('@')) {
        const isDuplicate = seenEmails.has(email);
        seenEmails.add(email);
        const ok = await addParticipant(name, email);
        if (ok) {
          if (!isDuplicate) addedCount++;
          else duplicateCount++;
        }
      }
    }

    setEmailInput('');
    setMsg(
      duplicateCount > 0
        ? `Successfully registered ${addedCount} unique participants (${duplicateCount} duplicate entries merged).`
        : `Successfully registered ${addedCount} participants for this test.`
    );
    setLoading(false);
  };

  const handleCsvUpload = async () => {
    if (!selectedTestId) {
      setError('Please select a test first.');
      return;
    }
    if (!csvFile) return;

    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const { read, utils } = await import('xlsx');
      const data = await csvFile.arrayBuffer();
      const workbook = read(data);
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows: any[][] = utils.sheet_to_json(worksheet, { header: 1 });

      if (!rawRows || rawRows.length === 0) {
        setError('The uploaded file is empty.');
        return;
      }

      // Check if the very first row contains email data (meaning no column header row)
      const firstRow = rawRows[0] || [];
      const firstRowHasEmail = firstRow.some((cell: any) => typeof cell === 'string' && cell.includes('@') && cell.includes('.'));

      let emailColIdx = -1;
      let nameColIdx = -1;
      let startIdx = 0;

      if (firstRowHasEmail) {
        // No header row - first row is already participant data
        startIdx = 0;
        for (let c = 0; c < firstRow.length; c++) {
          const val = String(firstRow[c] || '');
          if (val.includes('@')) {
            emailColIdx = c;
            break;
          }
        }
        nameColIdx = emailColIdx === 0 ? 1 : 0;
      } else {
        // First row contains headers
        startIdx = 1;
        for (let c = 0; c < firstRow.length; c++) {
          const header = String(firstRow[c] || '').toLowerCase().trim();
          if (header.includes('email') || header.includes('mail')) {
            emailColIdx = c;
          }
          if (header.includes('name')) {
            nameColIdx = c;
          }
        }
        // Fallback: if header name didn't match, inspect row 1 for '@'
        if (emailColIdx === -1 && rawRows.length > 1) {
          const sampleRow = rawRows[1] || [];
          for (let c = 0; c < sampleRow.length; c++) {
            if (String(sampleRow[c] || '').includes('@')) {
              emailColIdx = c;
              break;
            }
          }
          nameColIdx = emailColIdx === 0 ? 1 : 0;
        }
      }

      let addedCount = 0;
      let duplicateCount = 0;
      const seenEmails = new Set<string>();

      for (let i = startIdx; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        let email = emailColIdx >= 0 ? String(row[emailColIdx] || '').trim().toLowerCase() : '';
        let name = nameColIdx >= 0 ? String(row[nameColIdx] || '').trim() : '';

        // Dynamic fallback: scan cells in the row if email column wasn't detected
        if (!email || !email.includes('@')) {
          for (let c = 0; c < row.length; c++) {
            const str = String(row[c] || '').trim();
            if (str.includes('@') && str.includes('.')) {
              email = str.toLowerCase();
              if (c === nameColIdx) name = '';
              break;
            }
          }
        }

        if (email && email.includes('@')) {
          if (!name) name = email.split('@')[0];
          const isDuplicate = seenEmails.has(email);
          seenEmails.add(email);

          const ok = await addParticipant(name, email);
          if (ok) {
            if (!isDuplicate) {
              addedCount++;
            } else {
              duplicateCount++;
            }
          }
        }
      }

      setCsvFile(null);
      setMsg(
        duplicateCount > 0
          ? `Successfully imported ${addedCount} unique participants (${duplicateCount} duplicate rows merged).`
          : `Successfully imported and enrolled ${addedCount} participants.`
      );
    } catch (err: any) {
      console.error(err);
      setError('Failed to parse file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from this test?`)) return;
    setLoading(true);
    const key = encodeEmail(email);
    
    const existingSnap = await get(ref(rtdb, `participants/${key}`));
    const existing = existingSnap.val() || {};
    
    if (existing.tests && existing.tests[selectedTestId]) {
      const newTests = { ...existing.tests };
      delete newTests[selectedTestId];
      
      if (Object.keys(newTests).length === 0) {
        await remove(ref(rtdb, `participants/${key}`));
      } else {
        await set(ref(rtdb, `participants/${key}/tests`), newTests);
      }
    }

    setLoading(false);
  };

  const handleSaveEdit = async (oldEmail: string) => {
    const newNameTrimmed = editForm.name.trim();
    const newEmailTrimmed = editForm.email.trim().toLowerCase();
    
    if (!newNameTrimmed) {
      setError('Name cannot be empty.');
      return;
    }
    if (!newEmailTrimmed || !newEmailTrimmed.includes('@')) {
      setError('A valid email address is required.');
      return;
    }
    
    setLoading(true);
    setError(null);
    setMsg(null);
    
    const oldKey = encodeEmail(oldEmail);
    const existingSnap = await get(ref(rtdb, `participants/${oldKey}`));
    const existing = existingSnap.val() || {};
    
    if (newEmailTrimmed !== oldEmail) {
      await remove(ref(rtdb, `participants/${oldKey}`));
    }
    
    const newKey = encodeEmail(newEmailTrimmed);
    await set(ref(rtdb, `participants/${newKey}`), { 
      ...existing,
      email: newEmailTrimmed, 
      name: newNameTrimmed, 
      allowed: true 
    });
    
    setEditingEmail(null);
    setMsg('Participant updated successfully.');
    setLoading(false);
  };

  const filteredParticipants = selectedTestId 
    ? participants.filter(p => p.tests && p.tests[selectedTestId])
    : [];

  const handleDownloadParticipants = async () => {
    if (!selectedTestId) return;
    try {
      const { utils, writeFile } = await import('xlsx');
      const dataToExport = filteredParticipants.map(p => ({
        name: p.name || '',
        email: p.email
      }));
      const worksheet = utils.json_to_sheet(dataToExport);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, 'Participants');
      const testTitle = tests.find(t => t.id === selectedTestId)?.title || selectedTestId;
      writeFile(workbook, `participants_${testTitle.replace(/\s+/g, '_')}.xlsx`);
    } catch (e) {
      console.error('Failed to export participants', e);
      setError('Failed to export participants file.');
    }
  };

  const totalPages = Math.ceil(filteredParticipants.length / PAGE_SIZE);
  const pageData = filteredParticipants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
          <BackButton fallbackUrl="/admin" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Participant Management
          </h1>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="test-select" style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.8125rem' }}>
              Select Examination
            </label>
            <select 
              id="test-select" 
              value={selectedTestId} 
              onChange={e => setSelectedTestId(e.target.value)}
              style={{ maxWidth: 450 }}
            >
              <option value="">-- Choose an examination --</option>
              {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
            </select>
          </div>
        </div>

        {selectedTestId ? (
          <>
            <div className="grid-2" style={{ gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
              {/* Manual add */}
              <div className="card" style={{ padding: '16px' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)', fontSize: '1.05rem' }}>Add Manually</h3>
                <div className="form-group">
                  <label htmlFor="email-input" style={{ fontSize: '0.75rem' }}>Name, Email (one per line)</label>
                  <textarea
                    id="email-input"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={"John Doe, student1@example.com\nJane Smith, student2@example.com"}
                    rows={4}
                  />
                </div>
                <button id="add-emails-btn" className="btn btn-primary btn-sm" onClick={handleManualAdd} disabled={loading || !emailInput.trim()}>
                  {loading ? 'Adding...' : 'Add Participants'}
                </button>
              </div>

              {/* CSV upload */}
              <div className="card" style={{ padding: '16px' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)', fontSize: '1.05rem' }}>Import CSV / Excel</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                  Upload a spreadsheet with <code style={{ background: 'var(--bg-input)', padding: '2px 4px', borderRadius: 2 }}>name</code> and <code style={{ background: 'var(--bg-input)', padding: '2px 4px', borderRadius: 2 }}>email</code> columns.
                </p>
                <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
                  <input
                    id="csv-upload"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
                <button id="import-csv-btn" className="btn btn-primary btn-sm" onClick={handleCsvUpload} disabled={loading || !csvFile}>
                  {loading ? 'Importing...' : 'Import File'}
                </button>
              </div>
            </div>

            {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-md)' }}>{msg}</div>}
            {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

            {/* Participants list */}
            <div className="card" style={{ padding: '16px' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Registered Participants</h3>
                <div className="flex items-center gap-sm">
                  <button 
                    className="btn btn-outline btn-sm"
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={handleDownloadParticipants}
                    disabled={filteredParticipants.length === 0}
                  >
                    Download XLSX
                  </button>
                  <span className="badge badge-gray">{filteredParticipants.length} total</span>
                </div>
              </div>

              {filteredParticipants.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No participants registered for this test yet.</p>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="table-responsive desktop-only">
                    <table id="participants-table" className="table">
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
                                  <td style={{ fontWeight: 500 }}>{p.name || '-'}</td>
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
                  </div>

                  {/* Mobile Cards View */}
                  <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pageData.map((p, idx) => (
                      <div
                        key={p.email}
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                        }}
                      >
                        <div className="flex justify-between items-start" style={{ gap: 8, marginBottom: 4 }}>
                          <div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>
                              #{page * PAGE_SIZE + idx + 1}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                              {p.name || 'Unnamed'}
                            </span>
                          </div>
                          <span className="badge badge-green">Approved</span>
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
                          {p.email}
                        </div>

                        <div className="flex gap-sm" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            onClick={() => {
                              setEditingEmail(p.email);
                              setEditForm({ name: p.name || '', email: p.email });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--accent-red-light)', padding: '4px 10px', fontSize: '0.75rem' }}
                            onClick={() => handleRemove(p.email)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex justify-between items-center" style={{ marginTop: 'var(--space-md)' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        Page {page + 1} of {totalPages}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>Please select an examination above to manage candidate enrollments.</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ParticipantsPage() {
  return (
    <AdminGuard>
      <ParticipantsContent />
    </AdminGuard>
  );
}
