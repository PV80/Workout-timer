import { ActionGlyph } from '../src/components/ActionGlyph';
import { ArtworkHero } from '../src/components/ArtworkHero';
import { theme } from '../src/theme';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraIcon, CheckIcon, DownloadIcon } from '../src/components/icons';
import { EntranceView, MotionPressable } from '../src/components/Motion';
import { useHistoryStore } from '../src/store/historyStore';
import { useTrackerStore, currentWeekKey } from '../src/store/trackerStore';
import { exportCurrentWeek } from '../src/utils/exportWeek';
import { formatHoursMinutes } from '../src/utils/time';
import { runBodyweightCapture, runTrackerCapture } from '../src/utils/trackerCapture';
import { handleBodyweightResult, handleCaptureResult, promptCaptureSource } from './tracker';

export default function CompleteScreen() {
  const { height } = useWindowDimensions();
  const isCompact = height < 520;
  const sessions = useHistoryStore((s) => s.sessions);
  const latest = sessions[0] ?? null;
  const addBodyweight = useTrackerStore((s) => s.addBodyweight);
  const lastExportWeekKey = useTrackerStore((s) => s.lastExportWeekKey);
  const [capturing, setCapturing] = useState(false);
  const [weighing, setWeighing] = useState(false);
  const [weightDraft, setWeightDraft] = useState('');
  const [weightSaved, setWeightSaved] = useState(false);
  const [exported, setExported] = useState(false);
  const isMonday = latest?.day === 'monday';
  // Friday is the last training day of the week — logging the page routes to
  // the Tracker in review mode so misreads can be amended BEFORE the export.
  const week = currentWeekKey();
  const isFriday = latest?.day === 'friday';
  const weekExported = exported || lastExportWeekKey === week;

  async function exportThisWeek() {
    // Read fresh state inside the util — never from this render's props.
    try {
    const result = await exportCurrentWeek();
    if (result === 'nothing') {
      Alert.alert(
        'Nothing to export yet',
        'Complete a workout, log a tracker page or add a weigh-in first.',
      );
      return;
    }
    if (typeof result === 'object') {
      Alert.alert('Sharing unavailable', `Files written to:\n${result.savedTo}`);
    }
    if (result === 'shared') setExported(true);
    } catch (error: any) {
      Alert.alert('Export failed', error?.message ?? 'Your records are still saved. Please retry.');
    }
  }

  function capturePage() {
    promptCaptureSource(async (source) => {
      setCapturing(true);
      try {
        const result = await runTrackerCapture(source);
        const saved = handleCaptureResult(result);
        if (saved) {
          // Friday: land in review mode — check/amend the week's entries,
          // then the export runs from there (with the weigh-in prompt).
          router.replace(isFriday ? '/tracker?review=week' : '/tracker');
        }
      } finally {
        setCapturing(false);
      }
    });
  }

  async function saveWeight() {
    const kg = parseFloat(weightDraft.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
      Alert.alert('Enter a weight', 'Type your bodyweight in kg, e.g. 82.5');
      return;
    }
    try {
      await addBodyweight(kg);
      setWeightSaved(true);
      setWeightDraft('');
    } catch { Alert.alert('Weight not saved', 'Please retry saving your weight.'); }
  }

  function weighByPhoto() {
    promptCaptureSource(
      async (source) => {
        setWeighing(true);
        try {
          if (handleBodyweightResult(await runBodyweightCapture(source))) {
            setWeightSaved(true);
            setWeightDraft('');
          }
        } finally {
          setWeighing(false);
        }
      },
      { title: 'Log bodyweight', message: 'Photograph your scale now, or pick a photo you already took.' },
    );
  }

  if (!latest) {
    return (
      <SafeAreaView style={styles.screen}>
        <MotionPressable style={styles.doneBtn} onPress={() => router.replace('/')}>
          <Text style={styles.doneBtnText}>DONE</Text>
        </MotionPressable>
      </SafeAreaView>
    );
  }

  const totalSets = latest.setRecords.length;
  const totalDuration = latest.totalDuration;

  const byExercise: Record<string, { name: string; count: number }> = {};
  for (const r of latest.setRecords) {
    if (!byExercise[r.exerciseId]) byExercise[r.exerciseId] = { name: r.exerciseName, count: 0 };
    byExercise[r.exerciseId].count++;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: isCompact ? 130 : 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <EntranceView style={[styles.hero, isCompact && styles.heroCompact]}>
          <Text style={styles.savedLabel}>SESSION SAVED</Text>
          <EntranceView delay={80} style={[styles.checkCircle, isCompact && styles.checkCircleCompact]}>
            <CheckIcon size={isCompact ? 26 : 38} color="#000" strokeWidth={3} />
          </EntranceView>
          <Text style={[styles.title, isCompact && styles.titleCompact]}>WORKOUT COMPLETE</Text>
          <Text style={[styles.duration, isCompact && styles.durationCompact]}>
            {formatHoursMinutes(totalDuration)}
          </Text>
          <Text style={styles.durationLabel}>total time</Text>
        </EntranceView>

        <ArtworkHero kind="complete" label="SESSION SAVED" title="Well earned." subtitle="Today's effort is in your history." compact inset={true} />

        <View style={styles.statsCard}>
          <View>
            <Text style={styles.statLabel}>Exercises</Text>
            <Text style={styles.statValue}>{latest.exercisesCompleted}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.statLabel}>Sets Done</Text>
            <Text style={styles.statValue}>{totalSets}</Text>
          </View>
        </View>

        <View style={styles.breakdown}>
          <Text style={styles.breakdownTitle}>Session Breakdown</Text>
          {Object.values(byExercise).map((ex) => (
            <View key={ex.name} style={styles.breakdownRow}>
              <Text style={styles.breakdownName}>{ex.name}</Text>
              <Text style={styles.breakdownSets}>{ex.count} sets</Text>
            </View>
          ))}
        </View>

        {isFriday && (
          <View style={styles.bwCard}>
            <Text style={styles.bwTitle}>Week wrap-up</Text>
            {weekExported ? (
              <View style={styles.bwSavedRow}>
                <CheckIcon size={16} color={theme.green} strokeWidth={3} />
                <Text style={styles.bwSaved}>Week exported — enjoy the weekend.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.exportHint}>
                  Friday's the last session of the week — logging the tracker page below takes you
                  to review the week's entries, then export. Or export directly:
                </Text>
                <MotionPressable
                  style={styles.exportWeekBtn}
                  onPress={exportThisWeek}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Export this week"
                >
                  <View style={styles.busyRow}>
                    <ActionGlyph kind="export" size={26} />
                    <Text style={styles.exportWeekText}>Export week (CSV + JSON)</Text>
                  </View>
                </MotionPressable>
              </>
            )}
          </View>
        )}

        {isMonday && (
          <View style={styles.bwCard}>
            <Text style={styles.bwTitle}>Monday weigh-in</Text>
            {weightSaved ? (
              <View style={styles.bwSavedRow}>
                <CheckIcon size={16} color={theme.green} strokeWidth={3} />
                <Text style={styles.bwSaved}>Bodyweight saved — it'll be in this week's CSV.</Text>
              </View>
            ) : (
              <>
                <View style={styles.bwRow}>
                  <TextInput
                    style={styles.bwInput}
                    value={weightDraft}
                    onChangeText={setWeightDraft}
                    placeholder="e.g. 82.5"
                    placeholderTextColor={theme.subtle}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    onSubmitEditing={saveWeight}
                  />
                  <Text style={styles.bwUnit}>kg</Text>
                  <MotionPressable style={styles.bwAddBtn} onPress={saveWeight} disabled={weighing}>
                    <Text style={styles.bwAddText}>Save</Text>
                  </MotionPressable>
                </View>
                <MotionPressable
                  style={styles.bwPhotoBtn}
                  onPress={() => weighByPhoto()}
                  disabled={weighing}
                  activeOpacity={0.8}
                >
                  {weighing ? (
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
                </MotionPressable>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.ctaContainer}>
        <MotionPressable
          style={[styles.doneBtn, capturing && styles.btnBusy]}
          onPress={capturePage}
          disabled={capturing}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Log tracker page"
        >
          {capturing ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#000" />
              <Text style={styles.doneBtnText}>Reading page…</Text>
            </View>
          ) : (
            <View style={styles.busyRow}>
              <ActionGlyph kind="capture" size={26} onAccent />
              <Text style={styles.doneBtnText}>Log tracker page</Text>
            </View>
          )}
        </MotionPressable>
        <MotionPressable
          style={styles.secondaryBtn}
          onPress={() => router.replace('/')}
          activeOpacity={0.7}
          disabled={capturing}
        >
          <Text style={styles.secondaryText}>Skip — back to home</Text>
        </MotionPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },

  hero: { paddingTop: 36, paddingHorizontal: 24, alignItems: 'center' },
  savedLabel: { color: theme.muted, fontSize: 10, letterSpacing: 2.5, fontWeight: '700', marginBottom: 18 },
  heroCompact: { paddingTop: 20 },
  checkCircle: {
    width: 80, height: 80, borderRadius: 28, backgroundColor: theme.green,
    alignItems: 'center', justifyContent: 'center',
  },
  checkCircleCompact: { width: 56, height: 56, borderRadius: 28 },
  title: { fontSize: 25, fontWeight: '900', color: theme.text, letterSpacing: -0.5, textAlign: 'center', marginTop: 24 },
  titleCompact: { fontSize: 20, marginTop: 12 },
  duration: { fontSize: 56, fontWeight: '900', color: theme.green, textAlign: 'center', marginTop: 8, lineHeight: 64 },
  durationCompact: { fontSize: 40, lineHeight: 46 },
  durationLabel: { fontSize: 13, color: theme.muted, textAlign: 'center', marginTop: 6 },

  statsCard: {
    marginHorizontal: 20, marginTop: 32,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18,
    padding: 20, flexDirection: 'row', justifyContent: 'space-between',
  },
  statLabel: { fontSize: 10, fontWeight: '600', color: theme.muted, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 28, fontWeight: '800', color: theme.text, marginTop: 4 },

  breakdown: { marginHorizontal: 20, marginTop: 16 },
  breakdownTitle: { fontSize: 11, fontWeight: '600', color: theme.muted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  breakdownName: { fontSize: 14, fontWeight: '500', color: theme.text },
  breakdownSets: { fontSize: 13, color: theme.muted },

  bwCard: {
    marginHorizontal: 20, marginTop: 24,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18, padding: 16,
  },
  bwTitle: { fontSize: 11, fontWeight: '600', color: theme.muted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  bwRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bwInput: {
    flex: 1, height: 44, borderRadius: 8, paddingHorizontal: 12,
    backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontSize: 16, fontVariant: ['tabular-nums'],
  },
  bwUnit: { fontSize: 15, color: theme.muted, fontWeight: '600' },
  bwAddBtn: { height: 44, paddingHorizontal: 18, borderRadius: 8, backgroundColor: theme.green, alignItems: 'center', justifyContent: 'center' },
  bwAddText: { color: '#000', fontWeight: '800', fontSize: 14 },
  bwPhotoBtn: {
    marginTop: 10, height: 44, borderRadius: 8,
    borderWidth: 1.5, borderColor: 'rgba(34,212,110,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  bwPhotoText: { color: theme.green, fontWeight: '700', fontSize: 14 },
  bwSavedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bwSaved: { flex: 1, fontSize: 14, color: theme.green, fontWeight: '600' },
  exportHint: { fontSize: 13, color: theme.muted, lineHeight: 19, marginBottom: 12 },
  exportWeekBtn: {
    height: 44, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(34,212,110,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  exportWeekText: { color: theme.green, fontWeight: '700', fontSize: 14 },

  ctaContainer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 8, backgroundColor: theme.background, borderTopWidth: 1, borderTopColor: theme.border,
  },
  doneBtn: {
    height: 64, borderRadius: 16, backgroundColor: theme.green,
    alignItems: 'center', justifyContent: 'center',
  },
  doneBtnText: { color: '#000', fontSize: 17, fontWeight: '800' },
  btnBusy: { opacity: 0.85 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  secondaryBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },

  secondaryText: { color: theme.muted, fontSize: 15, fontWeight: '600' },
});
