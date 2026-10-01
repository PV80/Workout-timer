import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidNotificationSetting,
  AndroidVisibility,
  RepeatFrequency,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import { weekKey } from './week';

/**
 * Notification layer on Notifee. Compared to the previous expo-notifications
 * implementation this adds the two things the gym flow needed:
 *  - a LIVE ticking countdown on the ongoing status notification (Android's
 *    system chronometer renders it, so it ticks with the app backgrounded and
 *    without a foreground service), and
 *  - action buttons ("Done" / "Start next set" / "Start next exercise") on
 *    both the ongoing status and the end-of-phase alert, handled in the
 *    background (see notificationHandlers.ts) without opening the app.
 */

export const ACTION_DONE = 'done';
export const ACTION_NEXT_SET = 'next-set';
export const ACTION_NEXT_EXERCISE = 'next-exercise';
export type PhaseAction =
  | typeof ACTION_DONE
  | typeof ACTION_NEXT_SET
  | typeof ACTION_NEXT_EXERCISE;

const CHANNEL_ALERTS = 'workout-alerts';
const CHANNEL_STATUS = 'workout-status';
const CHANNEL_REMINDERS = 'reminders';

// One phase alert and one ongoing status exist at a time — fixed ids mean a
// re-display replaces in place (no flicker) and cancels are deterministic.
export const ALERT_ID = 'phase-alert';
export const ONGOING_ID = 'workout-ongoing';
const EXPORT_REMINDER_ID = 'weekly-export-reminder';

const ACCENT = '#22D46E';

let initialized = false;

export async function setupNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    await notifee.createChannel({
      id: CHANNEL_ALERTS,
      name: 'Workout alerts',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [300, 500],
      lights: true,
      lightColor: ACCENT,
      visibility: AndroidVisibility.PUBLIC,
    });
    await notifee.createChannel({
      id: CHANNEL_STATUS,
      name: 'Workout status',
      importance: AndroidImportance.LOW,
      vibration: false,
      visibility: AndroidVisibility.PUBLIC,
    });
    await notifee.createChannel({
      id: CHANNEL_REMINDERS,
      name: 'Reminders',
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
    });
    await notifee.requestPermission();
  } catch {}
}

/**
 * Android 14+ (and Samsung's One UI in particular) denies the "Alarms &
 * reminders" special permission by default. Our end-of-phase alerts are
 * scheduled through AlarmManager for exact timing — without the permission
 * the OS silently never fires them while the app is backgrounded/locked,
 * which looks like "no beep, no vibration, no buttons". Callers should check
 * this and send the user to the settings toggle; scheduling falls back to
 * inexact (WorkManager) delivery in the meantime so alerts still arrive.
 */
export async function canUseExactAlarms(): Promise<boolean> {
  try {
    const settings = await notifee.getNotificationSettings();
    return settings.android?.alarm === AndroidNotificationSetting.ENABLED;
  } catch {
    return true; // assume fine rather than nag on unexpected errors
  }
}

export async function openAlarmSettings(): Promise<void> {
  try {
    await notifee.openAlarmPermissionSettings();
  } catch {}
}

const ACTION_TITLES: Record<PhaseAction, string> = {
  [ACTION_DONE]: 'Done',
  [ACTION_NEXT_SET]: 'Start next set',
  [ACTION_NEXT_EXERCISE]: 'Start next exercise',
};

function androidActions(actions?: PhaseAction[]) {
  if (!actions || actions.length === 0) return undefined;
  // No launchActivity on the pressAction → the tap is delivered to the
  // background handler and the app stays wherever it is (locked / other app).
  return actions.map((id) => ({ title: ACTION_TITLES[id], pressAction: { id } }));
}

/** Schedule the end-of-phase alert (fires with sound even when backgrounded). */
export async function scheduleAlert(
  seconds: number,
  title: string,
  body: string,
  actions?: PhaseAction[],
): Promise<string | null> {
  if (seconds <= 0) return null;
  try {
    // Exact alarms need the "Alarms & reminders" permission; without it the
    // trigger would never fire. Fall back to inexact scheduling (may be a
    // little late under Doze, but it arrives).
    const exact = await canUseExactAlarms();
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: Date.now() + Math.max(1, Math.round(seconds)) * 1000,
      ...(exact ? { alarmManager: { allowWhileIdle: true } } : {}),
    };
    await notifee.createTriggerNotification(
      {
        id: ALERT_ID,
        title,
        body,
        android: {
          channelId: CHANNEL_ALERTS,
          importance: AndroidImportance.HIGH,
          category: AndroidCategory.ALARM,
          lightUpScreen: true,
          color: ACCENT,
          visibility: AndroidVisibility.PUBLIC,
          autoCancel: true,
          pressAction: { id: 'default', launchActivity: 'default' },
          actions: androidActions(actions),
        },
      },
      trigger,
    );
    return ALERT_ID;
  } catch {
    return null;
  }
}

export async function cancelAlert(id: string | null): Promise<void> {
  if (!id) return;
  try {
    // Cancels the pending trigger; if it already fired, clears the delivered
    // notification too.
    await notifee.cancelNotification(id);
  } catch {}
}

export interface OngoingOptions {
  /** Live system-rendered timer: counts down to (or up from) `timestamp` ms. */
  chronometer?: { direction: 'up' | 'down'; timestamp: number };
  actions?: PhaseAction[];
}

/**
 * Present the ongoing (sticky) status notification. Silent; shows a live
 * ticking countdown for the current phase plus the phase's primary action so
 * the timer can be driven from the shade / lock screen.
 */
export async function presentOngoing(
  title: string,
  body: string,
  opts: OngoingOptions = {},
): Promise<string | null> {
  try {
    await notifee.displayNotification({
      id: ONGOING_ID,
      title,
      body: body || undefined,
      android: {
        channelId: CHANNEL_STATUS,
        importance: AndroidImportance.LOW,
        color: ACCENT,
        visibility: AndroidVisibility.PUBLIC,
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        showTimestamp: false,
        ...(opts.chronometer
          ? {
              showChronometer: true,
              chronometerDirection: opts.chronometer.direction,
              timestamp: opts.chronometer.timestamp,
            }
          : {}),
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: androidActions(opts.actions),
      },
    });
    return ONGOING_ID;
  } catch {
    return null;
  }
}

export async function dismissOngoing(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await notifee.cancelNotification(id);
  } catch {}
}

/**
 * Weekly nudge to export the tracker: Friday evening, after the last training
 * day of the week. Skips ahead a week if this week was already exported.
 */
export async function ensureWeeklyExportReminder(
  exportedWeekKey: string | null | undefined,
): Promise<void> {
  try {
    await notifee.cancelTriggerNotification(EXPORT_REMINDER_ID);

    const next = new Date();
    next.setHours(18, 30, 0, 0);
    // 5 = Friday. Advance to the coming Friday 18:30 (or next week's if past).
    while (next.getDay() !== 5 || next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 1);
      next.setHours(18, 30, 0, 0);
    }
    // That Friday's week already exported → first reminder is a week later.
    if (exportedWeekKey && exportedWeekKey === weekKey(next)) {
      next.setDate(next.getDate() + 7);
    }

    const exact = await canUseExactAlarms();
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: next.getTime(),
      repeatFrequency: RepeatFrequency.WEEKLY,
      ...(exact ? { alarmManager: { allowWhileIdle: true } } : {}),
    };
    await notifee.createTriggerNotification(
      {
        id: EXPORT_REMINDER_ID,
        title: 'Export this week’s tracker',
        body: 'Friday session done — export the week’s CSV + JSON backup before the weekend gets busy.',
        android: {
          channelId: CHANNEL_REMINDERS,
          color: ACCENT,
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      },
      trigger,
    );
  } catch {}
}
