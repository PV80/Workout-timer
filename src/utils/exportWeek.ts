import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useHistoryStore } from '../store/historyStore';
import { useTrackerStore } from '../store/trackerStore';
import { BodyweightEntry, TrackerEntry } from '../types';
import { buildBackup } from './backup';
import { buildWeekCsv } from './csv';
import { ensureWeeklyExportReminder } from './notificationService';
import { weekKey } from './week';

/**
 * Shared export flow: writes the week's CSV AND a full-data JSON backup, then
 * offers both through the share sheet (two sheets back-to-back — Android's
 * share sheet takes one file at a time). The JSON doubles as the disaster-
 * recovery backup: restoring it in Settings brings back everything, not just
 * that week. Marks the week exported so the Friday reminder skips it.
 */
export async function exportWeekFiles(
  entries: TrackerEntry[],
  bodyweights: BodyweightEntry[],
  label: string,
): Promise<'shared' | 'nothing' | { savedTo: string }> {
  if (entries.length === 0 && bodyweights.length === 0) return 'nothing';

  // Sessions provide the app-timed per-set durations (set_time_s column).
  const csv = buildWeekCsv(entries, bodyweights, useHistoryStore.getState().sessions);
  const csvUri = `${FileSystem.cacheDirectory}workout-${label}.csv`;
  await FileSystem.writeAsStringAsync(csvUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  const backup = buildBackup();
  const jsonUri = `${FileSystem.cacheDirectory}workout-backup-${label}.json`;
  await FileSystem.writeAsStringAsync(jsonUri, JSON.stringify(backup, null, 1), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const store = useTrackerStore.getState();
  const week = weekKey();
  await store.markExported(week);
  ensureWeeklyExportReminder(week);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(csvUri, {
      mimeType: 'text/csv',
      dialogTitle: `Workout tracker — ${label} (CSV)`,
    });
    await Sharing.shareAsync(jsonUri, {
      mimeType: 'application/json',
      dialogTitle: `Workout backup — ${label} (JSON)`,
    });
    return 'shared';
  }
  return { savedTo: `${csvUri}\n${jsonUri}` };
}

/**
 * Export THIS week, reading the stores fresh at call time. Always use this
 * (not screen-level props/hooks) when exporting right after a capture or
 * weigh-in: a React render closure can hold the pre-capture entry list, which
 * is exactly how a just-captured Friday page once vanished from the CSV.
 */
export async function exportCurrentWeek(): Promise<'shared' | 'nothing' | { savedTo: string }> {
  const { entries, bodyweights } = useTrackerStore.getState();
  const week = weekKey();
  return exportWeekFiles(
    entries.filter((e) => e.weekKey === week),
    bodyweights.filter((b) => b.weekKey === week),
    week,
  );
}

/** Share just the JSON backup (Settings → "Back up now"). */
export async function shareBackupNow(): Promise<'shared' | { savedTo: string }> {
  const backup = buildBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}workout-backup-${stamp}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup, null, 1), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: `Workout backup — ${stamp}`,
    });
    return 'shared';
  }
  return { savedTo: uri };
}
