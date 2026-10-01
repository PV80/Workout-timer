import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { TimingRecord, UserSettings, WorkoutSession } from '../types';
import { DEFAULT_SETTINGS } from '../utils/timing';

export const HISTORY_KEYS = {
  timingHistory: 'timing_history',
  sessionHistory: 'session_history',
  userSettings: 'user_settings',
} as const;
const KEYS = HISTORY_KEYS;

interface HistoryState {
  timingRecords: TimingRecord[];
  sessions: WorkoutSession[];
  settings: UserSettings;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  addTimingRecord: (record: TimingRecord) => Promise<void>;
  saveSession: (session: WorkoutSession) => Promise<void>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  resetLearning: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  timingRecords: [],
  sessions: [],
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  async hydrate() {
    try {
      const [timingRaw, sessionRaw, settingsRaw] = await Promise.all([
        AsyncStorage.getItem(KEYS.timingHistory),
        AsyncStorage.getItem(KEYS.sessionHistory),
        AsyncStorage.getItem(KEYS.userSettings),
      ]);
      set({
        timingRecords: timingRaw ? JSON.parse(timingRaw) : [],
        sessions: sessionRaw ? JSON.parse(sessionRaw) : [],
        settings: settingsRaw ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) } : DEFAULT_SETTINGS,
        hydrated: true,
      });
    } catch (error) {
      // Startup must not overwrite history that failed to load.
      throw error;
    }
  },

  async addTimingRecord(record) {
    const next = [...get().timingRecords, record];
    set({ timingRecords: next });
    await AsyncStorage.setItem(KEYS.timingHistory, JSON.stringify(next));
  },

  async saveSession(session) {
    // Retrying a completed checkpoint after process death must not duplicate it.
    const next = [session, ...get().sessions.filter((s) => s.id !== session.id)];
    set({ sessions: next });
    await AsyncStorage.setItem(KEYS.sessionHistory, JSON.stringify(next));
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await AsyncStorage.setItem(KEYS.userSettings, JSON.stringify(next));
  },

  async resetLearning() {
    set({ timingRecords: [] });
    await AsyncStorage.setItem(KEYS.timingHistory, JSON.stringify([]));
  },
}));
