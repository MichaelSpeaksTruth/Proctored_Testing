import admin from 'firebase-admin';
import fs from 'fs';

const envText = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envText.split(/\r?\n/).forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1].trim()] = val;
  }
});

let serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function run() {
  console.log('--- Starting Mapping for Recruitment Test (K26) ---');

  // 1. Fetch test
  const testId = '-P4_P8RO28LW4WkVY5gj';
  const testSnap = await db.ref(`tests/${testId}`).once('value');
  const test = testSnap.val();

  if (!test) {
    console.error(`Test ${testId} not found!`);
    process.exit(1);
  }

  console.log(`Found Test: "${test.title}"`);

  // 2. Fetch personnel to map author details
  const perSnap = await db.ref('personnel').once('value');
  const perVal = perSnap.val() || {};
  const personnelMap = {};
  for (const key in perVal) {
    const p = perVal[key];
    if (p.email) {
      personnelMap[p.email.toLowerCase()] = p;
    }
  }

  const sections = test.sections || [];
  let updatedQuestionsCount = 0;
  const auditLogsToAdd = [];

  const baseTime = new Date('2026-10-23T16:30:00.000Z').getTime();

  // Add section creation audit event
  sections.forEach((sec, sIdx) => {
    const secName = sec.name || `Section ${sIdx + 1}`;
    const authorEmail = sec.questions?.[0]?.authorEmail || 'garvkumar10062005@gmail.com';
    const authorInfo = personnelMap[authorEmail.toLowerCase()] || { name: 'Garv Kumar', role: 'Question Setter' };

    const secEventId = `mig_sec_${testId}_${sIdx}`;
    auditLogsToAdd.push({
      id: secEventId,
      action: 'ADD_SECTION',
      actionLabel: 'Added Section',
      actorEmail: authorEmail,
      actorName: authorInfo.name,
      actorRole: authorInfo.role || 'Question Setter',
      targetTitle: secName,
      details: {
        testId: testId,
        testTitle: test.title,
        sectionName: secName,
      },
      timestamp: new Date(baseTime).toISOString(),
    });

    if (Array.isArray(sec.questions)) {
      sec.questions.forEach((q, qIdx) => {
        const qEmail = (q.authorEmail || authorEmail).toLowerCase();
        const pInfo = personnelMap[qEmail] || { name: 'Garv Kumar', role: 'Question Setter' };

        const qTime = new Date(baseTime + (qIdx + 1) * 3 * 60 * 1000).toISOString();

        // Update question object
        q.authorName = pInfo.name;
        q.authorRole = pInfo.role || 'Question Setter';
        q.authorEmail = qEmail;
        if (!q.createdAt) {
          q.createdAt = qTime;
        }

        updatedQuestionsCount++;

        // Audit log entry for question
        const qEventId = `mig_q_${testId}_${q.tag || qIdx}`;
        auditLogsToAdd.push({
          id: qEventId,
          action: 'ADD_QUESTION',
          actionLabel: 'Added Question',
          actorEmail: qEmail,
          actorName: pInfo.name,
          actorRole: pInfo.role || 'Question Setter',
          targetTitle: `Question #${q.tag}`,
          details: {
            testId: testId,
            testTitle: test.title,
            sectionName: secName,
            questionTag: q.tag,
            questionSnippet: (q.text || '').slice(0, 100),
          },
          timestamp: qTime,
        });
      });
    }
  });

  // 3. Update tests in RTDB
  console.log(`Updating ${sections.length} sections and ${updatedQuestionsCount} questions in RTDB...`);
  await db.ref(`tests/${testId}/sections`).set(sections);
  console.log('Sections updated successfully.');

  // 4. Update audit_logs in RTDB
  console.log(`Writing ${auditLogsToAdd.length} retroactive audit events into audit_logs...`);
  const updates = {};
  for (const log of auditLogsToAdd) {
    updates[`audit_logs/${log.id}`] = log;
  }
  await db.ref().update(updates);
  console.log('Audit events inserted successfully.');

  console.log('--- Mapping Complete Successfully! ---');
  process.exit(0);
}

run().catch(e => {
  console.error('Error during mapping:', e);
  process.exit(1);
});
