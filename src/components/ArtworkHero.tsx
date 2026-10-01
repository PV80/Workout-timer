import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { theme } from '../theme';
import { EntranceView } from './Motion';

const artwork = {
  training: require('../../assets/artwork/training-focus.jpg'),
  complete: require('../../assets/artwork/session-complete.jpg'),
  history: require('../../assets/artwork/history-progress.jpg'),
  tracker: require('../../assets/artwork/tracker-journal.jpg'),
  backup: require('../../assets/artwork/backup-vault.jpg'),
  recovery: require('../../assets/artwork/recovery.jpg'),
};

export function ArtworkHero({ kind = 'training', label, title, subtitle, compact = false, inset = true }: {
  kind?: keyof typeof artwork; label: string; title: string; subtitle: string; compact?: boolean; inset?: boolean;
}) {
  return <EntranceView testID={`artwork-${kind}`} collapsable={false} style={[styles.hero, compact && styles.compact, !inset && { marginHorizontal: 0 }]}>
    <Image source={artwork[kind]} style={styles.image} resizeMode="cover" accessible={false} />
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs><LinearGradient id="heroShade" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0" stopColor={theme.background} stopOpacity="0.9" />
        <Stop offset="0.6" stopColor={theme.background} stopOpacity="0.5" />
        <Stop offset="1" stopColor={theme.background} stopOpacity="0.05" />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill="url(#heroShade)" />
    </Svg>
    <View style={styles.content}>
      <View style={styles.tag}><View style={styles.dot} /><Text style={styles.label}>{label}</Text></View>
      <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  </EntranceView>;
}

const styles = StyleSheet.create({
  // Image adds the asset's intrinsic width/height before our styles on Android.
  // Absolute edges alone leave a 960x640 image clipped inside a small card.
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  hero: { minHeight: 208, marginHorizontal: 20, marginTop: 18, marginBottom: 14,
    borderRadius: 22, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', justifyContent: 'flex-end' },
  compact: { minHeight: 138, marginTop: 8 },
  content: { padding: 22, gap: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.green },
  label: { color: theme.green, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title: { fontSize: 34, fontWeight: '900', color: theme.text, letterSpacing: -1 },
  compactTitle: { fontSize: 28 },
  subtitle: { fontSize: 14, lineHeight: 21, color: theme.text, maxWidth: '80%' },
});
