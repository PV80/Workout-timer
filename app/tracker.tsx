import { useHistoryStore } from '../src/store/historyStore';
import { weekKey } from '../src/utils/week';
import { ActionGlyph } from '../src/components/ActionGlyph';
import { ArtworkHero } from '../src/components/ArtworkHero';
import { PageHeader } from '../src/components/PageHeader';
import { theme } from '../src/theme';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CameraIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from '../src/components/icons';
import { useTrackerStore, currentWeekKey } from '../src/store/trackerStore';
import {
  runTrackerCapture,
  runBodyweightCapture,
  BodyweightCaptureResult,
  CaptureResult,
  CaptureSource,
} from '../src/utils/trackerCapture';
import { exportCurrentWeek, exportWeekFiles } from '../src/utils/exportWeek';
import { BodyweightEntry, TrackerEntry, TrackerExercise, TrackerSet } from '../src/types';

/** Ask whether to use the camera or an existing photo, then run the chosen flow. */
export function promptCaptureSource(
  run: (source: CaptureSource) => void,
  copy?: { title: string; message: string },
) {
  Alert.alert(
    copy?.title ?? 'Log tracker page',
    copy?.message ?? 'Photograph the page now, or pick a photo you already took.',
    [
      { text: 'Take photo', onPress: () => run('camera') },
      { text: 'Choose from library', onPress: () => run('library') },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

/** Map a bodyweight capture result to an alert. Returns true if a weight was saved. */
export function handleBodyweightResult(r: BodyweightCaptureResult): boolean {
  switch (r.status) {
    case 'saved':
      Alert.alert('Bodyweight logged', `${r.kg} kg saved — it'll be in this week's CSV.`);
      return true;
    case 'no-key':
      Alert.alert('API key needed', 'Add your Anthropic API key in Settings → Tracker & API to read weigh-in photos.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings') },
      ]);
      return false;
    case 'no-permission':
      Alert.alert('Camera permission', 'Camera access is needed to photograph your scale.');
      return false;
    case 'empty':
      Alert.alert('Couldn’t read the weight', 'No bodyweight was detected. Try a clear, straight-on photo of the scale display.');
      return false;
    case 'error':
      Alert.alert('Reading failed', r.message);
      return false;
    case 'cancelled':
    default:
      return false;
  }
}

/** Map a capture result to a user-facing alert. Returns true if an entry was saved. */
export function handleCaptureResult(r: CaptureResult): boolean {
  switch (r.status) {
    case 'saved':
      return true;
    case 'no-key':
      Alert.alert('API key needed', 'Add your Anthropic API key in Settings → Tracker & API to parse photos.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings') },
      ]);
      return false;
    case 'no-permission':
      Alert.alert('Camera permission', 'Camera access is needed to photograph your tracker page.');
      return false;
    case 'empty':
      Alert.alert('Couldn’t read the page', 'No exercises were detected. Try a clearer, well-lit, straight-on photo.');
      return false;
    case 'error':
      Alert.alert('Parsing failed', r.message);
      return false;
    case 'cancelled':
    default:
      return false;
  }
}

function describeSet(s: TrackerSet): string {
  if (s.durationSeconds) return `${Math.round(s.durationSeconds / 60)}m`;
  const reps = s.reps ?? '–';
  const w = s.weight != null ? ` @ ${s.weight}` : '';
  const flag = s.inferred ? '*' : '';
  return `${reps}${flag}${w}`;
}

interface SetDraft {
  reps: string;
  weight: string;
  duration: string;
}

/**
 * Inline correction of a parsed page before it goes into the weekly CSV —
 * fix a misread weight here instead of re-photographing. A manually corrected
 * value is confirmed by a human, so its "inferred" flag is cleared.
 */
function EntryEditor({ entry, onClose }: { entry: TrackerEntry; onClose: () => void }) {
  const updateEntry = useTrackerStore((s) => s.updateEntry);
  const [drafts, setDrafts] = useState<SetDraft[][]>(() =>
    entry.exercises.map((ex) =>
      ex.sets.map((s) => ({
        reps: s.reps != null ? String(s.reps) : '',
        weight: s.weight != null ? String(s.weight) : '',
        duration: s.durationSeconds != null ? String(s.durationSeconds) : '',
      })),
    ),
  );
  const [notes, setNotes] = useState(entry.notes ?? '');

  function patch(i: number, j: number, field: keyof SetDraft, value: string) {
    setDrafts((cur) =>
      cur.map((ex, a) => (a !== i ? ex : ex.map((s, b) => (b !== j ? s : { ...s, [field]: value })))),
    );
  }

  const toNum = (v: string): number | null => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  async function save() {
    const exercises: TrackerExercise[] = entry.exercises.map((ex, i) => ({
      ...ex,
      sets: ex.sets.map((s, j) => {
        const d = drafts[i][j];
        const reps = toNum(d.reps);
        const weight = toNum(d.weight);
        const durationSeconds = toNum(d.duration);
        const changed =
          reps !== s.reps || weight !== s.weight || durationSeconds !== (s.durationSeconds ?? null);
        return { ...s, reps, weight, durationSeconds, inferred: changed ? false : s.inferred };
      }),
    }));
    await updateEntry(entry.id, { exercises, notes: notes.trim() ? notes.trim() : undefined });
    onClose();
  }

  return (
    <View>
      {entry.exercises.map((ex, i) => (
        <View key={i} style={styles.editExercise}>
          <Text style={styles.exName}>
            {ex.name}
            {ex.target ? <Text style={styles.exTarget}>  ({ex.target})</Text> : null}
          </Text>
          {ex.sets.map((s, j) => (
            <View key={j} style={styles.editSetRow}>
              <Text style={styles.editSetLabel}>S{s.setNumber}</Text>
              {s.durationSeconds != null ? (
                <>
                  <TextInput
                    style={styles.editInput}
                    value={drafts[i][j].duration}
                    onChangeText={(v) => patch(i, j, 'duration', v)}
                    keyboardType="numeric"
                    placeholder="–"
                    placeholderTextColor={theme.subtle}
                  />
                  <Text style={styles.editUnit}>sec</Text>
                </>
              ) : (
                <>
                  <TextInput
                    style={styles.editInput}
                    value={drafts[i][j].reps}
                    onChangeText={(v) => patch(i, j, 'reps', v)}
                    keyboardType="numeric"
                    placeholder="reps"
                    placeholderTextColor={theme.subtle}
                  />
                  <Text style={styles.editUnit}>×</Text>
                  <TextInput
                    style={styles.editInput}
                    value={drafts[i][j].weight}
                    onChangeText={(v) => patch(i, j, 'weight', v)}
                    keyboardType="decimal-pad"
                    placeholder="bw"
                    placeholderTextColor={theme.subtle}
                  />
                  <Text style={styles.editUnit}>kg</Text>
                </>
              )}
              {s.raw ? <Text style={styles.editRaw}>“{s.raw}”</Text> : null}
            </View>
          ))}
        </View>
      ))}

      <TextInput
        style={styles.editNotes}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes / PRs / form cues"
        placeholderTextColor={theme.subtle}
        multiline
      />

      <View style={styles.editBtnRow}>
        <TouchableOpacity style={styles.editSaveBtn} onPress={save} accessibilityRole="button" accessibilityLabel="Save corrections">
          <Text style={styles.editSaveText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.editCancelBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel editing">
          <Text style={styles.editCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TrackerScreen() {
  const sessions = useHistoryStore((s) => s.sessions);
  const entries = useTrackerStore((s) => s.entries);
  const bodyweights = useTrackerStore((s) => s.bodyweights);
  const apiKey = useTrackerStore((s) => s.apiKey);
  const deleteEntry = useTrackerStore((s) => s.deleteEntry);
  const addBodyweight = useTrackerStore((s) => s.addBodyweight);
  const deleteBodyweight = useTrackerStore((s) => s.deleteBodyweight);
  const clearWeeksBefore = useTrackerStore((s) => s.clearWeeksBefore);

  const [busy, setBusy] = useState<null | 'capturing' | 'weighing' | 'exporting'>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [weightDraft, setWeightDraft] = useState('');

  // Friday flow: arriving with ?review=week means "check every day's entries
  // (Edit fixes misreads), then export" — the export is the explicit last step.
  const { review } = useLocalSearchParams<{ review?: string }>();
  const [reviewMode, setReviewMode] = useState(false);
  useEffect(() => {
    if (review === 'week') setReviewMode(true);
  }, [review]);

  const week = currentWeekKey();
  const thisWeek = useMemo(() => entries.filter((e) => e.weekKey === week), [entries, week]);
  const weekBw = useMemo(() => bodyweights.filter((b) => b.weekKey === week), [bodyweights, week]);
  const olderCount = entries.length - thisWeek.length + (bodyweights.length - weekBw.length);

  // In review mode start with the newest page open so checking begins at once.
  useEffect(() => {
    if (reviewMode && thisWeek.length > 0) setExpandedId((cur) => cur ?? thisWeek[0].id);
  }, [reviewMode]);

  /** Final step of the Friday review: weigh-in check, then export fresh state. */
  function handleReviewExport() {
    const hasWeighIn = useTrackerStore.getState().bodyweights.some((b) => b.weekKey === week);
    if (!hasWeighIn) {
      Alert.alert(
        'Weekly weigh-in missing',
        'No bodyweight logged this week. Snap the scale, add it in the Bodyweight section above, or export without it.',
        [
          { text: 'Snap the scale', onPress: () => weighThenExport() },
          { text: 'Export without it', onPress: () => runReviewExport() },
          { text: 'Add it first', style: 'cancel' },
        ],
      );
      return;
    }
    runReviewExport();
  }

  async function runReviewExport() {
    setBusy('exporting');
    try {
      const result = await exportCurrentWeek();
      if (result === 'nothing') {
        Alert.alert('Nothing to export', 'No entries for this week yet.');
        return;
      }
      if (typeof result === 'object') {
        Alert.alert('Sharing unavailable', `Files written to:\n${result.savedTo}`);
      }
      if (typeof result === 'object') return;
      setReviewMode(false);
      Alert.alert('Week exported', 'CSV + JSON backup shared. Enjoy the weekend!', [
        { text: 'Done', onPress: () => router.replace('/') },
        { text: 'Stay here', style: 'cancel' },
      ]);
    } catch (error: any) {
      Alert.alert('Export failed', error?.message ?? 'Your records are still saved. Please retry.');
    } finally {
      setBusy(null);
    }
  }

  function weighThenExport() {
    promptCaptureSource(
      async (source) => {
        setBusy('weighing');
        try {
          if (handleBodyweightResult(await runBodyweightCapture(source))) {
            await runReviewExport();
          }
        } finally {
          setBusy((b) => (b === 'weighing' ? null : b));
        }
      },
      { title: 'Log bodyweight', message: 'Photograph your scale now, or pick a photo you already took.' },
    );
  }

  async function exportWeek(toExport: TrackerEntry[], bw: BodyweightEntry[], label: string) {
    try {
    const result = await exportWeekFiles(toExport, bw, label);
    if (result === 'nothing') {
      Alert.alert('Nothing to export', 'No entries for this period yet.');
      return false;
    }
    if (typeof result === 'object') {
      Alert.alert('Sharing unavailable', `Files written to:\n${result.savedTo}`);
      return false; // Temporary cache files are not a durable backup; do not clear records.
    }
    return true;
    } catch (error: any) {
      Alert.alert('Export failed', error?.message ?? 'Your records are still saved. Please retry.');
      return false;
    }
  }

  function handleCapture() {
    promptCaptureSource(async (source) => {
      setBusy('capturing');
      try {
        const result = await runTrackerCapture(source);
        if (handleCaptureResult(result) && result.status === 'saved') {
          setExpandedId(result.entry.id);
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function handleWeighPhoto() {
    promptCaptureSource(
      async (source) => {
        setBusy('weighing');
        try {
          handleBodyweightResult(await runBodyweightCapture(source));
        } finally {
          setBusy(null);
        }
      },
      { title: 'Log bodyweight', message: 'Photograph your scale now, or pick a photo you already took.' },
    );
  }

  async function handleAddWeight() {
    const kg = parseFloat(weightDraft.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
      Alert.alert('Enter a weight', 'Type your bodyweight in kg, e.g. 82.5');
      return;
    }
    try {
      await addBodyweight(kg);
      setWeightDraft('');
    } catch { Alert.alert('Weight not saved', 'Please retry saving your weight.'); }
  }

  function handleExportOlder() {
    const older = entries.filter((e) => e.weekKey < week);
    const olderBw = bodyweights.filter((b) => b.weekKey < week);
    Alert.alert(
      'Export & clear previous weeks?',
      `Export ${older.length + olderBw.length} item(s) from previous weeks to a CSV, then remove them to start fresh?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export & Clear',
          onPress: async () => {
            const ok = await exportWeek(older, olderBw, 'previous-weeks');
            if (ok) await clearWeeksBefore(week);
          },
        },
      ],
    );
  }

  function confirmDelete(id: string) {
    Alert.alert('Delete entry?', 'This removes the captured page from this week.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteEntry(id) },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <PageHeader title="Tracker" subtitle="Your training week, in one place." />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <ArtworkHero kind="tracker" label="TRAINING JOURNAL" title="Make it count." subtitle="Capture your reps. Keep your progress." compact inset={false} />

        {reviewMode && (
          <View style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>Review before export</Text>
            <Text style={styles.reviewBody}>
              Check each day's card below — tap to expand, Edit to fix any misread weights or reps.
              When it all looks right, hit Export at the bottom.
            </Text>
          </View>
        )}

        {!apiKey && (
          <TouchableOpacity style={styles.warnCard} onPress={() => router.push('/settings')} activeOpacity={0.8}>
            <Text style={styles.warnTitle}>Add your Anthropic API key</Text>
            <Text style={styles.warnBody}>
              Photo parsing uses the Claude API. Add your key in Settings → Tracker & API to enable capture.
            </Text>
          </TouchableOpacity>
        )}

        {olderCount > 0 && (
          <TouchableOpacity style={styles.rolloverCard} onPress={handleExportOlder} activeOpacity={0.85}>
            <Text style={styles.rolloverText}>
              {olderCount} entr{olderCount === 1 ? 'y' : 'ies'} from previous weeks
            </Text>
            <View style={styles.rolloverActionRow}>
              <Text style={styles.rolloverAction}>EXPORT & CLEAR</Text>
              <ChevronRightIcon size={13} color={theme.blue} strokeWidth={3} />
            </View>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>Bodyweight (Mondays)</Text>
        <View style={styles.card}>
          <View style={styles.bwInputRow}>
            <TextInput
              style={styles.bwInput}
              value={weightDraft}
              onChangeText={setWeightDraft}
              placeholder="e.g. 82.5"
              placeholderTextColor={theme.subtle}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={handleAddWeight}
            />
            <Text style={styles.bwUnit}>kg</Text>
            <TouchableOpacity style={styles.bwAddBtn} onPress={handleAddWeight} disabled={busy != null}>
              <Text style={styles.bwAddText}>Add</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.bwPhotoBtn}
            onPress={handleWeighPhoto}
            disabled={busy != null}
            activeOpacity={0.8}
          >
            {busy === 'weighing' ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={theme.green} />
                <Text style={styles.bwPhotoText}>Reading scale…</Text>
              </View>
            ) : (
              <View style={styles.busyRow}>
                <ActionGlyph kind="capture" size={26} />
                <Text style={styles.bwPhotoText}>Snap the scale instead</Text>
              </View>
            )}
          </TouchableOpacity>
          {weekBw.length === 0 ? (
            <Text style={styles.bwHint}>Log your post-gym weigh-in. It's included in the weekly CSV.</Text>
          ) : (
            weekBw.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={styles.bwRow}
                onLongPress={() =>
                  Alert.alert('Delete weigh-in?', `${b.kg} kg on ${b.date.slice(0, 10)}`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteBodyweight(b.id) },
                  ])
                }
              >
                <Text style={styles.bwDate}>{b.date.slice(0, 10)}</Text>
                <Text style={styles.bwKg}>{b.kg} kg</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <Text style={styles.sectionLabel}>This week · {week}</Text>

        {thisWeek.length === 0 && (
          <Text style={styles.empty}>No pages logged yet this week. Tap “Capture page” below.</Text>
        )}

        {thisWeek.map((entry) => {
          const expanded = expandedId === entry.id;
          const setCount = entry.exercises.reduce((n, e) => n + e.sets.length, 0);
          const sub = [entry.weekNumber ? `Week ${entry.weekNumber}` : null, entry.weekDate]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={entry.id} style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => setExpandedId(expanded ? null : entry.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{entry.title || 'Workout page'}</Text>
                  <Text style={styles.cardMeta}>
                    {entry.capturedAt.slice(0, 10)}{sub ? ` · ${sub}` : ''} · {entry.exercises.length} exercises · {setCount} sets
                  </Text>
                </View>
                {expanded ? (
                  <ChevronDownIcon size={16} color={theme.muted} />
                ) : (
                  <ChevronRightIcon size={16} color={theme.muted} />
                )}
              </TouchableOpacity>

              {expanded && (
                <View style={styles.cardBody}>
                  {editingId === entry.id ? (
                    <EntryEditor entry={entry} onClose={() => setEditingId(null)} />
                  ) : (
                    <>
                      {entry.exercises.map((ex, i) => (
                        <View key={i} style={styles.exRow}>
                          <Text style={styles.exName}>
                            {ex.name}
                            {ex.target ? <Text style={styles.exTarget}>  ({ex.target})</Text> : null}
                          </Text>
                          <Text style={styles.exSets}>{ex.sets.map(describeSet).join('   ')}</Text>
                        </View>
                      ))}
                      {entry.notes ? <Text style={styles.entryNotes}>Notes: {entry.notes}</Text> : null}
                      <Text style={styles.legend}>* reps inferred from target (bare weight written)</Text>
                      <View style={styles.entryActions}>
                        <TouchableOpacity
                          onPress={() => setEditingId(entry.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Edit entry"
                        >
                          <Text style={styles.editText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => confirmDelete(entry.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Delete entry"
                        >
                          <Text style={styles.deleteText}>Delete entry</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {(thisWeek.length > 0 || weekBw.length > 0 || sessions.some(s => weekKey(new Date(s.date)) === week && s.setRecords.length > 0)) && (
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => exportWeek(thisWeek, weekBw, week)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Export this week as CSV and JSON backup"
          >
            <View style={styles.busyRow}>
              <ActionGlyph kind="export" size={26} />
              <Text style={styles.exportText}>Export week (CSV + JSON)</Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.ctaContainer}>
        {reviewMode ? (
          <>
            <TouchableOpacity
              style={styles.captureAnotherBtn}
              onPress={handleCapture}
              disabled={busy != null}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Capture another page"
            >
              {busy === 'capturing' ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color={theme.muted} />
                  <Text style={styles.captureAnotherText}>Reading page…</Text>
                </View>
              ) : (
                <View style={styles.busyRow}>
                  <ActionGlyph kind="capture" size={26} />
                  <Text style={styles.captureAnotherText}>Capture another page</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.captureBtn, busy != null && styles.captureBtnBusy]}
              onPress={handleReviewExport}
              disabled={busy != null}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Export the week"
            >
              {busy === 'exporting' ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color="#000" />
                  <Text style={styles.captureText}>Exporting…</Text>
                </View>
              ) : (
                <View style={styles.busyRow}>
                  <ActionGlyph kind="export" size={26} onAccent />
                  <Text style={styles.captureText}>Looks good — Export week</Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.captureBtn, busy != null && styles.captureBtnBusy]}
            onPress={handleCapture}
            disabled={busy != null}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Capture tracker page"
          >
            {busy === 'capturing' ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color="#000" />
                <Text style={styles.captureText}>Reading page…</Text>
              </View>
            ) : (
              <View style={styles.busyRow}>
                <ActionGlyph kind="capture" size={26} onAccent />
                <Text style={styles.captureText}>Capture page</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.text },

  reviewCard: {
    backgroundColor: 'rgba(34,212,110,0.08)', borderWidth: 1, borderColor: 'rgba(34,212,110,0.35)',
    borderRadius: 18, padding: 16, marginTop: 12,
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: theme.green },
  reviewBody: { fontSize: 13, color: theme.muted, marginTop: 6, lineHeight: 19 },

  warnCard: {
    backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 18, padding: 16, marginTop: 12,
  },
  warnTitle: { fontSize: 14, fontWeight: '700', color: theme.amber },
  warnBody: { fontSize: 13, color: theme.muted, marginTop: 6, lineHeight: 19 },

  rolloverCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(59,130,246,0.10)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)',
    borderRadius: 18, padding: 16, marginTop: 12,
  },
  rolloverText: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.text },
  rolloverActionRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rolloverAction: { fontSize: 12, fontWeight: '800', color: theme.blue, letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: theme.muted, textTransform: 'uppercase',
    letterSpacing: 1.5, marginTop: 24, marginBottom: 8,
  },
  empty: { fontSize: 14, color: theme.muted, lineHeight: 22, paddingVertical: 8 },

  bwInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  bwInput: {
    flex: 1, height: 44, borderRadius: 8, paddingHorizontal: 12,
    backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontSize: 16, fontVariant: ['tabular-nums'],
  },
  bwUnit: { fontSize: 15, color: theme.muted, fontWeight: '600' },
  bwAddBtn: { height: 44, paddingHorizontal: 18, borderRadius: 8, backgroundColor: theme.green, alignItems: 'center', justifyContent: 'center' },
  bwAddText: { color: '#000', fontWeight: '800', fontSize: 14 },
  bwPhotoBtn: {
    marginHorizontal: 16, marginBottom: 4, height: 44, borderRadius: 8,
    borderWidth: 1.5, borderColor: 'rgba(34,212,110,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  bwPhotoText: { color: theme.green, fontWeight: '700', fontSize: 14 },
  bwHint: { fontSize: 12, color: theme.muted, paddingHorizontal: 16, paddingBottom: 14, lineHeight: 18 },
  bwRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.border,
  },
  bwDate: { fontSize: 13, color: theme.muted },
  bwKg: { fontSize: 15, color: theme.text, fontWeight: '700', fontVariant: ['tabular-nums'] },

  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: theme.text },
  cardMeta: { fontSize: 12, color: theme.muted, marginTop: 4 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 },
  exRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  exName: { fontSize: 14, fontWeight: '500', color: theme.text },
  exTarget: { fontSize: 12, color: theme.subtle, fontWeight: '400' },
  exSets: { fontSize: 13, color: theme.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  entryNotes: { fontSize: 12, color: theme.muted, marginTop: 10, lineHeight: 18, fontStyle: 'italic' },
  legend: { fontSize: 11, color: theme.subtle, marginTop: 8 },
  entryActions: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 14, paddingBottom: 4,
  },
  editText: { fontSize: 13, color: theme.green, fontWeight: '700' },
  deleteText: { fontSize: 13, color: theme.red, fontWeight: '600' },

  editExercise: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  editSetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  editSetLabel: { width: 26, fontSize: 12, fontWeight: '700', color: theme.muted },
  editInput: {
    width: 64, height: 40, borderRadius: 8, paddingHorizontal: 10, textAlign: 'center',
    backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontSize: 14, fontVariant: ['tabular-nums'],
  },
  editUnit: { fontSize: 13, color: theme.muted },
  editRaw: { flex: 1, fontSize: 11, color: theme.subtle, textAlign: 'right' },
  editNotes: {
    marginTop: 12, minHeight: 56, borderRadius: 8, padding: 10,
    backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontSize: 13, textAlignVertical: 'top',
  },
  editBtnRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  editSaveBtn: {
    flex: 1, height: 44, borderRadius: 8, backgroundColor: theme.green,
    alignItems: 'center', justifyContent: 'center',
  },
  editSaveText: { color: '#000', fontWeight: '800', fontSize: 14 },
  editCancelBtn: {
    flex: 1, height: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  editCancelText: { color: theme.muted, fontWeight: '600', fontSize: 14 },

  exportBtn: {
    marginTop: 16, height: 48, borderRadius: 18, borderWidth: 1.5, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  exportText: { fontSize: 15, fontWeight: '600', color: theme.muted },

  ctaContainer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 32, gap: 10 },
  captureAnotherBtn: {
    height: 44, borderRadius: 18, borderWidth: 1.5, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background,
  },
  captureAnotherText: { color: theme.muted, fontSize: 14, fontWeight: '600' },
  captureBtn: {
    height: 64, borderRadius: 16, backgroundColor: theme.green,
    alignItems: 'center', justifyContent: 'center',
  },
  captureBtnBusy: { opacity: 0.85 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captureText: { color: '#000', fontSize: 17, fontWeight: '800' },
});

