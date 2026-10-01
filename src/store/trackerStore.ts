import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { BodyweightEntry, TrackerEntry } from '../types';
import { weekKey } from '../utils/week';

export const TRACKER_KEYS = {
  entries: 'tracker_entries',
  bodyweight: 'tracker_bodyweight',
  apiKey: 'claude_api_key',
  lastExport: 'tracker_last_export',
} as const;
const KEYS = TRACKER_KEYS;

interface TrackerState {
  entries: TrackerEntry[];
  bodyweights: BodyweightEntry[];
  apiKey: string;
  /** ISO week key of the most recent export — silences that week's reminder. */
  lastExportWeekKey: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  addEntry: (entry: TrackerEntry) => Promise<void>;
  updateEntry: (id: string, patch: Partial<TrackerEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addBodyweight: (kg: number, date?: Date) => Promise<void>;
  deleteBodyweight: (id: string) => Promise<void>;
  markExported: (week: string) => Promise<void>;
  /** Drop entries and bodyweights strictly before the current week; retain future-dated data. */
  clearWeeksBefore: (currentWeek: string) => Promise<void>;
}

// Serialize mutations and publish state only after storage accepts the write.
// A failed save leaves the previous state intact and does not poison later retries.
let pendingWrite: Promise<void> = Promise.resolve();
function persistChange(change: () => Promise<void>): Promise<void> {
  const next = pendingWrite.then(change);
  pendingWrite = next.catch(() => {});
  return next;
}

export const useTrackerStore = create<TrackerState>((set, get) => ({
  entries: [], bodyweights: [], apiKey: '', lastExportWeekKey: null, hydrated: false,

  async hydrate() {
    await pendingWrite;
    const [rawEntries, rawBw, rawKey, rawExport] = await Promise.all([
      AsyncStorage.getItem(KEYS.entries), AsyncStorage.getItem(KEYS.bodyweight),
      AsyncStorage.getItem(KEYS.apiKey), AsyncStorage.getItem(KEYS.lastExport),
    ]);
    const entries = rawEntries ? JSON.parse(rawEntries) : [];
    const bodyweights = rawBw ? JSON.parse(rawBw) : [];
    if (!Array.isArray(entries) || !Array.isArray(bodyweights)) throw new Error('Saved tracker data could not be loaded.');
    set({ entries, bodyweights, apiKey: rawKey ?? '', lastExportWeekKey: rawExport, hydrated: true });
  },
  setApiKey(key) {
    return persistChange(async () => {
      const apiKey=key.trim();
      await AsyncStorage.setItem(KEYS.apiKey, apiKey); set({ apiKey });
    });
  },
  addEntry(entry) {
    return persistChange(async () => {
      const entries=[entry,...get().entries.filter(e=>e.id!==entry.id)];
      await AsyncStorage.setItem(KEYS.entries,JSON.stringify(entries)); set({entries});
    });
  },
  updateEntry(id,patch) {
    return persistChange(async () => {
      const entries=get().entries.map(e=>e.id===id?{...e,...patch,id:e.id}:e);
      await AsyncStorage.setItem(KEYS.entries,JSON.stringify(entries)); set({entries});
    });
  },
  deleteEntry(id) {
    return persistChange(async () => {
      const entries=get().entries.filter(e=>e.id!==id);
      await AsyncStorage.setItem(KEYS.entries,JSON.stringify(entries)); set({entries});
    });
  },
  addBodyweight(kg,date=new Date()) {
    return persistChange(async () => {
      if (!Number.isFinite(kg) || kg<=0 || kg>500 || !Number.isFinite(date.getTime())) throw new Error('Enter a valid bodyweight and date.');
      const entry: BodyweightEntry={id:Crypto.randomUUID(),date:date.toISOString(),weekKey:weekKey(date),kg};
      const bodyweights=[entry,...get().bodyweights];
      await AsyncStorage.setItem(KEYS.bodyweight,JSON.stringify(bodyweights)); set({bodyweights});
    });
  },
  deleteBodyweight(id) {
    return persistChange(async () => {
      const bodyweights=get().bodyweights.filter(b=>b.id!==id);
      await AsyncStorage.setItem(KEYS.bodyweight,JSON.stringify(bodyweights)); set({bodyweights});
    });
  },
  markExported(week) {
    return persistChange(async () => {
      await AsyncStorage.setItem(KEYS.lastExport,week); set({lastExportWeekKey:week});
    });
  },
  clearWeeksBefore(currentWeek) {
    return persistChange(async () => {
      const entries=get().entries.filter(e=>e.weekKey>=currentWeek);
      const bodyweights=get().bodyweights.filter(b=>b.weekKey>=currentWeek);
      await AsyncStorage.multiSet([[KEYS.entries,JSON.stringify(entries)],[KEYS.bodyweight,JSON.stringify(bodyweights)]]);
      set({entries,bodyweights});
    });
  },
}));

export function currentWeekKey(): string {
  return weekKey();
}

