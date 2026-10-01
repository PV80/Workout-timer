import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Exercise, SetRecord, TimerPhase, WorkoutDay } from '../types';
import { ActiveWorkoutSnapshot, createWorkoutPersistence } from '../utils/activeWorkout';
import {
  ALERT_ID,
  ONGOING_ID,
  ACTION_DONE,
  ACTION_NEXT_EXERCISE,
  ACTION_NEXT_SET,
  cancelAlert,
  dismissOngoing,
  OngoingOptions,
  PhaseAction,
  presentOngoing,
  scheduleAlert,
} from '../utils/notificationService';

interface WorkoutState {
  hydrated: boolean;
  recovered: boolean;
  recoveredCompletion: boolean;
  saveError: boolean;
  activeWorkout: WorkoutDay | null;
  sessionId: string | null;
  sessionStartedAt: number | null;
  currentExerciseIndex: number;
  currentSetNumber: number;
  currentPhase: TimerPhase;
  phaseStartedAt: number | null;
  targetDuration: number | null;
  pausedAt: number | null;
  setRecords: SetRecord[];
  warningDismissed: boolean;
  pendingAlertId: string | null;
  ongoingId: string | null;
  finishPending: boolean;

  startWorkout: (workout: WorkoutDay, sessionId: string, startIndex?: number) => void;
  startSet: (targetDuration: number | null) => void;
  startBreak: (targetDuration: number) => void;
  startTransition: (targetDuration: number) => void;
  completeBreak: (actualBreakDuration: number, nextSetDuration?: number | null) => void;
  completeSet: (record: SetRecord, phase: TimerPhase, duration: number | null) => void;
  skipBreak: () => void;
  pause: () => void;
  resume: () => void;
  addSetRecord: (record: SetRecord) => void;
  patchLastBreak: (actualBreakDuration: number) => void;
  advanceToNextExercise: (nextSetDuration?: number | null) => boolean;
  restoreNotifications: () => void;
  settleNotifications: () => Promise<void>;
  abandonWorkout: () => void;
  dismissWarning: () => void;
  reset: () => void;
}

const initialState = {
  activeWorkout: null,
  sessionId: null,
  sessionStartedAt: null,
  currentExerciseIndex: 0,
  currentSetNumber: 1,
  currentPhase: 'idle' as TimerPhase,
  phaseStartedAt: null,
  targetDuration: null,
  pausedAt: null,
  setRecords: [],
  warningDismissed: false,
  pendingAlertId: null,
  ongoingId: null,
  finishPending: false,
};

function endClock(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Index of the next non-cardio exercise after `from`, or null if none. */
function nextExerciseIndex(workout: WorkoutDay, from: number): number | null {
  let next = from + 1;
  while (next < workout.exercises.length && workout.exercises[next].type === 'CARDIO') {
    next++;
  }
  return next < workout.exercises.length ? next : null;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => {
  let notificationWork = Promise.resolve();
  let notificationGeneration = 0;
  /** Cancel the existing alert + ongoing notification, then arm new ones for
   *  whatever phase the store is currently in. Reads live state so it works
   *  for both fresh phase entry and resume-from-pause. */
  function armForCurrentPhase() {
    const generation = ++notificationGeneration;
    notificationWork = notificationWork.then(async () => {
      if (generation !== notificationGeneration) return;
      const s = get();
      const {
        currentPhase,
        phaseStartedAt,
        targetDuration,
        activeWorkout,
        currentExerciseIndex,
        currentSetNumber,
      } = s;

      // IDs survive in Android even when the previous JS process is gone.
      await cancelAlert(ALERT_ID);
      await dismissOngoing(ONGOING_ID);
      if (generation !== notificationGeneration) return;

      const ex = activeWorkout?.exercises[currentExerciseIndex] ?? null;
      if (!ex || !phaseStartedAt || currentPhase === 'idle') {
        set({ pendingAlertId: null, ongoingId: null });
        return;
      }

      if (s.pausedAt != null) {
        const id = await presentOngoing('Paused', 'Open the app to resume your timer');
        if (generation === notificationGeneration) set({ pendingAlertId: null, ongoingId: id });
        return;
      }

      const remaining =
        targetDuration != null
          ? Math.max(0, targetDuration - (Date.now() - phaseStartedAt) / 1000)
          : null;

      let alertTitle = '';
      let alertBody = '';
      let statusTitle = '';
      let statusBody = '';
      let actions: PhaseAction[] = [];

      if (currentPhase === 'break') {
        alertTitle = 'Break over';
        alertBody = `${ex.name} · set ${currentSetNumber + 1} ready`;
        statusTitle = `BREAK · ${ex.name}`;
        statusBody = remaining != null ? `next set at ${endClock(remaining)}` : '';
        actions = [ACTION_NEXT_SET];
      } else if (currentPhase === 'transition') {
        const ni = activeWorkout ? nextExerciseIndex(activeWorkout, currentExerciseIndex) : null;
        const nextName = ni != null ? activeWorkout!.exercises[ni].name : 'next exercise';
        alertTitle = "Setup time's up";
        alertBody = `Next: ${nextName}`;
        statusTitle = `SETUP · next: ${nextName}`;
        statusBody = remaining != null ? `ready at ${endClock(remaining)}` : '';
        actions = [ACTION_NEXT_EXERCISE];
      } else if (currentPhase === 'amrap') {
        statusTitle = `AMRAP · ${ex.name}`;
        statusBody = 'to failure — tap Done when finished';
        actions = [ACTION_DONE];
      } else {
        // set / timed
        alertTitle = 'Set time reached';
        alertBody = `${ex.name} · set ${currentSetNumber} — tap Done when finished`;
        statusTitle = `SET ${currentSetNumber}/${ex.sets} · ${ex.name}`;
        statusBody = remaining != null ? `target ${endClock(remaining)}` : '';
        actions = [ACTION_DONE];
      }

      if (currentPhase !== 'amrap' && remaining != null && remaining > 0) {
        const id = await scheduleAlert(remaining, alertTitle, alertBody, actions);
        if (generation !== notificationGeneration) return;
        set({ pendingAlertId: id });
      } else {
        set({ pendingAlertId: null });
      }

      // Live ticking timer in the shade: countdown to the target for timed
      // phases, count-up from the start for AMRAP.
      const ongoingOpts: OngoingOptions = { actions };
      if (currentPhase === 'amrap') {
        ongoingOpts.chronometer = { direction: 'up', timestamp: phaseStartedAt };
      } else if (targetDuration != null) {
        ongoingOpts.chronometer = {
          direction: 'down',
          timestamp: phaseStartedAt + targetDuration * 1000,
        };
      }
      const id = await presentOngoing(statusTitle, statusBody, ongoingOpts);
      if (generation === notificationGeneration) set({ ongoingId: id });
    });
  }

  return {
    ...initialState,
    hydrated: false,
    recovered: false,
    recoveredCompletion: false,
    saveError: false,

    restoreNotifications() { armForCurrentPhase(); },
    settleNotifications() { return notificationWork; },

    startWorkout(workout, sessionId, startIndex = 0) {
      // Resolve the first non-cardio exercise at or after the requested index.
      let idx = Math.max(0, Math.min(startIndex, workout.exercises.length - 1));
      while (idx < workout.exercises.length && workout.exercises[idx].type === 'CARDIO') {
        idx++;
      }
      if (idx >= workout.exercises.length) idx = 0;
      set({
        ...initialState,
        recovered: false,
        recoveredCompletion: false,
        activeWorkout: workout,
        sessionId,
        sessionStartedAt: Date.now(),
        currentExerciseIndex: idx,
      });
      armForCurrentPhase();
    },

    startSet(targetDuration) {
      const { activeWorkout, currentExerciseIndex } = get();
      const ex = activeWorkout?.exercises[currentExerciseIndex];
      const phase: TimerPhase =
        ex?.type === 'AMRAP' ? 'amrap' : ex?.type === 'TIMED' ? 'timed' : 'set';
      set({ currentPhase: phase, phaseStartedAt: Date.now(), targetDuration, pausedAt: null });
      armForCurrentPhase();
    },

    startBreak(targetDuration) {
      set({ currentPhase: 'break', phaseStartedAt: Date.now(), targetDuration, pausedAt: null });
      armForCurrentPhase();
    },

    startTransition(targetDuration) {
      set({ currentPhase: 'transition', phaseStartedAt: Date.now(), targetDuration, pausedAt: null });
      armForCurrentPhase();
    },

    completeSet(record, phase, duration) {
      // Checkpoint the completed record and its next phase in one update.
      // A restart must never restore an already-recorded set as still running.
      set((s) => ({
        setRecords: [...s.setRecords, record], currentPhase: phase,
        phaseStartedAt: phase === 'idle' ? null : Date.now(),
        targetDuration: duration, pausedAt: null, finishPending: phase === 'idle',
      }));
      armForCurrentPhase();
    },

    completeBreak(actualBreakDuration, nextSetDuration) {
      const { activeWorkout, currentExerciseIndex, currentSetNumber, setRecords } = get();
      const ex = activeWorkout?.exercises[currentExerciseIndex];
      if (!ex) return;
      if (currentSetNumber < ex.sets) {
        const records = setRecords.slice();
        if (records.length) records[records.length - 1] = { ...records[records.length - 1], actualBreakDuration };
        set({
          setRecords: records,
          currentSetNumber: currentSetNumber + 1,
          currentPhase: nextSetDuration === undefined ? 'idle' :
            ex.type === 'AMRAP' ? 'amrap' : ex.type === 'TIMED' ? 'timed' : 'set',
          phaseStartedAt: nextSetDuration === undefined ? null : Date.now(),
          targetDuration: nextSetDuration ?? null,
          pendingAlertId: null,
          ongoingId: null,
          pausedAt: null,
        });
        armForCurrentPhase();
      } else {
        set({ pendingAlertId: null, ongoingId: null, pausedAt: null });
      }
    },

    skipBreak() {
      get().completeBreak(0);
    },

    pause() {
      const { pausedAt, currentPhase, phaseStartedAt } = get();
      if (pausedAt || !phaseStartedAt || currentPhase === 'idle') return;
      set({ pausedAt: Date.now(), pendingAlertId: null, ongoingId: null });
      armForCurrentPhase();
    },

    resume() {
      const { pausedAt, phaseStartedAt } = get();
      if (!pausedAt || !phaseStartedAt) return;
      const pausedDuration = Date.now() - pausedAt;
      set({ phaseStartedAt: phaseStartedAt + pausedDuration, pausedAt: null });
      armForCurrentPhase();
    },

    addSetRecord(record) {
      set((s) => ({ setRecords: [...s.setRecords, record] }));
    },

    patchLastBreak(actualBreakDuration) {
      set((s) => {
        if (s.setRecords.length === 0) return s;
        const records = s.setRecords.slice();
        records[records.length - 1] = {
          ...records[records.length - 1],
          actualBreakDuration,
        };
        return { setRecords: records };
      });
    },

    advanceToNextExercise(nextSetDuration) {
      const { activeWorkout, currentExerciseIndex } = get();
      if (!activeWorkout) return false;
      const next = nextExerciseIndex(activeWorkout, currentExerciseIndex);
      if (next == null) return false;
      const ex = activeWorkout.exercises[next];
      set({
        currentExerciseIndex: next,
        currentSetNumber: 1,
        currentPhase: nextSetDuration === undefined ? 'idle' :
          ex.type === 'AMRAP' ? 'amrap' : ex.type === 'TIMED' ? 'timed' : 'set',
        phaseStartedAt: nextSetDuration === undefined ? null : Date.now(),
        targetDuration: nextSetDuration ?? null,
        pendingAlertId: null,
        ongoingId: null,
        pausedAt: null,
      });
      armForCurrentPhase();
      return true;
    },

    abandonWorkout() {
      set({ ...initialState, recovered: false, currentPhase: 'idle' });
      armForCurrentPhase();
    },

    dismissWarning() {
      set({ warningDismissed: true });
    },

    reset() {
      set({ ...initialState, recovered: false, currentPhase: 'idle' });
      armForCurrentPhase();
    },
  };
});

function checkpoint(s: WorkoutState): ActiveWorkoutSnapshot | null {
  if (!s.activeWorkout || !s.sessionId || s.sessionStartedAt == null) return null;
  return {
    activeWorkout: s.activeWorkout, sessionId: s.sessionId, sessionStartedAt: s.sessionStartedAt,
    currentExerciseIndex: s.currentExerciseIndex, currentSetNumber: s.currentSetNumber,
    currentPhase: s.currentPhase, phaseStartedAt: s.phaseStartedAt, targetDuration: s.targetDuration,
    pausedAt: s.pausedAt, setRecords: s.setRecords, warningDismissed: s.warningDismissed,
    finishPending: s.finishPending,
  };
}

const persistence = createWorkoutPersistence(AsyncStorage, (saveError) => {
  if (useWorkoutStore.getState().saveError !== saveError) useWorkoutStore.setState({ saveError });
});
useWorkoutStore.subscribe((state) => {
  if (state.hydrated) persistence.save(checkpoint(state));
});

let hydration: Promise<void> | null = null;
export function hydrateWorkout(): Promise<void> {
  if (useWorkoutStore.getState().hydrated) return Promise.resolve();
  if (!hydration) {
    hydration = persistence.load().then((saved) => {
      useWorkoutStore.setState({ ...saved, hydrated: true, recovered: saved !== null });
    }).catch((error) => { hydration = null; throw error; });
  }
  return hydration;
}

export async function flushWorkout(): Promise<void> {
  await persistence.flush();
}

export async function waitForWorkoutNotifications(): Promise<void> {
  let pending;
  do {
    pending = useWorkoutStore.getState().settleNotifications();
    await pending;
  } while (pending !== useWorkoutStore.getState().settleNotifications());
}

export async function retryWorkoutSave(): Promise<void> {
  persistence.save(checkpoint(useWorkoutStore.getState()), true);
  await persistence.flush();
}

/** The next non-cardio exercise after the current one, or null if it's the last. */
export function getNextExercise(): Exercise | null {
  const { activeWorkout, currentExerciseIndex } = useWorkoutStore.getState();
  if (!activeWorkout) return null;
  let next = currentExerciseIndex + 1;
  while (next < activeWorkout.exercises.length && activeWorkout.exercises[next].type === 'CARDIO') {
    next++;
  }
  return next < activeWorkout.exercises.length ? activeWorkout.exercises[next] : null;
}
