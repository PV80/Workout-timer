import { assertValidBackup } from './backupValidation';
import { useWorkoutStore } from '../store/workoutStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HISTORY_KEYS, useHistoryStore } from '../store/historyStore';
import { TRACKER_KEYS, useTrackerStore } from '../store/trackerStore';
import { BodyweightEntry, TimingRecord, TrackerEntry, UserSettings, WorkoutSession } from '../types';

/**
 * Full-data JSON backup. Everything the app persists lives in AsyncStorage on
 * one phone — this file is the recovery path for a lost/replaced device. The
 * Anthropic API key is deliberately EXCLUDED (backups get shared to Drive,
 * email, etc.); re-enter it once in Settings after a restore.
 */

export interface AppBackup {
  app: 'workout-timer';
  backupVersion: 1;
  exportedAt: string;
  settings: UserSettings;
  timingRecords: TimingRecord[];
  sessions: WorkoutSession[];
  trackerEntries: TrackerEntry[];
  bodyweights: BodyweightEntry[];
}

export function buildBackup(): AppBackup {
  const history = useHistoryStore.getState();
  const tracker = useTrackerStore.getState();
  return {
    app: 'workout-timer',
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: history.settings,
    timingRecords: history.timingRecords,
    sessions: history.sessions,
    trackerEntries: tracker.entries,
    bodyweights: tracker.bodyweights,
  };
}

export interface RestoreSummary {
  sessions: number;
  timingRecords: number;
  trackerEntries: number;
  bodyweights: number;
}

/**
 * Replace all app data with a backup's contents (API key untouched), then
 * re-hydrate the stores so the UI reflects it immediately.
 * Throws with a user-readable message if the file isn't a valid backup.
 */
export async function restoreFromBackupJson(text: string): Promise<RestoreSummary> {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data?.app !== 'workout-timer' || typeof data?.backupVersion !== 'number') {
    throw new Error('That file is not a Workout Timer backup.');
  }
  if (data.backupVersion > 1) {
    throw new Error('This backup was made by a newer app version.');
  }

  assertValidBackup(data);
  if (useWorkoutStore.getState().activeWorkout) {
    throw new Error('Finish or discard the active workout before restoring a backup.');
  }
  const timingRecords = data.timingRecords;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const trackerEntries = Array.isArray(data.trackerEntries) ? data.trackerEntries : [];
  const bodyweights = Array.isArray(data.bodyweights) ? data.bodyweights : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;

  const writes: Array<[string, string]> = [
    [HISTORY_KEYS.timingHistory, JSON.stringify(timingRecords)],
    [HISTORY_KEYS.sessionHistory, JSON.stringify(sessions)],
    [TRACKER_KEYS.entries, JSON.stringify(trackerEntries)],
    [TRACKER_KEYS.bodyweight, JSON.stringify(bodyweights)],
  ];
  if (settings) writes.push([HISTORY_KEYS.userSettings, JSON.stringify(settings)]);
  await AsyncStorage.multiSet(writes);

  await Promise.all([
    useHistoryStore.getState().hydrate(),
    useTrackerStore.getState().hydrate(),
  ]);

  return {
    sessions: sessions.length,
    timingRecords: timingRecords.length,
    trackerEntries: trackerEntries.length,
    bodyweights: bodyweights.length,
  };
}

