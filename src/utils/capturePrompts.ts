import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { BodyweightCaptureResult, CaptureResult, CaptureSource } from './trackerCapture';

/** Ask whether to use the camera or an existing photo, then run the chosen flow. */
export function promptCaptureSource(
  run: (source: CaptureSource) => void,
  copy?: { title: string; message: string },
) {
  Alert.alert(
    copy?.title ?? 'Log tracker page',
    copy?.message ?? 'Photograph the page now, or pick a photo you already took.',
    [
      { text: 'Take photo', onPress: () => run('camera') },
      { text: 'Choose from library', onPress: () => run('library') },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

/** Map a bodyweight capture result to an alert. Returns true if a weight was saved. */
export function handleBodyweightResult(r: BodyweightCaptureResult): boolean {
  switch (r.status) {
    case 'saved':
      Alert.alert('Bodyweight logged', `${r.kg} kg saved — it'll be in this week's CSV.`);
      return true;
    case 'no-key':
      Alert.alert('API key needed', 'Add your Anthropic API key in Settings → Tracker & API to read weigh-in photos.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings') },
      ]);
      return false;
    case 'no-permission':
      Alert.alert('Camera permission', 'Camera access is needed to photograph your scale.');
      return false;
    case 'empty':
      Alert.alert('Couldn’t read the weight', 'No bodyweight was detected. Try a clear, straight-on photo of the scale display.');
      return false;
    case 'error':
      Alert.alert('Reading failed', r.message);
      return false;
    case 'cancelled':
    default:
      return false;
  }
}

export function handleCaptureResult(result: CaptureResult): boolean {
  switch (result.status) {
    case 'saved':
      if (result.notices.length) Alert.alert('Tracker photo attached', result.notices.join('\n\n'));
      return true;
    case 'no-permission':
      Alert.alert('Camera permission', 'Allow camera access or choose a photo from your gallery.');
      return false;
    case 'error':
      Alert.alert('Photo could not be attached', result.message);
      return false;
    case 'cancelled':
      return false;
  }
}
