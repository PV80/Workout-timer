const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
function load(file,deps,exports){
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm,'')).replace(/^export\s+/gm,'');
  return new Function(...Object.keys(deps),source+';return {'+exports+'}')(...Object.values(deps));
}
const {weekKey}=load('src/utils/week.ts',{},'weekKey');
const {buildWeekCsv}=load('src/utils/csv.ts',{weekKey},'buildWeekCsv');
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
