import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircularTimer } from '../../src/components/CircularTimer';
import { SetDots } from '../../src/components/SetDots';
import {
  AlertTriangleIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from '../../src/components/icons';
import { useHistoryStore } from '../../src/store/historyStore';
import { useWorkoutStore, getNextExercise } from '../../src/store/workoutStore';
import { useTimer } from '../../src/hooks/useTimer';
import { useWorkoutDuration } from '../../src/hooks/useWorkoutDuration';
import { estimateLiveTotalDuration } from '../../src/utils/timing';
import { formatTime, formatElapsed } from '../../src/utils/time';
import { stopAlert } from '../../src/utils/alertService';
import {
  completeCurrentSet,
  continueToNextExercise,
  skipBreak,
  startNextSet,
} from '../../src/utils/workoutActions';

/** Primary/secondary CTA with icon, press haptic, and a compact variant. */
function CtaButton({
  label,
  icon,
  onPress,
  background,
  textColor,
  secondary = false,
  compact = false,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  background?: string;
  textColor?: string;
  secondary?: boolean;
  compact?: boolean;
}) {
  const handlePress = () => {
    // Physical confirmation the tap registered — screens get sweaty mid-workout.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };
  const base: ViewStyle[] = secondary
    ? [styles.secondaryBtn, { height: compact ? 40 : 48 }]
    : [styles.primaryBtn, { height: compact ? 52 : 64, backgroundColor: background }];
  return (
    <TouchableOpacity
      style={base}
      onPress={handlePress}
      activeOpacity={secondary ? 0.7 : 0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.btnRow}>
        {icon}
        <Text
          style={[
            secondary ? styles.secondaryBtnText : styles.primaryBtnText,
            !secondary && { color: textColor },
            compact && { fontSize: secondary ? 13 : 15 },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function WorkoutScreen() {
  useKeepAwake();

  const { width, height } = useWindowDimensions();
  // Split-screen / small windows: switch to a side-by-side layout so the
  // timer AND the action buttons stay visible without scrolling.
  const isCompact = height < 520;
  const ringSize = isCompact
    ? Math.max(120, Math.min(210, height - 150, width * 0.45))
    : Math.max(160, Math.min(300, width - 96, height - 430));

  const store = useWorkoutStore();
  const settings = useHistoryStore((s) => s.settings);
  const timingRecords = useHistoryStore((s) => s.timingRecords);

  const {
    activeWorkout,
    sessionStartedAt,
    currentExerciseIndex,
    currentSetNumber,
    currentPhase,
    phaseStartedAt,
    targetDuration,
    pausedAt,
    warningDismissed,
  } = store;

  const { elapsed, remaining, isOvertime } = useTimer(
    currentPhase as any,
    targetDuration,
    phaseStartedAt,
    pausedAt,
  );

  const duration = useWorkoutDuration(
    sessionStartedAt,
    settings.targetWorkoutMinutes,
    settings.warningWorkoutMinutes,
    warningDismissed,
  );

  const exercise = activeWorkout?.exercises[currentExerciseIndex] ?? null;
  const isPaused = pausedAt != null;
  const isBreak = currentPhase === 'break';
  const isTransition = currentPhase === 'transition';
  const isAmrap = currentPhase === 'amrap';
  const isCountdown = isBreak || isTransition; // counts DOWN

  const progress = (() => {
    if (!targetDuration || isAmrap) return 0;
    if (isCountdown) return Math.max(0, remaining / targetDuration);
    return Math.min(1, elapsed / targetDuration);
  })();

  // Phase logic lives in workoutActions (shared with the notification action
  // buttons); the screen just invokes it. Navigation to /complete on finish
  // happens inside the actions.
  const handleCompleteSet = useCallback(() => {
    completeCurrentSet();
  }, []);

  const handleStartNextSet = useCallback(() => {
    startNextSet();
  }, []);

  const handleSkipBreak = useCallback(() => {
    skipBreak();
  }, []);

  const handleContinueToNext = useCallback((record: boolean) => {
    continueToNextExercise(record);
  }, []);

  const handleTogglePause = useCallback(() => {
    if (isPaused) store.resume();
    else store.pause();
  }, [isPaused]);

  const handleAbandon = useCallback(() => {
    Alert.alert('Abandon Workout?', 'Your progress will not be saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Abandon',
        style: 'destructive',
        onPress: () => {
          stopAlert();
          store.abandonWorkout();
          router.replace('/');
        },
      },
    ]);
  }, []);

  const elapsedColor = (() => {
    if (duration.elapsedSeconds >= settings.warningWorkoutMinutes * 60) return '#EF4444';
    if (duration.elapsedSeconds >= settings.targetWorkoutMinutes * 60) return '#F59E0B';
    return '#F0F0F0';
  })();

  if (!exercise || !activeWorkout) return null;

  const nextEx = getNextExercise();

  const timerLabel = (() => {
    if (isCountdown && isOvertime) return `+${formatTime(-remaining)}`;
    if (isCountdown) return formatTime(remaining);
    if (isAmrap) return elapsed < 1 ? 'GO' : formatTime(elapsed);
    return formatTime(elapsed);
  })();

  const subLabel = (() => {
    if (isPaused) return 'Paused';
    if (isCountdown && isOvertime) return 'Overtime';
    if (isTransition) return 'Setup';
    if (isBreak) return 'Remaining';
    if (isAmrap) return 'to failure';
    return 'Elapsed';
  })();

  const timerColor = (() => {
    if (isCountdown && isOvertime) return '#EF4444';
    if (isAmrap) return '#22D46E';
    return '#F0F0F0';
  })();

  const progressBarWidth = `${(duration.progressToTarget * 100).toFixed(0)}%`;

  // Live projected finish, reacting to the session's pace. Recomputes each
  // render (the duration hook ticks ~1/s), so it tightens as sets complete.
  const liveEstimate = estimateLiveTotalDuration({
    workout: activeWorkout,
    setRecords: store.setRecords,
    currentExerciseIndex,
    currentSetNumber,
    currentPhase: currentPhase as any,
    currentPhaseElapsed: elapsed,
    currentTargetDuration: targetDuration,
    elapsedSeconds: duration.elapsedSeconds,
    allRecords: timingRecords,
    settings,
  });
  const etaColor = (() => {
    if (!liveEstimate) return '#888';
    if (liveEstimate.totalSeconds >= settings.warningWorkoutMinutes * 60) return '#EF4444';
    if (liveEstimate.totalSeconds >= settings.targetWorkoutMinutes * 60) return '#F59E0B';
    return '#22D46E';
  })();
  const etaText = (() => {
    if (!liveEstimate) return '';
    const totalMin = Math.round(liveEstimate.totalSeconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  const setProgressLabel = (() => {
    const repsLabel = exercise.type === 'AMRAP' ? 'to failure' : exercise.reps;
    return `SET ${currentSetNumber} OF ${exercise.sets}  ·  ${repsLabel}`;
  })();

  const midLabel = (() => {
    if (isTransition) return nextEx ? `NEXT  ·  ${nextEx.name}` : 'SETUP';
    if (isBreak) return `BREAK  ·  SET ${currentSetNumber + 1} NEXT`;
    return setProgressLabel;
  })();

  // Scale the big timer digits with the ring so they never clip the center.
  const timerFontSize = Math.max(26, Math.min(52, ringSize * 0.19));

  const ringBlock = (
    <View style={styles.ringBlock}>
      <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
        <CircularTimer
          phase={currentPhase as any}
          isOvertime={isOvertime}
          progress={progress}
          size={ringSize}
        />
        <View style={styles.timerCenter}>
          <Text
            style={[styles.timerText, { fontSize: timerFontSize, lineHeight: timerFontSize + 8, color: isPaused ? '#888' : timerColor }]}
          >
            {timerLabel}
          </Text>
          <Text style={[styles.timerSubLabel, isCountdown && isOvertime ? { color: '#EF4444' } : {}]}>
            {subLabel}
          </Text>
        </View>
      </View>
      <SetDots
        totalSets={exercise.sets}
        currentSet={currentSetNumber}
        completedSets={currentSetNumber - 1}
      />
      {targetDuration && !isAmrap ? (
        <Text style={styles.targetDuration}>
          target: <Text style={{ color: '#F0F0F0' }}>{formatTime(targetDuration)}</Text>
        </Text>
      ) : null}
      {isAmrap && !isCompact ? (
        <Text style={styles.amrapHint}>go until failure · tap done when finished</Text>
      ) : null}
    </View>
  );

  const ctas = isTransition ? (
    <>
      <CtaButton
        label="START NEXT EXERCISE"
        icon={<PlayIcon size={16} color="#000" />}
        background="#F59E0B"
        textColor="#000"
        onPress={() => handleContinueToNext(true)}
        compact={isCompact}
      />
      <CtaButton label="SKIP SETUP" secondary onPress={() => handleContinueToNext(false)} compact={isCompact} />
    </>
  ) : isBreak ? (
    <>
      <CtaButton
        label="START NEXT SET"
        icon={<PlayIcon size={16} color="#fff" />}
        background="#3B82F6"
        textColor="#fff"
        onPress={handleStartNextSet}
        compact={isCompact}
      />
      <CtaButton label="SKIP BREAK" secondary onPress={handleSkipBreak} compact={isCompact} />
    </>
  ) : (
    <CtaButton
      label="DONE"
      icon={<CheckIcon size={18} color="#000" strokeWidth={3} />}
      background="#22D46E"
      textColor="#000"
      onPress={handleCompleteSet}
      compact={isCompact}
    />
  );

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleAbandon}
          accessibilityRole="button"
          accessibilityLabel="Abandon workout"
        >
          <XIcon size={20} color="#888" />
        </TouchableOpacity>
        <View style={styles.clockBlock}>
          <Text style={[styles.elapsed, { color: elapsedColor }]}>
            {formatElapsed(duration.elapsedSeconds)}
          </Text>
          {liveEstimate ? (
            <Text style={[styles.eta, { color: etaColor }]} numberOfLines={1}>
              ≈ {etaText} total
            </Text>
          ) : (
            <Text style={styles.etaLabel}>elapsed</Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleTogglePause}
          accessibilityRole="button"
          accessibilityLabel={isPaused ? 'Resume timer' : 'Pause timer'}
        >
          {isPaused ? <PlayIcon size={18} color="#22D46E" /> : <PauseIcon size={18} color="#888" />}
        </TouchableOpacity>
        <View style={styles.progressArea}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressBarWidth as any }]} />
          </View>
          <Text style={styles.targetLabel}>target {settings.targetWorkoutMinutes}m</Text>
        </View>
      </View>

      {/* Exercise info */}
      <View style={[styles.exerciseBlock, isCompact && styles.exerciseBlockCompact]}>
        <View style={styles.exerciseTitleRow}>
          <Text
            style={[styles.exerciseName, isCompact && styles.exerciseNameCompact]}
            numberOfLines={isCompact ? 1 : 2}
          >
            {exercise.name}
          </Text>
          {exercise.type === 'TIER1' && (
            <View style={styles.t1Badge}><Text style={styles.t1Text}>T1</Text></View>
          )}
          {exercise.type === 'AMRAP' && (
            <View style={styles.amrapBadge}><Text style={styles.amrapText}>AMRAP</Text></View>
          )}
        </View>
        <Text style={[
          styles.setProgress,
          isCompact && styles.setProgressCompact,
          isBreak ? styles.setProgressBreak : {},
          isTransition ? styles.setProgressTransition : {},
        ]}>
          {midLabel}
        </Text>
      </View>

      {isCompact ? (
        /* Split-screen layout: ring on the left, actions on the right. */
        <View style={styles.compactRow}>
          {ringBlock}
          <View style={styles.compactCtas}>{ctas}</View>
        </View>
      ) : (
        <>
          <View style={styles.timerContainer}>{ringBlock}</View>
          <View style={{ flex: 1 }} />
          <View style={styles.ctaBlock}>{ctas}</View>
        </>
      )}

      {/* 2-hour warning overlay */}
      {duration.shouldShowWarning && !warningDismissed && (
        <View style={styles.warningOverlay}>
          <View style={styles.warningCard}>
            <AlertTriangleIcon size={36} color="#EF4444" />
            <Text style={styles.warningTitle}>2 Hours In</Text>
            <Text style={styles.warningBody}>
              You've been training for over 2 hours. Consider wrapping up or finishing your last exercise.
            </Text>
            <TouchableOpacity
              style={styles.warningBtn}
              onPress={() => store.dismissWarning()}
              activeOpacity={0.85}
            >
              <Text style={styles.warningBtnText}>GOT IT, KEEP GOING</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clockBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  elapsed: { textAlign: 'center', fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eta: { marginTop: 1, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  etaLabel: { marginTop: 1, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  progressArea: { alignItems: 'flex-end', gap: 4, marginLeft: 8 },
  progressTrack: { width: 64, height: 4, borderRadius: 2, backgroundColor: '#1C1C1C', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#22D46E', borderRadius: 2 },
  targetLabel: { fontSize: 10, color: '#888' },

  exerciseBlock: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  exerciseBlockCompact: { paddingTop: 2, paddingBottom: 2 },
  exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exerciseName: { flex: 1, fontSize: 20, fontWeight: '700', color: '#F0F0F0', lineHeight: 26 },
  exerciseNameCompact: { fontSize: 16, lineHeight: 20 },
  t1Badge: { backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  t1Text: { color: '#F59E0B', fontSize: 10, fontWeight: '800' },
  amrapBadge: { backgroundColor: 'rgba(59,130,246,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  amrapText: { color: '#3B82F6', fontSize: 10, fontWeight: '800' },
  setProgress: { fontSize: 14, fontWeight: '500', color: '#888', marginTop: 6 },
  setProgressCompact: { fontSize: 12, marginTop: 2 },
  setProgressBreak: { color: '#3B82F6' },
  setProgressTransition: { color: '#F59E0B' },

  timerContainer: { alignItems: 'center', paddingTop: 24, paddingBottom: 8 },
  ringBlock: { alignItems: 'center', gap: 10 },
  timerCenter: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
  },
  timerText: { fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  timerSubLabel: { fontSize: 12, fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 },
  targetDuration: { fontSize: 12, color: '#888' },
  amrapHint: { fontSize: 12, color: '#888' },

  compactRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 16, paddingBottom: 12,
  },
  compactCtas: { flex: 1, gap: 8, justifyContent: 'center' },

  ctaBlock: {
    padding: 16, paddingBottom: 32, gap: 10,
  },
  primaryBtn: {
    borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '800' },
  secondaryBtn: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#262626',
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: '#888', fontSize: 15, fontWeight: '600' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },

  warningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center', justifyContent: 'center',
    padding: 32,
  },
  warningCard: {
    backgroundColor: '#1C1C1C', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 20, padding: 32, width: '100%', maxWidth: 420, alignItems: 'center',
  },
  warningTitle: { fontSize: 24, fontWeight: '800', color: '#F0F0F0', marginTop: 16, textAlign: 'center' },
  warningBody: { fontSize: 14, lineHeight: 22, color: '#888', textAlign: 'center', marginTop: 8 },
  warningBtn: {
    marginTop: 28, width: '100%', height: 56, borderRadius: 14,
    backgroundColor: '#22D46E', alignItems: 'center', justifyContent: 'center',
  },
  warningBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});
