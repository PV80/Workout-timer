import notifee, { EventType, Event } from '@notifee/react-native';
import {
  ACTION_DONE,
  ACTION_NEXT_EXERCISE,
  ACTION_NEXT_SET,
} from './notificationService';
import {
  completeCurrentSet,
  continueToNextExercise,
  startNextSet,
} from './workoutActions';
import { ensureWorkoutReady } from './workoutRecovery';
import { flushWorkout, waitForWorkoutNotifications } from '../store/workoutStore';

/**
 * Routes notification action-button presses ("Done", "Start next set", …) to
 * the shared workout actions. The background handler covers presses made from
 * the lock screen or while another app is in the foreground — the timer
 * advances (and the next phase's notifications are re-armed) without the app
 * being opened. Registered at module load; imported for its side effect from
 * the app entry point, including when Android starts a headless JS runtime.
 */

async function handleEvent({ type, detail }: Event): Promise<void> {
  if (type !== EventType.ACTION_PRESS) return;
  await ensureWorkoutReady();
  switch (detail.pressAction?.id) {
    case ACTION_DONE:
      await completeCurrentSet();
      break;
    case ACTION_NEXT_SET:
      await startNextSet();
      break;
    case ACTION_NEXT_EXERCISE:
      await continueToNextExercise(true);
      break;
  }
  // Keep the headless task alive until the next checkpoint reaches storage.
  await waitForWorkoutNotifications();
  await flushWorkout();
}

notifee.onForegroundEvent((event) => {
  handleEvent(event).catch(() => {});
});

notifee.onBackgroundEvent(async (event) => {
  await handleEvent(event).catch(() => {});
});
