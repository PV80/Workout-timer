import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ActionGlyph } from './ActionGlyph';
import { TrackerPhotoCard, WeekColumnPicker } from './TrackerPhotoCard';
import { useTrackerStore } from '../store/trackerStore';
import { theme } from '../theme';
import { WorkoutSession } from '../types';
import { handleCaptureResult, promptCaptureSource } from '../utils/capturePrompts';
import { linkTrackerEntry, runTrackerCapture } from '../utils/trackerCapture';
import { exportWeekFiles } from '../utils/exportWeek';
import { weekKey } from '../utils/week';

export function SessionTracker({ session }: { session: WorkoutSession }) {
  const entries = useTrackerStore(s => s.entries);
  const [busy, setBusy] = useState(false);
  const [column, setColumn] = useState<number>();
  const week = weekKey(new Date(session.date));
  const linked = entries.find(e => e.sessionId === session.id);
  const candidates = linked ? [] : entries.filter(e => !e.sessionId && e.weekKey === week &&
    (!e.day || e.day.toLowerCase().includes(session.day.toLowerCase())));

  function capture() {
    promptCaptureSource(async source => {
      setBusy(true);
      try { handleCaptureResult(await runTrackerCapture(source, session, column)); }
      finally { setBusy(false); }
    });
  }

  async function link(id: string) {
    setBusy(true);
    try { await linkTrackerEntry(id, session); }
    catch (e) { Alert.alert('Page could not be linked', e instanceof Error ? e.message : 'Please retry.'); }
    finally { setBusy(false); }
  }

  async function exportWorkoutWeek() {
    setBusy(true);
    try {
      const store = useTrackerStore.getState();
      const result = await exportWeekFiles(store.entries.filter(e => e.weekKey === week),
        store.bodyweights.filter(b => b.weekKey === week), week);
      if (typeof result === 'object') Alert.alert('Sharing unavailable', result.savedTo);
      if (result === 'nothing') Alert.alert('Nothing to export for this workout week');
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Please retry.');
    } finally { setBusy(false); }
  }

  return <View style={styles.section}>
    <Text style={styles.heading}>Tracker page</Text>
    {linked && <Text style={styles.caption}>{linked.title ?? 'Workout page'} · {linked.exercises.length} exercises logged</Text>}
    {linked?.photo && <TrackerPhotoCard entry={linked} />}
    {candidates.map(e =>
      <TouchableOpacity key={e.id} accessibilityRole="button" onPress={() => link(e.id)} disabled={busy} style={styles.link}>
        <Text style={styles.action}>Link existing page · {e.title || 'Workout page'}</Text>
        <Text style={styles.caption}>{e.capturedAt.slice(0, 10)} · {e.exercises.length} exercises</Text>
      </TouchableOpacity>)}
    {!linked?.photo && week !== weekKey() && <WeekColumnPicker value={column} onChange={setColumn} />}
    <TouchableOpacity accessibilityRole="button" onPress={capture} disabled={busy} style={styles.button}>
      <ActionGlyph kind="capture" size={24} />
      <Text style={styles.action}>{busy ? 'Saving…' : linked?.photo ? 'Replace tracker photo' : linked ? 'Attach photo to logged page' : candidates.length ? 'Log a separate tracker page' : 'Log tracker page'}</Text>
    </TouchableOpacity>
    {linked && <TouchableOpacity accessibilityRole="button" style={styles.link} disabled={busy} onPress={exportWorkoutWeek}>
      <Text style={styles.action}>Export workout week · {week}</Text>
    </TouchableOpacity>}

  </View>;
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 12, gap: 8 },
  heading: { color: theme.text, fontSize: 16, fontWeight: '700' },
  caption: { color: theme.muted, fontSize: 13 },
  action: { color: theme.green, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  button: { minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', gap: 10, justifyContent: 'center', alignItems: 'center', borderColor: theme.green, borderWidth: 1, borderRadius: 10 },
  link: { paddingVertical: 8, minHeight: 44, gap: 3 },
});
