const admin = require('firebase-admin');
const { Groq } = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT_KEY");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(serviceAccountKey);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  });

  const db = admin.database();

  console.log("Fetching tests...");
  const testsSnap = await db.ref('tests').once('value');
  const tests = testsSnap.val();

  let targetTestId = null;
  for (const [id, data] of Object.entries(tests || {})) {
    if (data.title && data.title.toLowerCase().includes('aerosoc recruitment test')) {
      targetTestId = id;
    }
  }

  if (!targetTestId) {
    console.error("Could not find test with title 'aerosoc recruitment test'");
    process.exit(1);
  }

  console.log(`Target Test ID: ${targetTestId}`);

  const resultsRef = db.ref(`results/${targetTestId}`);
  const resultsSnap = await resultsRef.once('value');
  const results = resultsSnap.val();

  if (!results) {
    console.log("No results found for this test.");
    process.exit(0);
  }

  const uids = Object.keys(results);
  console.log(`Found ${uids.length} candidates. Starting AI review batch process...`);

  let count = 0;

  for (const uid of uids) {
    const data = results[uid];
    const score = data.score;
    const total = data.total;

    // Skip if already reviewed
    if (data.aiSeverity) {
      console.log(`Skipping ${uid} - already reviewed.`);
      continue;
    }

    console.log(`Processing ${uid}... (${count + 1}/${uids.length})`);

    // Fetch flags
    const flagsSnap = await db.ref(`proctoringFlags/${uid}/${targetTestId}/flags`).once('value');
    const flagsData = flagsSnap.val();
    const flags = flagsData ? Object.values(flagsData) : [];

    let finalSeverity = 'low';
    let finalSummary = 'Analysis complete.';

    if (flags.length === 0) {
      finalSeverity = 'low';
      finalSummary = 'No suspicious activity detected. The candidate completed the exam with no proctoring violations.';
    } else {
      // Summarize flag durations
      const durationSummary = {};
      for (const f of flags) {
        durationSummary[f.event] = (durationSummary[f.event] || 0) + (f.durationInSeconds || 0);
      }

      const scoreInfo = (score !== undefined && total !== undefined) ? `\nStudent Score: ${score} out of ${total}` : '';

      const promptText = `You are an AI proctoring analyst for an official university admission examination at BIT Mesra.
Review the following proctoring event summary recorded during a student's exam session. The values represent the TOTAL DURATION in seconds that the student was engaged in the infraction.${scoreInfo}

Total Time in Violation (Seconds): ${JSON.stringify(durationSummary)}
Total individual events logged: ${flags.length}

Event definitions:
- INVALID_FACE_COUNT / MULTIPLE_FACES / NO_FACE: Student's face was missing, or multiple faces were in the frame.
- TAB_SWITCHED: Student switched browser tabs or minimized the window.
- LEFT_FULLSCREEN: Student exited mandatory fullscreen mode.
- LOUD_AUDIO: Significant audio spike detected (possible talking).
- CAMERA_COVERED: The webcam lens was physically covered or the room was pitch black.
- PHONE_DETECTED: A smartphone was visible in the camera frame.
- HEAD_PITCH_DOWN / DUCKING_DOWN / SHOULDERS_OUT_OF_FRAME: Looking down or hiding from camera.
- MIC_MUTED: The microphone was muted by the student.

**Scoring Rules:**
* 0-15 total flags is generally considered normal background noise (e.g., brief face missing, minor movements). Evaluate these strictly as 'low' severity unless there is a critical cheating indicator.
* 16-40 total flags should be considered 'medium' severity, indicating suspicious behavior that warrants a manual look.
* 41+ total flags is a strong indicator of sustained rule-breaking and should be categorized as 'high' severity.
* ANY duration of PHONE_DETECTED or multiple faces is a critical cheating indicator and MUST result in a 'high' severity.
* When providing the summary, explicitly mention the total number of flags and how it influenced the severity score. Be fair and forgiving for low flag counts.

**Output format:** You must respond in strict JSON format matching EXACTLY this schema:
{
  "severity": "low|medium|high",
  "summary": "You MUST write a 2-3 sentence explanation of *why* you gave this risk rating, logically connecting the severity of the logs with the test score and specific timestamps/durations. NEVER output generic phrases like 'Analysis complete'."
}`;

      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: promptText }],
          model: 'qwen/qwen3.6-27b',
          temperature: 0.1,
          max_tokens: 4096,
        });

        let raw = completion.choices[0]?.message?.content || '{}';
        raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const cleaned = raw.substring(jsonStart, jsonEnd + 1);
          const result = JSON.parse(cleaned);
          finalSeverity = result.severity || 'low';
          finalSummary = result.summary || 'Analysis complete.';
        } else {
          console.warn(`No JSON found for ${uid}:`, raw);
        }
      } catch (err) {
        console.error(`Groq error for ${uid}:`, err.message || err);
        // Retry logic or just skip, we'll continue with defaults so it can be manually re-run if needed,
        // but let's just leave it blank if it fails so it can be retried properly.
        continue;
      }
    }

    // Save back to RTDB
    await db.ref(`results/${targetTestId}/${uid}`).update({
      aiSeverity: finalSeverity,
      aiSummary: finalSummary
    });
    console.log(`Saved result for ${uid} -> ${finalSeverity}`);
    
    count++;
    // Sleep to prevent rate limit
    await sleep(3500);
  }

  console.log(`Done! Successfully reviewed ${count} candidates.`);
  process.exit(0);
}

main().catch(console.error);
