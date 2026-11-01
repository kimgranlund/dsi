import { loadNative, resolve, type NativeSet } from '@dsi/resolve';

/**
 * Deciding tests for vocabulary boundaries (ADR 0021, docs/planning/boundaries.md). Each test reads only shipped
 * facts (names, descriptions, values per mode) and says which side of a boundary a token is on, or undefined when
 * it cannot tell. Tests never invent a concept; they normalize an answer's boundary facet.
 */
// Step words: strength words, ordinal layer words (secondary, tertiary; ADR 0008) and Material's container (ADR 0008).
const STRENGTH = new Set(['secondary', 'tertiary', 'quaternary', 'container', 'variant', 'low', 'lowest', 'high', 'highest', 'dim', 'bright', 'subtlest', 'subtler', 'subtle', 'default', 'bold', 'bolder', 'boldest', 'muted', 'emphasis', 'strong', 'stronger', 'strongest', 'weak', 'weaker', 'light', 'lighter', 'dark', 'darker']);
const STATES = /^(hover|hovered|pressed|active|focus|focused|selected|disabled|rest|down)$/i;
const words = (name: string) => name.split(/[.\-_]/).flatMap((s) => s.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [s]).filter((w) => w.toLowerCase() !== 'default');

function lum(hex: string) { const n = hex.replace('#', ''); const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export class BoundaryTests {
  set: NativeSet;
  modes: string[];
  page: Record<string, string>;
  private names: string[];
  constructor(root: string, product: string, version: string, pageToken?: string) {
    this.set = loadNative(root, product, version);
    this.modes = this.set.themes.includes('light') && this.set.themes.includes('dark') ? ['light', 'dark'] : this.set.themes.length ? this.set.themes.slice(0, 2) : [''];
    this.page = {} as Record<string, string>;
    this.page = Object.fromEntries(this.modes.map((m, i) => [m, (pageToken && this.hex(pageToken, m)) || (i === 0 ? '#ffffff' : '#1f1f1f')]));
    this.names = [...this.set.tokens.keys()];
  }
  /** The token's color in a mode, composited over the page when translucent (contrast needs what the eye sees). */
  hex(token: string, mode: string): string | undefined {
    const v = resolve(this.set, mode, token).value as { hex?: string; alpha?: number; components?: number[] } | undefined;
    const h = v?.hex; if (!h) return undefined;
    const a = v?.alpha ?? (h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1);
    const base = this.page?.[mode];
    if (a >= 0.999 || !base) return h.slice(0, 7);
    const mix = [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * a + parseInt(base.slice(i, i + 2), 16) * (1 - a)));
    return '#' + mix.map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  /**
   * B1: emphasis binds only in a contrast-ordered ladder: 2+ siblings (state words ignored) that differ only by a
   * strength word or number at one position, whose contrast against the page orders the same way in every mode.
   */
  ladder(token: string): { bound: boolean; members: string[] } {
    const base = words(token).filter((w) => !STATES.test(w));
    const key = (ws: string[], i: number) => ws.map((w, j) => (j === i ? '*' : w.toLowerCase())).join(' ');
    const isStep = (w: string) => STRENGTH.has(w.toLowerCase()) || /^\d+$/.test(w);
    for (let i = 0; i < base.length; i++) {
      if (!isStep(base[i])) continue;
      const k = key(base, i);
      const unmarked = base.filter((_, j) => j !== i).map((w) => w.toLowerCase()).join(' ');
      const members = this.names.filter((n) => {
        const all = words(n); if (all.some((w) => STATES.test(w))) return false;
        if (all.length === base.length) return isStep(all[i]) && key(all, i) === k;
        return all.length === base.length - 1 && all.map((w) => w.toLowerCase()).join(' ') === unmarked; // the plain member (critical beside critical-secondary)
      });
      if (members.length < 2) continue;
      if (this.ordered(members)) return { bound: true, members };
    }
    // The token itself carries no step word (Atlassian danger.default): look for siblings with one step word added.
    if (!base.some(isStep)) {
      const plain = base.map((w) => w.toLowerCase()).join(' ');
      const stepped = this.names.filter((n) => { const all = words(n); if (all.some((w) => STATES.test(w)) || all.length !== base.length + 1) return false; const j = all.findIndex(isStep); return j >= 0 && all.filter((_, x) => x !== j).map((w) => w.toLowerCase()).join(' ') === plain; });
      const members = [token.replace(/[.-](hovered|hover|pressed|active|focused|selected)$/, ''), ...stepped].filter((n, i, a) => a.indexOf(n) === i && this.set.tokens.has(n));
      if (stepped.length && this.ordered(members)) return { bound: true, members };
    }
    return { bound: false, members: [] };
  }

  /** Same contrast order against the page in every mode where every member has a value (at least one such mode). */
  ordered(members: string[]): boolean {
    // A mode counts only when the family's values change in it: fixed tokens (Material *-fixed) and untheme'd
    // experimental modes keep their light values on another page, which flips contrast by construction.
    const first = this.modes[0];
    const themed = (m: string) => m === first || members.some((t) => this.hex(t, m) !== this.hex(t, first));
    const orders = this.modes.filter(themed).map((m) => members.map((t) => ({ t, c: this.hex(t, m) ? contrast(this.hex(t, m)!, this.page[m]) : NaN }))).filter((o) => o.every((x) => !Number.isNaN(x.c)));
    if (!orders.length) return false;
    const perm = (o: { t: string; c: number }[]) => [...o].sort((a, b) => a.c - b.c).map((x) => x.t).join('|');
    return orders.every((o) => perm(o) === perm(orders[0]));
  }

  /** B3: usage surface only when the system has a page token and this token differs from it in some mode. */
  surface(token: string, hasPage: boolean): boolean | undefined {
    if (!hasPage) return false;
    const vals = this.modes.map((m) => this.hex(token, m));
    if (vals.some((v) => !v)) return undefined;
    return vals.some((v, i) => v !== this.page[this.modes[i]]);
  }

  /** B4: on-fill only on a bold fill: a sibling background contrasting >= 3:1 with the page, the token >= 4.5:1 on it. */
  onFill(token: string): boolean | undefined {
    const d = this.set.tokens.get(token)?.description ?? '';
    if (/non-bold|subtle (accent )?background|subtler|subtlest/i.test(d)) return false;
    const m0 = this.modes[0];
    const fg = this.hex(token, m0);
    if (!fg) return undefined;
    // The fill it sits on, by the system's own naming: Material on-X -> X; Polaris color-text-X-on-bg-fill -> color-bg-fill-X;
    // Fluent ...OnBrand -> colorBrandBackground; generic text/icon/fg -> background/bgColor.
    const cands = new Set<string>();
    const add = (t: string) => { if (t === token) return; for (const n of this.names) if (n === t || n.startsWith(t + '.') || n.startsWith(t + '-')) cands.add(n); };
    add(token.replace(/(^|[.-])on-/, '$1'));
    const pol = /^color-(text|icon)-(.+?)-on-bg-fill/.exec(token); if (pol) add(`color-bg-fill-${pol[2]}`);
    const flu = /On(Brand|Danger|Success|Warning|[A-Z][a-z]+)/.exec(token); if (flu) add(`color${flu[1]}Background`);
    for (const re of [/\b(text|icon)\b/, /(Foreground)/, /\bfg(Color)?\b/]) add(token.replace(re, (s) => (/[A-Z]/.test(s[0]) ? 'Background' : s.startsWith('fg') ? 'bgColor' : 'background')));
    const fills = [...cands].filter((n) => !words(n).some((w) => STATES.test(w))).map((n) => ({ n, h: this.hex(n, m0) })).filter((x) => x.h && contrast(x.h, this.page[m0]) >= 3);
    if (!fills.length) return undefined; // no evidence either way: leave the answer alone
    return fills.some((x) => contrast(fg, x.h!) >= 4.5);
  }

  /** B6: text when the system ships an icon sibling (color.icon.X beside color.text.X); foreground when one token colors both. */
  textNotForeground(token: string): boolean | undefined {
    const ws = token.split(/([.\-_])/);
    const i = ws.findIndex((w) => /^text$/i.test(w));
    if (i < 0) return /fg|foreground|content/i.test(token) ? false : undefined;
    // The system ships a separate icon family at the same place in the name (color.icon.* beside color.text.*).
    const prefix = [...ws.slice(0, i), ws[i][0] === 'T' ? 'Icon' : 'icon'].join('');
    // ... or anywhere in its names (Spectrum icon-color-* beside *-text-color).
    return this.names.some((n) => n.startsWith(prefix) || /(^|[.\-_])icon[.\-_]?colou?r|(^|[.\-_])icon([.\-_]|$)/i.test(n));
  }
}

/** Facets of a concept, and back. */
export const facetsOf = (c: string) => { const out = new Map<string, string[]>(); for (const seg of c.split('/').slice(2)) { const i = seg.indexOf('-'); out.set(seg.slice(0, i), seg.slice(i + 1).split('+')); } return out; };
const ORDER = ['intent', 'usage', 'hue', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'];
export const conceptOf = (domain: string, f: Map<string, string[]>) => `dsi:concept/${domain}/` + ORDER.filter((k) => f.get(k)?.length).map((k) => `${k}-${[...new Set(f.get(k)!)].sort().join('+')}`).join('/');

/** Normalize one answer's boundary facets by the tests. Returns the concept and which rules changed it. */
export function normalize(t: BoundaryTests, token: string, concept: string, hasPage: boolean, jevB4?: Map<string, boolean | undefined>): { concept: string; applied: string[]; needsEmphasis: boolean } {
  const domain = concept.split('/')[1];
  const f = facetsOf(concept);
  const applied: string[] = [];
  let needsEmphasis = false;
  const usage = f.get('usage') ?? [];
  // B1 (categorical hue ramps follow the ramp rule instead).
  if (!usage.includes('categorical')) {
    const l = t.ladder(token);
    if (!l.bound && f.has('emphasis')) { f.delete('emphasis'); applied.push('B1'); }
    if (l.bound && !f.has('emphasis')) needsEmphasis = true;
  }
  // B3
  if (['background', 'fill'].some((p) => f.get('property')?.includes(p))) {
    const s = t.surface(token, hasPage);
    const u = new Set(usage);
    if (s === false && u.has('surface')) { u.delete('surface'); applied.push('B3'); }
    // A page sibling is required for surface, not proof of it: the test only removes.
    f.set('usage', [...u]);
  }
  // B4
  if ((f.get('usage') ?? []).includes('on-fill') && ['text', 'icon', 'foreground'].some((p) => f.get('property')?.includes(p))) {
    const code = t.onFill(token);
    const decided = code ?? jevB4?.get(token); // the code test first; Jev's statement judgement only where code finds no evidence
    if (decided === false) { f.set('usage', (f.get('usage') ?? []).filter((x) => x !== 'on-fill')); applied.push(code === undefined ? 'B4/jev' : 'B4'); }
  }
  // B6
  const prop = f.get('property')?.[0];
  // Syntax, code-surface and link colors are text by nature whatever the name says (triage, 2026-11-01): B6 skips them.
  const textByNature = f.has('syntax') || (f.get('usage') ?? []).some((u) => u === 'code-surface' || u === 'link');
  if ((prop === 'text' || prop === 'foreground') && !textByNature) {
    const txt = t.textNotForeground(token);
    if (txt === true && prop === 'foreground') { f.set('property', ['text']); applied.push('B6'); }
    if (txt === false && prop === 'text') { f.set('property', ['foreground']); applied.push('B6'); }
  }
  return { concept: conceptOf(domain, f), applied, needsEmphasis };
}
