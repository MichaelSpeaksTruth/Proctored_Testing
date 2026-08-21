import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { DurationFlag } from '@/lib/proctoring';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { uid, flags } = await req.json();

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

    const promptText = `You are an AI proctoring analyst for an official university admission examination at BIT Mesra.
Review the following proctoring event summary recorded during a student's exam session. The values represent the TOTAL DURATION in seconds that the student was engaged in the infraction.

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
* If there are numerous critical flags (e.g., DUCKING_DOWN, HEAD_PITCH_DOWN, MIC_MUTED, TAB_SWITCHED) or they last for a significant duration, you MUST categorize the severity as 'high'.
* If there are only minor infractions for a few seconds, categorize as 'medium' or 'low'.
* Tab switching or leaving fullscreen for more than a few seconds is highly suspicious.
* ANY duration of PHONE_DETECTED or multiple faces is a critical cheating indicator.

**Output format:** You must respond in strict JSON format matching EXACTLY this schema:
{
  "severity": "low|medium|high",
  "summary": "You MUST write a 2-3 sentence explanation of *why* you gave this risk rating, referencing specific durations and events. NEVER output generic phrases like 'Analysis complete'."
}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptText }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 1024,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let result: any = {};
    try {
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
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
