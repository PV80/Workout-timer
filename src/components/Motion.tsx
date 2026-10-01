import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, AppState, Easing, TouchableOpacity,
  TouchableOpacityProps, ViewProps,
} from 'react-native';

const MotionContext = createContext(false);

/** One listener per app: honor accessibility preferences and stop background motion. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduced(value);
    }).catch(() => {});
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const visibility = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { mounted = false; preference.remove(); visibility.remove(); };
  }, []);
  return <MotionContext.Provider value={active && !reduced}>{children}</MotionContext.Provider>;
}

export function useMotionEnabled() { return useContext(MotionContext); }

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

/** Press feedback never delays the action or runs a timer of its own. */
export function MotionPressable({ style, onPressIn, onPressOut, ...props }: TouchableOpacityProps) {
  const enabled = useMotionEnabled();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [enabled, scale]);
  function animate(value: number) {
    if (enabled) Animated.timing(scale, {
      toValue: value, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }
  return <AnimatedTouchable {...props} style={[style, { transform: [{ scale }] }]}
    onPressIn={event => { animate(0.97); onPressIn?.(event); }}
    onPressOut={event => { animate(1); onPressOut?.(event); }} />;
}

/** A short fade/slide for cards and phase changes; no looping screen animation. */
export function EntranceView({ delay = 0, trigger, style, ...props }: ViewProps & {
  delay?: number; trigger?: string;
}) {
  const enabled = useMotionEnabled();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    value.stopAnimation();
    if (!enabled) { value.setValue(1); return; }
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1, duration: 260, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enabled, trigger, delay, value]);
  return <Animated.View {...props} style={[style, {
    opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  }]} />;
}
