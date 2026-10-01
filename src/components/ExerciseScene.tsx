import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { EXERCISE_ARTWORK, ExerciseArtwork, Point, Pose, REST_ARTWORK } from '../data/exerciseIllustrations';
import { theme } from '../theme';
import { useMotionEnabled } from './Motion';

const MovingPath = Animated.createAnimatedComponent(Path);
const MovingCircle = Animated.createAnimatedComponent(Circle);
const MovingLine = Animated.createAnimatedComponent(Line);

function point(a: Point, b: Point, t: number): Point {
  'worklet';
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function limb(a: Point, b: Point, c: Point): string {
  'worklet';
  return `M${a[0]},${a[1]} L${b[0]},${b[1]} L${c[0]},${c[1]}`;
}
function interpolatePose(art: ExerciseArtwork, t: number): Pose {
  'worklet';
  const a = art.start, b = art.end;
  return { head: point(a.head,b.head,t), shoulder: point(a.shoulder,b.shoulder,t), hip: point(a.hip,b.hip,t),
    elbow: point(a.elbow,b.elbow,t), hand: point(a.hand,b.hand,t), knee: point(a.knee,b.knee,t), foot: point(a.foot,b.foot,t),
    farElbow: point(a.farElbow,b.farElbow,t), farHand: point(a.farHand,b.farHand,t),
    farKnee: point(a.farKnee,b.farKnee,t), farFoot: point(a.farFoot,b.farFoot,t) };
}

/** Decorative SVGs with a transparent canvas. Animation uses only the UI thread. */
export function ExerciseScene({ exerciseId, phase, paused = false }: {
  exerciseId?: string; phase: string; paused?: boolean;
}) {
  const rest = phase === 'break';
  const art = rest ? REST_ARTWORK : EXERCISE_ARTWORK[exerciseId ?? ''];
  const enabled = useMotionEnabled() && !paused;
  const movement = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(movement);
    if (enabled && art) movement.value = withRepeat(withSequence(
      withTiming(1, { duration: rest ? 2400 : 1400, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: rest ? 2400 : 1400, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
    return () => cancelAnimation(movement);
  }, [exerciseId, rest, enabled, art, movement]);

  // Hooks always run, including for an unknown exercise. Unknowns show no unrelated pose.
  const model = art ?? REST_ARTWORK;
  const head = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { cx: p.head[0], cy: p.head[1] };
  });
  const torso = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { d: `M${p.shoulder[0]},${p.shoulder[1]} L${p.hip[0]},${p.hip[1]}` };
  });
  const arms = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { d: limb(p.shoulder,p.elbow,p.hand) };
  });
  const farArms = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { d: limb(p.shoulder,p.farElbow,p.farHand) };
  });
  const legs = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { d: limb(p.hip,p.knee,p.foot) };
  });
  const farLegs = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { d: limb(p.hip,p.farKnee,p.farFoot) };
  });
  const load = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    const anchor = model.loadAtHip ? p.hip : p.hand;
    if (model.equipment === 'landmine') return { d: `M24,113 L${anchor[0]},${anchor[1]}` };
    const width = model.equipment === 'barbell' ? 27 : 13;
    const x = anchor[0], y = anchor[1];
    return { d: `M${x-width},${y} H${x+width} M${x-width+4},${y-6} V${y+6} M${x+width-4},${y-6} V${y+6}` };
  });
  const farLoad = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value), x = p.farHand[0], y = p.farHand[1];
    return { d: `M${x-13},${y} H${x+13} M${x-9},${y-6} V${y+6} M${x+9},${y-6} V${y+6}` };
  });
  const wheel = useAnimatedProps(() => {
    const p = interpolatePose(model, movement.value);
    return { cx: p.hand[0], cy: p.hand[1] + 7 };
  });
  const breath = useAnimatedProps(() => ({ r: 22 + movement.value * 13, opacity: 0.12 - movement.value * 0.04 }));
  if (!art) return null;

  return <View style={styles.card}>
    <Svg width={110} height={82} viewBox="0 0 160 120" accessible={false}>
      {rest && <MovingCircle cx={75} cy={58} r={22} fill={theme.blue} animatedProps={breath} />}
      <Line x1={15} y1={117} x2={148} y2={117} stroke={theme.border} strokeWidth={2} />
      {art.bench && <G fill="none" stroke={theme.subtle} strokeWidth={4} strokeLinecap="round">
        {art.bench === 'incline' ? <Path d="M29 64 L86 88 H118 M41 73 V114 M106 88 V114" /> :
          art.bench === 'seat' ? <Path d="M60 87 H132 M67 88 V114 M126 88 V114" /> :
          art.bench === 'preacher' ? <Path d="M53 90 H83 M61 90 V114 M83 54 L116 75 M101 65 V114" /> :
          <Path d="M20 84 H101 M31 85 V114 M89 85 V114" />}
      </G>}
      {art.equipment === 'pullup' && <Path d="M25 114 V12 H139 V114" fill="none" stroke={theme.subtle} strokeWidth={4} />}
      {art.equipment === 'bars' && <Path d="M43 114 V57 H57 M113 114 V57 H128" fill="none" stroke={theme.subtle} strokeWidth={4} />}
      {art.equipment === 'landmine' && <Circle cx={24} cy={113} r={6} fill={theme.subtle} />}
      <G fill="none" strokeLinecap="round" strokeLinejoin="round">
        <MovingPath d={limb(art.start.hip,art.start.farKnee,art.start.farFoot)} stroke={theme.subtle} strokeWidth={7} animatedProps={farLegs} />
        <MovingPath d={limb(art.start.shoulder,art.start.farElbow,art.start.farHand)} stroke={theme.subtle} strokeWidth={6} animatedProps={farArms} />
        <MovingPath d={limb(art.start.hip,art.start.knee,art.start.foot)} stroke={theme.text} strokeWidth={7} animatedProps={legs} />
        <MovingPath d={`M${art.start.shoulder.join(',')} L${art.start.hip.join(',')}`} stroke={rest ? theme.blue : theme.green} strokeWidth={15} animatedProps={torso} />
        <MovingPath d={limb(art.start.shoulder,art.start.elbow,art.start.hand)} stroke={theme.text} strokeWidth={6} animatedProps={arms} />
        {art.equipment === 'dumbbells' && <MovingPath stroke={theme.subtle} strokeWidth={4} animatedProps={farLoad} />}
        {['barbell','dumbbells','landmine'].includes(art.equipment) && <MovingPath stroke={rest ? theme.blue : theme.green} strokeWidth={4} animatedProps={load} />}
        {art.equipment === 'roller' && <MovingCircle r={9} stroke={theme.green} strokeWidth={4} animatedProps={wheel} />}
      </G>
      <MovingCircle cx={art.start.head[0]} cy={art.start.head[1]} r={8} fill={theme.text} animatedProps={head} />
    </Svg>
    <View style={styles.copy}>
      <Text style={styles.title}>{paused ? 'Take your time.' : rest ? 'Breathe. Reset.' : phase === 'transition' ? 'Get set for the next one.' : exerciseId === 'plank' ? 'Stay steady.' : 'Find your rhythm.'}</Text>
      <Text style={styles.subtitle}>{paused ? 'Resume when you are ready.' : rest ? 'Let your breathing settle.' : phase === 'transition' ? 'A moment to set up.' : 'One set at a time.'}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 360, minHeight: 88, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 4, gap: 8, backgroundColor: theme.surface,
    borderRadius: 20, borderWidth: 1, borderColor: theme.border },
  copy: { flex: 1, paddingRight: 4 },
  title: { color: theme.text, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  subtitle: { color: theme.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
});
