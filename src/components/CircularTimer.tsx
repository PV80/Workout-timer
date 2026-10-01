import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle,
  useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { useMotionEnabled } from './Motion';
import { theme } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const STROKE = 10;
interface Props {
  phase: 'set' | 'break' | 'amrap' | 'timed' | 'transition' | 'idle';
  isOvertime: boolean; progress: number; size?: number; paused?: boolean;
}

export function CircularTimer({ phase, isOvertime, progress, size = 280, paused = false }: Props) {
  const motion = useMotionEnabled() && !paused;
  const radius = (size - 40) / 2;
  const circumference = 2 * Math.PI * radius;
  const animProgress = useSharedValue(progress);
  const rotation = useSharedValue(0);
  const color = paused ? theme.subtle : isOvertime && (phase === 'break' || phase === 'transition')
    ? theme.red : phase === 'break' ? theme.blue : phase === 'transition' ? theme.amber : theme.green;

  useEffect(() => {
    cancelAnimation(rotation);
    if (phase === 'amrap' && motion) {
      rotation.value = withRepeat(withTiming(rotation.value + 360, {
        duration: 3200, easing: Easing.linear,
      }), -1, false);
    }
    return () => cancelAnimation(rotation);
  }, [phase, motion, rotation]);
  useEffect(() => {
    cancelAnimation(animProgress);
    const target = Math.max(0, Math.min(1, progress));
    animProgress.value = motion ? withTiming(target, { duration: 420 }) : target;
    return () => cancelAnimation(animProgress);
  }, [progress, phase, motion, animProgress]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: phase === 'amrap' ? 0 : circumference * (1 - animProgress.value),
  }));
  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${phase === 'amrap' ? rotation.value : 0}deg` }],
  }));

  return <View style={{ width: size, height: size }} accessible={false}>
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={radius - 20} fill={theme.surface} />
      {Array.from({ length: 48 }, (_, i) => {
        const angle = i * Math.PI / 24;
        const inner = size / 2 - 8;
        const outer = size / 2 - (i % 4 === 0 ? 2 : 5);
        return <Line key={i} x1={size / 2 + inner * Math.sin(angle)} y1={size / 2 - inner * Math.cos(angle)}
          x2={size / 2 + outer * Math.sin(angle)} y2={size / 2 - outer * Math.cos(angle)}
          stroke={theme.border} strokeWidth={1.5} />;
      })}
      <Circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={theme.raised} strokeWidth={STROKE} />
    </Svg>
    <Animated.View style={[{ position: 'absolute', width: size, height: size }, rotatingStyle]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color}
          strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={phase === 'amrap' ? `${circumference * 0.28} ${circumference * 0.72}` : `${circumference}`}
          animatedProps={ringProps} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
    </Animated.View>
  </View>;
}
