import { grey, white } from "./colors.js";
const names = ['a', 'b'];
const spacings = { s: '8px' };
export const make = (brand)=>{
  const t = names.reduce((acc, n)=>Object.assign(acc, { [`size${n.slice(0, 1).toUpperCase()}`]: spacings.s }), {});
  t.patched = grey[26];
  return { ...t, fg: grey[14], bg: white, label: `${brand}-x` };
};
export const light = make('web');
