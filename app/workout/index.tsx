import { theme } from '../../src/theme';
import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Alert,
  ScrollView,
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
import { EntranceView, MotionPressable } from '../../src/components/Motion';
import { ExerciseScene } from '../../src/components/ExerciseScene';
import {
  AlertTriangleIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from '../../src/components/icons';
import { useHistoryStore } from '../../src/store/historyStore';
import { retryWorkoutSave, useWorkoutStore, getNextExercise } from '../../src/store/workoutStore';
import { useTimer } from '../../src/hooks/useTimer';
import { useWorkoutDuration } from '../../src/hooks/useWorkoutDuration';
import { estimateLiveTotalDuration } from '../../src/utils/timing';
import { formatTime, formatElapsed } from '../../src/utils/time';
import { stopAlert } from '../../src/utils/alertService';
import { saveFinishedWorkout } from '../../src/utils/workoutRecovery';
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
    <MotionPressable
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
    </MotionPressable>
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
    : Math.max(144, Math.min(300, width - 96, height - (height >= 700 ? 580 : 430)));

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
    completeCurrentSet().catch(handleSaveFailure);
  }, []);

  const handleStartNextSet = useCallback(() => {
    startNextSet().catch(handleSaveFailure);
  }, []);

  const handleSkipBreak = useCallback(() => {
    skipBreak().catch(handleSaveFailure);
  }, []);

  const handleContinueToNext = useCallback((record: boolean) => {
    continueToNextExercise(record).catch(handleSaveFailure);
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
    if (duration.elapsedSeconds >= settings.warningWorkoutMinutes * 60) return theme.red;
    if (duration.elapsedSeconds >= settings.targetWorkoutMinutes * 60) return theme.amber;
    return theme.text;
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
    if (isCountdown && isOvertime) return theme.red;
    if (isAmrap) return theme.green;
    return theme.text;
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
    if (!liveEstimate) return theme.muted;
    if (liveEstimate.totalSeconds >= settings.warningWorkoutMinutes * 60) return theme.red;
    if (liveEstimate.totalSeconds >= settings.targetWorkoutMinutes * 60) return theme.amber;
    return theme.green;
  })();
  const etaText = (() => {
    if (!liveEstimate) return '';
    const totalMin = Math.round(liveEstimate.totalSeconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();
  // Third clock: the projected finish as a wall-clock time — "done at 2:47 PM".
  // Session start + projected total = the phone-clock moment you'll walk out.
  const finishClock = (() => {
    if (!liveEstimate || !sessionStartedAt) return '';
    return new Date(sessionStartedAt + liveEstimate.totalSeconds * 1000)
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
          paused={isPaused}
        />
        <View style={styles.timerCenter}>
          <Text
            style={[styles.timerText, { fontSize: timerFontSize, lineHeight: timerFontSize + 8, color: isPaused ? theme.muted : timerColor }]}
          >
            {timerLabel}
          </Text>
          <Text style={[styles.timerSubLabel, isCountdown && isOvertime ? { color: theme.red } : {}]}>
            {subLabel}
          </Text>
        </View>
      </View>
      <SetDots
        totalSets={exercise.sets}
        currentSet={currentSetNumber}
        completedSets={currentSetNumber - 1}
        paused={isPaused}
      />
      {targetDuration && !isAmrap ? (
        <Text style={styles.targetDuration}>
          target: <Text style={{ color: theme.text }}>{formatTime(targetDuration)}</Text>
        </Text>
      ) : null}
      {isAmrap && !isCompact ? (
        <Text style={styles.amrapHint}>go until failure · tap done when finished</Text>
      ) : null}
    </View>
  );

  const ctas = isPaused ? (
    <CtaButton label="RESUME WORKOUT" icon={<PlayIcon size={16} color="#000" />}
      background={theme.green} textColor="#000" onPress={handleTogglePause} compact={isCompact} />
  ) : isTransition ? (
    <>
      <CtaButton
        label="START NEXT EXERCISE"
        icon={<PlayIcon size={16} color="#000" />}
        background={theme.amber}
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
        icon={<PlayIcon size={16} color="#000" />}
        background={theme.blue}
        textColor="#000"
        onPress={handleStartNextSet}
        compact={isCompact}
      />
      <CtaButton label="SKIP BREAK" secondary onPress={handleSkipBreak} compact={isCompact} />
    </>
  ) : (
    <CtaButton
      label="DONE"
      icon={<CheckIcon size={18} color="#000" strokeWidth={3} />}
      background={theme.green}
      textColor="#000"
      onPress={handleCompleteSet}
      compact={isCompact}
    />
  );

  return (
    <SafeAreaView style={styles.screen}>
      {store.saveError && (
        <TouchableOpacity
          onPress={async () => {
            try {
              await retryWorkoutSave();
              if (useWorkoutStore.getState().finishPending) {
                await saveFinishedWorkout();
                router.replace('/complete');
              }
            } catch { handleSaveFailure(); }
          }}
          accessibilityRole="button" accessibilityLabel="Retry saving workout"
          style={{ padding: 12, backgroundColor: theme.raised }}
        >
          <Text style={{ color: theme.amber, textAlign: 'center' }}>
            Progress could not be saved. Keep the app open. Tap to retry.
          </Text>
        </TouchableOpacity>
      )}
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleAbandon}
          accessibilityRole="button"
          accessibilityLabel="Abandon workout"
        >
          <XIcon size={20} color={theme.muted} />
        </TouchableOpacity>
        <View style={styles.clockBlock}>
          <Text style={[styles.elapsed, { color: elapsedColor }]}>
            {formatElapsed(duration.elapsedSeconds)}
          </Text>
          {liveEstimate ? (
            <Text style={[styles.eta, { color: etaColor }]} numberOfLines={1}>
              ≈ {etaText} · done {finishClock}
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
          {isPaused ? <PlayIcon size={18} color={theme.green} /> : <PauseIcon size={18} color={theme.muted} />}
        </TouchableOpacity>
        <View style={styles.progressArea}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressBarWidth as any }]} />
          </View>
          <Text style={styles.targetLabel}>target {settings.targetWorkoutMinutes}m</Text>
        </View>
      </View>

      {/* Exercise info */}
      <EntranceView trigger={`${exercise.id}:${currentPhase}:${isPaused}`} style={[styles.exerciseBlock, isCompact && styles.exerciseBlockCompact]}>
        <View style={styles.phaseRow}>
          <View style={[styles.phaseBadge, { borderColor: isPaused ? theme.muted : isBreak ? theme.blue : isTransition ? theme.amber : theme.green }]}>
            <Text style={[styles.phaseText, { color: isPaused ? theme.muted : isBreak ? theme.blue : isTransition ? theme.amber : theme.green }]}>
              {isPaused ? 'PAUSED' : isBreak ? 'RECOVER' : isTransition ? 'GET READY' : 'IN THE ZONE'}
            </Text>
          </View>
          <Text style={styles.sessionLabel}>{activeWorkout.name}</Text>
        </View>
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
      </EntranceView>

      {isCompact ? (
        /* Split-screen layout: ring on the left, actions on the right. */
        <View style={styles.compactRow}>
          {ringBlock}
          <View style={styles.compactCtas}>{ctas}</View>
        </View>
      ) : (
        <>
          <ScrollView style={styles.workoutBody} contentContainerStyle={styles.workoutBodyContent}>
          <View style={styles.timerContainer}>{ringBlock}</View>
          <View style={[styles.sceneSpace, height >= 700 && styles.sceneSpaceWithArt]}>
            {height >= 700 && <ExerciseScene
              exerciseId={isTransition ? nextEx?.id : exercise.id}
              phase={currentPhase} paused={isPaused}
            />}
          </View>
          </ScrollView>
          <View style={styles.ctaBlock}>{ctas}</View>
        </>
      )}

      {/* 2-hour warning overlay */}
      {duration.shouldShowWarning && !warningDismissed && (
        <View style={styles.warningOverlay}>
          <View style={styles.warningCard}>
            <AlertTriangleIcon size={36} color={theme.red} />
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

function handleSaveFailure() {
  useWorkoutStore.setState({ saveError: true });
  Alert.alert('Progress could not be saved', 'Keep the app open and retry saving before switching apps.');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  headerBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' },
  clockBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  elapsed: { textAlign: 'center', fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eta: { marginTop: 1, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  etaLabel: { marginTop: 1, fontSize: 10, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1 },
  progressArea: { alignItems: 'flex-end', gap: 4, marginLeft: 8 },
  progressTrack: { width: 64, height: 4, borderRadius: 2, backgroundColor: theme.raised, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
  targetLabel: { fontSize: 10, color: theme.muted },

  phaseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  phaseBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: theme.surface },
  phaseText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  sessionLabel: { fontSize: 10, color: theme.subtle, fontWeight: '700', letterSpacing: 1.5 },
  exerciseBlock: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  exerciseBlockCompact: { paddingTop: 4, paddingBottom: 2 },
  exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exerciseName: { flex: 1, fontSize: 25, fontWeight: '800', color: theme.text, lineHeight: 31, letterSpacing: -0.6 },
  exerciseNameCompact: { fontSize: 16, lineHeight: 20 },
  t1Badge: { backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  t1Text: { color: theme.amber, fontSize: 10, fontWeight: '800' },
  amrapBadge: { backgroundColor: 'rgba(59,130,246,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  amrapText: { color: theme.blue, fontSize: 10, fontWeight: '800' },
  setProgress: { fontSize: 14, fontWeight: '500', color: theme.muted, marginTop: 6 },
  setProgressCompact: { fontSize: 12, marginTop: 2 },
  setProgressBreak: { color: theme.blue },
  setProgressTransition: { color: theme.amber },

  // Reserve the animation's real height; allow scrolling with large text or
  // unusually long exercise names while keeping the action buttons fixed.
  workoutBody: { flex: 1 },
  workoutBodyContent: { flexGrow: 1 },
  sceneSpaceWithArt: { minHeight: 116 },
  timerContainer: { alignItems: 'center', paddingTop: 18, paddingBottom: 8 },
  sceneSpace: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  ringBlock: { alignItems: 'center', gap: 10 },
  timerCenter: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
  },
  timerText: { fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  timerSubLabel: { fontSize: 12, fontWeight: '500', color: theme.muted, textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 },
  targetDuration: { fontSize: 12, color: theme.muted },
  amrapHint: { fontSize: 12, color: theme.muted },

  compactRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 16, paddingBottom: 12,
  },
  compactCtas: { flex: 1, gap: 8, justifyContent: 'center' },

  ctaBlock: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 10,
  },
  primaryBtn: {
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '800' },
  secondaryBtn: {
    borderRadius: 16, borderWidth: 1.5, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: theme.muted, fontSize: 15, fontWeight: '600' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },

  warningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center', justifyContent: 'center',
    padding: 32,
  },
  warningCard: {
    backgroundColor: theme.raised, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 20, padding: 32, width: '100%', maxWidth: 420, alignItems: 'center',
  },
  warningTitle: { fontSize: 24, fontWeight: '800', color: theme.text, marginTop: 16, textAlign: 'center' },
  warningBody: { fontSize: 14, lineHeight: 22, color: theme.muted, textAlign: 'center', marginTop: 8 },
  warningBtn: {
    marginTop: 28, width: '100%', height: 56, borderRadius: 14,
    backgroundColor: theme.green, alignItems: 'center', justifyContent: 'center',
  },
  warningBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});
