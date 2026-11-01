import fs from 'node:fs';
import path from 'node:path';

/**
 * What a system's own component CSS says about a token (data/usage/<product>/<version>.json), as facet evidence:
 * the property it colors, the states it appears in, whether it sits on a filled background, and the kind of
 * container it paints. Evidence is decisive only when a clear majority of uses agree.
 */
export interface Use { token: string; component: string; selector: string; property: string; state?: string; background?: string }
export interface Evidence { uses: number; components: string[]; property?: string; propertyShare: number; state?: string; stateShare: number; onBackground: number; container?: string }

export function propertyClass(u: Use): string | undefined {
  const p = u.property;
  if (/^background(-color|-image)?$/.test(p)) return 'background';
  if (/^(fill|stroke)$/.test(p)) return 'icon';
  if (p === 'color' || p === 'text-decoration-color' || p === '-webkit-text-fill-color' || p === 'caret-color') return /icon|svg|Icon|glyph/.test(u.selector) ? 'icon' : 'text';
  if (/^border|^outline/.test(p)) return /focus/.test(u.state ?? '') || p.startsWith('outline') ? 'focus-ring|border' : 'border';
  if (/shadow/.test(p)) return 'shadow';
  return undefined;
}

export function loadUsage(root: string, product: string, version: string): Map<string, Use[]> | undefined {
  const f = path.join(root, 'data', 'usage', product, `${version}.json`);
  if (!fs.existsSync(f)) return undefined;
  const by = new Map<string, Use[]>();
  const seen = new Set<string>();
  for (const u of JSON.parse(fs.readFileSync(f, 'utf8')).uses as Use[]) {
    const k = `${u.token}|${u.selector}|${u.property}`;
    if (seen.has(k)) continue; // the same rule shipped in two files counts once
    seen.add(k);
    (by.get(u.token) ?? by.set(u.token, []).get(u.token)!).push(u);
  }
  return by;
}

export function evidenceOf(uses: Use[]): Evidence {
  const top = (xs: (string | undefined)[]) => { const c = new Map<string, number>(); for (const x of xs) c.set(x ?? 'none', (c.get(x ?? 'none') ?? 0) + 1); const [k, n] = [...c].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0]; return { k, share: xs.length ? n / xs.length : 0 }; };
  const props = uses.map(propertyClass).filter(Boolean) as string[];
  const p = top(props), s = top(uses.map((u) => u.state));
  const content = uses.filter((u) => ['text', 'icon'].includes(propertyClass(u) ?? ''));
  const bgs = uses.filter((u) => propertyClass(u) === 'background');
  const cont = bgs.map((u) => (/popover|menu|tooltip|dialog|modal|tray|toast|coachmark|overlay/i.test(u.selector + u.component) ? 'overlay' : /card|well|panel|accordion|table|tile|box\b|Box/i.test(u.selector + u.component) ? 'surface' : undefined));
  const c = top(cont.filter(Boolean));
  return { uses: uses.length, components: [...new Set(uses.map((u) => u.component))].slice(0, 8), property: props.length ? p.k : undefined, propertyShare: p.share, state: s.k === 'none' ? undefined : s.k, stateShare: s.share, onBackground: content.length ? content.filter((u) => u.background).length / content.length : 0, container: cont.filter(Boolean).length / Math.max(1, bgs.length) >= 0.5 ? c.k : undefined };
}

/** Does the evidence agree with a concept's property and state? undefined when the evidence is not decisive. */
export function agrees(e: Evidence, concept: string): { property?: boolean; state?: boolean; container?: boolean } {
  const f = new Map(concept.split('/').slice(2).map((seg) => [seg.slice(0, seg.indexOf('-')), seg.slice(seg.indexOf('-') + 1)] as const));
  const prop = f.get('property'), state = f.get('state') ?? 'none', usage = (f.get('usage') ?? '').split('+');
  const out: { property?: boolean; state?: boolean; container?: boolean } = {};
  if (e.property && e.propertyShare >= 0.7 && prop) {
    const ok: Record<string, string[]> = { background: ['background', 'fill'], text: ['text'], icon: ['icon'], foreground: ['text', 'icon'], border: ['border', 'focus-ring|border'], 'focus-ring': ['focus-ring|border'], shadow: ['shadow'], graphic: ['icon', 'background'] };
    out.property = (ok[prop] ?? [prop]).includes(e.property);
  }
  if (e.stateShare >= 0.7) out.state = state.split('+').includes(e.state ?? 'none') || (state === 'none' && !e.state);
  if (e.container) out.container = usage.includes(e.container);
  return out;
}
