import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useMotionEnabled } from './Motion';
import { theme } from '../theme';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

interface Props {
  totalSets: number;
  currentSet: number;
  completedSets: number;
  paused?: boolean;
}

function PulsingDot({ active }: { active: boolean }) {
  const motion = useMotionEnabled();
  const scale = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(scale);
    if (active && motion) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.18, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
        false,
      );
    } else {
      scale.value = 1;
    }
    return () => cancelAnimation(scale);
  }, [active, motion, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        styles.dot,
        active ? styles.dotCurrent : styles.dotCompleted,
        animStyle,
      ]}
    />
  );
}

export function SetDots({ totalSets, currentSet, completedSets, paused = false }: Props) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`Set ${currentSet} of ${totalSets}`}>
      {Array.from({ length: totalSets }).map((_, i) => {
        const setNum = i + 1;
        const isCompleted = setNum <= completedSets;
        const isCurrent = setNum === currentSet;

        if (isCurrent) {
          return <PulsingDot key={i} active={!paused} />;
        }
        return (
          <View
            key={i}
            style={[
              styles.dot,
              isCompleted ? styles.dotCompleted : styles.dotRemaining,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 8,
  },
  dot: {
    width: 24,
    height: 5,
    borderRadius: 3,
  },
  dotCompleted: {
    backgroundColor: theme.green,
  },
  dotCurrent: {
    backgroundColor: theme.green,
  },
  dotRemaining: {
    borderWidth: 1.5,
    borderColor: theme.border,
  },
});

