import { requireNativeModule } from 'expo';
import * as FileSystem from 'expo-file-system';
import { PermissionsAndroid, Platform } from 'react-native';
import { TrackerPhoto } from '../types';
import { weekKey } from './week';

const folder = () => {
  if (!FileSystem.documentDirectory) throw new Error('Photo storage is unavailable.');
  return FileSystem.documentDirectory + 'tracker-pages/';
};

export function trackerPhotoUri(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid tracker photo.');
  }
  return folder() + id + '.jpg';
}

export async function writeTrackerPhoto(id: string, jpeg: string) {
  await FileSystem.makeDirectoryAsync(folder(), { intermediates: true });
  await FileSystem.writeAsStringAsync(trackerPhotoUri(id), jpeg, { encoding: FileSystem.EncodingType.Base64 });
}

export async function readTrackerPhoto(id: string) {
  const uri = trackerPhotoUri(id);
  if (!(await FileSystem.getInfoAsync(uri)).exists) throw new Error('Choose the photo from your phone album to attach it again.');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function discardPrivatePhoto(id: string) {
  await FileSystem.deleteAsync(trackerPhotoUri(id), { idempotent: true });
}

export async function copyToTrackerAlbum(photo: TrackerPhoto) {
  if (Platform.OS === 'android' && Number(Platform.Version) <= 28) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Allow storage access to save a copy to Pictures.');
  }
  const date = new Date(photo.date + 'T12:00:00');
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  const album = requireNativeModule<{ saveAsync: (id: string, date: string, week: string, day: string, time: number) => Promise<void> }>('TrackerAlbum');
  await album.saveAsync(photo.id, photo.date, weekKey(date).slice(-3), day, date.getTime());
}
