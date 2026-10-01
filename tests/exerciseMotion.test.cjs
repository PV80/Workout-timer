const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src/data/exerciseIllustrations.ts'), 'utf8')).replace(/^export /gm, '');
const { EXERCISE_ARTWORK, getExerciseRig } = new Function(source + ';return {EXERCISE_ARTWORK,getExerciseRig}')();
const distance = (a,b) => Math.hypot(...a.map((v,i) => v-b[i]));
const ids = [...Object.keys(EXERCISE_ARTWORK), 'rest'];

test('all 23 exercise rigs and rest retain anatomical segment lengths throughout their motion', () => {
  assert.equal(Object.keys(EXERCISE_ARTWORK).length, 23);
  for (const id of ids) for (let sample=0;sample<=100;sample++) {
    const r=getExerciseRig(id,sample/100);
    assert.ok(Math.abs(distance(r.shoulder,r.hip)-34)<0.025, id+' torso');
    for(let side=0;side<2;side++) for(const [a,b,expected] of [['shoulders','elbows',19],['elbows','hands',18],['hips','knees',24],['knees','feet',24]]) {
      const actual=distance(r[a][side],r[b][side]);
      assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<0.025, `${id} ${a} to ${b} at ${sample}%: ${actual}`);
    }
  }
});

test('supported feet and grips do not slide during repetitions', () => {
  const fixedFeet=['bench-press','incline-db','skull-crushers','back-squats','deadlifts','bulgarian-split','hip-thrusts','barbell-curls','preacher-curls','lateral-raises','landmine-chest','landmine-press','rear-delt-flyes','plank','rest'];
  for(const id of fixedFeet) for(const q of [.2,.5,.8,1]) assert.deepEqual(getExerciseRig(id,q).feet,getExerciseRig(id,0).feet,id);
  for(const id of ['pull-ups','dips']) for(const q of [.2,.5,.8,1]) assert.deepEqual(getExerciseRig(id,q).hands,getExerciseRig(id,0).hands,id);
  for(const q of [.2,.5,.8,1]) {
    assert.deepEqual(getExerciseRig('landmine-lunges',q).feet[0],getExerciseRig('landmine-lunges',0).feet[0]);
    assert.deepEqual(getExerciseRig('db-rows',q).hands[0],getExerciseRig('db-rows',0).hands[0]);
    assert.deepEqual(getExerciseRig('ab-roller',q).knees,getExerciseRig('ab-roller',0).knees);
  }
});

test('weights stay at the grips and landmines keep a constant bar length', () => {
  for(const id of Object.keys(EXERCISE_ARTWORK)) for(let n=0;n<=50;n++) {
    const r=getExerciseRig(id,n/50), art=EXERCISE_ARTWORK[id];
    if(art.equipment==='landmine') assert.ok(Math.abs(distance(r.anchor,r.bar)-128)<1e-8,id);
    if(art.equipment==='barbell') {
      const mid=r.hands[0].map((v,i)=>(v+r.hands[1][i])/2);
      assert.ok(distance(mid,r.bar)<1e-8,id);
    }
    for(const weight of r.dumbbells) assert.ok(r.hands.some(hand=>distance(hand,weight)<1e-8),id);
  }
});

test('plank holds a straight shoulder hip ankle line while breathing without moving its supports', () => {
  const first=getExerciseRig('plank',0), last=getExerciseRig('plank',1);
  for(const key of ['head','shoulder','hip','shoulders','hips','hands','elbows','knees','feet']) assert.deepEqual(first[key],last[key],key);
  const ankle=[0,first.feet[0][1],first.feet[0][2]];
  assert.ok(Math.abs(distance(first.shoulder,first.hip)+distance(first.hip,ankle)-distance(first.shoulder,ankle))<1e-7);
  assert.notEqual(first.breath,last.breath);
});

test('hanging leg raises keep extended arms on the bar, feet clear, and the trunk still', () => {
  const initial=getExerciseRig('leg-raises',0),art=EXERCISE_ARTWORK['leg-raises'];
  assert.equal(art.equipment,'pullup');
  for(let n=0;n<=100;n++) {
    const r=getExerciseRig('leg-raises',n/100);
    for(const key of ['head','shoulder','hip','hands','elbows']) assert.deepEqual(r[key],initial[key]);
    for(let side=0;side<2;side++) {
      assert.equal(r.hands[side][1],art.barHeight);
      assert.ok(Math.abs(distance(r.shoulders[side],r.hands[side])-37)<1e-8);
      assert.ok(Math.abs(distance(r.hips[side],r.feet[side])-48)<1e-8);
      assert.ok(r.feet[side][1]>=6);
    }
  }
  assert.equal(getExerciseRig('leg-raises',1).feet[0][2],48);
});

test('prone faces point down throughout the motion and supine faces still point up', () => {
  for(const id of ['plank','ab-roller','bench-press','skull-crushers']) for(let n=0;n<=100;n++) {
    const r=getExerciseRig(id,n/100),a=EXERCISE_ARTWORK[id];
    const {project}=new Function(source+';return {project}')();
    const h=project(r.head,a.yaw),s=project(r.shoulder,a.yaw);
    const angle=Math.atan2(h[0]-s[0],s[1]-h[1]);
    const noseY=Math.sin(angle)*(a.faceDown?-1:1);
    assert.ok(['plank','ab-roller'].includes(id)?noseY>0:noseY<0,id);
  }
});
