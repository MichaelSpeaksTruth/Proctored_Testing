'use client';

import { useState, useEffect } from 'react';
import { rtdb } from '@/lib/firebase';
import { ref, get, set, update, remove } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import LeaderboardTable, { LeaderboardEntry } from '@/components/LeaderboardTable';
import Link from 'next/link';

interface TestOption { id: string; title: string; }
interface AnswerKey { [tag: string]: string; }
interface Submission { answers: Record<string, string>; submittedAt: string; autoSubmitted: boolean; email?: string; name?: string; }

function ResultsContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [answerKeyText, setAnswerKeyText] = useState('');
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [answerKey, setAnswerKey] = useState<AnswerKey | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundStatusUpdates, setRoundStatusUpdates] = useState<Record<string, string>>({});
  const [editingDetailsFor, setEditingDetailsFor] = useState<string | null>(null);
  const [detailsForm, setDetailsForm] = useState({ interviewScheduled: false, panelNo: '', venue: '', dateTime: '' });

  useEffect(() => {
    get(ref(rtdb, 'tests')).then(snap => {
      const val = snap.val();
      if (val) {
        setTests(Object.keys(val).map(key => ({ id: key, title: val[key].title || key })));
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedTestId) {
      setLeaderboard([]);
      return;
    }
    const fetchExistingResults = async () => {
      setLoading(true);
      try {
        const resultsSnap = await get(ref(rtdb, `results/${selectedTestId}`));
        const resultsVal = resultsSnap.val();
        if (resultsVal) {
          const partsSnap = await get(ref(rtdb, 'participants'));
          const partsData = partsSnap.val() || {};
          const uidToName: Record<string, string> = {};
          Object.keys(partsData).forEach(key => {
            if (partsData[key].uid) {
              uidToName[partsData[key].uid] = partsData[key].name || partsData[key].email.split('@')[0];
            }
          });

          const entries: LeaderboardEntry[] = [];
          for (const uid of Object.keys(resultsVal)) {
            const data = resultsVal[uid];
            // Get proctoring flags
            const flagsSnap = await get(ref(rtdb, `proctoringFlags/${uid}/${selectedTestId}/flags`));
            const flagsData = flagsSnap.val();
            const flags = flagsData ? Object.values(flagsData) as { event: string; severity: string; timestamp: string }[] : [];

            const isEmailUid = data.email === uid;
            const fallbackEmail = isEmailUid ? 'Unknown Email' : (data.email || 'Unknown Email');
            let fallbackName = data.name || uidToName[uid];
            if (!fallbackName) {
              fallbackName = isEmailUid ? 'Unknown Name' : (data.email?.split('@')[0] || 'Unknown Name');
            }

            entries.push({
              uid,
              name: fallbackName,
              email: fallbackEmail,
              score: data.score,
              total: data.total,
              rank: data.rank,
              roundStatus: data.roundStatus || 'Pending',
              flagCount: flags.length,
              flags,
              aiSeverity: data.aiSeverity,
              aiSummary: data.aiSummary,
              interviewScheduled: data.interviewScheduled,
              panelNo: data.panelNo,
              venue: data.venue,
              dateTime: data.dateTime,
            });
          }
          entries.sort((a, b) => b.score - a.score);
          setLeaderboard(entries);
        } else {
          setLeaderboard([]);
        }
      } catch (e) {
        console.error("Failed to load existing results", e);
      } finally {
        setLoading(false);
      }
    };
    fetchExistingResults();
  }, [selectedTestId]);

  const parseAnswerKeyText = (text: string): AnswerKey => {
    const key: AnswerKey = {};
    text.split('\n').forEach(line => {
      const [tag, answer] = line.split(':').map(s => s.trim());
      if (tag && answer) key[tag] = answer.toUpperCase();
    });
    return key;
  };

  const loadAnswerKeyFromFile = async () => {
    if (!answerKeyFile) return null;
    const { read, utils } = await import('xlsx');
    const buf = await answerKeyFile.arrayBuffer();
    const wb = read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = utils.sheet_to_json<{ tag?: string; answer?: string; Tag?: string; Answer?: string }>(sheet);
    const key: AnswerKey = {};
    rows.forEach(row => {
      const tag = String(row.tag || row.Tag || '').trim();
      const ans = String(row.answer || row.Answer || '').trim().toUpperCase();
      if (tag && ans) key[tag] = ans;
    });
    return key;
  };

  const uploadAnswerKey = async () => {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      let key: AnswerKey = {};
      if (answerKeyFile) {
        const fileKey = await loadAnswerKeyFromFile();
        if (fileKey) key = fileKey;
      } else if (answerKeyText.trim()) {
        key = parseAnswerKeyText(answerKeyText);
      } else {
        setError('Please provide an answer key via file or text input.');
        setLoading(false);
        return;
      }
      await set(ref(rtdb, `answerKeys/${selectedTestId}`), key);
      setAnswerKey(key);
      setMsg(`Answer key uploaded with ${Object.keys(key).length} entries.`);
    } catch (e) {
      setError('Failed to upload answer key.');
    } finally {
      setLoading(false);
    }
  };

  const declareResults = async () => {
    if (!selectedTestId) { setError('Select a test first.'); return; }
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      // Load answer key if not in state
      let key = answerKey;
      if (!key) {
        const keySnap = await get(ref(rtdb, `answerKeys/${selectedTestId}`));
        if (!keySnap.exists()) { setError('No answer key found. Please upload it first.'); setLoading(false); return; }
        key = keySnap.val() as AnswerKey;
        setAnswerKey(key);
      }

      // Load test structure (to get question tags)
      const testSnap = await get(ref(rtdb, `tests/${selectedTestId}`));
      const testData = testSnap.val();
      const questionTagMap: Record<string, string> = {}; // questionId -> tag
      // RTDB returns arrays as numbered objects - normalise both sections and questions
      const toArr = <T,>(v: unknown): T[] => {
        if (!v) return [];
        if (Array.isArray(v)) return v as T[];
        if (typeof v === 'object') return Object.values(v as Record<string, T>);
        return [];
      };
      toArr<{ questions: unknown; id: string; tag: string }>(testData?.sections).forEach((sec) => {
        toArr<{ id: string; tag: string }>(sec.questions).forEach((q) => {
          questionTagMap[q.id] = q.tag;
        });
      });
      const totalQuestions = Object.keys(questionTagMap).length;

      // Load all submissions
      const submissionsSnap = await get(ref(rtdb, `submissions/${selectedTestId}`));
      const subsData = submissionsSnap.val() || {};
      
      const participantsSnap = await get(ref(rtdb, 'participants'));
      const partsData = participantsSnap.val() || {};

      // Map uid -> {email, name} from participants (indexed by email key)
      const uidToData: Record<string, {email: string, name: string}> = {};
      Object.keys(partsData).forEach(key => { 
        if (partsData[key].uid) {
          uidToData[partsData[key].uid] = { 
            email: partsData[key].email,
            name: partsData[key].name || partsData[key].email.split('@')[0]
          };
        }
      });

      // Score each submission
      const scored: { uid: string; email: string; name: string; score: number }[] = [];
      for (const uid of Object.keys(subsData)) {
        const sub = subsData[uid] as Submission;
        let score = 0;
        Object.entries(sub.answers || {}).forEach(([qId, ans]) => {
          const tag = questionTagMap[qId];
          if (tag && key![tag] === ans) score++;
        });
        
        const emailFallback = sub.email || uidToData[uid]?.email || 'Unknown Email';
        const nameFallback = sub.name || uidToData[uid]?.name || (emailFallback !== 'Unknown Email' ? emailFallback.split('@')[0] : 'Unknown Name');
        
        scored.push({ uid, email: emailFallback, name: nameFallback, score });
      }

      // Sort by score descending, assign ranks
      scored.sort((a, b) => b.score - a.score);
      const entries: LeaderboardEntry[] = [];

      // Fetch proctoring flags for each
      for (let i = 0; i < scored.length; i++) {
        const { uid, email, name, score } = scored[i];
        const rank = i + 1;

        // Check for existing result first to preserve fields
        const existingResultSnap = await get(ref(rtdb, `results/${selectedTestId}/${uid}`));
        const existingVal = existingResultSnap.val() || {};

        const roundStatus = roundStatusUpdates[uid] || existingVal.roundStatus || 'Pending';

        // Save result to RTDB
        await update(ref(rtdb, `results/${selectedTestId}/${uid}`), {
          score,
          total: totalQuestions,
          rank,
          roundStatus,
          email,
          name,
        });

        // Fetch flags from RTDB - stored at new path uid/testId/flags
        const flagsSnap = await get(ref(rtdb, `proctoringFlags/${uid}/${selectedTestId}/flags`));
        const flagsData = flagsSnap.val();
        const flags = flagsData
          ? Object.values(flagsData) as { event: string; severity: string; timestamp: string }[]
          : [];

        entries.push({
          uid,
          name,
          email,
          score,
          total: totalQuestions,
          rank,
          roundStatus,
          flagCount: flags.length,
          flags,
          aiSeverity: existingVal.aiSeverity,
          aiSummary: existingVal.aiSummary,
          interviewScheduled: existingVal.interviewScheduled,
          panelNo: existingVal.panelNo,
          venue: existingVal.venue,
          dateTime: existingVal.dateTime,
        });
      }

      setLeaderboard(entries);
      setMsg(`Results declared for ${entries.length} students.`);
    } catch (e) {
      console.error(e);
      setError('Failed to calculate results. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const analyzeStudent = async (uid: string) => {
    const entry = leaderboard.find(e => e.uid === uid);
    if (!entry || !entry.flags) return;
    setAnalyzing(uid);
    try {
      const res = await fetch('/api/analyze-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, flags: entry.flags }),
      });
      const data = await res.json();

      // Persist AI result to RTDB
      if (selectedTestId && data.severity) {
        await update(ref(rtdb, `results/${selectedTestId}/${uid}`), {
          aiSeverity: data.severity,
          aiSummary: data.summary,
        });
      }

      setLeaderboard(prev =>
        prev.map(e =>
          e.uid === uid
            ? { ...e, aiSeverity: data.severity, aiSummary: data.summary }
            : e
        )
      );
    } catch (e) {
      console.error('Groq analysis failed:', e);
    } finally {
      setAnalyzing(null);
    }
  };

  const updateRoundStatus = async (uid: string, status: string) => {
    setRoundStatusUpdates(prev => ({ ...prev, [uid]: status }));
    if (selectedTestId) {
      await update(ref(rtdb, `results/${selectedTestId}/${uid}`), {
        roundStatus: status,
      });
      setLeaderboard(prev => prev.map(e => e.uid === uid ? { ...e, roundStatus: status } : e));
    }
  };

  const saveInterviewDetails = async (uid: string) => {
    if (!selectedTestId) return;
    await update(ref(rtdb, `results/${selectedTestId}/${uid}`), detailsForm);
    setLeaderboard(prev => prev.map(e => e.uid === uid ? { ...e, ...detailsForm } : e));
    setEditingDetailsFor(null);
  };

  const deleteResult = async (uid: string) => {
    if (!selectedTestId) return;
    if (!confirm('Are you sure you want to delete this past test record? This will also remove their submission and proctoring flags.')) return;
    await remove(ref(rtdb, `results/${selectedTestId}/${uid}`));
    await remove(ref(rtdb, `submissions/${selectedTestId}/${uid}`));
    await remove(ref(rtdb, `proctoringFlags/${uid}/${selectedTestId}`));
    setLeaderboard(prev => prev.filter(e => e.uid !== uid));
    setMsg('Test record, submission, and proctoring logs deleted.');
  };


  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Results & Grading</h1>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}
        {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)' }}>{error}</div>}

        {/* Test select + Answer key upload */}
        <div className="grid-2" style={{ gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Select Test</h3>
            <div className="form-group">
              <label htmlFor="results-test-select">Test</label>
              <select id="results-test-select" value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
                <option value="">-- Select a test --</option>
                {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
              </select>
            </div>
            <button
              id="declare-results-btn"
              className="btn btn-success"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={declareResults}
              disabled={loading || !selectedTestId}
            >
              {loading ? 'Calculating...' : ' Declare Results'}
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Upload Answer Key</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
              Upload XLSX (columns: tag, answer) or enter manually (tag:answer per line).
            </p>
            <div className="form-group">
              <label htmlFor="answer-key-file">XLSX File</label>
              <input id="answer-key-file" type="file" accept=".xlsx,.xls,.csv" onChange={e => setAnswerKeyFile(e.target.files?.[0] || null)} />
            </div>
            <div className="form-group">
              <label htmlFor="answer-key-text">Or enter manually</label>
              <textarea
                id="answer-key-text"
                value={answerKeyText}
                onChange={e => setAnswerKeyText(e.target.value)}
                rows={4}
                placeholder={`apt_1:A\napt_2:C\nphy_1:B`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}
              />
            </div>
            <button
              id="upload-key-btn"
              className="btn btn-primary"
              onClick={uploadAnswerKey}
              disabled={loading || (!answerKeyFile && !answerKeyText.trim()) || !selectedTestId}
            >
              Upload Key
            </button>
          </div>
        </div>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
              <h2 style={{ fontSize: '1.375rem' }}>Leaderboard</h2>
              <span className="badge badge-gray">{leaderboard.length} candidates</span>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 'var(--space-lg)' }}>
              <strong>AI Proctoring Review:</strong> Click "AI Review" on any student row to run an on-demand Groq analysis of their proctoring flags. Analysis is rate-limit safe - one student at a time.
            </div>

            <LeaderboardTable
              entries={leaderboard}
              onAnalyze={analyzeStudent}
              analyzing={analyzing}
              onDelete={deleteResult}
              onUpdateRoundStatus={updateRoundStatus}
              onEditInfo={(uid) => {
                const entry = leaderboard.find(e => e.uid === uid);
                if (entry) {
                  setDetailsForm({
                    interviewScheduled: entry.interviewScheduled || false,
                    panelNo: entry.panelNo || '',
                    venue: entry.venue || '',
                    dateTime: entry.dateTime || ''
                  });
                  setEditingDetailsFor(uid);
                }
              }}
            />

            {editingDetailsFor && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ width: 400, maxWidth: '90%' }}>
                  <h3 style={{ marginBottom: 'var(--space-md)' }}>Upcoming Info</h3>
                  <div className="form-group">
                    <label>
                      <input 
                        type="checkbox" 
                        checked={detailsForm.interviewScheduled}
                        onChange={e => setDetailsForm(prev => ({ ...prev, interviewScheduled: e.target.checked }))}
                        style={{ marginRight: 8 }}
                      />
                      Interview Scheduled
                    </label>
                  </div>
                  <div className="form-group">
                    <label>Panel No.</label>
                    <input 
                      type="text" 
                      value={detailsForm.panelNo}
                      onChange={e => setDetailsForm(prev => ({ ...prev, panelNo: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Venue / Link</label>
                    <input 
                      type="text" 
                      value={detailsForm.venue}
                      onChange={e => setDetailsForm(prev => ({ ...prev, venue: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Date & Time</label>
                    <input 
                      type="text" 
                      value={detailsForm.dateTime}
                      onChange={e => setDetailsForm(prev => ({ ...prev, dateTime: e.target.value }))}
                      className="input"
                      placeholder="e.g. 10th Aug, 10:00 AM"
                    />
                  </div>
                  <div className="flex gap-sm justify-end" style={{ marginTop: 'var(--space-lg)' }}>
                    <button className="btn btn-ghost" onClick={() => setEditingDetailsFor(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => saveInterviewDetails(editingDetailsFor)}>Save</button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </main>
  );
}

export default function ResultsPage() {
  return <AdminGuard><ResultsContent /></AdminGuard>;
}
