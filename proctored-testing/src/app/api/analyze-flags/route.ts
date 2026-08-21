import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { DurationFlag } from '@/lib/proctoring';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { uid, flags, score, total } = await req.json();

    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    if (!flags || flags.length === 0) {
      return NextResponse.json({
        severity: 'low',
        summary: 'No suspicious activity detected. The candidate completed the exam with no proctoring violations.',
      });
    }

    // Summarize flag durations for brevity in the prompt
    const durationSummary: Record<string, number> = {};
    for (const f of flags as DurationFlag[]) {
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

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptText }],
      model: 'qwen/qwen3.6-27b',
      temperature: 0.1,
      max_tokens: 4096,
    });

    let raw = completion.choices[0]?.message?.content || '{}';
    // Remove <think> blocks commonly produced by reasoning models like Qwen
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    let result: any = {};
    try {
      // Find the first { and last } to extract JSON
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

    return NextResponse.json({
      severity: result.severity || 'low',
      summary: result.summary || 'Analysis complete.',
    });
  } catch (err) {
    console.error('Groq analysis error:', err);
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.', severity: null, summary: null },
      { status: 500 }
    );
  }
}
