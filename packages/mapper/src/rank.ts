import crypto from 'node:crypto';
import { loadNative, resolve as resolveToken, themeFor, type NativeSet } from '@dsi/resolve';

/**
 * ADR 0018 emphasis by contrast rank, computed instead of judged. For queued tokens on which both mapping agents
 * agree on every facet except emphasis (and match type), group them into families (same concept without emphasis
 * and state), take each resting member's native emphasis word, and compare the word order with the contrast order
 * against the page in every mode. When they agree, the word's step is the answer (exact); when they disagree, the
 * members take the word positions in contrast order (close). Hover/pressed siblings take their resting member's step.
 */
const WORDS: Record<string, number> = { subtlest: 1, subtler: 2, subtle: 3, default: 4, bold: 5, bolder: 6, boldest: 7, muted: 3, emphasis: 5, strong: 5 };
const STEPS = ['', 'subtlest', 'subtler', 'subtle', 'default', 'strong', 'stronger', 'strongest'];

type P = { token: string; concept?: string; match?: string; confidence?: number };
const strip = (c: string) => c.split('/').filter((s) => !s.startsWith('emphasis-') && !s.startsWith('state-')).join('/');
const stateOf = (c: string) => c.split('/').find((s) => s.startsWith('state-'));
// The emphasis word of a token name. A trailing `default` is Atlassian's resting-state segment
// (subtle.default / subtle.hovered), not an emphasis, unless it is the only candidate (danger.default.default).
const wordOf = (token: string) => {
  const segs = token.split(/[.-]/);
  if (segs.at(-1) === 'default' || ['hovered', 'pressed', 'hover', 'active', 'focused', 'selected'].includes(segs.at(-1)!)) segs.pop();
  return segs.filter((w) => WORDS[w] !== undefined).pop() ?? (token.split(/[.-]/).includes('default') ? 'default' : undefined);
};
const restingKey = (token: string) => token.replace(/[.-](hovered|hover|pressed|active|focused|selected)(?=$|[.-])/g, '').replace(/[.-]default$/, '');

function lum(hex: string) { const n = hex.replace('#', ''); const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexOf = (set: NativeSet, theme: string, token: string) => { const v = resolveToken(set, theme, token).value as { hex?: string } | undefined; return v?.hex?.slice(0, 7); };

export function rankEmphasis(root: string, product: string, version: string, a: P[], b: P[], pageToken: (mode: string) => string | undefined) {
  const set = loadNative(root, product, version);
  const bmap = new Map(b.map((x) => [x.token, x]));
  const agreed = a.filter((x) => { const y = bmap.get(x.token); return x.concept && y?.concept && strip(x.concept) === strip(y.concept) && stateOf(x.concept) === stateOf(y.concept); });
  const families = new Map<string, P[]>();
  for (const x of agreed) (families.get(strip(x.concept!)) ?? families.set(strip(x.concept!), []).get(strip(x.concept!))!).push(x);
  const out: { token: string; concept: string; match: 'exact' | 'close'; note: string }[] = [];
  const skipped: string[] = [];
  for (const [fam, members] of families) {
    // Numbered ladders (Fluent Background1..6) carry no emphasis word: rank them by contrast and spread the members
    // over the seven steps (ADR 0018 amended), always close.
    const numbered = members.filter((m) => !stateOf(m.concept!) && /\d+$/.test(m.token.replace(/(Hover|Pressed|Selected|Disabled)$/, '')));
    if (!members.some((m) => !stateOf(m.concept!) && wordOf(m.token)) && numbered.length >= 2 && numbered.length <= 7) {
      const SPREAD: Record<number, number[]> = { 2: [3, 5], 3: [3, 4, 5], 4: [2, 3, 5, 6], 5: [2, 3, 4, 5, 6], 6: [1, 2, 3, 5, 6, 7], 7: [1, 2, 3, 4, 5, 6, 7] };
      const modes = Object.keys(set.modes).filter((m) => m === 'light' || m === 'dark');
      const orders = modes.map((mode) => {
        const th = themeFor(set, mode)!;
        const page = (pageToken(mode) && hexOf(set, th, pageToken(mode)!)) ?? (mode === 'dark' ? '#000000' : '#ffffff');
        const vals = numbered.map((m) => ({ t: m.token, c: (() => { const h = hexOf(set, th, m.token); return h ? contrast(h, page) : NaN; })() }));
        return vals.some((v) => Number.isNaN(v.c)) || new Set(vals.map((v) => v.c.toFixed(3))).size !== vals.length ? undefined : vals.sort((p, q) => p.c - q.c).map((v) => v.t);
      });
      if (orders.some((o) => !o) || new Set(orders.map((o) => o!.join())).size !== 1) { skipped.push(`${fam}: numbered ladder without one contrast order in every mode`); continue; }
      const stepOf = new Map(orders[0]!.map((t, i) => [t, SPREAD[numbered.length][i]]));
      const base = (t: string) => t.replace(/(Hover|Pressed|Selected|Disabled)$/, '');
      for (const m of members) {
        const rest = stateOf(m.concept!) ? numbered.find((r) => r.token === base(m.token)) : m;
        const step = rest && stepOf.get(rest.token);
        if (!step) { skipped.push(`${m.token}: no ranked numbered sibling`); continue; }
        const st = stateOf(m.concept!);
        out.push({ token: m.token, concept: [...fam.split('/'), `emphasis-${STEPS[step]}`, ...(st ? [st] : [])].join('/'), match: 'close', note: `numbered ladder ranked by contrast in ${modes.join(' and ')} (${orders[0]!.join(' < ')})` });
      }
      continue;
    }
    const resting = members.filter((m) => !stateOf(m.concept!) && wordOf(m.token));
    const byWord = new Map<string, P>();
    for (const m of resting) byWord.set(String(WORDS[wordOf(m.token)!]) + '|' + m.token, m);
    const words = [...new Set(resting.map((m) => WORDS[wordOf(m.token)!]))];
    if (resting.length < 2 || words.length !== resting.length) { skipped.push(`${fam}: ${resting.length < 2 ? 'fewer than two resting members' : 'repeated emphasis words'}`); continue; }
    const modes = Object.keys(set.modes).filter((m) => m === 'light' || m === 'dark');
    const orders = modes.map((mode) => {
      const th = themeFor(set, mode)!;
      const page = (pageToken(mode) && hexOf(set, th, pageToken(mode)!)) ?? (mode === 'dark' ? '#000000' : '#ffffff');
      const vals = resting.map((m) => ({ m, c: (() => { const h = hexOf(set, th, m.token); return h ? contrast(h, page) : NaN; })() }));
      return vals.some((v) => Number.isNaN(v.c)) ? undefined : vals.sort((p, q) => p.c - q.c).map((v) => v.m.token);
    });
    if (orders.some((o) => !o) || new Set(orders.map((o) => o!.join())).size !== 1) { skipped.push(`${fam}: contrast order missing or differs between modes`); continue; }
    const byContrast = orders[0]!;
    const byWordOrder = [...resting].sort((p, q) => WORDS[wordOf(p.token)!] - WORDS[wordOf(q.token)!]).map((m) => m.token);
    const agree = byContrast.join() === byWordOrder.join();
    // Words contradict values: anchor at the lightest step (owner decision, ADR 0018 amended). Light-side members
    // (word at or below default) take subtlest, subtler, subtle, default in contrast order; bold-side members keep
    // their word's step (bold -> strong, bolder -> stronger, boldest -> strongest).
    let light = 0;
    const stepOf = new Map<string, number>(byContrast.map((t) => [t, agree ? WORDS[wordOf(t)!] : WORDS[wordOf(t)!] <= 4 ? ++light : WORDS[wordOf(t)!]]));
    for (const m of members) {
      const rest = stateOf(m.concept!) ? members.find((r) => !stateOf(r.concept!) && restingKey(r.token) === restingKey(m.token)) : m;
      const step = rest && stepOf.get(rest.token);
      if (!step) { skipped.push(`${m.token}: no resting sibling with a rank`); continue; }
      const parts = fam.split('/');
      const st = stateOf(m.concept!);
      const concept = [...parts, `emphasis-${STEPS[step]}`, ...(st ? [st] : [])].join('/');
      out.push({ token: m.token, concept, match: agree ? 'exact' : 'close', note: agree ? `native word order equals contrast order in ${modes.join(' and ')}` : `native words contradict contrast order in ${modes.join(' and ')}; step by rank (${byContrast.map((t) => wordOf(t)).join(' < ')})` });
    }
  }
  return { out, skipped, id: (t: string, c: string, mt: string) => 'm-' + crypto.createHash('sha1').update([t, c, mt].join('|')).digest('hex').slice(0, 12) };
}
