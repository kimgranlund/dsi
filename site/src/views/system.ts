import { concepts, groups as loadGroups, meta, tokens, type Product, type Token } from '../data';
import { el, orderModes, pill, setTitle, swatch, tokenHref } from '../ui';

type ViewGroup = { id: string; label: string; meaning?: string; native?: string; note?: string; tokens: string[]; subgroups: { label: string; tokens: string[] }[] };
const FACET_PRIORITY = ['usage', 'intent', 'syntax', 'property'] as const;
const STATE_RANK: Record<string, number> = { hover: 1, active: 2, focus: 3, selected: 4, disabled: 6, visited: 7 };
const EMPHASIS_SIGNED: Record<string, number> = { subtlest: -2, subtle: -1, default: 0, strong: 1, strongest: 2 };

/** Hue (0-360) and saturation of a hex display value, for ordering palette families. */
function hueOf(display?: string): { h: number; s: number } | undefined {
  const m = display && /^#([0-9a-f]{6})/i.exec(display);
  if (!m) return undefined;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return { h: 0, s: 0 };
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: sat };
}

/** Palette family and step of the token an alias chain ends at: red.60 -> red / 60; md.ref.palette.primary40 -> primary / 40. */
function sourceOf(chain: string[]): { family: string; step?: number; path: string } | undefined {
  const end = chain.at(-1);
  if (!end) return undefined;
  const segs = end.replace(/^md\.ref\.palette\./, '').replace(/^colors\./, '').replace(/^size\./, 'size.').split('.');
  const m = segs[0].match(/^([a-zA-Z-]+?)(\d+)?$/);
  const family = (m?.[1] ?? segs[0]).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const stepStr = m?.[2] ?? segs[1];
  return { family, step: stepStr !== undefined && /^\d+$/.test(stepStr) ? Number(stepStr) : undefined, path: end };
}
const title = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/-/g, ' ').replace(/^Ai\b/, 'AI');

const SOURCE: Record<string, string> = { 'shipped-groups': 'Groups and order as the system ships them', 'shipped-order': 'Grouped by name, in the order the system’s source declares them', 'name-family': 'Grouped by name, ordered base → pairs → variants → states' };

export async function systemView(main: HTMLElement, p: Product) {
  setTitle(p.name);
  const [m, ts, cs, gs] = await Promise.all([meta(), tokens(p.id), concepts(), loadGroups(p.id)]);
  const byIri = new Map(cs.map((c) => [c.iri, c]));
  const byPath = new Map(ts.map((t) => [t.p, t]));
  const modeNames = orderModes(Object.keys(p.modes));
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const modePick = el('select', { id: 'tok-mode', 'aria-label': 'Swatch mode' }, modeNames.map((mode) => el('option', { value: mode, text: `Swatches: ${mode}`, selected: mode === (prefersDark && p.modes.dark ? 'dark' : modeNames[0]) || undefined })));
  const themeOf = () => p.modes[modePick.value] ?? Object.values(p.modes)[0] ?? 'all';
  const filter = el('input', { type: 'search', id: 'tok-filter', placeholder: 'Filter tokens', 'aria-label': 'Filter tokens' });
  const status = el('select', { id: 'tok-status', 'aria-label': 'Mapping status' }, el('option', { value: '', text: 'All tokens' }), el('option', { value: 'mapped', text: 'Mapped' }), el('option', { value: 'unmapped', text: 'No concept fits' }));
  const groupBy = el('select', { id: 'tok-group', 'aria-label': 'Group by' }, el('option', { value: 'system', text: 'Group by: system groups' }), el('option', { value: 'namespace', text: 'Group by: namespace' }), el('option', { value: 'source', text: 'Group by: source color' }));
  try { const saved = localStorage.getItem('dsi-group-by'); if (saved) groupBy.value = saved; } catch { /* storage unavailable */ }
  const caption = el('span', { class: 'none-note' });
  const body = el('div', { class: 'groups' });
  const jump = el('nav', { class: 'chips jump', 'aria-label': 'Token groups' });

  const card = (t: Token) => {
    const v = t.v?.[themeOf()] ?? t.v?.all ?? Object.values(t.v ?? {})[0];
    const c = t.m[0] && byIri.get(t.m[0][0]);
    return el('a', { class: 'row-card', href: tokenHref(p.id, t.p), 'data-link': true }, swatch(v?.[0]),
      el('div', { class: 'meta' }, el('span', { class: 'name mono', text: t.p }), el('span', { class: 'sub', text: c ? `→ ${c.label}` : t.u ? 'no concept fits' : t.n })));
  };
  const facetLabel = (f: string, v: string) => v.split('+').map((x) => m.facets[f]?.find((y) => y.value === x)?.label ?? title(x)).join(' + ');
  const facetsOf = (t: Token) => (t.m[0] ? byIri.get(t.m[0][0])?.facets : undefined);
  /** Base first, then pairs, emphasis as a ramp, then states: the same progression the structure stage uses. */
  const progression = (a: Token, b: Token) => {
    const fa = facetsOf(a) ?? {}, fb = facetsOf(b) ?? {};
    return (EMPHASIS_SIGNED[fa.emphasis ?? 'default'] ?? 0) - (EMPHASIS_SIGNED[fb.emphasis ?? 'default'] ?? 0) || (STATE_RANK[fa.state ?? ''] ?? 0) - (STATE_RANK[fb.state ?? ''] ?? 0) || a.p.localeCompare(b.p);
  };
  // Designer order from the system's own structure, used before the generic progression.
  const designOrder = new Map<string, number>();
  (gs?.groups ?? []).forEach((g) => [...g.tokens, ...g.subgroups.flatMap((x) => x.tokens)].forEach((t) => designOrder.set(t, designOrder.size)));
  const byDesign = (a: Token, b: Token) => (designOrder.get(a.p) ?? 1e9) - (designOrder.get(b.p) ?? 1e9) || progression(a, b);
  const syntaxRoot = (v: string) => { let cur = v; for (let i = 0; i < 6; i++) { const b = m.facets.syntax?.find((x) => x.value === cur)?.broader; if (!b) break; cur = b; } return cur; };
  const namespaceGroups = (): ViewGroup[] => {
    const top = new Map<string, Map<string, Token[]>>();
    const none: Token[] = [];
    for (const t of ts) {
      const f = facetsOf(t);
      if (!f) { none.push(t); continue; }
      const i = FACET_PRIORITY.findIndex((k) => f[k]);
      if (i < 0) { none.push(t); continue; }
      const facet = FACET_PRIORITY[i];
      const [first, ...others] = f[facet].split('+');
      let key: string, sub: string;
      if (facet === 'syntax') { key = 'syntax:*'; sub = `syntax:${syntaxRoot(first)}`; }
      else {
        key = `${facet}:${first}`;
        // Combined values fold into their first value; the rest, or the next facet, forms the subgroup.
        const subFacet = FACET_PRIORITY.slice(i + 1).find((k) => f[k]);
        sub = others.length ? `${facet}:${others.join('+')}` : subFacet ? `${subFacet}:${f[subFacet].split('+')[0]}` : '';
      }
      const g = top.get(key) ?? top.set(key, new Map()).get(key)!;
      (g.get(sub) ?? g.set(sub, []).get(sub)!).push(t);
    }
    const order = (k: string) => FACET_PRIORITY.indexOf(k.split(':')[0] as (typeof FACET_PRIORITY)[number]);
    const out: ViewGroup[] = [...top].sort(([a, x], [b, y]) => order(a) - order(b) || [...y.values()].flat().length - [...x.values()].flat().length).map(([k, subs], i) => {
      const [f, v] = k.split(':');
      const main = (subs.get('') ?? []).sort(byDesign).map((t) => t.p);
      const label = f === 'syntax' ? 'Code' : facetLabel(f, v);
      return { id: `ns-${i}`, label, note: f === 'syntax' ? 'syntax roles, by Lezer tag family' : f, tokens: main, subgroups: [...subs].filter(([s2]) => s2).sort(([a, x], [b, y]) => (designOrder.get(x[0].p) ?? 1e9) - (designOrder.get(y[0].p) ?? 1e9) || a.localeCompare(b)).map(([s2, items]) => { const [sf, sv] = s2.split(':'); return { label: facetLabel(sf, sv), tokens: items.sort(byDesign).map((t) => t.p) }; }) };
    });
    if (none.length) out.push({ id: 'ns-none', label: 'No concept yet', note: 'unmapped', tokens: none.sort((a, b) => a.p.localeCompare(b.p)).map((t) => t.p), subgroups: [] });
    return out;
  };
  const sourceGroups = (): ViewGroup[] => {
    const theme = themeOf();
    const fams = new Map<string, Map<number | 'x', { path: string; tokens: Token[] }>>();
    const literal: Token[] = [];
    for (const t of ts) {
      const v = t.v?.[theme] ?? t.v?.all ?? Object.values(t.v ?? {})[0];
      const src = v && sourceOf(v[1]);
      if (!src) { literal.push(t); continue; }
      const f = fams.get(src.family) ?? fams.set(src.family, new Map()).get(src.family)!;
      const k = src.step ?? 'x';
      const e = f.get(k) ?? f.set(k, { path: src.path, tokens: [] }).get(k)!;
      e.tokens.push(t);
    }
    const famHue = (f: Map<number | 'x', { tokens: Token[] }>) => {
      const hs = [...f.values()].flatMap((x) => x.tokens).map((t) => hueOf((t.v?.[theme] ?? Object.values(t.v ?? {})[0])?.[0])).filter((x): x is { h: number; s: number } => !!x);
      const sat = hs.reduce((a, x) => a + x.s, 0) / (hs.length || 1);
      const h = hs.length ? hs[Math.floor(hs.length / 2)].h : 0;
      return sat < 0.12 ? -1 : h;
    };
    const out: ViewGroup[] = [...fams].sort(([a, x], [b, y]) => famHue(x) - famHue(y) || a.localeCompare(b)).map(([family, steps], i) => ({
      id: `src-${i}`, label: title(family), note: 'palette',
      tokens: [],
      subgroups: [...steps].sort(([a], [b]) => (a === 'x' ? 1e9 : a) - (b === 'x' ? 1e9 : b)).map(([step, e]) => ({ label: step === 'x' ? e.path : `${title(family)} ${step}`, tokens: e.tokens.sort(byDesign).map((t) => t.p) })),
    }));
    if (literal.length) out.push({ id: 'src-literal', label: 'Literal values', note: 'no alias to a palette token', tokens: literal.sort((a, b) => a.p.localeCompare(b.p)).map((t) => t.p), subgroups: [] });
    return out;
  };

  const render = () => {
    try { localStorage.setItem('dsi-group-by', groupBy.value); } catch { /* storage unavailable */ }
    const q = filter.value.trim().toLowerCase();
    const ok = (t: Token | undefined): t is Token => !!t && (!q || t.p.toLowerCase().includes(q) || t.n.toLowerCase().includes(q) || (t.d ?? '').toLowerCase().includes(q)) && (!status.value || (status.value === 'mapped' ? t.m.length > 0 : !!t.u));
    const systemList: ViewGroup[] = gs?.groups ?? [{ id: 'all', label: 'Tokens', tokens: [...ts].sort((a, b) => a.p.localeCompare(b.p)).map((t) => t.p), subgroups: [] }];
    const list: (ViewGroup & { properties?: string[] })[] = groupBy.value === 'namespace' ? namespaceGroups() : groupBy.value === 'source' ? sourceGroups() : systemList;
    caption.textContent = groupBy.value === 'namespace' ? 'Grouped by canonical role: usage, then intent, then property' : groupBy.value === 'source' ? `Grouped by the palette token each alias chain ends at (${modePick.value} mode)` : gs ? SOURCE[gs.kind] : `${ts.length} tokens`;
    const sections: HTMLElement[] = [];
    const chips: HTMLElement[] = [];
    for (const g of list) {
      const main = g.tokens.map((x) => byPath.get(x)).filter(ok);
      const subs = g.subgroups.map((s) => ({ s, items: s.tokens.map((x) => byPath.get(x)).filter(ok) })).filter((x) => x.items.length);
      const n = main.length + subs.reduce((a, x) => a + x.items.length, 0);
      if (!n) continue;
      const id = `group-${g.id}`;
      chips.push(el('a', { class: 'chip', href: `#${id}`, onclick: (e: Event) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }, g.label, el('small', { text: String(n) })));
      sections.push(el('section', { class: 'group', id, 'aria-labelledby': `${id}-h` },
        el('div', { class: 'group-head' },
          el('h3', { id: `${id}-h` }, g.label, g.meaning ? el('span', { class: 'meaning', text: ` means ${g.meaning}` }) : null),
          el('span', { class: 'none-note', text: `${n} token${n === 1 ? '' : 's'}${g.note ? ` · ${g.note}` : ''}${g.native && g.native !== g.label.toLowerCase() ? ` · ${g.native}-` : ''}${g.properties?.length ? ` · paints ${g.properties.join(', ')}` : ''}` })),
        main.length ? el('div', { class: 'list' }, main.map(card)) : null,
        subs.map(({ s, items }) => el('div', { class: 'subgroup' }, el('h4', { text: s.label }), el('div', { class: 'list' }, items.map(card))))));
    }
    jump.replaceChildren(...chips);
    body.replaceChildren(...(sections.length ? sections : [el('p', { class: 'none-note', text: 'No tokens match this filter.' })]));
  };
  filter.addEventListener('input', render); status.addEventListener('change', render); modePick.addEventListener('change', render); groupBy.addEventListener('change', render);
  render();
  main.replaceChildren(
    el('section', {},
      el('span', { class: 'eyebrow', text: `${p.organization ?? ''} · design system` }),
      el('h1', { text: p.name }),
      el('p', { class: 'lede', text: p.description }),
      el('dl', { class: 'facts' },
        el('dt', { text: 'Ingested from' }), el('dd', {}, el('code', { text: `${p.implementation} ${p.version}` })),
        el('dt', { text: 'Modes' }), el('dd', { text: orderModes(Object.keys(p.modes)).map((mode) => (mode === p.modes[mode] ? mode : `${mode} (${p.modes[mode]})`)).join(', ') }),
        el('dt', { text: 'License' }), el('dd', {}, p.license ?? '', p.redistribution === 'restricted' ? ' · ' : '', p.redistribution === 'restricted' ? pill('nearest', 'restricted', 'Published by owner decision; see ADR 0009') : null),
        p.homepage ? el('dt', { text: 'Docs' }) : null, p.homepage ? el('dd', {}, el('a', { href: p.homepage, rel: 'noopener', text: p.homepage })) : null),
      el('div', { class: 'stat-row' }, el('span', {}, el('b', { text: String(p.counts.tokens) }), ' tokens ingested'), el('span', {}, el('b', { text: String(p.counts.mapped) }), ' mapped'), el('span', {}, el('b', { text: String(p.counts.unmapped) }), ' no concept fits'), el('span', {}, el('b', { text: `${p.counts.answered} / ${m.concepts}` }), ' concepts answered'))),
    el('section', {},
      el('div', { class: 'section-head' }, el('h2', { text: 'Semantic and mapped tokens' }), caption),
      el('div', { class: 'filters' }, filter, groupBy, status, modeNames.length > 1 ? modePick : null),
      jump,
      body),
  );
}
