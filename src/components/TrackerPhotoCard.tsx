import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTrackerStore } from '../store/trackerStore';
import { theme } from '../theme';
import { TrackerEntry } from '../types';
import { readPageEntries, savePhoneCopy } from '../utils/trackerCapture';
import { trackerPhotoUri } from '../utils/trackerPhotos';

export function WeekColumnPicker({ value, onChange }: { value?: number; onChange: (n?: number) => void }) {
  return <View>
    <Text style={styles.caption}>Printed week column</Text>
    <View style={styles.choices}>
      {[undefined, 1, 2, 3, 4].map(n =>
        <TouchableOpacity key={n ?? 'auto'} accessibilityRole="radio"
          accessibilityLabel={n ? 'Week ' + n : 'Auto'} accessibilityState={{ selected: value === n }}
          onPress={() => onChange(n)} style={[styles.choice, value === n && styles.selected]}>
          <Text style={value === n ? styles.action : styles.muted}>{n ?? 'Auto'}</Text>
        </TouchableOpacity>)}
    </View>
  </View>;
}

export function TrackerPhotoCard({ entry }: { entry: TrackerEntry }) {
  const photo = entry.photo;
  const hasKey = useTrackerStore(s => Boolean(s.apiKey));
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [reading, setReading] = useState(false);
  const [chooseAgain, setChooseAgain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [column, setColumn] = useState(photo?.column);
  useEffect(() => { setMissing(false); setChooseAgain(false); setColumn(photo?.column); }, [photo?.id, photo?.column]);
  if (!photo) return null;
  const source = { uri: trackerPhotoUri(photo.id) };
  const busy = reading || saving;

  async function read() {
    setReading(true);
    try { await readPageEntries(entry, column); setChooseAgain(false); }
    catch (e) { Alert.alert('Page could not be read', e instanceof Error ? e.message : 'Try again.'); }
    finally { setReading(false); }
  }

  async function save() {
    setSaving(true);
    try { await savePhoneCopy(entry); }
    catch (e) { Alert.alert('Gallery copy pending', e instanceof Error ? e.message : 'Try again.'); }
    finally { setSaving(false); }
  }

  return <View style={styles.card}>
    {missing ? <Text style={styles.muted}>The photo file is missing on this phone. Reattach it from your gallery.</Text> :
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="View tracker photo" onPress={() => setOpen(true)}>
        <Image source={source} resizeMode="cover" style={styles.thumb} onError={() => setMissing(true)} />
      </TouchableOpacity>}
    {!missing && <Text style={styles.muted}>{photo.inAlbum ? 'Phone album · Workout Tracker ' + photo.date.slice(0, 7) : 'Phone album copy pending'}</Text>}
    {!photo.inAlbum && !missing && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={save} style={styles.link}>
      <Text style={styles.action}>{saving ? 'Saving…' : 'Save to phone album'}</Text>
    </TouchableOpacity>}
    {!missing && !photo.needsReading && !chooseAgain && hasKey && <TouchableOpacity
      accessibilityRole="button" style={styles.link} onPress={() => setChooseAgain(true)}>
      <Text style={styles.action}>Read a different week column</Text>
    </TouchableOpacity>}
    {(photo.needsReading || chooseAgain) && !missing && (hasKey ? <>
      <WeekColumnPicker value={column} onChange={setColumn} />
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={read} style={styles.link}>
        <Text style={styles.action}>{reading ? 'Reading…' : chooseAgain ? 'Replace saved readings' : 'Read handwritten sets'}</Text>
      </TouchableOpacity>
      {chooseAgain && <TouchableOpacity accessibilityRole="button" style={styles.link} disabled={busy} onPress={() => setChooseAgain(false)}>
        <Text style={styles.muted}>Keep existing readings</Text>
      </TouchableOpacity>}
    </> : <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/settings')} style={styles.link}>
      <Text style={styles.action}>Set up handwriting recognition</Text>
    </TouchableOpacity>)}
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="fade">
      <SafeAreaView style={styles.full}>
        <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(false)} style={styles.close}>
          <Text style={styles.action}>Close photo</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.fullPhoto} maximumZoomScale={4} minimumZoomScale={1}>
          <Image accessibilityLabel="Tracker page" source={source} style={styles.image} resizeMode="contain" />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingVertical: 10, gap: 8 },
  thumb: { height: 128, width: '100%', borderRadius: 10, backgroundColor: theme.raised },
  caption: { fontSize: 13, color: theme.muted, marginBottom: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  choice: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 8, backgroundColor: theme.raised },
  selected: { borderWidth: 1, borderColor: theme.green },
  muted: { color: theme.muted, fontSize: 13 },
  link: { minHeight: 44, justifyContent: 'center' },
  action: { color: theme.green, fontSize: 14, fontWeight: '700' },
  full: { flex: 1, backgroundColor: theme.background },
  fullPhoto: { flexGrow: 1 }, image: { width: '100%', flex: 1 },
  close: { padding: 16, alignSelf: 'flex-end' },
});
