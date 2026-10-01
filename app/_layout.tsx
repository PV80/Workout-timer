import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTrackerStore } from '../src/store/trackerStore';
import { flushWorkout, useWorkoutStore } from '../src/store/workoutStore';
import { ensureWorkoutReady } from '../src/utils/workoutRecovery';
import {
  ensureWeeklyExportReminder,
  setupNotifications,
} from '../src/utils/notificationService';
import { warmUpAlert } from '../src/utils/alertService';
import { MotionProvider, useMotionEnabled } from '../src/components/Motion';
import { theme } from '../src/theme';

export default function RootLayout() {
  return <MotionProvider><RootNavigator /></MotionProvider>;
}

function RootNavigator() {
  const motionEnabled = useMotionEnabled();
  const hydrateTracker = useTrackerStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);

  async function restore() {
    setRecoveryError(false);
    try {
      // Don't render Home/Start until its existing workout and history are loaded.
      await ensureWorkoutReady();
      await hydrateTracker();
      await setupNotifications();
      useWorkoutStore.getState().restoreNotifications();
      ensureWeeklyExportReminder(useTrackerStore.getState().lastExportWeekKey);
      setReady(true);
    } catch {
      setRecoveryError(true);
    }
  }

  useEffect(() => {
    restore();
    warmUpAlert();
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushWorkout().catch(() => {});
    });
    return () => listener.remove();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <StatusBar style="light" />
        {recoveryError ? (
          <>
            <Text style={{ color: '#F0F0F0', textAlign: 'center', marginBottom: 20 }}>
              Your saved workout could not be loaded. Your saved data has been kept.
            </Text>
            <TouchableOpacity onPress={restore} accessibilityRole="button" accessibilityLabel="Retry loading workout">
              <Text style={{ color: '#22D46E', fontSize: 18 }}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator color="#22D46E" accessibilityLabel="Loading saved workout" />}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, animation: motionEnabled ? 'fade_from_bottom' : 'none', contentStyle: { backgroundColor: theme.background } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="workout/index" />
          <Stack.Screen name="complete" />
          <Stack.Screen name="history" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="tracker" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
