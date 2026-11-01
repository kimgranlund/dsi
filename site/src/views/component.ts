import { components, meta, type ComponentDoc, type SlotCell } from '../data';
import { el, link, pill, setTitle, swatch, tokenHref } from '../ui';
import { numeric } from './scales';

/**
 * Component tier (ADR 0015): what each system applies to each anatomy slot of a component. A slot is a part and a
 * role (Container · Padding), optionally in a state. Values come from shipped component styles; a system with no
 * row for a slot did not tokenize it (unknown), and a system that ships no such component says so (absent).
 */

const SYS_ORDER = ['material', 'carbon', 'polaris'];
const COLOR_ROLES = new Set(['background', 'text', 'icon', 'border']);
const TYPE_ROLES = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'];
const SIZE_ROLES = new Set(['padding', 'gap', 'margin', 'height', 'width', 'corner-radius', 'border-width', 'font-size', 'letter-spacing']);

export async function componentIndex(main: HTMLElement) {
  setTitle('Components');
  const [cs, m] = await Promise.all([components(), meta()]);
  main.replaceChildren(el('section', {},
    el('p', { class: 'eyebrow', text: 'Tier 5 · Component' }),
    el('h1', { text: 'Components' }),
    el('p', { class: 'lede', text: 'How each system applies its tokens inside a component: padding, gaps, height, corner radius, colors and type per anatomy part. Read from each system’s shipped component styles, never from docs alone.' }),
    el('div', { class: 'comp-list' }, cs.map((c) => link(`/component/${c.id}`, el('strong', { text: c.label }), el('span', { class: 'none-note', text: `${c.slots.length} slots · ${SYS_ORDER.filter((s) => c.systems[s]?.some((x) => !x.absent)).map((s) => m.products.find((p) => p.id === s)?.name.replace(/ Design System| Design 3/, '')).join(', ')}` }))))));
}

export async function componentView(main: HTMLElement, id: string) {
  const [cs, m] = await Promise.all([components(), meta()]);
  const c = cs.find((x) => x.id === id);
  if (!c) return false;
  setTitle(c.label);
  const systems = SYS_ORDER.filter((s) => c.systems[s]);
  const name = (s: string) => m.products.find((p) => p.id === s)?.name.replace(/ Design System| Design 3/, '') ?? s;

  const head = el('section', {},
    el('p', { class: 'eyebrow' }, link('/component', 'Components'), ' · Tier 5'),
    el('h1', { text: c.label }),
    c.definition ? el('p', { class: 'lede', text: c.definition }) : null,
    el('div', { class: 'comp-systems' }, systems.map((s) => el('div', { class: 'comp-sys' },
      el('strong', { text: name(s) }),
      ...c.systems[s].map((x) => x.absent
        ? el('span', { class: 'none-note', text: `No component. ${x.evidence ?? ''}` })
        : el('span', {}, el('code', { text: x.native! }), ' ', pill(x.match!, x.match!, x.match === 'close' ? 'A close counterpart, not the same component' : 'Same component'), x.variant ? el('span', { class: 'none-note', text: ` ${x.variant}` }) : null))))));

  const anatomy = anatomyOf(c);
  const byPart = c.parts.map((part) => {
    const all = c.slots.filter((s) => s.part === part);
    const slots = all.filter((s) => !TYPE_ROLES.includes(s.role));
    const typeRows = [...new Set(all.filter((s) => TYPE_ROLES.includes(s.role)).map((s) => s.state ?? ''))].map((st) => typeRow(all.filter((s) => TYPE_ROLES.includes(s.role) && (s.state ?? '') === st), st, systems, c));
    return el('section', { class: 'comp-part', id: `part-${part}` },
      el('h2', { text: slots[0].label.split(' · ')[0] }),
      el('div', { class: 'slot-table', style: `--cols: ${systems.length}` },
        el('div', { class: 'slot-row slot-head' }, el('span', { text: 'Slot' }), ...systems.map((s) => el('span', { text: name(s) }))),
        ...typeRows, ...slots.map((sl) => slotRow(sl, systems, c))));
  });
  main.replaceChildren(head, anatomy, ...byPart,
    el('p', { class: 'none-note', text: 'Empty cells: the system’s shipped styles apply no token to that slot (a literal, a prop, or nothing). Each value links to its token; hover for the CSS rule it came from.' }));
  return true;
}

function slotRow(sl: ComponentDoc['slots'][number], systems: string[], c: ComponentDoc) {
  const role = sl.label.split(' · ').slice(1).join(' · ');
  const px = SIZE_ROLES.has(sl.role) ? Math.max(1, ...systems.flatMap((s) => (sl.cells[s] ?? []).map((x) => numeric(x.value)?.n ?? 0))) : 0;
  return el('div', { class: 'slot-row' + (sl.state ? ' is-state' : '') },
    el('span', { class: 'slot-name' }, role),
    ...systems.map((s) => {
      if (c.systems[s].every((x) => x.absent)) return el('span', { class: 'slot-cell none-note', text: '—' });
      const cells = sl.cells[s] ?? [];
      if (!cells.length) return el('span', { class: 'slot-cell empty', text: 'not tokenized', title: 'No token in the shipped styles for this slot: unknown, not absent.' });
      return el('span', { class: 'slot-cell' }, ...dedupe(cells).map((x) => cellView(s, x, sl.role, px, c.systems[s].length > 1)));
    }));
}

/** One row for a part's type: size / line height · weight · tracking, a specimen, and the tokens behind it. */
function typeRow(slots: ComponentDoc['slots'], state: string, systems: string[], c: ComponentDoc) {
  return el('div', { class: 'slot-row' + (state ? ' is-state' : '') },
    el('span', { class: 'slot-name' }, state ? `Type · ${state}` : 'Type'),
    ...systems.map((s) => {
      if (c.systems[s].every((x) => x.absent)) return el('span', { class: 'slot-cell none-note', text: '—' });
      const natives = [...new Set(slots.flatMap((sl) => (sl.cells[s] ?? []).map((x) => x.native)))];
      if (!natives.length) return el('span', { class: 'slot-cell empty', text: 'not tokenized', title: 'No type tokens in the shipped styles for this part.' });
      return el('span', { class: 'slot-cell' }, ...natives.map((nat) => {
        const get = (role: string) => slots.find((sl) => sl.role === role)?.cells[s]?.find((x) => x.native === nat);
        const size = get('font-size'), lh = get('line-height'), wt = get('font-weight'), ls = get('letter-spacing'), fam = get('font-family');
        const px = (x?: SlotCell) => { const n = numeric(x?.value); return n && n.unit === 'px' ? `${Math.round(n.n * 100) / 100}px` : x?.value; };
        const lhText = lh && numeric(lh.value)?.unit === '' ? lh.value : px(lh);
        const sample = el('span', { class: 'type-specimen', text: 'Aa' });
        if (size?.value) sample.style.fontSize = /rem|px/.test(size.value) ? size.value : `${size.value}px`;
        if (wt?.value) sample.style.fontWeight = wt.value;
        const tokens = [size, lh, wt, ls, fam].filter((x): x is SlotCell => !!x?.token);
        const common = tokens.length ? tokens.map((x) => x.token!).reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); }) : '';
        const styleName = common.replace(/[-.]$/, '').replace(/[.-](font|label-text|text)?$/, '') || undefined;
        const title = tokens.map((x) => `${x.token} = ${x.value}`).join('\n');
        return el('span', { class: 'slot-entry', title },
          c.systems[s].length > 1 ? el('span', { class: 'none-note', text: nat }) : null,
          el('span', { class: 'type-line' }, sample, el('span', { class: 'mono', text: [size && lh ? `${px(size)} / ${lhText}` : px(size) ?? (lh ? `lh ${lhText}` : ''), wt?.value, ls ? `${px(ls)} tracking` : ''].filter(Boolean).join(' · ') })),
          styleName ? el('span', { class: 'slot-token mono', text: styleName }) : null);
      }));
    }));
}

/** Shorthand rows (padding: block inline) keep positions; identical token cells from several rules merge. */
function dedupe(cells: SlotCell[]) {
  const out = new Map<string, SlotCell>();
  // Same value, same media: one entry (Material's four logical corners share one radius), the other tokens listed.
  for (const x of cells) { const k = `${x.native}|${x.value ?? x.token}|${x.media ?? ''}|${x.computed ? 'c' : ''}`; const cur = out.get(k); if (cur) { cur.css.push(...x.css); if (x.token && x.token !== cur.token) (cur.also ??= []).push(x.token); } else out.set(k, { ...x, css: [...x.css] }); }
  return [...out.values()];
}

function cellView(product: string, x: SlotCell, role: string, max: number, showNative: boolean) {
  const css = x.css.map((r) => `${r.how === 'prop-default' ? 'prop default' : r.selector} { ${r.property} }${r.media ? ` ${r.media}` : ''}\n  ${r.file}${r.line ? `:${r.line}` : ''}\n  ${r.chain.join(' → ')}`).join('\n');
  const chain = x.chain?.length ? `\n${[x.token, ...x.chain].join(' → ')}` : '';
  const title = `${x.computed ? `computed: ${x.computed.replace(/\s+/g, ' ')}` : (x.name ?? x.token ?? 'literal')}${chain}${x.value ? ` = ${x.value}` : ''}\n\n${css}`;
  const n = numeric(x.value);
  const bar = max && n ? el('span', { class: 'slot-bar' }, el('i', { style: `width: ${Math.max(3, Math.min(100, (100 * n.n) / max))}%` })) : null;
  const value = COLOR_ROLES.has(role) && x.value ? el('span', { class: 'slot-value' }, swatch(x.value), x.value) : el('span', { class: 'slot-value mono', text: n && n.unit === 'px' && !/px$/.test(x.value ?? '') ? `${x.value} · ${Math.round(n.n * 100) / 100}px` : (x.value ?? '') });
  const tok = x.computed
    ? el('span', {}, el('span', { class: 'none-note', text: x.inputs?.length ? 'computed from ' : 'computed' }), ...(x.inputs ?? []).flatMap((t, i) => [i ? ', ' : '', link(tokenHref(product, t), t.split('.').pop()!)]))
    : x.token ? el('span', {}, link(tokenHref(product, x.token), x.token), x.also?.length ? el('span', { class: 'none-note', text: ` +${x.also.length} with the same value` }) : null) : el('span', { class: 'none-note', text: 'literal, no token' });
  return el('span', { class: 'slot-entry', title },
    showNative ? el('span', { class: 'none-note', text: x.native }) : null,
    value, bar, x.media ? el('span', { class: 'none-note', text: x.media.replace('@media ', '') }) : null, el('span', { class: 'slot-token mono' }, tok, x.deprecated ? el('span', { class: 'dep', text: 'deprecated' }) : null));
}

/** A neutral anatomy drawing: one labeled box per part, linking to that part's slots. Not any system's look. */
function anatomyOf(c: ComponentDoc) {
  const box = (part: string, ...kids: (HTMLElement | string | null)[]) => c.parts.includes(part) ? el('a', { class: `anat anat-${part}`, href: `#part-${part}`, title: `Slots of ${part}` }, el('span', { class: 'anat-tag', text: part.replace('-', ' ') }), ...kids) : null;
  const text = (t: string, cls = '') => el('span', { class: `anat-text ${cls}`, text: t });
  let body: (HTMLElement | null)[];
  switch (c.id) {
    case 'button':
      body = [box('container', c.parts.includes('icon') ? box('icon', text('◆')) : null, box('label', text('Label')) ?? text('Label'))];
      break;
    case 'card':
      body = [box('container', box('header', box('label', text('Overline label')) ?? text('Title'), box('supporting-text', text('Description', 'muted'))), box('body', text('Body content of the card')), box('footer', text('Actions')))];
      break;
    case 'text-field':
      body = [box('label', text('Label')), box('container', box('icon', text('⌕')), box('input', text('Value')), box('indicator')), box('supporting-text', text('Supporting text', 'muted'))];
      break;
    case 'table':
      body = [box('container', box('header', text('Header  ·  Header  ·  Header')), box('body', box('row', box('cell', text('Cell')), text('Cell'), text('Cell')), text('Row  ·  Row  ·  Row', 'muted')))];
      break;
    default:
      body = c.parts.map((p) => box(p));
  }
  return el('section', { class: 'anatomy', 'aria-label': `${c.label} anatomy` }, el('div', { class: `anat-stage anat-${c.id}` }, ...body));
}
