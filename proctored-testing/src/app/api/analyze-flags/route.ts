import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

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

    // Summarize flag counts for brevity in the prompt
    const summary: Record<string, number> = {};
    for (const f of flags) {
      summary[f.event] = (summary[f.event] || 0) + 1;
    }

    const prompt = `You are an AI proctoring analyst for an official university admission examination at BIT Mesra.
Review the following proctoring event summary recorded during a student's exam session:

Event counts: ${JSON.stringify(summary)}
Total violations: ${flags.length}
First violation timestamp: ${flags[0]?.timestamp}
Last violation timestamp: ${flags[flags.length - 1]?.timestamp}

Event definitions:
- NO_FACE_DETECTED: Student's face not visible to camera
- MULTIPLE_FACES: More than one person detected on camera
- TAB_SWITCHED: Student switched browser tabs or windows
- EXITED_FULLSCREEN: Student exited mandatory fullscreen mode
- LOUD_AUDIO: Significant audio spike detected (possible talking)

Based on the frequency, severity and pattern of these events, determine the overall cheating risk.
Consider: isolated single occurrences may be accidental (low risk), but repeated or combined violations especially MULTIPLE_FACES and TAB_SWITCHED together suggest deliberate cheating (high risk).

Respond ONLY with a JSON object matching exactly this schema:
{ "severity": "low|medium|high", "summary": "A professional, concise 2-sentence analysis for the exam administrator." }`;

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
    // Graceful fallback — don't crash the admin dashboard
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.', severity: null, summary: null },
      { status: 500 }
    );
  }
}
