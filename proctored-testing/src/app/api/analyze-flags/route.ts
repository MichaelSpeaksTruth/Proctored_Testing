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

    const prompt = `You are an AI proctoring analyst for an official university admission examination at BIT Mesra.
Review the following proctoring event summary recorded during a student's exam session. The values represent the TOTAL DURATION in seconds that the student was engaged in the infraction.

Total Time in Violation (Seconds): ${JSON.stringify(durationSummary)}
Total individual events logged: ${flags.length}

Event definitions:
- INVALID_FACE_COUNT: Student's face was missing, or multiple faces were in the frame.
- TAB_SWITCHED: Student switched browser tabs or minimized the window.
- LEFT_FULLSCREEN: Student exited mandatory fullscreen mode.
- LOUD_AUDIO: Significant audio spike detected (possible talking).
- CAMERA_COVERED: The webcam lens was physically covered or the room was pitch black.
- PHONE_DETECTED: A smartphone was visible in the camera frame.

Based on the total duration and combination of these events, determine the overall cheating risk.
Consider: 
- 1-5 seconds of face missing or audio might be accidental (e.g., dropping a pen, clearing throat). Low risk.
- Tab switching or leaving fullscreen for more than a few seconds is highly suspicious.
- ANY duration of PHONE_DETECTED or multiple faces is a critical cheating indicator.

Respond ONLY with a JSON object matching exactly this schema:
{ "severity": "low|medium|high", "summary": "A practical, concise 2-sentence analysis for the exam administrator, explicitly mentioning the total durations in seconds. (e.g., 'Student left fullscreen for 45 seconds total...')" }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'qwen/qwen3.6-27b',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 256,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const result = JSON.parse(raw);

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
