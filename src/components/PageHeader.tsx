import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeftIcon } from './icons';
import { MotionPressable } from './Motion';
import { theme } from '../theme';

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.header}>
    <MotionPressable onPress={() => router.back()} style={styles.back}
      accessibilityRole="button" accessibilityLabel="Back">
      <ChevronLeftIcon size={22} color={theme.text} />
    </MotionPressable>
    <View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: theme.text },
  subtitle: { fontSize: 12, color: theme.muted, marginTop: 3 },
});
