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
- INVALID_FACE_COUNT / MULTIPLE_FACES: Student's face was missing, or multiple faces were in the frame.
- TAB_SWITCHED: Student switched browser tabs or minimized the window.
- LEFT_FULLSCREEN: Student exited mandatory fullscreen mode.
- LOUD_AUDIO: Significant audio spike detected (possible talking).
- CAMERA_COVERED: The webcam lens was physically covered or the room was pitch black.
Based on the total duration and combination of these events (and any photos provided), determine the overall cheating risk.
Consider: 
- 1-5 seconds of face missing or audio might be accidental. Low risk.
- Tab switching or leaving fullscreen for more than a few seconds is highly suspicious.
- ANY duration of PHONE_DETECTED or multiple faces is a critical cheating indicator.
- If snapshots are provided, explicitly state if you observe cheating behavior in them.

Respond ONLY with a JSON object matching exactly this schema:
{ "severity": "low|medium|high", "summary": "A practical, concise 2-sentence analysis for the exam administrator, explicitly mentioning the total durations in seconds and what was found in the photos if any. (e.g., 'Student left fullscreen for 45 seconds total...')" }`;

    const contentArray: any[] = [{ type: 'text', text: promptText }];
    
    // Add up to 3 snapshots to avoid token/size limits
    const snapshots = flags.filter((f: any) => !!f.snapshotBase64).slice(0, 3);
    for (const flag of snapshots) {
      contentArray.push({
        type: 'image_url',
        image_url: { url: flag.snapshotBase64 }
      });
    }

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: contentArray }],
      model: 'qwen/qwen3.6-27b',
      temperature: 0.1,
      max_tokens: 256,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let result: any = {};
    try {
      // Find the first { and last } to extract just the JSON object
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        console.warn('No JSON object found in response:', raw);
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
