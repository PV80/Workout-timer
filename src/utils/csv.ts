import { BodyweightEntry, SetRecord, TrackerEntry, WorkoutSession } from '../types';
import { weekKey } from './week';

function esc(v: string | number | boolean | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Correlating timer data with parsed pages ────────────────────────────────
// The timer logs actualSetDuration on every DONE tap (per exercise, per set).
// Page exercise names are handwritten/printed and the timer's come from the
// hardcoded programme, so matching is fuzzy: normalised equality, containment,
// or majority token overlap. "DB"/"BB" shorthand is expanded first.

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(' ').filter((t) => t.length > 2);
  const tb = new Set(nb.split(' ').filter((t) => t.length > 2));
  if (ta.length === 0 || tb.size === 0) return false;
  const overlap = ta.filter((t) => tb.has(t)).length;
  return overlap >= Math.ceil(Math.min(ta.length, tb.size) / 2) && overlap > 0;
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
function findTimerSetSeconds(
  sessions: WorkoutSession[],
  entry: TrackerEntry,
  exerciseName: string,
  setNumber: number,
): number | null {
  const entryDay = dayNameFrom(entry.day);
  for (const session of sessions) {
    if (weekKey(new Date(session.date)) !== entry.weekKey) continue;
    if (entryDay && session.day !== entryDay) continue;
    let match: SetRecord | null = null;
    for (const r of session.setRecords) {
      if (r.setNumber === setNumber && namesMatch(r.exerciseName, exerciseName)) {
        match = r;
        break;
      }
    }
    if (match) {
      return match.actualSetDuration != null ? Math.round(match.actualSetDuration) : null;
    }
  }
  return null;
}

/**
 * Flatten tracker entries into one CSV row per set (all captured days — the
 * `day` column distinguishes them), plus one row per bodyweight weigh-in.
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

  for (const entry of entries) {
    const captured = entry.capturedAt.slice(0, 10);
    for (const ex of entry.exercises) {
      ex.sets.forEach((s) => {
        const timerSeconds = findTimerSetSeconds(byDateDesc, entry, ex.name, s.setNumber);
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
