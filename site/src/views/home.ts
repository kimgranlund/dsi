import { components, concepts, meta, type ComponentDoc, type Concept, type Meta, type Product } from '../data';
import { conceptHref, el, link, setTitle, swatch } from '../ui';
import { numeric } from './scales';

/** Specimen parts: each lists canonical names in order of preference. */
const PARTS: { part: string; names: string[] }[] = [
  { part: 'Page', names: ['page-background'] },
  { part: 'Card', names: ['surface-background'] },
  { part: 'Card border', names: ['border'] },
  { part: 'Heading text', names: ['text', 'surface-foreground'] },
  { part: 'Body text', names: ['text-subtle', 'foreground-subtle'] },
  { part: 'Error banner', names: ['danger-surface-background', 'danger-background-subtle'] },
  { part: 'Error text', names: ['danger-text'] },
  { part: 'Primary button', names: ['accent-background'] },
  { part: 'Primary button label', names: ['accent-on-fill-foreground', 'accent-on-fill-text', 'on-fill-text'] },
  { part: 'Delete button', names: ['danger-background'] },
  { part: 'Delete button label', names: ['danger-on-fill-foreground', 'on-fill-text'] },
  { part: 'Link', names: ['link-text'] },
];

const SHORT = (n: string) => n.replace(/ Design System| Design 3/, '');
const STATUS: Record<string, string> = { mapped: 'Mapped', 'in-progress': 'Mapping in progress', 'not-started': 'Mapping not started' };

/** A display value ("#c9372c", "#000000 @ 0.4") as a CSS color. */
const cssColor = (d?: string) => {
  const m = d ? /^(#[0-9a-f]{6})(?: @ ([\d.]+))?$/i.exec(d) : null;
  if (!m) return undefined;
  return m[2] ? `${m[1]}${Math.round(Number(m[2]) * 255).toString(16).padStart(2, '0')}` : m[1];
};

/** Small multiples: the same sample card painted by each system's own answers, one mode for all. */
function multiples(cs: Concept[], products: Product[]) {
  const byName = new Map(cs.map((c) => [c.name, c]));
  let mode = 'light';
  const grid = el('div', { class: 'multiples' });
  const modes = ['light', 'dark'];
  const toggle = modes.map((m) => el('button', { type: 'button', text: m === 'light' ? 'Light' : 'Dark', onclick: () => { mode = m; draw(); } }));
  function draw() {
    toggle.forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i] === mode)));
    grid.replaceChildren(...products.map((p) => {
      const vars: string[] = [];
      let answered = 0;
      for (const { names } of PARTS) for (const n of names) {
        const c = cssColor(byName.get(n)?.cells[p.id]?.[mode]?.d);
        if (c) { vars.push(`--dsi-color-${n}: ${c}`); answered++; break; }
      }
      const ui = el('div', { class: 'specimen mini', style: vars.join(';'), 'aria-hidden': 'true' },
        el('div', { class: 'sp-card' },
          el('h4', { text: 'Payment method' }),
          el('p', { text: 'Cards are charged on the first of each month.' }),
          el('div', { class: 'sp-banner', text: 'Your card was declined.' }),
          el('div', { class: 'sp-actions' }, el('span', { class: 'sp-btn accent', text: 'Save' }), el('span', { class: 'sp-btn danger', text: 'Remove' })),
          el('span', { class: 'sp-link', text: 'Billing history' })));
      const st = p.home?.status ?? 'mapped';
      return el('figure', { class: 'multi' + (st !== 'mapped' ? ' pending' : '') }, ui,
        el('figcaption', {}, link(`/system/${p.id}`, SHORT(p.name)), el('span', { class: 'none-note', text: st === 'not-started' ? STATUS[st] : `${answered} of ${PARTS.length} parts${st === 'in-progress' ? ' · in progress' : ''}` })));
    }));
  }
  draw();
  return el('section', { 'aria-labelledby': 'multi-h' },
    el('div', { class: 'section-head' }, el('h2', { id: 'multi-h', text: 'One interface, every system' }), el('div', { class: 'switcher', role: 'group', 'aria-label': 'Mode' }, toggle)),
    el('p', { class: 'none-note', text: 'Each card is painted only with that system’s approved tokens for page, surface, border, text, danger, accent and link. Dashed outlines are parts it has no approved token for yet.' }),
    grid);
}

/** One concept at a time, every system's answer: a swatch for colors, the whole scale for roles, values for component slots. */
function strip(cs: Concept[], products: Product[], comps: ComponentDoc[]) {
  const byName = new Map(cs.map((c) => [c.name, c]));
  const button = comps.find((c) => c.id === 'button');
  const padding = button?.slots.find((s) => s.part === 'container' && s.role === 'padding' && s.axis === 'inline' && !s.state);
  const cell = (p: Product, body: HTMLElement, sub?: string) => el('div', { class: 'strip-cell' }, el('span', { class: 'strip-sys', text: SHORT(p.name) }), body, sub ? el('span', { class: 'none-note mono strip-sub', text: sub }) : null);
  const empty = (p: Product) => cell(p, el('span', { class: 'none-note', text: p.home?.status === 'mapped' ? 'no approved token' : 'not mapped yet' }));
  const colorRow = (c?: Concept) => el('div', { class: 'strip-row' }, products.map((p) => {
    const x = c?.cells[p.id]?.light;
    return x ? cell(p, el('span', { class: 'strip-swatch' }, swatch(x.d), el('span', { class: 'mono', text: x.d })), x.t) : empty(p);
  }));
  const scaleRow = (c?: Concept) => {
    const vals = (p: Product) => (c?.members?.[p.id] ?? []).map((m) => numeric(m[1])?.n).filter((n): n is number => n !== undefined && n < 500).sort((a, b) => a - b);
    const max = Math.max(1, ...products.flatMap(vals));
    return el('div', { class: 'strip-row' }, products.map((p) => {
      const ms = vals(p);
      if (!ms.length) return empty(p);
      return cell(p, el('span', { class: 'strip-scale' }, ms.map((n) => el('i', { title: `${n}px`, style: `height:${Math.max(3, (100 * n) / max)}%` }))), `${ms.length} steps · ${ms[0]}–${ms[ms.length - 1]}px`);
    }));
  };
  const slotRow = () => el('div', { class: 'strip-row' }, products.map((p) => {
    if (button?.systems[p.id]?.every((x) => x.absent)) return cell(p, el('span', { class: 'none-note', text: 'no component' }));
    const x = padding?.cells[p.id]?.[0];
    return x ? cell(p, el('span', { class: 'mono strip-value', text: x.value ?? '' }), x.token ?? (x.computed ? 'computed' : 'literal')) : empty(p);
  }));
  const TABS: { label: string; layer: string; render: () => HTMLElement }[] = [
    { label: 'Danger background', layer: 'Semantic', render: () => colorRow(byName.get('danger-background')) },
    { label: 'Surface', layer: 'System', render: () => colorRow(byName.get('surface-background')) },
    { label: 'Spacing', layer: 'Scale', render: () => scaleRow(byName.get('spacing')) },
    { label: 'Corner radius', layer: 'Scale', render: () => scaleRow(byName.get('corner-radius')) },
    { label: 'Body font size', layer: 'Scale', render: () => scaleRow(byName.get('body-font-size')) },
    { label: 'Button padding', layer: 'Component', render: slotRow },
  ];
  const body = el('div');
  const tabs = TABS.map((t, i) => el('button', { type: 'button', onclick: () => pick(i) }, el('small', { text: t.layer }), ' ', t.label));
  function pick(i: number) { tabs.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j))); body.replaceChildren(TABS[i].render()); }
  pick(0);
  return el('section', { 'aria-labelledby': 'strip-h' }, el('h2', { id: 'strip-h', text: 'Same question, every system' }), el('div', { class: 'switcher strip-tabs', role: 'group', 'aria-label': 'Concept' }, tabs), body);
}

/** The five layers with counts across all systems, and one real alias chain walked from component to raw value. */
function layers(m: Meta) {
  const sum = (k: string) => m.products.reduce((n, p) => n + (p.home?.tokensByScope[k] ?? 0), 0);
  const TIERS = [
    { n: 1, name: 'Source', note: 'Raw palettes: blue-800, neutral10', count: `${sum('palette').toLocaleString()} tokens` },
    { n: 2, name: 'Scale', note: 'Foundations: space-400, corner-medium', count: `${sum('foundation').toLocaleString()} tokens` },
    { n: 3, name: 'Semantic', note: 'Meaning: danger, accent, success', count: '' },
    { n: 4, name: 'System', note: 'Roles: surface, on-fill, border', count: `${sum('semantic').toLocaleString()} tokens (3 + 4)` },
    { n: 5, name: 'Component', note: 'Applied: button color, card padding', count: `${sum('component').toLocaleString()} tokens` },
  ];
  const f = m.featured;
  const TIER: Record<string, string> = { component: 'Component', semantic: 'Semantic · System', palette: 'Source', foundation: 'Scale' };
  return el('section', { 'aria-labelledby': 'layers-h' },
    el('h2', { id: 'layers-h', text: 'Five layers, one chain' }),
    el('div', { class: 'tiers' }, TIERS.map((t) => el('div', { class: 'tier' }, el('span', { class: 'tier-n', text: String(t.n) }), el('strong', { text: t.name }), el('span', { class: 'none-note', text: t.note }), el('span', { class: 'tier-count', text: t.count })))),
    f ? el('ol', { class: 'chain', 'aria-label': 'An alias chain from component to value' },
      ...f.steps.flatMap((s, i) => [el('li', {}, el('small', { text: TIER[f.scopes[i] ?? ''] ?? '' }), link(`/token/${f.product}/${encodeURIComponent(s)}`, el('code', { text: s }))), el('span', { class: 'chain-arrow', 'aria-hidden': 'true', text: '→' })]),
      el('li', { class: 'chain-value' }, el('small', { text: 'Value' }), el('span', { class: 'strip-swatch' }, swatch(f.value), el('code', { text: f.value })))) : null);
}

function systemCard(p: Product, total: number) {
  const h = p.home;
  const st = h?.status ?? 'mapped';
  const audited = h?.audit ? Object.values(h.audit).reduce((a, b) => a + b, 0) : 0;
  const cats: [string, number][] = [['Color', h?.byCat.color ?? 0], ['Geometry', h?.byCat.geometry ?? 0], ['Type', h?.byCat.typography ?? 0], ['Motion', h?.byCat.motion ?? 0], ['Components', h?.components ?? 0]];
  return el('a', { class: 'system-card', href: `/system/${p.id}`, 'data-link': true },
    el('div', { class: 'card-top' }, el('h3', { text: p.name }), el('span', { class: `status ${st}`, text: STATUS[st] })),
    el('span', { class: 'org', text: `${p.organization ?? ''} · v${p.version} · ${h?.license ?? p.license ?? ''}` }),
    el('dl', { class: 'cat-list' }, cats.map(([k, v]) => el('div', { class: 'cat-item' }, el('dt', { text: k }), el('dd', { text: String(v) })))),
    el('div', { class: 'bar', title: `${p.counts.answered} of ${total} concepts answered` }, el('i', { class: 'm', style: `width:${(100 * p.counts.answered) / total}%` })),
    el('span', { class: 'none-note', text: `${p.counts.tokens.toLocaleString()} tokens · ${p.counts.mapped} mapped${audited ? ` · audit ${h!.audit!.supported ?? 0}/${audited} supported` : ''}` }));
}

export async function home(main: HTMLElement) {
  setTitle('');
  const [m, cs, comps] = await Promise.all([meta(), concepts(), components()]);
  const rank = (p: Product) => ({ mapped: 0, 'in-progress': 1, 'not-started': 2 })[p.home?.status ?? 'mapped'];
  const products = [...m.products].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const ids = products.map((p) => p.id);
  const answers = (c: Concept) => ids.filter((id) => c.cells[id] || c.members?.[id]).length;
  const top = [...cs].sort((a, b) => answers(b) - answers(a) || a.label.localeCompare(b.label)).slice(0, 12);
  const intents = m.facets.intent.filter((v) => cs.some((c) => c.facets.intent?.split('+').includes(v.value)));
  const tokens = m.products.reduce((n, p) => n + p.counts.tokens, 0);
  const mapped = m.products.reduce((n, p) => n + p.counts.mapped, 0);
  const audits: Record<string, number> = {};
  for (const p of m.products) for (const [k, v] of Object.entries(p.home?.audit ?? {})) audits[k] = (audits[k] ?? 0) + v;
  const auditTotal = Object.values(audits).reduce((a, b) => a + b, 0);
  const q = document.getElementById('q') as HTMLInputElement;
  const tryQuery = (t: string) => { q.value = t; q.dispatchEvent(new Event('input', { bubbles: true })); q.focus(); };
  const EXAMPLES = ['danger', 'surface', '--ds-space-100', 'corner radius', 'button', 'primary40'];
  main.replaceChildren(
    el('section', { class: 'hero' },
      el('span', { class: 'eyebrow', text: `${m.products.length} design systems · ${tokens.toLocaleString()} tokens · ${m.concepts} concepts` }),
      el('h1', { text: 'Every design system’s tokens, in one vocabulary.' }),
      el('p', { class: 'lede', text: 'Polaris says critical, Material says error, Carbon says support-error, Atlassian says danger. The index reads each system’s shipped code, maps its tokens to shared concepts across five layers, from raw palette to component, and shows the real values in every mode with how close each match is.' }),
      el('div', { class: 'try' }, el('span', { class: 'none-note', text: 'Try' }), EXAMPLES.map((t) => el('button', { type: 'button', class: 'chip', text: t, onclick: () => tryQuery(t) })))),
    multiples(cs, products),
    strip(cs, products, comps),
    layers(m),
    el('section', {},
      el('div', { class: 'section-head' }, el('h2', { text: 'Systems' }), el('span', { class: 'none-note', text: `${m.products.filter((p) => p.home?.status === 'mapped').length} mapped · ${m.products.filter((p) => p.home?.status !== 'mapped').length} in progress` })),
      el('div', { class: 'systems' }, products.map((p) => systemCard(p, m.concepts)))),
    el('section', {},
      el('div', { class: 'section-head' }, el('h2', { text: 'Most-answered concepts' }), el('span', { class: 'none-note', text: `answered by N of ${ids.length} systems` })),
      el('div', { class: 'list' }, top.map((c) => el('div', { class: 'ranked' }, conceptRow(c, ids), el('span', { class: 'rank', text: `${answers(c)}/${ids.length}` }))))),
    el('section', { class: 'tiles' },
      link('/component', el('small', { text: 'Tier 5' }), el('strong', { text: 'Components' }), el('span', { class: 'none-note', text: `${comps.map((c) => c.label).join(', ')}: padding, gaps, radius and color per part` })),
      link('/concept/spacing', el('small', { text: 'Scales' }), el('strong', { text: 'Spacing, radius, type, motion' }), el('span', { class: 'none-note', text: 'Each system’s whole scale on one ruler' })),
      link('/ontology', el('small', { text: 'Ontology' }), el('strong', { text: 'The vocabulary' }), el('span', { class: 'none-note', text: 'Intent, usage, hue, style, emphasis, state: the SKOS concepts every mapping uses' }))),
    el('section', { class: 'trust' },
      el('h2', { text: 'How the index knows' }),
      el('ul', {},
        el('li', {}, el('strong', { text: 'Read from shipped code. ' }), 'Tokens come from the published packages (DTCG files, CSS, Sass, built JSON), read without running package code.'),
        el('li', {}, el('strong', { text: 'Two models must agree. ' }), `${mapped.toLocaleString()} approved mappings: two AI models from different families answered blind and agreed, or a person decided.`),
        auditTotal ? el('li', {}, el('strong', { text: 'Audited against evidence. ' }), `An auditor on a third model checked ${auditTotal} approved mappings against docs and values: ${audits.supported ?? 0} supported, ${audits.contradicted ?? 0} contradicted and reopened.`) : null,
        el('li', {}, el('strong', { text: 'Unknown is not absent. ' }), 'A system with no approved token for a concept shows as unknown; only a recorded judgment says it has no equivalent.'))),
    el('section', {},
      el('h2', { text: 'Browse by intent' }),
      el('div', { class: 'chips' }, intents.map((v) => el('a', { class: 'chip', href: `/ontology/intent/${v.value}`, 'data-link': true }, el('small', { text: 'intent' }), v.label)))),
  );
}

export function conceptRow(c: Concept, productIds: string[]) {
  const first = productIds.map((p) => c.cells[p]?.light ?? Object.values(c.cells[p] ?? {})[0]).find(Boolean);
  return el('a', { class: 'row-card', href: conceptHref(c.name), 'data-link': true }, swatch(first?.d),
    el('div', { class: 'meta' }, el('span', { class: 'name', text: c.label }),
      el('span', { class: 'dots', title: productIds.map((p) => `${p}: ${c.cells[p] ? Object.values(c.cells[p])[0].s : c.members?.[p] ? 'scale' : 'no answer'}`).join(', ') }, productIds.map((p) => el('i', { class: `dot ${c.cells[p] ? Object.values(c.cells[p])[0].s : c.members?.[p] ? 'match' : ''}` })))));
}
