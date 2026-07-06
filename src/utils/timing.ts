import {
  AdaptedTiming,
  Exercise,
  ExerciseType,
  SetRecord,
  TimerPhase,
  TimingRecord,
  UserSettings,
  WorkoutDay,
} from '../types';

// Nominal seconds assumed for an AMRAP (to-failure) set when projecting — it
// has no fixed target, so we can't measure pace on it, but it still consumes
// time that belongs in the estimate.
const AMRAP_NOMINAL_SET = 45;

export const DEFAULT_SETTINGS: UserSettings = {
  tier1SetDuration: 60,
  tier1BreakDuration: 150,
  standardSetDuration: 40,
  standardBreakDuration: 90,
  transitionDuration: 180,
  targetWorkoutMinutes: 90,
  warningWorkoutMinutes: 120,
  minSessionsForAdaptation: 3,
};

const TYPE_DEFAULTS: Record<ExerciseType, AdaptedTiming> = {
  TIER1:    { setDuration: 60,   breakDuration: 150 },
  STANDARD: { setDuration: 40,   breakDuration: 90  },
  AMRAP:    { setDuration: null, breakDuration: 90  },
  TIMED:    { setDuration: 60,   breakDuration: 60  },
  CARDIO:   { setDuration: null, breakDuration: 0   },
};

export function getDefaultTiming(type: ExerciseType, settings: UserSettings): AdaptedTiming {
  switch (type) {
    case 'TIER1':    return { setDuration: settings.tier1SetDuration,    breakDuration: settings.tier1BreakDuration };
    case 'STANDARD': return { setDuration: settings.standardSetDuration, breakDuration: settings.standardBreakDuration };
    case 'AMRAP':    return { setDuration: null, breakDuration: settings.standardBreakDuration };
    case 'TIMED':    return { setDuration: 60,   breakDuration: 60 };
    case 'CARDIO':   return { setDuration: null, breakDuration: 0 };
  }
}

export function getAdaptedTiming(
  exerciseId: string,
  exerciseType: ExerciseType,
  allRecords: TimingRecord[],
  settings: UserSettings,
): AdaptedTiming {
  const records = allRecords.filter((r) => r.exerciseId === exerciseId && !r.transition);
  if (records.length < settings.minSessionsForAdaptation) {
    return getDefaultTiming(exerciseType, settings);
  }
  const last15 = records.slice(-15);
  const setDurations = last15.map((r) => r.setDuration).filter((d): d is number => d !== null);
  const breakDurations = last15.map((r) => r.breakDuration).filter((d): d is number => d !== null);
  const avgSet = setDurations.length > 0 ? setDurations.reduce((a, b) => a + b, 0) / setDurations.length : null;
  const defaults = getDefaultTiming(exerciseType, settings);
  const avgBreak = breakDurations.length > 0
    ? breakDurations.reduce((a, b) => a + b, 0) / breakDurations.length
    : null;
  return {
    setDuration: exerciseType === 'AMRAP' ? null : (avgSet !== null ? Math.round(avgSet) : defaults.setDuration),
    breakDuration: avgBreak !== null ? Math.max(30, Math.round(avgBreak)) : defaults.breakDuration,
  };
}

/**
 * Adaptive countdown for the between-exercise transition (weight setup / bathroom).
 * Keyed by the UPCOMING exercise id, since setup time is a property of the exercise
 * you're about to start. Falls back to the user's transition default until enough
 * history exists.
 */
export function getAdaptedTransition(
  nextExerciseId: string,
  allRecords: TimingRecord[],
  settings: UserSettings,
): number {
  const records = allRecords.filter(
    (r) => r.exerciseId === nextExerciseId && r.transition && r.breakDuration !== null,
  );
  if (records.length < settings.minSessionsForAdaptation) {
    return settings.transitionDuration;
  }
  const last15 = records.slice(-15);
  const avg = last15.reduce((a, r) => a + (r.breakDuration ?? 0), 0) / last15.length;
  return Math.max(30, Math.round(avg));
}

export function estimateTotalDuration(
  workout: WorkoutDay,
  allRecords: TimingRecord[],
  settings: UserSettings,
): number {
  let total = 0;
  let seenFirst = false;
  for (const ex of workout.exercises) {
    if (ex.type === 'CARDIO') continue;
    const timing = getAdaptedTiming(ex.id, ex.type, allRecords, settings);
    const setDur = ex.type === 'AMRAP' ? AMRAP_NOMINAL_SET : (timing.setDuration ?? AMRAP_NOMINAL_SET);
    // transition (setup) before every exercise except the first
    if (seenFirst) total += getAdaptedTransition(ex.id, allRecords, settings);
    total += ex.sets * setDur + (ex.sets - 1) * timing.breakDuration;
    seenFirst = true;
  }
  return total;
}

function setDurationOf(ex: Exercise, timing: AdaptedTiming): number {
  return ex.type === 'AMRAP' ? AMRAP_NOMINAL_SET : (timing.setDuration ?? AMRAP_NOMINAL_SET);
}

export interface LiveEstimateInput {
  workout: WorkoutDay;
  /** This session's completed set records (carry predicted + actual). */
  setRecords: SetRecord[];
  currentExerciseIndex: number;
  currentSetNumber: number;
  currentPhase: TimerPhase;
  /** Seconds elapsed in the current phase (pause-aware). */
  currentPhaseElapsed: number;
  /** The current phase's target countdown (break/transition), if any. */
  currentTargetDuration: number | null;
  /** Whole-session elapsed wall-clock seconds. */
  elapsedSeconds: number;
  allRecords: TimingRecord[];
  settings: UserSettings;
}

export interface LiveEstimate {
  /** Projected total workout duration, seconds. */
  totalSeconds: number;
  /** Observed pace vs. baseline: >1 slower than expected, <1 faster. */
  paceFactor: number;
}

/**
 * Live projection of the whole workout's duration, from start to finish, that
 * reacts to how fast you're actually moving. It measures the session's pace
 * from completed sets/breaks (actual ÷ predicted, from the records already
 * being written on every DONE) and applies that factor to the estimated time
 * still remaining. The pace only earns trust as sets accumulate, so the number
 * starts at the plain baseline estimate and tightens as the session goes on —
 * letting you see whether you need to pick it up to hit your target.
 */
export function estimateLiveTotalDuration(input: LiveEstimateInput): LiveEstimate | null {
  const {
    workout, setRecords, currentExerciseIndex, currentSetNumber, currentPhase,
    currentPhaseElapsed, currentTargetDuration, elapsedSeconds, allRecords, settings,
  } = input;

  const exercises = workout.exercises;
  const currentEx = exercises[currentExerciseIndex];
  if (!currentEx || currentPhase === 'idle') return null;

  // ── Pace factor from completed work this session ──────────────────────────
  let actualSum = 0;
  let predictedSum = 0;
  let completedSets = 0;
  for (const r of setRecords) {
    if (r.actualSetDuration != null && r.predictedSetDuration != null) {
      actualSum += r.actualSetDuration;
      predictedSum += r.predictedSetDuration;
      completedSets++;
    }
    // Count a break only where one actually happened (last set of an exercise
    // has a transition instead, recorded as a 0 break).
    if (r.actualBreakDuration > 0 && r.predictedBreakDuration != null) {
      actualSum += r.actualBreakDuration;
      predictedSum += r.predictedBreakDuration;
    }
  }
  let paceFactor = 1;
  if (predictedSum > 0 && completedSets >= 1) {
    const raw = actualSum / predictedSum;
    const confidence = Math.min(1, completedSets / 3); // full trust after ~3 sets
    paceFactor = 1 + (raw - 1) * confidence;
    paceFactor = Math.max(0.6, Math.min(1.8, paceFactor));
  }

  // ── Time left in the current phase (unscaled — it's already underway) ─────
  const currentTiming = getAdaptedTiming(currentEx.id, currentEx.type, allRecords, settings);
  const currentSetDur = setDurationOf(currentEx, currentTiming);
  let currentRemaining = 0;
  if (currentPhase === 'set' || currentPhase === 'timed') {
    currentRemaining = Math.max(0, currentSetDur - currentPhaseElapsed);
  } else if (currentPhase === 'amrap') {
    currentRemaining = Math.max(0, AMRAP_NOMINAL_SET - currentPhaseElapsed);
  } else if (currentPhase === 'break' || currentPhase === 'transition') {
    currentRemaining = Math.max(0, (currentTargetDuration ?? 0) - currentPhaseElapsed);
  }

  // ── Baseline of everything after the current phase ────────────────────────
  let future = 0;
  if (currentEx.type !== 'CARDIO') {
    const brk = currentTiming.breakDuration;
    if (currentPhase === 'set' || currentPhase === 'timed' || currentPhase === 'amrap') {
      const remainingSets = Math.max(0, currentEx.sets - currentSetNumber);
      future += remainingSets * (brk + currentSetDur);
    } else if (currentPhase === 'break') {
      const remainingSets = Math.max(0, currentEx.sets - currentSetNumber);
      future += remainingSets * currentSetDur + Math.max(0, remainingSets - 1) * brk;
    }
    // 'transition' → the current exercise is fully done; nothing more from it.
  }
  let firstUpcoming = true;
  for (let i = currentExerciseIndex + 1; i < exercises.length; i++) {
    const ex = exercises[i];
    if (ex.type === 'CARDIO') continue;
    const t = getAdaptedTiming(ex.id, ex.type, allRecords, settings);
    const setDur = setDurationOf(ex, t);
    const body = ex.sets * setDur + (ex.sets - 1) * t.breakDuration;
    // The transition into the very next exercise is skipped if we're already
    // in it (currentPhase === 'transition').
    const transition = firstUpcoming && currentPhase === 'transition'
      ? 0
      : getAdaptedTransition(ex.id, allRecords, settings);
    future += transition + body;
    firstUpcoming = false;
  }

  const totalSeconds = elapsedSeconds + currentRemaining + paceFactor * future;
  return { totalSeconds, paceFactor };
}
