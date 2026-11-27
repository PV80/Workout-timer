const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
function load(file,deps,exports){
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm,'')).replace(/^export\s+/gm,'');
  return new Function(...Object.keys(deps),source+';return {'+exports+'}')(...Object.values(deps));
}
const {weekKey,localDate}=load('src/utils/week.ts',{},'weekKey,localDate');
const {buildWeekCsv}=load('src/utils/csv.ts',{weekKey,localDate},'buildWeekCsv');
const {assertValidBackup}=load('src/utils/backupValidation.ts',{},'assertValidBackup');
const {DEFAULT_SETTINGS}=load('src/utils/timing.ts',{},'DEFAULT_SETTINGS');
const date='2026-10-01T12:00:00Z',week=weekKey(new Date(date));
const record=(id='bench',name='Flat Barbell Bench Press',seconds=42)=>({exerciseId:id,exerciseName:name,setNumber:1,predictedSetDuration:60,actualSetDuration:seconds,predictedBreakDuration:90,actualBreakDuration:80,completedAt:date});
const session=(id='session-1',setRecords=[record()])=>({id,day:'monday',date,totalDuration:150,exercisesCompleted:1,setRecords});
const entry=name=>({id:'page-1',capturedAt:date,weekKey:week,day:'Monday',exercises:[{name,sets:[{setNumber:1,reps:8,weight:40}]}]});
const backup=()=>({app:'workout-timer',backupVersion:1,exportedAt:date,settings:DEFAULT_SETTINGS,sessions:[session()],timingRecords:[{exerciseId:'bench',setNumber:0,setDuration:null,breakDuration:110,date,sessionId:'session-1',transition:true}],trackerEntries:[entry('Flat Barbell Bench Press')],bodyweights:[{id:'weight-1',date,weekKey:week,kg:82.5}]});

test('valid full backup accepts transition records and legacy exercise names',()=>assert.doesNotThrow(()=>assertValidBackup(backup())));
test('missing collections, nested corrupt records, duplicate IDs and invalid settings are rejected',()=>{
  for(const corrupt of [b=>delete b.sessions,b=>b.sessions[0].setRecords=null,b=>b.trackerEntries[0].exercises[0].sets[0].weight='40',b=>b.sessions.push(b.sessions[0]),b=>b.settings={...b.settings,standardSetDuration:-1},b=>b.bodyweights[0].kg=Infinity,b=>b.timingRecords[0].setNumber=1,b=>b.backupVersion=0]) {
    const b=backup();corrupt(b);assert.throws(()=>assertValidBackup(b),/invalid|incomplete/);
  }
});
test('invalid backup and restore during active workout perform no storage writes',async()=>{
  let writes=0,active=null;
  const deps={assertValidBackup,AsyncStorage:{multiSet:async()=>{writes++}},HISTORY_KEYS:{},TRACKER_KEYS:{},useWorkoutStore:{getState:()=>({activeWorkout:active})}};
  const {restoreFromBackupJson}=load('src/utils/backup.ts',deps,'restoreFromBackupJson');
  const b=backup();delete b.sessions;
  await assert.rejects(restoreFromBackupJson(JSON.stringify(b)),/incomplete/);
  active={};await assert.rejects(restoreFromBackupJson(JSON.stringify(backup())),/active workout/);
  assert.equal(writes,0);
});
test('timer-only sessions and unmatched sets survive CSV export',()=>{
  const csv=buildWeekCsv([],[],[session('s1',[record(),record('plank','Plank',60)])]);
  assert.equal(csv.split('\n').length,3);assert.match(csv,/Flat Barbell Bench Press,,1,,,,42/);assert.match(csv,/Plank,,1,,,,60/);
});
test('matched photographed sets are joined once, while older restarted sessions remain available',()=>{
  const newer={...session('new',[record('bench','Flat Barbell Bench Press',55)]),date:'2026-10-01T13:00:00Z'};
  const csv=buildWeekCsv([entry('Flat BB Bench Press')],[],[session(),newer]);
  assert.equal(csv.split('\n').length,3);assert.match(csv,/,8,40,,55,/);assert.match(csv,/Timer record; session session-1/);
});
test('shared words do not attach bench times to military press, and exact names outrank fuzzy matches',()=>{
  const csv=buildWeekCsv([entry('Military Press')],[],[session()]);
  assert.equal(csv.split('\n')[1].split(',')[11],'');
  const exact=buildWeekCsv([entry('Incline Dumbbell Bench')],[],[session('s1',[record('flat','Flat Dumbbell Bench',41),record('incline','Incline Dumbbell Bench',61)])]);
  assert.equal(exact.split('\n')[1].split(',')[11],'61');
});
test('ambiguous photographed exercise names retain separate timing rows',()=>{
  const csv=buildWeekCsv([entry('Dumbbell Bench')],[],[session('s1',[record('flat','Flat Dumbbell Bench',41),record('incline','Incline Dumbbell Bench',61)])]);
  assert.equal(csv.split('\n').length,4);assert.equal(csv.split('\n')[1].split(',')[11],'');
});
test('carriage returns, commas and quotes in tracker notes are CSV escaped',()=>{
  const page=entry('Bench');page.exercises[0].sets[0].notes='first\rsecond,"quoted"';
  assert.ok(buildWeekCsv([page]).includes('"first\rsecond,""quoted"""'));
});
function exporter({sharing=true,failShare=false,failWrite=false,sessions=[session()]}={}) {
  const writes=[],marks=[],reminders=[],shares=[];
  const module=load('src/utils/exportWeek.ts',{
    weekKey:()=>week,buildWeekCsv,buildBackup:backup,
    useHistoryStore:{getState:()=>({sessions})},
    useTrackerStore:{getState:()=>({entries:[],bodyweights:[],markExported:async w=>marks.push(w)})},
    ensureWeeklyExportReminder:async w=>reminders.push(w),
    FileSystem:{cacheDirectory:'cache/',EncodingType:{UTF8:'utf8'},writeAsStringAsync:async(uri,data)=>{if(failWrite)throw Error('disk');writes.push({uri,data})}},
    Sharing:{isAvailableAsync:async()=>sharing,shareAsync:async uri=>{if(failShare)throw Error('share');shares.push(uri)}},
  },'exportWeekFiles,exportCurrentWeek');
  return {...module,writes,marks,reminders,shares};
}
test('current-week export works without tracker photos and includes a full JSON backup',async()=>{
  const r=exporter();assert.equal(await r.exportCurrentWeek(),'shared');assert.equal(r.writes.length,2);assert.equal(r.shares.length,2);assert.deepEqual(r.marks,[week]);assertValidBackup(JSON.parse(r.writes[1].data));
});
test('previous-week export does not silence the current-week reminder',async()=>{
  const r=exporter();await r.exportWeekFiles([entry('Bench')],[],'previous-weeks');assert.deepEqual(r.marks,[]);assert.deepEqual(r.reminders,[]);
});
test('failed sharing or file writing never marks the week exported',async()=>{
  for(const options of [{failShare:true},{failWrite:true}]){const r=exporter(options);await assert.rejects(r.exportCurrentWeek());assert.deepEqual(r.marks,[]);}
});
test('unavailable sharing returns cache paths without suppressing reminders',async()=>{
  const r=exporter({sharing:false});assert.ok((await r.exportCurrentWeek()).savedTo);assert.deepEqual(r.marks,[]);
});
test('weekly export filters timer sessions to the requested week',async()=>{
  // This case uses the real week function so historical sessions cannot leak into this week.
  const writes=[];
  const {exportWeekFiles}=load('src/utils/exportWeek.ts',{weekKey,buildWeekCsv,buildBackup:backup,useHistoryStore:{getState:()=>({sessions:[session(),{...session('old'),date:'2026-09-01T12:00:00Z'}]})},useTrackerStore:{getState:()=>({markExported:async()=>{}})},ensureWeeklyExportReminder:async()=>{},FileSystem:{cacheDirectory:'cache/',EncodingType:{UTF8:'utf8'},writeAsStringAsync:async(uri,data)=>writes.push(data)},Sharing:{isAvailableAsync:async()=>false}},'exportWeekFiles');
  await exportWeekFiles([],[],week);assert.match(writes[0],/session-1/);assert.doesNotMatch(writes[0],/session old/);
});

function trackerRuntime(){
  const {createStore}=require('zustand/vanilla');let fail=false,serial=0;const disk=new Map();
  const storage={getItem:async k=>{if(fail)throw Error('storage');return disk.get(k)??null},setItem:async(k,v)=>{if(fail)throw Error('storage');await new Promise(r=>setTimeout(r,2));disk.set(k,v)},multiSet:async pairs=>{if(fail)throw Error('storage');for(const [k,v] of pairs)disk.set(k,v)}};
  const m=load('src/store/trackerStore.ts',{create:createStore,AsyncStorage:storage,Crypto:{randomUUID:()=>`id-${++serial}`},weekKey},'useTrackerStore,TRACKER_KEYS');
  return {...m,disk,fail:v=>{fail=v}};
}
test('concurrent tracker saves preserve both entries on disk and retry does not duplicate an ID',async()=>{
  const r=trackerRuntime(),s=r.useTrackerStore.getState(),a=entry('Bench'),b={...entry('Plank'),id:'page-2'};
  await Promise.all([s.addEntry(a),s.addEntry(b)]);await s.addEntry(a);
  assert.equal(r.useTrackerStore.getState().entries.length,2);assert.equal(JSON.parse(r.disk.get(r.TRACKER_KEYS.entries)).length,2);
});
test('failed tracker writes retain previous state and allow successful retry',async()=>{
  const r=trackerRuntime(),s=r.useTrackerStore.getState();await s.addEntry(entry('Bench'));r.fail(true);
  await assert.rejects(s.deleteEntry('page-1'));assert.equal(r.useTrackerStore.getState().entries.length,1);
  await assert.rejects(s.addBodyweight(82));assert.equal(r.useTrackerStore.getState().bodyweights.length,0);
  r.fail(false);await s.addBodyweight(82);assert.equal(r.useTrackerStore.getState().bodyweights.length,1);
});
test('tracker load failures keep startup blocked instead of replacing prior data',async()=>{
  const r=trackerRuntime();r.fail(true);await assert.rejects(r.useTrackerStore.getState().hydrate());assert.equal(r.useTrackerStore.getState().hydrated,false);
  r.fail(false);r.disk.set(r.TRACKER_KEYS.entries,'{}');await assert.rejects(r.useTrackerStore.getState().hydrate());assert.equal(r.useTrackerStore.getState().hydrated,false);
});
test('clearing previous weeks retains current and future tracker records',async()=>{
  const r=trackerRuntime(),s=r.useTrackerStore.getState();
  for(const [id,w] of [['old','2026-W39'],['current','2026-W40'],['future','2026-W41']])await s.addEntry({...entry('Bench'),id,weekKey:w});
  await s.clearWeeksBefore('2026-W40');assert.deepEqual(r.useTrackerStore.getState().entries.map(e=>e.id),['future','current']);
});

const workout = { id: 'tue-am', day: 'tuesday', date: '2026-09-22T09:00:00Z' };
function pageCapture() {
  const tracker = trackerRuntime();
  const files = new Map(), album = new Map(), calls = [], reads = [];
  const config = { cancel: false, cameraAllowed: true, albumFails: false, readFails: false };
  let id = 0;
  const pick = source => async () => {
    calls.push(source);
    return config.cancel ? { canceled: true } : { assets: [{ base64: 'jpeg-' + id }] };
  };
  const capture = load('src/utils/trackerCapture.ts', {
    useTrackerStore: tracker.useTrackerStore, weekKey, localDate,
    Crypto: { randomUUID: () => '4d1f9900-abba-4444-8000-' + String(++id).padStart(12, '0') },
    ImagePicker: { requestCameraPermissionsAsync: async () => ({ granted: config.cameraAllowed }),
      launchCameraAsync: pick('camera'), launchImageLibraryAsync: pick('library') },
    writeTrackerPhoto: async (id, jpeg) => files.set(id, jpeg), readTrackerPhoto: async id => files.get(id),
    discardPrivatePhoto: async id => files.delete(id),
    copyToTrackerAlbum: async photo => {
      if (config.albumFails) throw Error('gallery unavailable');
      album.set(photo.id, files.get(photo.id));
    },
    parseTrackerImage: async (jpeg, key, selection) => {
      reads.push({ jpeg, key, selection });
      if (config.readFails) throw Error('offline');
      return { month: 'September', day: 'Tuesday', weekNumber: 2, exercises: entry('Squat').exercises };
    },
  }, 'runTrackerCapture,savePhoneCopy,readPageEntries,linkTrackerEntry');
  return { ...capture, ...tracker, state: () => tracker.useTrackerStore.getState(), files, album, calls, reads, config };
}

test('late camera capture attaches to the exact workout, saves a JPEG without a key, and reads the selected column later', async () => {
  const r = pageCapture();
  const result = await r.runTrackerCapture('camera', workout, 2);
  assert.equal(result.status, 'saved');
  const saved = r.state().entries[0];
  assert.equal(saved.sessionId, workout.id); assert.equal(saved.workoutDate, '2026-09-22');
  assert.equal(saved.weekKey, '2026-W39'); assert.notEqual(saved.capturedAt, workout.date);
  assert.equal(saved.photo.date, saved.workoutDate); assert.equal(saved.photo.inAlbum, true);
  assert.equal(saved.photo.needsReading, true); assert.equal(r.files.get(saved.photo.id), r.album.get(saved.photo.id));
  assert.deepEqual(r.calls, ['camera']); assert.equal(r.reads.length, 0);
  await r.state().setApiKey('test-key'); await r.readPageEntries(saved);
  assert.deepEqual(r.reads[0].selection, { date: saved.workoutDate, historical: true, column: 2 });
  assert.equal(r.state().entries.length, 1); assert.equal(r.state().entries[0].photo.needsReading, false);
});

test('gallery and OCR failures preserve the attached file and both operations can be retried separately', async () => {
  const r = pageCapture(); await r.state().setApiKey('test-key');
  r.config.albumFails = true; r.config.readFails = true;
  const result = await r.runTrackerCapture('library', workout);
  assert.equal(result.status, 'saved'); assert.equal(result.notices.length, 2);
  const saved = r.state().entries[0]; assert.equal(saved.photo.inAlbum, false); assert.equal(saved.photo.needsReading, true);
  r.config.albumFails = false; r.config.readFails = false;
  await r.savePhoneCopy(saved); await r.savePhoneCopy(saved); await r.readPageEntries(saved);
  assert.equal(r.album.size, 1); assert.equal(r.state().entries.length, 1);
  assert.equal(r.state().entries[0].photo.inAlbum, true); assert.equal(r.state().entries[0].photo.needsReading, false);
});

test('cancel, denied camera access and a failed durable write leave the workout and existing page untouched', async () => {
  const r = pageCapture(); const saved = (await r.runTrackerCapture('library', workout)).entry;
  r.config.cancel = true; assert.equal((await r.runTrackerCapture('library', workout)).status, 'cancelled');
  r.config.cameraAllowed = false; assert.equal((await r.runTrackerCapture('camera', workout)).status, 'no-permission');
  r.config.cancel = false; r.fail(true);
  assert.equal((await r.runTrackerCapture('library', workout)).status, 'error');
  assert.deepEqual(r.state().entries, [saved]); assert.equal(r.files.size, 1); assert.equal(r.album.size, 1);
});

test('linking a legacy page then attaching a photo preserves its manually corrected values and avoids duplicate rows', async () => {
  const r = pageCapture(); const old = entry('Squat'); await r.state().addEntry(old);
  await r.linkTrackerEntry(old.id, workout); await r.state().setApiKey('test-key');
  await r.runTrackerCapture('library', workout);
  const [page] = r.state().entries; assert.equal(page.id, old.id); assert.deepEqual(page.exercises, old.exercises);
  assert.ok(page.photo); assert.equal(r.reads.length, 0); assert.equal(r.state().entries.length, 1);
  await r.state().clearWeeksBefore('2026-W48');
  assert.equal(r.state().entries[0].archived, true); assert.equal(r.state().entries[0].sessionId, workout.id);
});

test('a photo reading that finishes after a retake cannot overwrite the replacement', async () => {
  const r = pageCapture(); const first = (await r.runTrackerCapture('library', workout)).entry;
  const second = (await r.runTrackerCapture('library', workout)).entry;
  await r.state().setApiKey('test-key');
  await assert.rejects(r.readPageEntries(first), /changed/);
  assert.deepEqual(r.state().entries, [second]); assert.equal(r.album.size, 2);
});

test('linked exports choose the selected session on a repeated day, preserve other timers, and keep the capture and workout dates distinct', () => {
  const early = { ...workout, setRecords: [record('squat', 'Squat', 29)] };
  const late = { ...early, id: 'tue-pm', date: '2026-09-22T16:00:00Z', setRecords: [record('squat', 'Squat', 54)] };
  const page = { ...entry('Squat'), sessionId: early.id, workoutDate: '2026-09-22', weekKey: '2026-W39', day: 'Misread heading' };
  const rows = buildWeekCsv([page], [], [late, early]).split('\n').slice(1).map(r => r.split(','));
  assert.equal(rows.length, 2); assert.equal(rows[0][0], date.slice(0, 10)); assert.equal(rows[0][11], '29');
  assert.deepEqual(rows[0].slice(-2), ['2026-09-22', early.id]); assert.equal(rows[1][11], '54');
  assert.equal(buildWeekCsv([{ ...page, sessionId: 'unknown' }], [], [early]).split('\n')[1].split(',')[11], '');
});

test('a later or blank week column cannot replace the requested handwritten sets', async () => {
  const r = pageCapture(); await r.state().setApiKey('test-key');
  const result = await r.runTrackerCapture('camera', workout, 1);
  assert.equal(result.status, 'saved'); assert.equal(r.state().entries[0].exercises.length, 0);
  assert.equal(r.state().entries[0].photo.needsReading, true); assert.ok(r.state().entries[0].photo.inAlbum);
});

test('a restored photo link accepts a dated ID, rejects paths and impossible dates, and legacy backups still load', async () => {
  const r = pageCapture(); const result = await r.runTrackerCapture('camera', workout);
  const b = backup(); b.trackerEntries = [result.entry]; assert.doesNotThrow(() => assertValidBackup(b));
  b.trackerEntries[0].photo.date = '2026-11-31'; assert.throws(() => assertValidBackup(b));
  b.trackerEntries[0].photo.date = '2026-11-27'; b.trackerEntries[0].photo.id = '../data'; assert.throws(() => assertValidBackup(b));
});

test('Excel receives UTF-8 CSV with a single BOM so printed week headings and multiplication signs survive', async () => {
  const r = exporter(); await r.exportWeekFiles([{ ...entry('Legs — 4×8'), day: 'TUESDAY — Legs' }], [], week);
  assert.ok(r.writes[0].data.startsWith('\uFEFFcaptured,')); assert.match(r.writes[0].data, /TUESDAY — Legs/);
});
