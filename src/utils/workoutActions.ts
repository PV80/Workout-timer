import { router } from 'expo-router';
import { useHistoryStore } from '../store/historyStore';
import { flushWorkout, useWorkoutStore, getNextExercise } from '../store/workoutStore';
import { getAdaptedTiming, getAdaptedTransition } from './timing';
import { stopAlert } from './alertService';
import { SetRecord } from '../types';
import { saveFinishedWorkout } from './workoutRecovery';

export type ActionOutcome = 'break' | 'transition' | 'set' | 'finished' | 'noop';

// Screen and notification taps share a lock while checkpoint/storage writes
// are pending. Repeated taps must not duplicate a record or skip the next set.
let advancing = false;
async function advance(action: () => Promise<ActionOutcome> | ActionOutcome): Promise<ActionOutcome> {
  if (advancing) return 'noop';
  advancing = true;
  try {
    const outcome = await action();
    await flushWorkout();
    return outcome;
  } finally {
    advancing = false;
  }
}

async function finishSession(): Promise<void> {
  await saveFinishedWorkout();
  // There may be no mounted navigator during a headless notification event.
  try { router.replace('/complete'); } catch {}
}

/** SET / AMRAP / TIMED finished → atomically record it and enter the next phase. */
export async function completeCurrentSet(): Promise<ActionOutcome> {
  return advance(async () => {
    const ws = useWorkoutStore.getState();
    const hs = useHistoryStore.getState();
    const exercise = ws.activeWorkout?.exercises[ws.currentExerciseIndex];
    const phase = ws.currentPhase;
    if (!exercise || !ws.sessionId || !ws.phaseStartedAt || ws.pausedAt != null) return 'noop';
    if (phase !== 'set' && phase !== 'timed' && phase !== 'amrap') return 'noop';
    stopAlert();

    const actualSetDuration = phase === 'amrap' ? null : (Date.now() - ws.phaseStartedAt) / 1000;
    const timing = getAdaptedTiming(exercise.id, exercise.type, hs.timingRecords, hs.settings);
    const record: SetRecord = {
      exerciseId: exercise.id, exerciseName: exercise.name, setNumber: ws.currentSetNumber,
      predictedSetDuration: timing.setDuration, actualSetDuration,
      predictedBreakDuration: timing.breakDuration, actualBreakDuration: 0,
      completedAt: new Date().toISOString(),
    };
    const lastSet = ws.currentSetNumber >= exercise.sets;
    const next = lastSet ? getNextExercise() : null;
    const outcome = !lastSet ? 'break' : next ? 'transition' : 'finished';
    ws.completeSet(record, outcome === 'finished' ? 'idle' : outcome,
      outcome === 'break' ? timing.breakDuration : next ?
        getAdaptedTransition(next.id, hs.timingRecords, hs.settings) : null);
    await flushWorkout();

    await hs.addTimingRecord({
      exerciseId: exercise.id, setNumber: ws.currentSetNumber,
      setDuration: actualSetDuration, breakDuration: null,
      date: record.completedAt, sessionId: ws.sessionId,
    });
    if (outcome === 'finished') await finishSession();
    return outcome;
  });
}

/** BREAK finished → checkpoint its duration and the next set together. */
export async function startNextSet(): Promise<ActionOutcome> {
  return advance(async () => {
    const ws = useWorkoutStore.getState();
    const hs = useHistoryStore.getState();
    const exercise = ws.activeWorkout?.exercises[ws.currentExerciseIndex];
    if (!exercise || !ws.sessionId || !ws.phaseStartedAt || ws.currentPhase !== 'break' || ws.pausedAt != null) return 'noop';
    stopAlert();
    const actualBreakDuration = (Date.now() - ws.phaseStartedAt) / 1000;
    const timing = getAdaptedTiming(exercise.id, exercise.type, hs.timingRecords, hs.settings);
    ws.completeBreak(actualBreakDuration, timing.setDuration);
    await flushWorkout();
    await hs.addTimingRecord({
      exerciseId: exercise.id, setNumber: ws.currentSetNumber,
      setDuration: null, breakDuration: actualBreakDuration,
      date: new Date().toISOString(), sessionId: ws.sessionId,
    });
    return 'set';
  });
}

/** Deliberately skipped rest stays in session history, but is not learned. */
export async function skipBreak(): Promise<ActionOutcome> {
  return advance(() => {
    const ws = useWorkoutStore.getState();
    const hs = useHistoryStore.getState();
    const exercise = ws.activeWorkout?.exercises[ws.currentExerciseIndex];
    if (!exercise || !ws.phaseStartedAt || ws.currentPhase !== 'break' || ws.pausedAt != null) return 'noop';
    stopAlert();
    const timing = getAdaptedTiming(exercise.id, exercise.type, hs.timingRecords, hs.settings);
    ws.completeBreak((Date.now() - ws.phaseStartedAt) / 1000, timing.setDuration);
    return 'set';
  });
}

/** TRANSITION finished → checkpoint the first set of the next exercise. */
export async function continueToNextExercise(record: boolean): Promise<ActionOutcome> {
  return advance(async () => {
    const ws = useWorkoutStore.getState();
    const hs = useHistoryStore.getState();
    if (!ws.sessionId || !ws.phaseStartedAt || ws.currentPhase !== 'transition' || ws.pausedAt != null) return 'noop';
    const next = getNextExercise();
    if (!next) return 'noop';
    stopAlert();
    const actualTransition = (Date.now() - ws.phaseStartedAt) / 1000;
    const timing = getAdaptedTiming(next.id, next.type, hs.timingRecords, hs.settings);
    ws.advanceToNextExercise(timing.setDuration);
    await flushWorkout();
    if (record) {
      await hs.addTimingRecord({
        exerciseId: next.id, setNumber: 0, setDuration: null,
        breakDuration: actualTransition, date: new Date().toISOString(),
        sessionId: ws.sessionId, transition: true,
      });
    }
    return 'set';
  });
}
