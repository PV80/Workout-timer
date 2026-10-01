import React, { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, createAnimatedPropAdapter, Easing, useAnimatedProps, useDerivedValue, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Ellipse, G, Path } from 'react-native-svg';
import { add, EXERCISE_ARTWORK, ExerciseArtwork, getExerciseRig, Point, project, REST_ARTWORK, Rig, V3 } from '../data/exerciseIllustrations';
import { theme } from '../theme';
import { useMotionEnabled } from './Motion';

const MovingPath=Animated.createAnimatedComponent(Path);
const MovingG=Animated.createAnimatedComponent(G);
const groupTransformAdapter=createAnimatedPropAdapter(props=>{
  'worklet';
  if(Array.isArray(props.transform)){props.matrix=props.transform;delete props.transform;}
},['matrix']);
const MovingEllipse=Animated.createAnimatedComponent(Ellipse);
const SKIN='#DDB397', FAR_SKIN='#A77F68', SHIRT='#26BC78', FAR_SHIRT='#176647';
function line(points: Point[], close=false) {
  'worklet'; return points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ')+(close?' Z':'');
}
function worldLine(points: V3[], yaw: number, close=false) {
  'worklet'; return line(points.map(p=>project(p,yaw)),close);
}
function capsule(a: Point,b: Point,wa: number,wb: number) {
  'worklet';const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.max(0.01,Math.sqrt(dx*dx+dy*dy));
  const x=-dy/d,y=dx/d;
  return line([[a[0]+x*wa,a[1]+y*wa],[b[0]+x*wb,b[1]+y*wb],[b[0]-x*wb,b[1]-y*wb],[a[0]-x*wa,a[1]-y*wa]],true);
}
function plate(p: Point, rx: number,ry: number) {
  'worklet';return `M${p[0]-rx},${p[1]} a${rx},${ry} 0 1 0 ${rx*2},0 a${rx},${ry} 0 1 0 ${-rx*2},0`;
}
function gear(r: Rig, art: ExerciseArtwork): {shaft:string;plates:string} {
  'worklet';let shaft='',plates='';const yaw=art.yaw;
  if(art.equipment==='barbell'&&r.bar){
    shaft=worldLine([add(r.bar,[-38,0,0]),add(r.bar,[38,0,0])],yaw);
    const rx=2+8*Math.sin(yaw*Math.PI/180);
    for(const side of [-1,1])plates+=plate(project(add(r.bar,[side*30,0,0]),yaw),rx,11);
  }
  if(art.equipment==='dumbbells')for(const p of r.dumbbells){
    shaft+=worldLine([add(p,[-8,0,0]),add(p,[8,0,0])],yaw);
    for(const side of [-1,1])plates+=worldLine([add(p,[side*6,-4,0]),add(p,[side*6,4,0])],yaw);
  }
  if(art.equipment==='landmine'&&r.bar&&r.anchor){
    const a=project(r.anchor,yaw),b=project(r.bar,yaw);shaft=line([a,b]);
    const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.sqrt(dx*dx+dy*dy),ux=dx/d,uy=dy/d;
    const c:Point=[b[0]-ux*8,b[1]-uy*8];
    plates=line([[c[0]-uy*9-ux*2,c[1]+ux*9-uy*2],[c[0]+uy*9-ux*2,c[1]-ux*9-uy*2],
      [c[0]+uy*9+ux*2,c[1]-ux*9+uy*2],[c[0]-uy*9+ux*2,c[1]+ux*9+uy*2]],true);
  }
  if(r.roller){
    const p=r.roller,a=(p[2]+32)/9;
    shaft=worldLine([add(p,[-14,0,0]),add(p,[14,0,0])],yaw);
    plates=plate(project(p,yaw),9*Math.sin(yaw*Math.PI/180),9);
    for(const offset of [0,Math.PI/2]){
      const y=7*Math.cos(a+offset),z=7*Math.sin(a+offset);
      shaft+=worldLine([add(p,[0,y,z]),add(p,[0,-y,-z])],yaw);
    }
  }
  return {shaft,plates};
}
function equipmentFrame(art:ExerciseArtwork) {
  const yaw=art.yaw;let frame='',pad='';
  function bench(x:number,z1:number,z2:number,y:number,width:number){
    pad+=worldLine([[x-width,y,z1],[x+width,y,z1],[x+width,y,z2],[x-width,y,z2]],yaw,true);
    for(const z of [z1+4,z2-4])for(const side of [-1,1])frame+=worldLine([[x+side*(width-3),y,z],[x+side*(width-3),1,z]],yaw);
  }
  if(art.bench==='flat')bench(0,-49,10,39,13);
  if(art.bench==='incline'){
    bench(0,-1,17,39,13);
    pad+=worldLine([[-13,68,-47],[13,68,-47],[13,39,4],[-13,39,4]],yaw,true);
    frame+=worldLine([[0,62,-38],[0,1,-28]],yaw);
  }
  if(art.bench==='row')bench(-11,-43,38,25,12);
  if(art.bench==='split')bench(0,-46,-25,27,22);
  if(art.bench==='seat')bench(0,-17,9,34,16);
  if(art.bench==='preacher'){
    bench(0,-24,-2,39,14);
    pad+=worldLine([[-17,73,-2],[17,73,-2],[17,54,21],[-17,54,21]],yaw,true);
    frame+=worldLine([[0,63,10],[0,1,10]],yaw);
  }
  if(art.equipment==='pullup'){
    frame+=worldLine([[-40,1,0],[-40,117,0],[40,117,0],[40,1,0]],yaw);
    frame+=worldLine([[-48,1,0],[-32,1,0]],yaw)+worldLine([[32,1,0],[48,1,0]],yaw);
  }
  if(art.equipment==='bars')for(const side of [-1,1])frame+=worldLine([[side*20,1,-18],[side*20,74,-18],[side*20,74,20],[side*20,1,20]],yaw);
  return {frame,pad};
}

/** Decorative exercise loop. Skeletal calculations and SVG updates stay on the UI thread. */
export function ExerciseScene({exerciseId,phase,paused=false}:{exerciseId?:string;phase:string;paused?:boolean}) {
  const rest=phase==='break', id=rest?'rest':exerciseId??'';
  const compact=useWindowDimensions().height<800;
  const art=rest?REST_ARTWORK:EXERCISE_ARTWORK[id];
  const model=art??REST_ARTWORK;
  const enabled=useMotionEnabled()&&!paused;
  const cycle=useSharedValue(0);
  useEffect(()=>{
    // Reset only when the movement changes; pausing keeps the current pose.
    cancelAnimation(cycle);cycle.value=0;
  },[id,cycle]);
  useEffect(()=>{
    cancelAnimation(cycle);
    if(enabled&&art){
      const [out,hold,back,reset]=art.tempo;
      cycle.value=withRepeat(withSequence(
        withTiming(1,{duration:out,easing:Easing.inOut(Easing.sin)}),
        withTiming(1,{duration:hold}),
        withTiming(0,{duration:back,easing:Easing.inOut(Easing.sin)}),
        withTiming(0,{duration:reset}),
      ),-1,false);
    }
    return()=>cancelAnimation(cycle);
  },[id,enabled,art,cycle]);
  const rig=useDerivedValue(()=>getExerciseRig(id,cycle.value));
  const yaw=model.yaw;
  const farLeg=useAnimatedProps(()=>({d:worldLine([rig.value.hips[0],rig.value.knees[0],rig.value.feet[0]],yaw)}));
  const nearLeg=useAnimatedProps(()=>({d:worldLine([rig.value.hips[1],rig.value.knees[1],rig.value.feet[1]],yaw)}));
  const shorts=useAnimatedProps(()=>{
    const r=rig.value;let d='';for(let i=0;i<2;i++){
      const h=r.hips[i],k=r.knees[i];d+=worldLine([h,[h[0]+(k[0]-h[0])*.48,h[1]+(k[1]-h[1])*.48,h[2]+(k[2]-h[2])*.48]],yaw);
    }return {d};
  });
  const shoes=useAnimatedProps(()=>({d:rig.value.feet.map(p=>worldLine([add(p,[0,-1,-2]),add(p,[0,-2,6])],yaw)).join('')}));
  const farArm=useAnimatedProps(()=>({d:worldLine([rig.value.shoulders[0],rig.value.elbows[0],rig.value.hands[0]],yaw)}));
  const nearArm=useAnimatedProps(()=>({d:worldLine([rig.value.shoulders[1],rig.value.elbows[1],rig.value.hands[1]],yaw)}));
  const torso=useAnimatedProps(()=>({d:capsule(project(rig.value.shoulder,yaw),project(rig.value.hip,yaw),9.5+rig.value.breath*.65,6.5)}));
  const seam=useAnimatedProps(()=>({d:worldLine([add(rig.value.shoulder,[4,0,0]),add(rig.value.hip,[4,0,0])],yaw)}));
  const head=useAnimatedProps(()=>{
    const r=rig.value,h=project(r.head,yaw),s=project(r.shoulder,yaw);
    const angle=Math.atan2(h[0]-s[0],s[1]-h[1]);
    // Adapt the SVG transform to the native matrix consumed by Fabric.
    return {transform:[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),h[0],h[1]] as [number,number,number,number,number,number]};
  },undefined,groupTransformAdapter);
  const neck=useAnimatedProps(()=>({d:worldLine([rig.value.shoulder,rig.value.head],yaw)}));
  const shaft=useAnimatedProps(()=>({d:gear(rig.value,model).shaft}));
  const plates=useAnimatedProps(()=>({d:gear(rig.value,model).plates}));
  const glow=useAnimatedProps(()=>{
    const r=rig.value,p=project([r.shoulder[0],(r.shoulder[1]+r.hip[1])/2,r.shoulder[2]],yaw);
    return {cx:p[0],cy:p[1],rx:18+r.breath*5,ry:23+r.breath*6,opacity:0.055+r.breath*0.025};
  });
  const chest=useAnimatedProps(()=>({opacity:.15+rig.value.breath*.12}));
  if(!art)return null;
  const frame=equipmentFrame(art);
  const title=paused?'Take your time.':rest?'Breathe. Reset.':phase==='transition'?'Get set.':id==='plank'?'Stay steady.':'Move with control.';
  return <View style={[styles.card,compact&&{minHeight:88}]} accessible={false}>
    <Svg width={compact?110:138} height={compact?82:104} viewBox="0 0 192 144" accessible={false}>
      <Ellipse cx={96} cy={136} rx={75} ry={5} fill="#07110D" opacity={.55}/>
      {art.floor&&<Path d={worldLine([[-22,0,-65],[22,0,-65],[22,0,54],[-22,0,54]],yaw,true)} fill="#243B32" stroke="#395648" strokeWidth={1}/>} 
      {(rest||id==='plank')&&<MovingEllipse animatedProps={glow} fill={rest?theme.blue:theme.green}/>}
      <Path d={frame.frame} fill="none" stroke="#587369" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
      <Path d={frame.pad} fill="#30483C" stroke="#718A7D" strokeWidth={3} strokeLinejoin="round"/>
      <G fill="none" strokeLinecap="round" strokeLinejoin="round">
        <MovingPath animatedProps={farLeg} stroke={FAR_SKIN} strokeWidth={8}/>
        <MovingPath animatedProps={farArm} stroke={FAR_SKIN} strokeWidth={7}/>
        <MovingPath animatedProps={nearLeg} stroke={SKIN} strokeWidth={8}/>
        <MovingPath animatedProps={shorts} stroke="#243F33" strokeWidth={12}/>
        <MovingPath animatedProps={shoes} stroke="#DEE8E1" strokeWidth={6}/>
        <MovingPath animatedProps={neck} stroke={SKIN} strokeWidth={6}/>
      </G>
      <MovingPath animatedProps={torso} fill={rest?'#4F95D4':SHIRT} stroke={rest?'#30678F':FAR_SHIRT} strokeWidth={1.2} strokeLinejoin="round"/>
      <MovingG animatedProps={chest}><MovingPath animatedProps={seam} stroke="#C9FBE0" strokeWidth={2} strokeLinecap="round"/></MovingG>
      <MovingG animatedProps={head}>
        <Path d="M-6 0 Q-7-8 0-8 Q7-8 7-2 L9 1 L6 3 Q5 8 0 7 Q-6 6-6 0Z" fill={SKIN}/>
        <Path d="M-6 2 Q-9-7-2-9 Q6-11 8-4 L3-4 L1-1 L-3-2 L-3 3Z" fill="#26372F"/>
      </MovingG>
      <MovingPath animatedProps={nearArm} stroke={SKIN} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <MovingPath animatedProps={shaft} stroke="#ACBEB4" strokeWidth={2.7} fill="none" strokeLinecap="round"/>
      <MovingPath animatedProps={plates} stroke={rest?theme.blue:'#72C69D'} strokeWidth={art.equipment==='dumbbells'?4:2.5} fill={art.equipment==='dumbbells'?'none':'#223C30'} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
    <View style={styles.copy}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{paused?'Resume when you are ready.':phase==='transition'?'A moment to set up.':art.cue}</Text>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  card:{width:'100%',maxWidth:360,minHeight:108,flexDirection:'row',alignItems:'center',paddingHorizontal:6,paddingVertical:2,gap:8,
    backgroundColor:theme.surface,borderRadius:20,borderWidth:1,borderColor:theme.border},
  copy:{flex:1,paddingRight:10},title:{color:theme.text,fontSize:12,fontWeight:'700',lineHeight:18},
  subtitle:{color:theme.muted,fontSize:10,lineHeight:15,marginTop:4},
});
