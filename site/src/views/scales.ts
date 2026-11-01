import type { Concept, Token } from '../data';
import { el, tokenHref } from '../ui';

export type Category = 'color' | 'geometry' | 'typography' | 'motion';
const GEOMETRY = new Set(['space', 'size', 'shape', 'layout', 'elevation']);

/** Category of a token: from its mapped concept's domain, else from its DTCG type. */
export function categoryOf(t: Token): Category {
  const d = t.m[0]?.[0].match(/^dsi:concept\/([a-z]+)\//)?.[1];
  if (d) return d === 'color' || d === 'opacity' ? 'color' : d === 'typography' ? 'typography' : d === 'motion' ? 'motion' : GEOMETRY.has(d) ? 'geometry' : 'geometry';
  if (t.t === 'color') return 'color';
  if (t.t === 'fontFamily' || t.t === 'fontWeight') return 'typography';
  if (t.t === 'duration' || t.t === 'cubicBezier' || t.t === 'transition') return 'motion';
  return 'geometry';
}

/** px from a display value ("0.5rem", "8px", "200ms" -> number in its unit); undefined when not numeric. */
export function numeric(display?: string): { n: number; unit: 'px' | 'ms' | '' } | undefined {
  if (!display) return undefined;
  let m = display.match(/^(-?[\d.]+)(px|rem|ms|s)?$/);
  if (!m) return undefined;
  const v = Number(m[1]), u = m[2] ?? '';
  if (u === 'rem') return { n: v * 16, unit: 'px' };
  if (u === 's') return { n: v * 1000, unit: 'ms' };
  return { n: v, unit: (u as 'px' | 'ms' | '') };
}

const valueOf = (t: Token, theme: string) => (t.v?.[theme] ?? t.v?.all ?? Object.values(t.v ?? {})[0])?.[0];
const role = (t: Token, byIri: Map<string, Concept>) => (t.m[0] ? byIri.get(t.m[0][0]) : undefined);

/** One ruler row: name, a bar to a shared scale, the value. */
function rulerRow(product: string, t: { p: string; dep?: string }, name: string, value: string | undefined, max: number, unit: string, pxOnly = false) {
  const num = numeric(value);
  const bar = el('span', { class: 'bar-fill' + (num && max && Math.abs(num.n) > max ? ' capped' : '') });
  bar.style.width = num && max ? `${Math.max(1.5, Math.min(100, (100 * Math.abs(num.n)) / max))}%` : '0';
  return el('a', { class: 'ruler-row' + (t.dep ? ' is-dep' : ''), href: tokenHref(product, t.p), 'data-link': true, title: t.p },
    el('span', { class: 'ruler-name mono' }, name, t.dep ? el('span', { class: 'dep', text: 'deprecated', title: t.dep }) : null),
    el('span', { class: 'ruler-track' }, bar),
    el('span', { class: 'ruler-value mono', text: num ? pxOnly && num.unit === 'px' ? `${round(num.n)}px` : `${value}${num.unit === 'px' && !String(value).endsWith('px') ? ` · ${round(num.n)}px` : ''}` : value ?? '—' }));
  void unit;
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Scale maximum for bars: the largest value, unless it is an outlier (a "full" radius of 9999px), then the next. */
export function scaleMax(values: number[]): number {
  const v = values.filter((n) => !Number.isNaN(n)).map(Math.abs).sort((a, b) => b - a);
  if (!v.length) return 0;
  return v.length > 1 && v[0] > 4 * v[1] && v[1] > 0 ? v[1] * 1.15 : v[0];
}

/** A small drawing of a cubic-bezier easing curve. */
function easingCurve(value?: string) {
  let pts: number[] | undefined;
  try { const a = JSON.parse(value ?? ''); if (Array.isArray(a) && a.length === 4) pts = a.map(Number); } catch { /* not a curve */ }
  const m = !pts && value?.match(/cubic-bezier\(([^)]+)\)/);
  if (m) pts = m[1].split(',').map(Number);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-4 -4 48 48'); svg.setAttribute('class', 'curve'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', value ?? 'easing');
  if (pts) {
    const [x1, y1, x2, y2] = pts;
    const P = (x: number, y: number) => `${x * 40} ${40 - y * 40}`;
    const frame = document.createElementNS(svg.namespaceURI, 'path'); frame.setAttribute('d', 'M0 40 L40 40 M0 40 L0 0'); frame.setAttribute('class', 'curve-axis');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', `M${P(0, 0)} C${P(x1, y1)} ${P(x2, y2)} ${P(1, 1)}`); path.setAttribute('class', 'curve-line');
    svg.append(frame, path);
  }
  return svg;
}

/** Strip a typography property suffix to get the type style a token belongs to (body-large-font -> body-large). */
/** The property part of a concept label ("Heading · Font size · Productive" -> "Font size"). */
const propLabel = (c: Concept | undefined) => { if (!c) return undefined; const i = Object.keys(c.facets).indexOf('property'); const parts = c.label.split(' · '); return parts[i] ?? parts.at(-1); };
const styleKey = (name: string) => name.replace(/[-.](font-family|font-size|font-weight|font-line-height|font-letter-spacing|line-height|letter-spacing|tracking|weight|size|font)$/, '');

/** A concept's members in one system, as a ruler (or curves), for concept pages. */
export function memberRuler(product: string, members: [string, string, string][], short: (p: string) => string) {
  const sorted = [...members].sort((a, b) => (numeric(a[1])?.n ?? 1e12) - (numeric(b[1])?.n ?? 1e12) || a[0].localeCompare(b[0]));
  if (members.every((m) => /^\[|cubic-bezier/.test(m[1]))) return el('div', { class: 'curves' }, sorted.map(([t, d]) => el('a', { class: 'curve-card', href: tokenHref(product, t), 'data-link': true, title: t }, easingCurve(d), el('span', { class: 'mono', text: short(t) }))));
  const max = scaleMax(sorted.map((m) => numeric(m[1])?.n ?? NaN));
  return el('div', { class: 'ruler compact' }, sorted.map(([t, d]) => rulerRow(product, { p: t }, short(t), d, max, '', true)));
}

export function renderScales(category: Category, product: string, ts: Token[], byIri: Map<string, Concept>, theme: string, short: (p: string) => string): HTMLElement[] {
  if (category === 'typography') {
    const styles = new Map<string, Token[]>();
    const loose: Token[] = [];
    for (const t of ts) { const k = styleKey(t.p); if (k !== t.p) (styles.get(k) ?? styles.set(k, []).get(k)!).push(t); else loose.push(t); }
    const prop = (t: Token) => role(t, byIri)?.facets.property;
    const specimens = [...styles].map(([key, members]) => {
      const get = (p: string) => members.find((t) => prop(t) === p);
      const size = numeric(valueOf(get('font-size') ?? ({} as Token), theme));
      const lh = numeric(valueOf(get('line-height') ?? ({} as Token), theme));
      const weight = valueOf(get('font-weight') ?? ({} as Token), theme);
      let family = valueOf(get('font-family') ?? ({} as Token), theme);
      try { const a = JSON.parse(family ?? ''); if (Array.isArray(a)) family = a.map((f: string) => (/\s/.test(f) ? `"${f}"` : f)).join(', '); } catch { /* plain */ }
      const sample = el('div', { class: 'type-sample', text: 'The quick brown fox jumps over the lazy dog' });
      if (size) sample.style.fontSize = `${Math.min(size.n, 64)}px`;
      if (lh) sample.style.lineHeight = lh.unit === '' ? String(lh.n) : `${Math.min(lh.n, 76)}px`;
      if (weight) sample.style.fontWeight = weight;
      if (family) sample.style.fontFamily = family;
      return { size: size?.n ?? 0, node: el('div', { class: 'type-row' },
        el('div', { class: 'type-meta' }, el('b', { class: 'mono', text: short(key) }),
          el('span', { class: 'none-note', text: [size && `${round(size.n)}px`, lh && `/${lh.unit === '' ? lh.n : `${round(lh.n)}px`}`, weight && `· ${weight}`].filter(Boolean).join(' ') }),
          el('span', { class: 'type-tokens' }, members.map((t) => el('a', { class: 'tok-chip', href: tokenHref(product, t.p), 'data-link': true, title: `${t.p}: ${valueOf(t, theme)}`, text: propLabel(role(t, byIri)) ?? short(t.p) })))),
        sample) };
    }).sort((a, b) => b.size - a.size).map((x) => x.node);
    const out: HTMLElement[] = [];
    if (specimens.length) out.push(el('section', { class: 'group' }, el('div', { class: 'group-head' }, el('h3', { text: 'Type styles' }), el('span', { class: 'none-note', text: `${specimens.length} styles, largest first` })), el('div', { class: 'type-list' }, specimens)));
    if (loose.length) out.push(...rolesSections(product, loose, byIri, theme, short));
    return out;
  }
  return rolesSections(product, ts, byIri, theme, short);
}

/** Geometry and motion: one section per role, members sorted by value; rulers, durations, curves. */
function rolesSections(product: string, ts: Token[], byIri: Map<string, Concept>, theme: string, short: (p: string) => string): HTMLElement[] {
  const groups = new Map<string, Token[]>();
  for (const t of ts) { const c = role(t, byIri); const k = c ? c.label : 'No role yet'; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
  return [...groups].sort(([a], [b]) => (a === 'No role yet' ? 1 : b === 'No role yet' ? -1 : a.localeCompare(b))).map(([label, items], i) => {
    const isCurve = items.every((t) => t.t === 'cubicBezier');
    const nums = items.map((t) => numeric(valueOf(t, theme))?.n ?? NaN);
    const max = scaleMax(nums);
    const sorted = items.map((t, k) => ({ t, n: nums[k] })).sort((a, b) => (Number.isNaN(a.n) ? 1e12 : a.n) - (Number.isNaN(b.n) ? 1e12 : b.n) || a.t.p.localeCompare(b.t.p)).map((x) => x.t);
    const body = isCurve
      ? el('div', { class: 'curves' }, sorted.map((t) => el('a', { class: 'curve-card', href: tokenHref(product, t.p), 'data-link': true, title: t.p }, easingCurve(valueOf(t, theme)), el('span', { class: 'mono', text: short(t.p) }), el('span', { class: 'none-note mono', text: valueOf(t, theme) ?? '' }))))
      : el('div', { class: 'ruler' }, sorted.map((t) => rulerRow(product, t, short(t.p), valueOf(t, theme), max, '')));
    return el('section', { class: 'group', id: `scale-${i}` },
      el('div', { class: 'group-head' }, el('h3', { text: label }), el('span', { class: 'none-note', text: `${items.length} token${items.length === 1 ? '' : 's'}${isCurve ? '' : max ? ' · drawn to scale' : ''}` })),
      body);
  });
}
