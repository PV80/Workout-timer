const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const { createStore } = require('zustand/vanilla');

// Execute the real stores/actions with only the React Native platform APIs
// mocked. Each runtime has fresh module state but shares the same disk map,
// reproducing Android destroying and recreating its JS process.
function load(file, dependencies, exported) {
  let source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  source = source.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm, '');
  source = stripTypeScriptTypes(source).replace(/^export\s+/gm, '');
  return new Function(...Object.keys(dependencies), source + '\nreturn {' + exported.join(',') + '};')(...Object.values(dependencies));
}

const workout = {
  day: 'monday', dayOfWeek: 1, name: 'MONDAY', muscleGroups: 'Test',
  exercises: [
    { id: 'bench', name: 'Bench', type: 'TIER1', sets: 2, reps: '8-10' },
    { id: 'plank', name: 'Plank', type: 'TIMED', sets: 1, reps: '1 min' },
    { id: 'cardio', name: 'Rowing', type: 'CARDIO', sets: 1, reps: '10 min' },
    { id: 'dips', name: 'Dips', type: 'AMRAP', sets: 1, reps: 'Failure' },
  ],
};
const startTime = Date.parse('2026-10-01T12:00:00Z');

function runtime(disk = new Map(), initialTime = startTime) {
  let now = initialTime;
  const writes = [];
  let failureKey = null;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const storage = {
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => {
      if (failureKey === key) throw new Error('Storage unavailable');
      writes.push({ key, value }); disk.set(key, value);
    },
    removeItem: async key => {
      if (failureKey === key) throw new Error('Storage unavailable');
      disk.delete(key);
    },
  };
  const create = initialize => createStore(initialize);
  const persistence = load('src/utils/activeWorkout.ts', {}, ['ACTIVE_WORKOUT_KEY', 'readActiveWorkout', 'createWorkoutPersistence']);
  const timing = load('src/utils/timing.ts', {}, ['DEFAULT_SETTINGS', 'getAdaptedTiming', 'getAdaptedTransition']);
  const notifications = [];
  const native = {
    ALERT_ID: 'phase-alert', ONGOING_ID: 'workout-ongoing',
    ACTION_DONE: 'done', ACTION_NEXT_SET: 'next-set', ACTION_NEXT_EXERCISE: 'next-exercise',
    cancelAlert: async () => {}, dismissOngoing: async () => {},
    scheduleAlert: async (seconds, title) => { notifications.push({ seconds, title }); return 'phase-alert'; },
    presentOngoing: async (title, body, opts) => { notifications.push({ title, opts }); return 'ongoing'; },
  };
  const ws = load('src/store/workoutStore.ts', { create, AsyncStorage: storage, ...persistence, ...native, Date: Clock }, ['useWorkoutStore', 'hydrateWorkout', 'flushWorkout', 'retryWorkoutSave', 'getNextExercise', 'waitForWorkoutNotifications']);
  const hs = load('src/store/historyStore.ts', { create, AsyncStorage: storage, DEFAULT_SETTINGS: timing.DEFAULT_SETTINGS }, ['useHistoryStore', 'HISTORY_KEYS']);
  const recovery = load('src/utils/workoutRecovery.ts', { ...ws, ...hs, Date: Clock }, ['ensureWorkoutReady', 'saveFinishedWorkout']);
  const actions = load('src/utils/workoutActions.ts', { ...ws, ...hs, ...timing, ...recovery, Date: Clock, stopAlert: () => {}, router: { replace: () => {} } }, ['completeCurrentSet', 'startNextSet', 'skipBreak', 'continueToNextExercise']);
  let background;
  load('src/utils/notificationHandlers.ts', {
    ...actions, ...native, ...ws, ...recovery, EventType: { ACTION_PRESS: 1 },
    notifee: { onForegroundEvent: () => {}, onBackgroundEvent: fn => { background = fn; } },
  }, []);
  return {
    ...ws, ...hs, ...recovery, ...actions, disk, writes, notifications, storage,
    tick: seconds => { now += seconds * 1000; }, now: () => now,
    fail: key => { failureKey = key; },
    background: id => background({ type: 1, detail: { pressAction: { id } } }),
    async start(programme = workout, index = 0) {
      await recovery.ensureWorkoutReady();
      ws.useWorkoutStore.getState().startWorkout(programme, 'session-1', index);
      const ex = programme.exercises[ws.useWorkoutStore.getState().currentExerciseIndex];
      ws.useWorkoutStore.getState().startSet(timing.getAdaptedTiming(ex.id, ex.type, [], timing.DEFAULT_SETTINGS).setDuration);
      await ws.flushWorkout();
    },
  };
}

test('restart preserves all earlier sets, rest durations, and session identity through final CSV export', async () => {
  let r = runtime();
  await r.start();
  r.tick(40); await r.completeCurrentSet();
  r.tick(90); await r.startNextSet();
  const phaseStart = r.useWorkoutStore.getState().phaseStartedAt;
  r.tick(300);
  r = runtime(r.disk, r.now());
  await r.ensureWorkoutReady();
  let state = r.useWorkoutStore.getState();
  assert.equal(state.sessionId, 'session-1');
  assert.equal(state.sessionStartedAt, startTime);
  assert.equal(state.currentSetNumber, 2);
  assert.equal(state.phaseStartedAt, phaseStart);
  assert.equal(state.setRecords[0].actualSetDuration, 40);
  assert.equal(state.setRecords[0].actualBreakDuration, 90);
  await r.completeCurrentSet();
  assert.equal(r.useWorkoutStore.getState().currentPhase, 'transition');
  r.tick(15); await r.continueToNextExercise(true);
  assert.equal(r.useWorkoutStore.getState().currentPhase, 'timed');
  r.tick(60); await r.completeCurrentSet();
  r.tick(10); await r.continueToNextExercise(true);
  assert.equal(r.useWorkoutStore.getState().currentExerciseIndex, 3);
  assert.equal(r.useWorkoutStore.getState().currentPhase, 'amrap');
  r.tick(45); await r.completeCurrentSet();
  const session = r.useHistoryStore.getState().sessions[0];
  assert.equal(session.id, 'session-1');
  assert.equal(session.setRecords.length, 4);
  assert.equal(session.setRecords[0].actualSetDuration, 40);
  assert.equal(r.disk.has('active_workout'), false);
  const week = load('src/utils/week.ts', {}, ['weekKey']);
  const { buildWeekCsv } = load('src/utils/csv.ts', week, ['buildWeekCsv']);
  const csv = buildWeekCsv([{
    id: 'page', capturedAt: session.date, weekKey: week.weekKey(new Date(session.date)), day: 'Monday',
    exercises: [{ name: 'Bench', sets: [{ setNumber: 1, reps: 8, weight: 60 }] }],
  }], [], [session]);
  assert.equal(csv.split('\n')[1].split(',')[11], '40');
});

for (const phase of ['set', 'break', 'transition', 'timed', 'amrap', 'paused']) {
  test(`restart restores ${phase} phase without restarting its clock`, async () => {
    const r = runtime();
    await r.start(workout, phase === 'timed' ? 1 : phase === 'amrap' ? 3 : 0);
    const s = r.useWorkoutStore.getState();
    r.tick(20);
    if (phase === 'break') s.startBreak(150);
    if (phase === 'transition') s.startTransition(180);
    if (phase === 'paused') s.pause();
    s.dismissWarning();
    await r.flushWorkout();
    const before = r.useWorkoutStore.getState();
    const restarted = runtime(r.disk, r.now() + 300000);
    await restarted.ensureWorkoutReady();
    const after = restarted.useWorkoutStore.getState();
    for (const key of ['sessionId', 'sessionStartedAt', 'currentExerciseIndex', 'currentSetNumber', 'currentPhase', 'phaseStartedAt', 'targetDuration', 'pausedAt', 'warningDismissed']) {
      assert.equal(after[key], before[key], key);
    }
    after.restoreNotifications();
    await new Promise(resolve => setImmediate(resolve));
    if (phase === 'paused') {
      assert.equal(restarted.notifications.some(n => n.title === 'Paused'), true);
      after.resume();
      assert.equal(restarted.now() - restarted.useWorkoutStore.getState().phaseStartedAt, 20000);
    } else {
      assert.equal(restarted.notifications.some(n => n.opts?.chronometer), true);
    }
  });
}

test('cold lock-screen action hydrates records before advancing and saves before returning', async () => {
  const r = runtime(); await r.start();
  r.tick(30); await r.completeCurrentSet();
  const restarted = runtime(r.disk, r.now() + 90000);
  await restarted.background('next-set');
  const saved = JSON.parse(r.disk.get('active_workout')).state;
  assert.equal(saved.currentPhase, 'set');
  assert.equal(saved.currentSetNumber, 2);
  assert.equal(saved.setRecords[0].actualSetDuration, 30);
  assert.equal(saved.setRecords[0].actualBreakDuration, 90);
});

test('completed record and next phase are checkpointed atomically; repeated taps do not duplicate it', async () => {
  const r = runtime(); await r.start(); r.tick(30);
  const results = await Promise.all([r.completeCurrentSet(), r.completeCurrentSet()]);
  assert.deepEqual(results, ['break', 'noop']);
  assert.equal(r.useWorkoutStore.getState().setRecords.length, 1);
  for (const write of r.writes.filter(w => w.key === 'active_workout')) {
    const s = JSON.parse(write.value).state;
    assert.equal(s.setRecords.length === 1 && s.currentPhase === 'set' && s.currentSetNumber === 1, false);
  }
  r.tick(90);
  await Promise.all([r.startNextSet(), r.startNextSet()]);
  assert.equal(r.useWorkoutStore.getState().currentSetNumber, 2);
});

test('restart completes a final checkpoint whose session-history write failed', async () => {
  const r = runtime(); await r.start(workout, 3); r.tick(30);
  r.fail('session_history');
  await assert.rejects(r.completeCurrentSet());
  assert.equal(JSON.parse(r.disk.get('active_workout')).state.finishPending, true);
  const restarted = runtime(r.disk, r.now() + 3600000);
  await restarted.ensureWorkoutReady();
  assert.equal(restarted.useHistoryStore.getState().sessions.length, 1);
  assert.equal(restarted.useHistoryStore.getState().sessions[0].totalDuration, 30);
  assert.equal(restarted.disk.has('active_workout'), false);
});

test('restart after history saved but checkpoint clear failed does not duplicate the session', async () => {
  const r = runtime(); await r.start(workout, 3); r.tick(30);
  // Final checkpoint save must succeed, only the subsequent removal fails.
  const originalRemove = r.disk.delete.bind(r.disk);
  r.disk.delete = key => { if (key === 'active_workout') throw new Error('Interrupted clear'); return originalRemove(key); };
  await assert.rejects(r.completeCurrentSet());
  r.disk.delete = originalRemove;
  const restarted = runtime(r.disk, r.now());
  await restarted.ensureWorkoutReady();
  assert.equal(restarted.useHistoryStore.getState().sessions.length, 1);
  assert.equal(restarted.useWorkoutStore.getState().activeWorkout, null);
  assert.equal(restarted.disk.has('active_workout'), false);
});

test('abandoning a workout clears its saved checkpoint', async () => {
  const r = runtime(); await r.start();
  r.useWorkoutStore.getState().abandonWorkout(); await r.flushWorkout();
  const restarted = runtime(r.disk); await restarted.ensureWorkoutReady();
  assert.equal(restarted.useWorkoutStore.getState().activeWorkout, null);
});

test('unreadable checkpoint is retained and hydration can be retried', async () => {
  const r = runtime(new Map([['active_workout', '{broken-json']]));
  await assert.rejects(r.ensureWorkoutReady());
  assert.equal(r.useWorkoutStore.getState().hydrated, false);
  assert.equal(r.disk.get('active_workout'), '{broken-json');
  r.disk.delete('active_workout');
  await r.ensureWorkoutReady();
  assert.equal(r.useWorkoutStore.getState().hydrated, true);
});

test('failed checkpoint write is surfaced and can be retried without dropping progress', async () => {
  const r = runtime(); await r.start(); r.fail('active_workout');
  r.tick(20); await assert.rejects(r.completeCurrentSet());
  assert.equal(r.useWorkoutStore.getState().saveError, true);
  assert.equal(r.useWorkoutStore.getState().setRecords.length, 1);
  r.fail(null); await r.retryWorkoutSave();
  assert.equal(r.useWorkoutStore.getState().saveError, false);
  const restarted = runtime(r.disk); await restarted.ensureWorkoutReady();
  assert.equal(restarted.useWorkoutStore.getState().setRecords.length, 1);
});

test('ordered writes prevent an older set overwriting a newer rest checkpoint', async () => {
  const { createWorkoutPersistence } = load('src/utils/activeWorkout.ts', {}, ['createWorkoutPersistence']);
  const disk = new Map(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  const persistence = createWorkoutPersistence({
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => { if (first) { first = false; await gate; } disk.set(key, value); },
    removeItem: async key => disk.delete(key),
  }, () => {});
  persistence.save({ currentPhase: 'set' });
  persistence.save({ currentPhase: 'break' });
  await new Promise(resolve => setImmediate(resolve));
  release(); await persistence.flush();
  assert.equal(JSON.parse(disk.get('active_workout')).state.currentPhase, 'break');
});

test('simultaneous UI and background hydration share one load and do not overwrite progress', async () => {
  const r = runtime(); await r.start(); r.tick(20); await r.completeCurrentSet();
  const saved = r.disk.get('active_workout');
  const restarted = runtime(r.disk);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const getItem = restarted.storage.getItem;
  let loads = 0;
  restarted.storage.getItem = async key => {
    if (key === 'active_workout') { loads++; await gate; }
    return getItem(key);
  };
  const ui = restarted.ensureWorkoutReady();
  const background = restarted.ensureWorkoutReady();
  assert.equal(ui, background);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.useWorkoutStore.getState().hydrated, false);
  assert.equal(r.disk.get('active_workout'), saved);
  release(); await Promise.all([ui, background]);
  assert.equal(loads, 1);
  assert.equal(restarted.useWorkoutStore.getState().setRecords.length, 1);
});

test('history load failure blocks recovery instead of overwriting previous sessions', async () => {
  const r = runtime(new Map([['session_history', '{unreadable-history']]));
  await assert.rejects(r.ensureWorkoutReady());
  assert.equal(r.useHistoryStore.getState().hydrated, false);
  assert.equal(r.disk.get('session_history'), '{unreadable-history');
  assert.equal(r.disk.has('active_workout'), false);
});
