import React from 'react';
import Svg, { Path } from 'react-native-svg';
// Original SVG artwork, also provided as standalone assets/buttons/*.svg.
const shapes = {"start": ["M9 6h14a7 7 0 0 1 7 7v6a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7v-6a7 7 0 0 1 7-7Z", "M13 10l9 6-9 6Z", "M6 12v8"], "capture": ["M5 9h5l2-3h8l2 3h5v17H5Z", "M21 17a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z", "M25 12h.1M2 5v5M2 5h5M30 5h-5M30 5v5"], "export": ["M6 18v9h20v-9", "M16 3v17m-6-6 6 6 6-6", "M7 4h4M21 4h4"]} as const;
export function ActionGlyph({kind,size=28,onAccent=false}:{kind:keyof typeof shapes;size?:number;onAccent?:boolean}) {
  const colors=onAccent?['#103322','#103322','#103322']:['#78B996','#22D46E','#AEE8CA'];
  return <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" accessible={false}>
    {shapes[kind].map((d,i)=><Path key={i} d={d} fill={i===0&&kind!=='export'?(onAccent?'none':'#1B4734'):'none'} stroke={colors[i]} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>)}
  </Svg>;
}
