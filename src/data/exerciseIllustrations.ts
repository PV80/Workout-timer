/**
 * Exercise-specific 3D joint rigs, projected to transparent SVG.
 * Angles/targets move; bone lengths do not interpolate. Equipment stays on its grip.
 * Form references and chosen variants: docs/exercise-motion.md.
 */
export type V3 = readonly [number, number, number];
export type Point = readonly [number, number];
export interface ExerciseArtwork {
  yaw: number;
  tempo: readonly [number, number, number, number]; // outward, hold, return, reset (ms)
  cue: string;
  equipment: 'barbell' | 'dumbbells' | 'landmine' | 'roller' | 'pullup' | 'bars' | 'none';
  bench?: 'flat' | 'incline' | 'preacher' | 'split' | 'row' | 'seat';
  floor?: boolean;
  faceDown?: boolean;
  barHeight?: number;
}
const lift = [1050, 200, 1800, 250] as const;
const lower = [1750, 200, 1150, 300] as const;
export const EXERCISE_ARTWORK: Record<string, ExerciseArtwork> = {
  'bench-press': { yaw: 58, tempo: lift, cue: 'Steady feet. Controlled press.', equipment: 'barbell', bench: 'flat' },
  'incline-db': { yaw: 48, tempo: lift, cue: 'Press up. Lower with control.', equipment: 'dumbbells', bench: 'incline' },
  'landmine-chest': { yaw: 62, tempo: lift, cue: 'Brace. Press along the arc.', equipment: 'landmine' },
  'barbell-curls': { yaw: 48, tempo: lift, cue: 'Still elbows. Smooth curl.', equipment: 'barbell' },
  'preacher-curls': { yaw: 60, tempo: lift, cue: 'Keep upper arms on the pad.', equipment: 'barbell', bench: 'preacher' },
  'leg-raises': { yaw: 65, tempo: [1400,250,2100,300], cue: 'Hang still. Raise legs. Lower slowly.', equipment: 'pullup', barHeight: 125 },
  'ab-roller': { yaw: 76, tempo: [2100,250,1700,300], cue: 'Brace. Reach. Return.', equipment: 'roller', floor: true, faceDown: true },
  'back-squats': { yaw: 58, tempo: lower, cue: 'Sit down. Drive through feet.', equipment: 'barbell' },
  'landmine-lunges': { yaw: 62, tempo: [1950,180,1450,300], cue: 'Step back. Keep the front foot set.', equipment: 'landmine' },
  'bulgarian-split': { yaw: 66, tempo: lower, cue: 'Lower steadily. Drive up.', equipment: 'dumbbells', bench: 'split' },
  'hip-thrusts': { yaw: 70, tempo: [1200,650,1800,250], cue: 'Lift through hips. Keep ribs down.', equipment: 'barbell', floor: true },
  'military-press': { yaw: 30, tempo: lift, cue: 'Brace. Press overhead.', equipment: 'barbell' },
  'landmine-press': { yaw: 60, tempo: lift, cue: 'One arm. A smooth upward arc.', equipment: 'landmine' },
  'lateral-raises': { yaw: 12, tempo: [1400,250,1950,200], cue: 'Soft elbows. Stop at shoulder height.', equipment: 'dumbbells' },
  'skull-crushers': { yaw: 60, tempo: lower, cue: 'Keep upper arms steady.', equipment: 'dumbbells', bench: 'flat' },
  'dips': { yaw: 52, tempo: lower, cue: 'Lower with control. Press up.', equipment: 'bars' },
  'oblique-twists': { yaw: 22, tempo: [1700,200,1700,200], cue: 'Turn the chest. Keep hips steady.', equipment: 'none', floor: true },
  'plank': { yaw: 74, tempo: [2400,0,2600,0], cue: 'Hold the line. Breathe.', equipment: 'none', floor: true, faceDown: true },
  'deadlifts': { yaw: 66, tempo: [1350,300,1950,500], cue: 'Bar close. Hips and knees together.', equipment: 'barbell' },
  'pull-ups': { yaw: 22, tempo: [1450,300,2100,300], cue: 'Pull smoothly. Lower fully.', equipment: 'pullup' },
  'landmine-rows': { yaw: 60, tempo: lift, cue: 'Steady hinge. Elbow toward hip.', equipment: 'landmine' },
  'db-rows': { yaw: 60, tempo: lift, cue: 'Row toward hip. Keep torso still.', equipment: 'dumbbells', bench: 'row' },
  'rear-delt-flyes': { yaw: 18, tempo: [1450,250,1950,200], cue: 'Hold the hinge. Open the arms.', equipment: 'dumbbells' },
};
export const REST_ARTWORK: ExerciseArtwork = { yaw: 55, tempo: [2500,250,3000,250], cue: 'Let your breathing settle.', equipment: 'none', bench: 'seat' };

export interface Rig {
  head: V3; shoulder: V3; hip: V3;
  shoulders: [V3,V3]; hips: [V3,V3]; elbows: [V3,V3]; hands: [V3,V3]; knees: [V3,V3]; feet: [V3,V3];
  bar: V3 | null; anchor: V3 | null; dumbbells: V3[]; roller: V3 | null; breath: number;
}
const RAD = Math.PI / 180;
export function add(a: V3, b: V3): V3 { 'worklet'; return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function sub(a: V3, b: V3): V3 { 'worklet'; return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function mul(a: V3, n: number): V3 { 'worklet'; return [a[0]*n,a[1]*n,a[2]*n]; }
function dot(a: V3, b: V3): number { 'worklet'; return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function length(a: V3): number { 'worklet'; return Math.sqrt(dot(a,a)); }
function unit(a: V3): V3 { 'worklet'; return mul(a,1/Math.max(0.0001,length(a))); }
function mix(a: number, b: number, q: number): number { 'worklet'; return a+(b-a)*q; }
export function project(p: V3, yaw: number): Point {
  'worklet'; const angle=yaw*RAD;
  return [96+p[0]*Math.cos(angle)+p[2]*Math.sin(angle),136-p[1]+(p[2]*Math.cos(angle)-p[0]*Math.sin(angle))*0.10];
}
/** Two-bone inverse kinematics with a pole selecting the anatomical bend plane. */
export function joint(root: V3, end: V3, upper: number, lower: number, pole: V3): V3 {
  'worklet';
  const delta=sub(end,root), distance=Math.max(0.0001,length(delta)), axis=unit(delta);
  const d=Math.max(Math.abs(upper-lower)+0.0001,Math.min(upper+lower,distance));
  const along=(upper*upper-lower*lower+d*d)/(2*d);
  let perpendicular=sub(pole,mul(axis,dot(pole,axis)));
  if(length(perpendicular)<0.001) perpendicular=sub([1,0,0],mul(axis,axis[0]));
  return add(add(root,mul(axis,along)),mul(unit(perpendicular),Math.sqrt(Math.max(0,upper*upper-along*along))));
}
function arm(r: Rig, side: number, hand: V3, pole: V3 = [0,0,1]) {
  'worklet'; r.hands[side]=hand; r.elbows[side]=joint(r.shoulders[side],hand,19,18,pole);
}
function leg(r: Rig, side: number, foot: V3, pole: V3 = [0,0,1]) {
  'worklet'; r.feet[side]=foot; r.knees[side]=joint(r.hips[side],foot,24,24,pole);
}
function body(hip: V3, shoulder: V3, twist=0): Rig {
  'worklet';
  const direction=unit(sub(shoulder,hip));
  const across: V3=[Math.cos(twist),0,Math.sin(twist)];
  const shoulders: [V3,V3]=[add(shoulder,mul(across,-10)),add(shoulder,mul(across,10))];
  const hips: [V3,V3]=[add(hip,[-6,0,0]),add(hip,[6,0,0])];
  return { head:add(shoulder,mul(direction,13)),shoulder,hip,shoulders,hips,
    elbows:[shoulders[0],shoulders[1]],hands:[shoulders[0],shoulders[1]],knees:[hips[0],hips[1]],feet:[hips[0],hips[1]],
    bar:null,anchor:null,dumbbells:[],roller:null,breath:0 };
}
function standing(hip: V3=[0,53.4,0], lean=0): Rig {
  'worklet'; const r=body(hip,add(hip,[0,34*Math.cos(lean),34*Math.sin(lean)]));
  leg(r,0,[-9,6,5]);leg(r,1,[9,6,5]);
  for(let i=0;i<2;i++){const side=i===0?-1:1;arm(r,i,add(r.shoulders[i],[side*3,-36,3]));}
  return r;
}
function barGrip(r: Rig, centre: V3, halfWidth: number, pole: V3=[0,-1,0]) {
  'worklet'; r.bar=centre;
  arm(r,0,add(centre,[-halfWidth,0,0]),pole);arm(r,1,add(centre,[halfWidth,0,0]),pole);
}
function bench(incline=false): Rig {
  'worklet';
  const hip: V3=[0,45,4], shoulder: V3=incline?[0,62,-25.445]:[0,45,-30];
  const r=body(hip,shoulder);leg(r,0,[-9,6,28]);leg(r,1,[9,6,28]);return r;
}
function landmine(y: number, x=0, anchorZ=100, radius=128): V3 {
  'worklet'; return [x,y,anchorZ-Math.sqrt(radius*radius-y*y)];
}
/** q is the eased exercise phase, 0→1→0. Holds move only the breath field. */
export function getExerciseRig(id: string, q: number): Rig {
  'worklet';
  let r=standing();
  if(id==='rest') {
    r=body([0,41,-5],[0,75,-5]);
    leg(r,0,[-9,6,26]);leg(r,1,[9,6,26]);
    arm(r,0,[-9,44,13],[0,0,1]);arm(r,1,[9,44,13],[0,0,1]);r.breath=q;return r;
  }
  if(id==='bench-press'||id==='incline-db'||id==='skull-crushers') {
    r=bench(id==='incline-db');
    if(id==='bench-press') barGrip(r,[0,mix(50,78,q),mix(-23,-29,q)],21);
    else if(id==='incline-db') {
      for(let i=0;i<2;i++){const side=i===0?-1:1;arm(r,i,[side*mix(23,15,q),mix(64,97,q),mix(-16,-22,q)],[side*0.25,-1,0]);}
      r.dumbbells=[r.hands[0],r.hands[1]];
    } else {
      // The upper arm stays nearly vertical; only the forearm rotates beside the head.
      for(let i=0;i<2;i++){
        const elbow=add(r.shoulders[i],[0,18.34,-4.965]);
        const angle=mix(10,110,q)*RAD;
        r.elbows[i]=elbow;r.hands[i]=add(elbow,[0,18*Math.cos(angle),-18*Math.sin(angle)]);
      }
      r.dumbbells=[r.hands[0],r.hands[1]];
    }
  } else if(id==='military-press') {
    barGrip(r,[0,mix(86,122,q),mix(9,0,q)],22,[0,-1,1]);
  } else if(id==='barbell-curls'||id==='preacher-curls') {
    if(id==='preacher-curls'){
      r=body([0,45,-10],[0,78.49,-4.1]);leg(r,0,[-9,6,17]);leg(r,1,[9,6,17]);
    }
    for(let i=0;i<2;i++){
      const a=id==='preacher-curls'?40*RAD:5*RAD;
      const elbow=add(r.shoulders[i],[0,-19*Math.cos(a),19*Math.sin(a)]);
      const angle=mix(id==='preacher-curls'?40:8,145,q)*RAD;
      r.elbows[i]=elbow;r.hands[i]=add(elbow,[0,-18*Math.cos(angle),18*Math.sin(angle)]);
    }
    r.bar=mul(add(r.hands[0],r.hands[1]),0.5);
  } else if(id==='landmine-chest'||id==='landmine-press') {
    const single=id==='landmine-press';r.anchor=[single?10:0,0,100];r.bar=landmine(mix(80,104,q),single?10:0);
    if(single){arm(r,1,r.bar,[0,-1,0]);arm(r,0,[-8,66,8],[0,-1,0]);}
    else {arm(r,0,add(r.bar,[-3,0,0]),[-1,-1,0]);arm(r,1,add(r.bar,[3,0,0]),[1,-1,0]);}
  } else if(id==='lateral-raises'||id==='rear-delt-flyes') {
    if(id==='rear-delt-flyes')r=standing([0,49,0],66*RAD);
    const angle=mix(8,88,q)*RAD;
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      r.elbows[i]=add(r.shoulders[i],[side*19*Math.sin(angle),-19*Math.cos(angle),0]);
      r.hands[i]=add(r.elbows[i],[side*18*Math.sin(angle-0.1),-18*Math.cos(angle-0.1),0]);
    }
    r.dumbbells=[r.hands[0],r.hands[1]];
  } else if(id==='back-squats') {
    const lean=mix(0,32,q)*RAD;
    r=standing([0,mix(53.5,26,q),8-34*Math.sin(lean)],lean);
    leg(r,0,[-12,6,8]);leg(r,1,[12,6,8]);
    barGrip(r,add(r.shoulder,[0,-1,-3]),24,[0,-1,-1]);
  } else if(id==='deadlifts') {
    const lean=mix(58,0,q)*RAD;
    r=standing([0,mix(38,53.5,q),5-34*Math.sin(lean)],lean);
    leg(r,0,[-8,6,10]);leg(r,1,[8,6,10]);
    const drop=Math.sqrt(37*37-3*3-7*7);
    barGrip(r,add(r.shoulder,[0,-drop,7]),13,[0,0,1]);
  } else if(id==='landmine-lunges') {
    const descend=q, step=q;
    r=standing([0,50-19*descend,-12*descend],5*RAD);
    leg(r,0,[-9,6,12]);leg(r,1,[9,6+4*Math.sin(Math.PI*step),5-43*step]);
    r.anchor=[0,0,100];r.bar=landmine(r.shoulder[1]-5);
    arm(r,0,add(r.bar,[-3,0,0]),[-1,-1,0]);arm(r,1,add(r.bar,[3,0,0]),[1,-1,0]);
  } else if(id==='bulgarian-split') {
    r=standing([0,50-18*q,1-6*q],10*RAD);
    leg(r,1,[9,6,20]);leg(r,0,[-9,33,-32]);
    r.dumbbells=[r.hands[0],r.hands[1]];
  } else if(id==='hip-thrusts') {
    const rise=mix(3,20,q);
    const shoulder: V3=[0,12,-35];
    r=body([0,12+rise,-35+Math.sqrt(34*34-rise*rise)],shoulder);
    leg(r,0,[-9,6,23]);leg(r,1,[9,6,23]);
    barGrip(r,add(r.hip,[0,4,0]),12,[0,0,1]);
  } else if(id==='dips') {
    const shoulder: V3=[0,mix(107,83,q),5];
    r=body(add(shoulder,[0,-33.26,-7.07]),shoulder);
    arm(r,0,[-20,74,0],[0,0,-1]);arm(r,1,[20,74,0],[0,0,-1]);
    for(let i=0;i<2;i++){
      r.knees[i]=add(r.hips[i],[0,-22.55,-8.21]);r.feet[i]=add(r.knees[i],[0,-12,-20.7846]);
    }
  } else if(id==='pull-ups') {
    r=standing([0,mix(49,77,q),0]);
    arm(r,0,[-23,117,0],[-1,-1,0]);arm(r,1,[23,117,0],[1,-1,0]);
    for(let i=0;i<2;i++){
      r.knees[i]=add(r.hips[i],[0,-23.18,-6.21]);r.feet[i]=add(r.knees[i],[0,-14,-19.4936]);
    }
  } else if(id==='leg-raises') {
    // Fixed overhead grip and quiet trunk; straight legs rotate at the hips.
    r=body([0,54,0],[0,88,0]);const angle=mix(0,90,q)*RAD;
    arm(r,0,[-10,125,0],[-1,-1,0]);arm(r,1,[10,125,0],[1,-1,0]);
    for(let i=0;i<2;i++){
      const dir: V3=[0,-Math.cos(angle),Math.sin(angle)];
      r.knees[i]=add(r.hips[i],mul(dir,24));r.feet[i]=add(r.knees[i],mul(dir,24));
    }
  } else if(id==='ab-roller') {
    const a=mix(25,62,q)*RAD, hip: V3=[0,6+24*Math.cos(a),17-24*Math.sin(a)];
    const rise=mix(16,7,q);r=body(hip,add(hip,[0,rise,-Math.sqrt(34*34-rise*rise)]));
    r.roller=[0,9,mix(-32,-69,q)];
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;r.knees[i]=[side*6,6,17];r.feet[i]=[side*6,6,41];
      arm(r,i,add(r.roller,[side*10,0,0]),[0,-1,0]);
    }
  } else if(id==='plank') {
    const rise=25/82,run=Math.sqrt(1-rise*rise);
    r=body([0,31-34*rise,-31.867+34*run],[0,31,-31.867]);
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;r.elbows[i]=[side*10,12,-31.867];r.hands[i]=[side*10,12,-49.867];
      leg(r,i,[side*6,6,-31.867+82*run],[0,1,0]);
    }
    r.breath=q;
  } else if(id==='oblique-twists') {
    const angle=mix(-40,40,q)*RAD;
    r=body([0,10,0],[0,39.445,-17],angle);
    leg(r,0,[-7,6,41],[0,1,0]);leg(r,1,[7,6,41],[0,1,0]);
    const grip: V3=[24*Math.sin(angle),32,-17+24*Math.cos(angle)];
    arm(r,0,add(grip,[-2,0,0]),[-1,-1,0]);arm(r,1,add(grip,[2,0,0]),[1,-1,0]);
  } else if(id==='db-rows'||id==='landmine-rows') {
    if(id==='db-rows') {
      r=body([0,51,-2],[0,67,28]);
      leg(r,1,[9,6,-8]);r.knees[0]=[-6,30,-2-Math.sqrt(24*24-21*21)];r.feet[0]=add(r.knees[0],[0,0,-24]);
      arm(r,0,[-10,30,28],[0,0,-1]);arm(r,1,[10,mix(31,55,q),mix(28,6,q)],[0,0,-1]);r.dumbbells=[r.hands[1]];
    } else {
      r=standing([0,49,0],66*RAD);leg(r,0,[-10,6,-9]);leg(r,1,[10,6,17]);
      const y=mix(27,54,q);r.anchor=[10,0,-94];r.bar=[10,y,-94+Math.sqrt(128*128-y*y)];
      arm(r,1,r.bar,[0,0,-1]);arm(r,0,[-10,40,14],[0,0,1]);
    }
  }
  return r;
}
