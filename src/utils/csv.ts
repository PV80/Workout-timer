import { BodyweightEntry, SetRecord, TrackerEntry, WorkoutSession } from '../types';
import { weekKey } from './week';

function esc(v: string | number | boolean | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Correlating timer data with parsed pages ────────────────────────────────
// The timer logs actualSetDuration on every DONE tap (per exercise, per set).
// Page names can use shorthand. Prefer normalized exact matches, then unique
// multi-word matches; ambiguous candidates remain separate timer rows.

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameScore(a: string, b: string): number {
  const na=normName(a),nb=normName(b);
  if (!na || !nb) return 0;
  if (na===nb) return 3;
  const ta=na.split(' ').filter(t=>t.length>2),tb=nb.split(' ').filter(t=>t.length>2);
  const overlap=ta.filter(t=>tb.includes(t)).length;
  if (Math.min(ta.length,tb.length)>=2 && (na.includes(nb)||nb.includes(na))) return 2;
  return overlap>=2 && overlap>=Math.ceil(Math.max(ta.length,tb.length)*.67)?1:0;
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** "MONDAY — Chest, Biceps & Abs" → "monday"; null if no weekday found. */
function dayNameFrom(heading: string | undefined): string | null {
  if (!heading) return null;
  const lower = heading.toLowerCase();
  return DAY_NAMES.find((d) => lower.includes(d)) ?? null;
}

/**
 * Look up how long a set actually took according to the app timer.
 * Sessions are matched to the page by ISO week + weekday, then the exercise
 * by fuzzy name, then the exact set number.
 */
function findTimerRecord(
  sessions: WorkoutSession[], entry: TrackerEntry, exerciseName: string, setNumber: number,
): SetRecord | null {
  const entryDay=dayNameFrom(entry.day);
  const candidates=sessions.filter(s=>weekKey(new Date(s.date))===entry.weekKey && (!entryDay||s.day===entryDay))
    .flatMap(s=>s.setRecords).filter(r=>r.setNumber===setNumber)
    .map(record=>({record,score:nameScore(record.exerciseName,exerciseName)})).filter(c=>c.score>0);
  const best=Math.max(0,...candidates.map(c=>c.score));
  const matches=candidates.filter(c=>c.score===best);
  // Different movements with the same score are ambiguous: keep their timer rows separate.
  if (new Set(matches.map(c=>c.record.exerciseId)).size!==1) return null;
  return matches[0]?.record??null;
}

/**
 * Flatten tracker entries and unmatched timer records into rows per set,
 * plus one row per bodyweight weigh-in. Callers filter sessions by export week.
 * `set_time_s` is the app-timed length of that set (every exercise, every
 * DONE tap); `duration_s` stays the page-written hold time for timed moves.
 */
export function buildWeekCsv(
  entries: TrackerEntry[],
  bodyweights: BodyweightEntry[] = [],
  sessions: WorkoutSession[] = [],
): string {
  // Newest session first so a restarted day resolves to the completed run.
  const byDateDesc = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

  const header = [
    'captured', 'month', 'day', 'page_week', 'week_date',
    'exercise', 'target', 'set', 'reps', 'weight', 'duration_s', 'set_time_s', 'inferred', 'raw', 'notes',
  ];
  const rows: string[] = [header.join(',')];
  const matchedRecords = new Set<SetRecord>();

  for (const entry of entries) {
    const captured = entry.capturedAt.slice(0, 10);
    for (const ex of entry.exercises) {
      ex.sets.forEach((s) => {
        const timerRecord = findTimerRecord(byDateDesc, entry, ex.name, s.setNumber);
        if (timerRecord) matchedRecords.add(timerRecord);
        const timerSeconds = timerRecord?.actualSetDuration == null ? null : Math.round(timerRecord.actualSetDuration);
        rows.push(
          [
            esc(captured),
            esc(entry.month ?? ''),
            esc(entry.day ?? ''),
            esc(entry.weekNumber ?? ''),
            esc(entry.weekDate ?? ''),
            esc(ex.name),
            esc(ex.target ?? ''),
            esc(s.setNumber),
            esc(s.reps),
            esc(s.weight),
            esc(s.durationSeconds ?? ''),
            esc(timerSeconds ?? ''),
            esc(s.inferred ? 'yes' : ''),
            esc(s.raw ?? ''),
            esc(s.notes ?? ''),
          ].join(','),
        );
      });
    }
  }

  // Preserve every saved timer set, including sessions without a photographed page.
  for (const session of byDateDesc) for (const record of session.setRecords) {
    if (matchedRecords.has(record)) continue;
    rows.push([session.date.slice(0,10),'',session.day,'','',record.exerciseName,'',record.setNumber,
      '','','',record.actualSetDuration == null ? '' : Math.round(record.actualSetDuration),'','',
      `Timer record; session ${session.id}`].map(esc).join(','));
  }

  // Bodyweight weigh-ins as their own rows (exercise = "Bodyweight", weight = kg).
  for (const b of bodyweights) {
    rows.push(
      [
        esc(b.date.slice(0, 10)),
        '', '', '', '',
        esc('Bodyweight'),
        '', '', '',
        esc(b.kg),
        '', '', '', '',
        esc('weekly weigh-in'),
      ].join(','),
    );
  }

  return rows.join('\n');
}

