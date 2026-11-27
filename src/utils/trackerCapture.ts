import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useTrackerStore } from '../store/trackerStore';
import { parseBodyweightImage, parseTrackerImage } from './claudeClient';
import { localDate, weekKey } from './week';
import { TrackerEntry, TrackerPhoto, WorkoutSession } from '../types';
import { copyToTrackerAlbum, discardPrivatePhoto, readTrackerPhoto, writeTrackerPhoto } from './trackerPhotos';

export type CaptureResult =
  | { status: 'saved'; entry: TrackerEntry; notices: string[] }
  | { status: 'cancelled' }
  | { status: 'no-permission' }
  | { status: 'error'; message: string };

export type BodyweightCaptureResult =
  | { status: 'saved'; kg: number }
  | { status: 'cancelled' }
  | { status: 'no-key' }
  | { status: 'no-permission' }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export type CaptureSource = 'camera' | 'library';

/** Open the camera or photo library and return a base64 JPEG, or a failure status. */
async function grabImage(
  source: CaptureSource, quality = 0.5,
): Promise<{ ok: true; base64: string } | { ok: false; status: 'cancelled' | 'no-permission' }> {
  let shot: ImagePicker.ImagePickerResult;
  if (source === 'library') {
    // Existing photo (e.g. taken earlier). The Android photo picker needs no
    // runtime permission.
    shot = await ImagePicker.launchImageLibraryAsync({
      base64: true,
      quality,
      allowsEditing: true,
      mediaTypes: ['images'],
    });
  } else {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, status: 'no-permission' };
    shot = await ImagePicker.launchCameraAsync({
      base64: true,
      quality,
      allowsEditing: true,
    });
  }
  if (shot.canceled || !shot.assets?.[0]?.base64) return { ok: false, status: 'cancelled' };
  return { ok: true, base64: shot.assets[0].base64 };
}

type Session = Pick<WorkoutSession, 'id' | 'date' | 'day'>;

export function sessionFields(session: Session) {
  const date = new Date(session.date);
  return { sessionId: session.id, workoutDate: localDate(date), weekKey: weekKey(date) };
}

export function linkTrackerEntry(id: string, session: Session) {
  return useTrackerStore.getState().updateEntry(id, current => {
    if (current.sessionId && current.sessionId !== session.id) throw new Error('That page is already linked to another workout.');
    return sessionFields(session);
  });
}

function updatePhoto(entry: TrackerEntry, change: Partial<TrackerPhoto>, fields: Partial<TrackerEntry> = {}) {
  return useTrackerStore.getState().updateEntry(entry.id, current => {
    if (!current.photo || current.photo.id !== entry.photo?.id) throw new Error('The tracker photo has changed. Open the current photo.');
    return { ...fields, photo: { ...current.photo, ...change } };
  });
}

export async function savePhoneCopy(entry: TrackerEntry) {
  if (!entry.photo) throw new Error('Attach a photo first.');
  await copyToTrackerAlbum(entry.photo);
  await updatePhoto(entry, { inAlbum: true });
}

export async function readPageEntries(entry: TrackerEntry, column = entry.photo?.column, jpeg?: string) {
  const key = useTrackerStore.getState().apiKey;
  if (!key) throw new Error('Add your API key in Settings when you want to read the handwriting.');
  if (!entry.photo) throw new Error('Attach a photo first.');
  const historical = Boolean(entry.sessionId && entry.weekKey !== weekKey());
  const parsed = await parseTrackerImage(jpeg ?? await readTrackerPhoto(entry.photo.id), key, {
    date: entry.workoutDate, historical, column,
  });
  if (!parsed.exercises.some(ex => ex.sets.length) || (column && parsed.weekNumber !== column)) {
    throw new Error('No sets could be read for this workout. Choose the printed week and try again, or attach a clearer photo.');
  }
  const title = [parsed.month, parsed.day].filter(Boolean).join(' · ');
  await updatePhoto(entry, { needsReading: false, column }, {
    month: parsed.month ?? undefined, day: parsed.day ?? entry.day,
    title: title || entry.title, weekNumber: parsed.weekNumber, weekDate: parsed.weekDate ?? undefined,
    exercises: parsed.exercises, notes: parsed.notes ?? undefined, rawText: parsed.rawText,
  });
}

const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

/** Save the photo and its session link before either the gallery write or network read. */
export async function runTrackerCapture(
  source: CaptureSource = 'camera', session?: Session, column?: number,
): Promise<CaptureResult> {
  try {
    const image = await grabImage(source, 0.85);
    if (!image.ok) return { status: image.status };

    const store = useTrackerStore.getState();
    const previous = session ? store.entries.find(e => e.sessionId === session.id) : undefined;
    const now = new Date();
    const workoutDate = localDate(session ? new Date(session.date) : now);
    const photo: TrackerPhoto = {
      id: Crypto.randomUUID(), date: workoutDate, inAlbum: false,
      needsReading: !previous?.exercises.length, column,
    };
    const entry: TrackerEntry = previous ? { ...previous, photo } : {
      id: Crypto.randomUUID(), capturedAt: now.toISOString(), exercises: [], day: session?.day,
      title: session ? session.day[0].toUpperCase() + session.day.slice(1) + ' · ' + workoutDate : 'Workout page',
      ...(session ? sessionFields(session) : { workoutDate, weekKey: weekKey(now) }), photo,
    };
    try {
      await writeTrackerPhoto(photo.id, image.base64);
      if (previous) {
        // A retake changes the image while preserving any corrections already on the page.
        await store.updateEntry(previous.id, current => {
          if (current.photo?.id !== previous.photo?.id) throw new Error('Another photo was attached to this workout. Please reopen it.');
          return { photo };
        });
      } else {
        await store.addEntry(entry);
      }
    } catch (error) {
      await discardPrivatePhoto(photo.id).catch(() => {});
      throw error;
    }
    if (previous?.photo) await discardPrivatePhoto(previous.photo.id).catch(() => {});
    const notices: string[] = [];
    try {
      await savePhoneCopy(entry);
    } catch (error) {
      notices.push('Gallery copy pending. ' + message(error));
    }
    if (photo.needsReading) {
      try {
        await readPageEntries(entry, column, image.base64);
      } catch (error) {
        notices.push(message(error));
      }
    }
    return { status: 'saved', entry: useTrackerStore.getState().entries.find(e => e.id === entry.id) ?? entry, notices };
  } catch (error) {
    return { status: 'error', message: message(error) };
  }
}

/**
 * Photo → Claude → bodyweight entry: reads a scale photo (camera or library)
 * and logs the weight for this week so it flows into the weekly CSV alongside
 * the manually-typed weigh-ins.
 */
export async function runBodyweightCapture(
  source: CaptureSource = 'camera',
): Promise<BodyweightCaptureResult> {
  const { apiKey, addBodyweight } = useTrackerStore.getState();
  if (!apiKey) return { status: 'no-key' };

  const img = await grabImage(source);
  if (!img.ok) return { status: img.status };

  try {
    const parsed = await parseBodyweightImage(img.base64, apiKey);
    if (parsed.kg == null) return { status: 'empty' };
    await addBodyweight(parsed.kg);
    return { status: 'saved', kg: parsed.kg };
  } catch (e: any) {
    return { status: 'error', message: e?.message ?? 'Failed to read the weight.' };
  }
}
