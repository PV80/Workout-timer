import type { SetRecord, TimerPhase, WorkoutDay } from '../types';

export const ACTIVE_WORKOUT_KEY = 'active_workout';

export interface ActiveWorkoutSnapshot {
  activeWorkout: WorkoutDay;
  sessionId: string;
  sessionStartedAt: number;
  currentExerciseIndex: number;
  currentSetNumber: number;
  currentPhase: TimerPhase;
  phaseStartedAt: number | null;
  targetDuration: number | null;
  pausedAt: number | null;
  setRecords: SetRecord[];
  warningDismissed: boolean;
  finishPending: boolean;
}

/** Reject an unreadable checkpoint instead of silently starting over it. */
export function readActiveWorkout(raw: string | null): ActiveWorkoutSnapshot | null {
  if (raw == null) return null;
  const saved = JSON.parse(raw);
  const s = saved?.state;
  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const nullable = (value: unknown) => value === null || finite(value);
  if (
    saved.version !== 1 || !s || typeof s.sessionId !== 'string' || !s.sessionId ||
    !finite(s.sessionStartedAt) || !Array.isArray(s.activeWorkout?.exercises) ||
    !Number.isInteger(s.currentExerciseIndex) || s.currentExerciseIndex < 0 ||
    !s.activeWorkout.exercises[s.currentExerciseIndex] ||
    !Number.isInteger(s.currentSetNumber) || s.currentSetNumber < 1 ||
    s.currentSetNumber > s.activeWorkout.exercises[s.currentExerciseIndex].sets ||
    !['set', 'break', 'amrap', 'timed', 'transition', 'idle'].includes(s.currentPhase) ||
    !nullable(s.phaseStartedAt) || !nullable(s.targetDuration) || !nullable(s.pausedAt) ||
    (s.currentPhase !== 'idle' && s.phaseStartedAt === null) ||
    !Array.isArray(s.setRecords) ||
    !s.setRecords.every((r: any) => r && typeof r.exerciseId === 'string' &&
      typeof r.exerciseName === 'string' && Number.isInteger(r.setNumber) && r.setNumber > 0 &&
      nullable(r.predictedSetDuration) && nullable(r.actualSetDuration) &&
      nullable(r.predictedBreakDuration) && finite(r.actualBreakDuration) &&
      typeof r.completedAt === 'string' && Number.isFinite(Date.parse(r.completedAt))) ||
    typeof s.warningDismissed !== 'boolean' || typeof s.finishPending !== 'boolean'
  ) {
    throw new Error('The saved workout could not be read. Your saved data has been kept.');
  }
  // Only accept checkpoint fields; never merge persisted values over store actions.
  return {
    activeWorkout: s.activeWorkout, sessionId: s.sessionId, sessionStartedAt: s.sessionStartedAt,
    currentExerciseIndex: s.currentExerciseIndex, currentSetNumber: s.currentSetNumber,
    currentPhase: s.currentPhase, phaseStartedAt: s.phaseStartedAt, targetDuration: s.targetDuration,
    pausedAt: s.pausedAt, setRecords: s.setRecords, warningDismissed: s.warningDismissed,
    finishPending: s.finishPending,
  };
}

interface Storage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
  removeItem: (key: string) => Promise<unknown>;
}

/** Serialize writes so an older phase cannot finish saving after a newer one. */
export function createWorkoutPersistence(storage: Storage, onError: (failed: boolean) => void) {
  let writes = Promise.resolve();
  let error: unknown = null;
  let lastQueued: string | null = null;

  function save(snapshot: ActiveWorkoutSnapshot | null, force = false) {
    const raw = snapshot === null ? null : JSON.stringify({ version: 1, state: snapshot });
    if (raw === lastQueued && !force) return;
    lastQueued = raw;
    writes = writes.then(async () => {
      if (raw === null) await storage.removeItem(ACTIVE_WORKOUT_KEY);
      else await storage.setItem(ACTIVE_WORKOUT_KEY, raw);
    }).then(() => { error = null; onError(false); }, (failure) => {
      error = failure;
      onError(true);
    });
  }

  return {
    async load() {
      await writes;
      const raw = await storage.getItem(ACTIVE_WORKOUT_KEY);
      const snapshot = readActiveWorkout(raw);
      lastQueued = snapshot === null ? null : JSON.stringify({ version: 1, state: snapshot });
      return snapshot;
    },
    save,
    async flush() {
      // A write may trigger another state update while this one is pending.
      let pending;
      do { pending = writes; await pending; } while (pending !== writes);
      if (error !== null) throw error;
    },
  };
}
