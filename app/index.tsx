import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import React, { useEffect } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  GearIcon,
  MoonIcon,
  PlayIcon,
} from '../src/components/icons';
import { useHistoryStore } from '../src/store/historyStore';
import { flushWorkout, useWorkoutStore } from '../src/store/workoutStore';
import { getTodayWorkout, getNextWorkout, WORKOUTS } from '../src/data/workouts';
import { canUseExactAlarms, openAlarmSettings } from '../src/utils/notificationService';
import { getAdaptedTiming, estimateTotalDuration } from '../src/utils/timing';
import { Exercise, WorkoutDay } from '../src/types';

// Once per app launch: if Android's "Alarms & reminders" permission is off,
// the background set/break alerts silently never fire — tell the user where
// the switch lives. Asked at workout start, when it's about to matter.
let alarmPromptShown = false;
async function maybePromptAlarmPermission() {
  if (alarmPromptShown) return;
  if (await canUseExactAlarms()) return;
  alarmPromptShown = true;
  Alert.alert(
    'Enable background alerts',
    'Android is blocking exact timers for this app, so the set/break alerts won\'t sound while the phone is locked or you\'re in another app.\n\nTurn on "Alarms & reminders" for Workout Timer to fix it.',
    [
      { text: 'Open settings', onPress: () => openAlarmSettings() },
      { text: 'Not now', style: 'cancel' },
    ],
  );
}

function HeaderIconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </TouchableOpacity>
  );
}

function ExerciseRow({ ex, onPress }: { ex: Exercise; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.exerciseRow} onPress={onPress} activeOpacity={0.6}>
      {ex.type === 'TIER1' && (
        <View style={styles.t1Badge}>
          <Text style={styles.t1Text}>T1</Text>
        </View>
      )}
      {ex.type === 'AMRAP' && (
        <View style={styles.amrapBadge}>
          <Text style={styles.amrapText}>∞</Text>
        </View>
      )}
      {ex.type !== 'TIER1' && ex.type !== 'AMRAP' && (
        <View style={styles.stdDot} />
      )}
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{ex.name}</Text>
        <Text style={styles.exerciseReps}>{ex.sets} × {ex.reps}</Text>
      </View>
      <ChevronRightIcon size={16} color="#3A3A3A" />
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { height } = useWindowDimensions();
  // Split-screen / short windows: keep only the start button pinned and let
  // everything else scroll so nothing is cut off.
  const isCompact = height < 520;

  const settings = useHistoryStore((s) => s.settings);
  const timingRecords = useHistoryStore((s) => s.timingRecords);
  const startWorkout = useWorkoutStore((s) => s.startWorkout);
  const startSet = useWorkoutStore((s) => s.startSet);
  const abandonWorkout = useWorkoutStore((s) => s.abandonWorkout);
  const activeWorkout = useWorkoutStore((s) => s.activeWorkout);
  const hasActive = !!activeWorkout;
  const recovered = useWorkoutStore((s) => s.recovered);
  const recoveredCompletion = useWorkoutStore((s) => s.recoveredCompletion);

  useEffect(() => {
    if (!recovered && !recoveredCompletion) return;
    useWorkoutStore.setState({ recovered: false, recoveredCompletion: false });
    router.replace(recoveredCompletion ? '/complete' : '/workout');
  }, [recovered, recoveredCompletion]);

  const today = getTodayWorkout();
  const nextWorkout = getNextWorkout();

  async function beginWorkout(workout: WorkoutDay, startIndex: number) {
    const sessionId = Crypto.randomUUID();
    startWorkout(workout, sessionId, startIndex);
    // The store resolves the actual starting index (skipping any cardio);
    // read it back so the first set's timing matches the exercise we land on.
    const resolvedIdx = useWorkoutStore.getState().currentExerciseIndex;
    const firstEx = workout.exercises[resolvedIdx];
    if (firstEx) {
      const timing = getAdaptedTiming(firstEx.id, firstEx.type, timingRecords, settings);
      startSet(timing.setDuration);
    }
    try {
      await flushWorkout();
    } catch {
      Alert.alert('Progress could not be saved', 'Keep the app open. You can retry saving on the workout screen.');
    }
    router.push('/workout');
    maybePromptAlarmPermission();
  }

  function handleStartWorkout(workout: WorkoutDay | null = today, startIndex = 0) {
    if (!workout) return;
    // A workout is already running (you backed out without finishing it).
    // Default to resuming the existing one rather than clobbering it.
    if (hasActive) {
      Alert.alert(
        'Workout in progress',
        'You already have a workout running. Resume it, or discard it and start this one?',
        [
          { text: 'Resume', onPress: () => router.push('/workout') },
          {
            text: 'Discard & Start',
            style: 'destructive',
            onPress: () => {
              abandonWorkout();
              beginWorkout(workout, startIndex);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    beginWorkout(workout, startIndex);
  }

  function Header() {
    return (
      <View style={styles.header}>
        <Text style={styles.appTitle}>WORKOUT TIMER</Text>
        <View style={styles.headerIcons}>
          <HeaderIconButton label="Tracker" onPress={() => router.push('/tracker')}>
            <ClipboardIcon size={21} color="#888" />
          </HeaderIconButton>
          <HeaderIconButton label="History" onPress={() => router.push('/history')}>
            <ClockIcon size={21} color="#888" />
          </HeaderIconButton>
          <HeaderIconButton label="Settings" onPress={() => router.push('/settings')}>
            <GearIcon size={21} color="#888" />
          </HeaderIconButton>
        </View>
      </View>
    );
  }

  function ResumeBanner() {
    if (!hasActive) return null;
    return (
      <TouchableOpacity style={styles.resumeBanner} onPress={() => router.push('/workout')} activeOpacity={0.85}>
        <View style={styles.resumeDot} />
        <Text style={styles.resumeText}>Workout in progress — {activeWorkout?.name}</Text>
        <View style={styles.resumeAction}>
          <Text style={styles.resumeActionText}>RESUME</Text>
          <ChevronRightIcon size={13} color="#22D46E" strokeWidth={3} />
        </View>
      </TouchableOpacity>
    );
  }

  function DayPicker({ label }: { label: string }) {
    const days: Array<{ key: keyof typeof WORKOUTS; tag: string }> = [
      { key: 'monday', tag: 'MON' },
      { key: 'tuesday', tag: 'TUE' },
      { key: 'thursday', tag: 'THU' },
      { key: 'friday', tag: 'FRI' },
    ];
    return (
      <View style={styles.pickerWrap}>
        <Text style={styles.pickerLabel}>{label}</Text>
        <View style={styles.pickerRow}>
          {days.map((d) => (
            <TouchableOpacity
              key={d.key}
              style={[styles.pickerChip, today?.day === d.key && styles.pickerChipActive]}
              onPress={() => handleStartWorkout(WORKOUTS[d.key])}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Start ${d.key} workout`}
            >
              <Text style={styles.pickerChipText}>{d.tag}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (!today) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header />
        <ResumeBanner />

        <ScrollView contentContainerStyle={styles.restScroll}>
          <View style={styles.restDayCenter}>
            <MoonIcon size={56} color="#555" strokeWidth={1.5} />
            <Text style={styles.restTitle}>REST DAY</Text>
            <Text style={styles.restSubtitle}>No 4AM alarm. Sleep in. Your muscles grow during rest.</Text>
            <View style={styles.divider} />
            <Text style={styles.nextLabel}>Next Up</Text>
            {nextWorkout && (
              <Text style={styles.nextWorkout}>
                {nextWorkout.name} — {nextWorkout.muscleGroups}
              </Text>
            )}
            <DayPicker label="Or start any workout" />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const estSeconds = estimateTotalDuration(today, timingRecords, settings);
  const estMinutes = Math.round(estSeconds / 60);

  const startLabel = hasActive ? 'RESUME WORKOUT' : 'START WORKOUT';
  const startAction = hasActive ? () => router.push('/workout') : () => handleStartWorkout();

  return (
    <SafeAreaView style={styles.screen}>
      <Header />
      <ResumeBanner />

      <ScrollView contentContainerStyle={{ paddingBottom: isCompact ? 100 : 200 }}>
        <View style={styles.dayBlock}>
          <Text style={[styles.dayName, isCompact && styles.dayNameCompact]}>{today.name}</Text>
          <Text style={styles.muscleGroups}>{today.muscleGroups}</Text>
        </View>

        <View style={styles.statsCard}>
          <View>
            <Text style={styles.statLabel}>Exercises</Text>
            <Text style={styles.statValue}>{today.exercises.length}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.statLabel}>Est. Time</Text>
            <Text style={styles.statValue}>~{estMinutes} min</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Today's Programme</Text>
        <Text style={styles.tapHint}>Tap an exercise to start from there</Text>

        {today.exercises.map((ex, i) => (
          <ExerciseRow key={ex.id} ex={ex} onPress={() => handleStartWorkout(today, i)} />
        ))}

        {isCompact && <DayPicker label="Switch workout" />}
      </ScrollView>

      <View style={styles.ctaContainer}>
        {!isCompact && <DayPicker label="Switch workout" />}
        <TouchableOpacity
          style={[styles.startBtn, isCompact && styles.startBtnCompact]}
          onPress={startAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={startLabel}
        >
          <View style={styles.startBtnRow}>
            <PlayIcon size={16} color="#000" />
            <Text style={styles.startBtnText}>{startLabel}</Text>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  appTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase', color: '#888' },
  headerIcons: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  dayBlock: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  dayName: { fontSize: 40, fontWeight: '900', color: '#22D46E', letterSpacing: -1 },
  dayNameCompact: { fontSize: 28 },
  muscleGroups: { fontSize: 15, color: '#888', marginTop: 4 },

  statsCard: {
    marginHorizontal: 24, marginBottom: 24,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 12,
    padding: 16, flexDirection: 'row', justifyContent: 'space-between',
  },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 28, fontWeight: '800', color: '#F0F0F0', marginTop: 4 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase',
    letterSpacing: 1.5, paddingHorizontal: 24, marginBottom: 4,
  },
  tapHint: {
    fontSize: 12, color: '#555', paddingHorizontal: 24, marginBottom: 8,
  },
  resumeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    backgroundColor: 'rgba(34,212,110,0.10)', borderWidth: 1, borderColor: 'rgba(34,212,110,0.35)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  resumeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22D46E' },
  resumeText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#F0F0F0' },
  resumeAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  resumeActionText: { fontSize: 12, fontWeight: '800', color: '#22D46E', letterSpacing: 0.5 },
  exerciseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 24, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  t1Badge: { backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  t1Text: { color: '#F59E0B', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  amrapBadge: { backgroundColor: 'rgba(59,130,246,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  amrapText: { color: '#3B82F6', fontSize: 10, fontWeight: '800' },
  stdDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#262626', marginHorizontal: 6 },
  exerciseInfo: { flex: 1 },
  exerciseName: { fontSize: 15, fontWeight: '500', color: '#F0F0F0' },
  exerciseReps: { fontSize: 12, color: '#888', marginTop: 2 },

  ctaContainer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 16, paddingBottom: 32,
    backgroundColor: 'transparent',
  },
  startBtn: {
    height: 64, borderRadius: 16, backgroundColor: '#22D46E',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#22D46E', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  startBtnCompact: { height: 52 },
  startBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  startBtnText: { color: '#000', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },

  restScroll: { flexGrow: 1, justifyContent: 'center' },
  restDayCenter: {
    alignItems: 'center', paddingHorizontal: 24, paddingVertical: 32,
  },
  pickerWrap: { alignItems: 'center', marginTop: 16 },
  pickerLabel: { fontSize: 10, fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', gap: 8 },
  pickerChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1C1C1C', borderWidth: 1, borderColor: '#2A2A2A',
  },
  pickerChipActive: { borderColor: '#22D46E' },
  pickerChipText: { color: '#F0F0F0', fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  restTitle: { fontSize: 36, fontWeight: '900', color: '#888', letterSpacing: -1, marginTop: 24 },
  restSubtitle: { fontSize: 15, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 22, maxWidth: 260 },
  divider: { width: 80, height: 1, backgroundColor: '#1C1C1C', marginVertical: 32 },
  nextLabel: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 1.5 },
  nextWorkout: { fontSize: 16, fontWeight: '600', color: '#F0F0F0', marginTop: 6, textAlign: 'center' },
});
