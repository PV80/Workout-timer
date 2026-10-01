import { useHistoryStore } from '../store/historyStore';
import { flushWorkout, hydrateWorkout, useWorkoutStore } from '../store/workoutStore';

/** Save the final checkpoint before clearing it; safe to retry after a crash. */
export async function saveFinishedWorkout(): Promise<void> {
  const ws = useWorkoutStore.getState();
  if (!ws.activeWorkout || !ws.sessionId || ws.sessionStartedAt == null || !ws.finishPending) return;
  await flushWorkout();
  const endedAt = ws.setRecords[ws.setRecords.length - 1]?.completedAt ?? new Date().toISOString();
  await useHistoryStore.getState().saveSession({
    id: ws.sessionId, day: ws.activeWorkout.day, date: endedAt,
    totalDuration: Math.max(0, (Date.parse(endedAt) - ws.sessionStartedAt) / 1000),
    exercisesCompleted: new Set(ws.setRecords.map((r) => r.exerciseId)).size,
    setRecords: ws.setRecords,
  });
  if (useWorkoutStore.getState().sessionId === ws.sessionId) ws.reset();
  await flushWorkout();
}

let readiness: Promise<void> | null = null;
/** Shared by startup and headless notification events: hydrate once before use. */
export function ensureWorkoutReady(): Promise<void> {
  if (!readiness) {
    readiness = (async () => {
      if (!useHistoryStore.getState().hydrated) await useHistoryStore.getState().hydrate();
      await hydrateWorkout();
      const ws = useWorkoutStore.getState();
      const alreadySaved = ws.sessionId != null &&
        useHistoryStore.getState().sessions.some((s) => s.id === ws.sessionId);
      if (alreadySaved) {
        ws.reset();
        await flushWorkout();
        useWorkoutStore.setState({ recoveredCompletion: true });
      } else if (ws.finishPending) {
        await saveFinishedWorkout();
        useWorkoutStore.setState({ recoveredCompletion: true });
      }
    })().catch((error) => { readiness = null; throw error; });
  }
  return readiness;
}
