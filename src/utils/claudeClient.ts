import { TrackerExercise } from '../types';

// Personal app, user-supplied key stored on-device: call the Messages API
// directly with fetch. The official SDK targets server/browser environments
// and would need dangerouslyAllowBrowser in React Native; raw fetch is the
// clean mobile path and keeps the bundle small.
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';

// The prompt encodes Brian's exact handwritten shorthand so the model reads
// the page the way he writes it.
const PROMPT = `You are reading a photo of a printed "WORKOUT TRACKER" page that has been filled in by hand. Read it precisely and return JSON only.

PAGE LAYOUT
- Top: a MONTH (handwritten, e.g. "July") and a DAY heading (e.g. "MONDAY — Chest, Biceps & Abs").
- A table of exercises. Each row has: the exercise name, a "Sets × Reps" TARGET (e.g. "4×8-10", "3×10", "3×12", "4×15", "3×Failure", "3×1 min"), then four WEEK columns (WEEK 1, WEEK 2, WEEK 3, WEEK 4). Each week column has set boxes labelled S1, S2, S3, S4 where weights/reps are handwritten. A small date (e.g. "25th") may be written above a week column.
- Bottom: NOTES / PR's / FORM CUES, sometimes one note per week (and check-circles for cardio rows like "HIIT Rowing").

WHICH WEEK TO READ
- Read ONLY the most recently completed week: the RIGHTMOST WEEK column that contains handwriting. Report its column number (1-4) in "weekNumber" and any date written above it in "weekDate". Ignore empty/earlier columns.

HOW TO READ EACH SET BOX — this shorthand is critical:
1. BARE WEIGHT = max reps. If the exercise has a numeric rep target (e.g. "8-10", "10", "12", "15") and the box has ONLY a number with no "R" mark, that number is the WEIGHT in kg and the reps equal the MAXIMUM of the target range (10 for "8-10", 12 for "3×12", 15 for "4×15", 10 for "3×10"). Set inferred=true.
2. OVERRIDE (reps differ from target). If a box shows reps marked with "R" (e.g. "7R", "12R", "9R") together with a weight (written either order, e.g. "7R 70", "70 7R", "12R 30"), then the R-number is the ACTUAL reps and the other number is the WEIGHT in kg. Set inferred=false. Example: "60 / 7R" → weight 60, reps 7.
3. NO WEIGHT TARGET (bodyweight). If the target is "Failure"/"AMRAP" (e.g. Ab Roller, Dips, Pull-Ups), the number written in the box IS the rep count achieved; set weight=null.
4. TIMED. If the target is a duration (e.g. "1 min"), a box like "1m" means it was held for that duration; set reps=null, weight=null, and put the duration in durationSeconds (e.g. 60 for "1m").
5. Units: a weight may have "kg" written after it — strip it, keep the number. Form remarks like "(form?)" go in the set's "notes", never in a number.
6. Always copy exactly what was written into "raw". If a value is genuinely unreadable, use null — do NOT guess a number.
7. Skip blank set boxes.

Return ONLY this JSON object, no markdown fences, no commentary:
{
  "month": string | null,
  "day": string | null,
  "weekNumber": number | null,
  "weekDate": string | null,
  "exercises": [
    {
      "name": string,
      "target": string | null,
      "sets": [
        { "setNumber": number, "reps": number | null, "weight": number | null, "durationSeconds": number | null, "inferred": boolean, "raw": string, "notes": string | null }
      ]
    }
  ],
  "notes": string | null,
  "rawText": string
}
If the page is unreadable, return the same object with "exercises": [] and your best "rawText".`;

// Reading a scale photo for the Monday weigh-in. Brian photographs his weight
// each week; this lets that same photo flow into the weekly report.
const BODYWEIGHT_PROMPT = `You are reading a photo showing a person's bodyweight — usually a bathroom scale's display (digital numbers or a dial), or the weight written by hand. Read it precisely and return JSON only.

HOW TO READ
- Find the single BODYWEIGHT reading. It is a number, typically between 40 and 250, often with one decimal place (e.g. 82.5).
- Units: if "kg" is shown, use the number as-is. If "lb", "lbs" or "pounds" is shown, convert to kilograms (kg = pounds × 0.45359237) and round to 1 decimal, and report unit "lb". If no unit is shown, assume kilograms.
- A smart scale may also show body-fat %, BMI, muscle %, water %, the time, or a user number — IGNORE all of those. Return only the total bodyweight.
- If you cannot confidently read a single bodyweight value, set "kg" to null. Never guess.

Return ONLY this JSON object, no markdown fences, no commentary:
{ "kg": number | null, "unit": "kg" | "lb" | null, "raw": string }
where "raw" is exactly what you read from the display (e.g. "82.5 kg", "181.9 lb").`;

export interface ParsedBodyweight {
  kg: number | null;
  unit: 'kg' | 'lb' | null;
  raw: string;
}

export interface ParsedTracker {
  month: string | null;
  day: string | null;
  weekNumber: number | null;
  weekDate: string | null;
  exercises: TrackerExercise[];
  notes: string | null;
  rawText: string;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in the model response.');
  }
  return body.slice(start, end + 1);
}

function num(v: any): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Send a base64 JPEG + prompt to the vision model and return its text reply. */
async function callVision(base64Jpeg: string, prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message ? `: ${err.error.message}` : '';
    } catch {}
    if (res.status === 401) throw new Error(`Invalid API key${detail}`);
    if (res.status === 429) throw new Error(`Rate limited — try again shortly${detail}`);
    throw new Error(`Claude API error ${res.status}${detail}`);
  }

  const data = await res.json();
  return (data?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

export async function parseBodyweightImage(
  base64Jpeg: string,
  apiKey: string,
): Promise<ParsedBodyweight> {
  const text = await callVision(base64Jpeg, BODYWEIGHT_PROMPT, apiKey, 512);
  const parsed = JSON.parse(extractJson(text));
  const kg = num(parsed.kg);
  return {
    kg: kg != null && kg > 0 && kg <= 500 ? kg : null,
    unit: parsed.unit === 'kg' || parsed.unit === 'lb' ? parsed.unit : null,
    raw: typeof parsed.raw === 'string' ? parsed.raw : text,
  };
}

export async function parseTrackerImage(
  base64Jpeg: string,
  apiKey: string,
  selection?: { date?: string; historical: boolean; column?: number },
): Promise<ParsedTracker> {
  let whichWeek = '';
  if (selection?.column) {
    whichWeek = `Read ONLY printed WEEK ${selection.column}, even if later columns are filled. Return no exercises if that column is blank.`;
  } else if (selection?.historical && selection.date) {
    whichWeek = `Read ONLY the column dated for the selected workout on ${selection.date}. If the handwritten dates do not uniquely identify it, return no exercises so the user can select the printed week. Never substitute a different column.`;
  }
  const prompt = whichWeek ? PROMPT.replace(/(WHICH WEEK TO READ\n)[^\n]+/, '$1' + whichWeek) : PROMPT;
  const text = await callVision(base64Jpeg, prompt, apiKey, 4096);

  const parsed = JSON.parse(extractJson(text));
  return {
    month: parsed.month ?? null,
    day: parsed.day ?? null,
    weekNumber: num(parsed.weekNumber),
    weekDate: parsed.weekDate ?? null,
    notes: parsed.notes ?? null,
    exercises: Array.isArray(parsed.exercises)
      ? parsed.exercises.map((e: any) => ({
          name: String(e?.name ?? 'Unknown'),
          target: e?.target ?? undefined,
          sets: Array.isArray(e?.sets)
            ? e.sets.map((s: any, i: number) => ({
                setNumber: num(s?.setNumber) ?? i + 1,
                reps: num(s?.reps),
                weight: num(s?.weight),
                durationSeconds: num(s?.durationSeconds),
                inferred: s?.inferred === true,
                raw: typeof s?.raw === 'string' ? s.raw : undefined,
                notes: s?.notes ?? undefined,
              }))
            : [],
        }))
      : [],
    rawText: typeof parsed.rawText === 'string' ? parsed.rawText : text,
  };
}
