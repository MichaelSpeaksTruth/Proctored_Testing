import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { DurationFlag, calculateIntegrityScore, isHardViolation } from '@/lib/proctoring';
import { getAdminDb } from '@/lib/firebaseAdmin';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { uid, flags, score, total, testId } = await req.json();

    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    if (!flags || flags.length === 0) {
      return NextResponse.json({
        severity: 'low',
        integrityScore: 100,
        summary: 'Excellent academic integrity. The candidate completed the exam with zero proctoring infractions.',
      });
    }

    const flagList = flags as DurationFlag[];
    const integrityScore = calculateIntegrityScore(flagList);

    // Group flags into Hard Violations vs Soft Telemetry
    const hardSummary: Record<string, { count: number; totalSeconds: number }> = {};
    const softSummary: Record<string, { count: number; totalSeconds: number }> = {};

    let totalHardEvents = 0;
    let totalSoftEvents = 0;

    for (const f of flagList) {
      const dur = f.durationInSeconds || 0;
      if (isHardViolation(f.event)) {
        totalHardEvents++;
        if (!hardSummary[f.event]) hardSummary[f.event] = { count: 0, totalSeconds: 0 };
        hardSummary[f.event].count++;
        hardSummary[f.event].totalSeconds += dur;
      } else {
        totalSoftEvents++;
        if (!softSummary[f.event]) softSummary[f.event] = { count: 0, totalSeconds: 0 };
        softSummary[f.event].count++;
        softSummary[f.event].totalSeconds += dur;
      }
    }

    const scoreInfo = (score !== undefined && total !== undefined) ? `\nStudent Exam Score: ${score} out of ${total}` : '';

    const promptText = `You are a fair, objective AI proctoring integrity auditor for an official university engineering examination at BIT Mesra.
Your task is to analyze candidate session telemetry and provide a reliable, trustworthy integrity assessment.

Candidate Statistics:
- Calculated Integrity Score: ${integrityScore}/100
- Total Flags: ${flagList.length} (Hard Violations: ${totalHardEvents}, Soft Telemetry: ${totalSoftEvents})${scoreInfo}

Hard Intentional Violations (Tab switches, fullscreen exits, unauthorized devices, multiple faces):
${JSON.stringify(hardSummary, null, 2)}

Soft Physiological/Behavioral Telemetry (Looking down, gaze deviation, room noise, brief face obstruction):
${JSON.stringify(softSummary, null, 2)}

Integrity Guidelines:
1. Low Risk (Clean/Normal): Occasional glances away, natural head tilt while reading or solving problems on desk, brief audio spikes, or 0-1 momentary window blurs. Integrity score typically >= 80.
2. Medium Risk (Review Suggested): Repeated tab switching, prolonged gaze away from screen (>45s cumulative), or frequent face dropouts. Integrity score typically 60-79.
3. High Risk (Action Required): Sustained presence of multiple faces, confirmed unauthorized mobile phone usage, repeated or prolonged window/tab exits (>20s), or integrity score < 60.

Write a professional, balanced 2-sentence summary explaining the rationale. Distinguish clearly between innocent natural movement and actual suspicious activity.

Output format: You must respond in strict JSON format:
{
  "severity": "low|medium|high",
  "summary": "Professional 2-3 sentence analysis of findings.",
  "integrityScore": ${integrityScore}
}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptText }],
      model: 'openai/gpt-oss-120b',
      temperature: 0.1,
      max_tokens: 1024,
    });

    let raw = completion.choices[0]?.message?.content || '{}';
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    let result: any = {};
    try {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const cleaned = raw.substring(jsonStart, jsonEnd + 1);
        result = JSON.parse(cleaned);
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch (e) {
      console.warn('Failed to parse output as json:', raw, e);
    }

    // Default severity fallback aligned with the objective integrity score
    let computedSeverity: 'low' | 'medium' | 'high' = 'low';
    if (integrityScore < 60 || totalHardEvents >= 3) {
      computedSeverity = 'high';
    } else if (integrityScore < 80 || totalHardEvents >= 1) {
      computedSeverity = 'medium';
    }

    const finalSeverity = result.severity || computedSeverity;
    const finalSummary = result.summary || `Integrity Score: ${integrityScore}/100 with ${totalHardEvents} critical events recorded.`;
    const finalIntegrityScore = result.integrityScore ?? integrityScore;

    if (testId && uid) {
      try {
        const db = getAdminDb();
        await db.ref(`results/${testId}/${uid}`).update({
          aiSeverity: finalSeverity,
          aiSummary: finalSummary,
          integrityScore: finalIntegrityScore,
        });
      } catch (dbErr) {
        console.warn('Failed to persist AI review to RTDB via admin SDK:', dbErr);
      }
    }

    return NextResponse.json({
      severity: finalSeverity,
      summary: finalSummary,
      integrityScore: finalIntegrityScore,
    });
  } catch (err: any) {
    console.error('Groq analysis error:', err.message || err);
    
    if (err.status === 429 || (err.error && err.error.error && err.error.error.code === 'rate_limit_exceeded')) {
      const msg = err.error?.error?.message || 'Rate limit reached.';
      const waitMatch = msg.match(/try again in ([0-9a-z.]+)/i);
      const waitTime = waitMatch ? waitMatch[1] : 'a few minutes';
      
      return NextResponse.json(
        { error: `API Rate limit reached. Please try again in ${waitTime}.`, severity: null, summary: null },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Analysis failed. Please try again.', severity: null, summary: null },
      { status: 500 }
    );
  }
}
