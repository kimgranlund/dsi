import { concepts, meta, type Concept } from '../data';
import { conceptHref, el, link, orderModes, setTitle, swatch } from '../ui';

/** Specimen parts: each lists canonical names in order of preference; the legend reports which one painted it. */
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

function specimen(cs: Concept[], products: { id: string; name: string; modes: Record<string, string> }[]) {
  const byName = new Map(cs.map((c) => [c.name, c]));
  const choices = products.flatMap((p) => orderModes(Object.keys(p.modes)).filter((m) => m !== 'increased-contrast').map((mode) => ({ p, mode })));
  let current = choices[0];
  const sheet = document.getElementById('specimen-css') as HTMLLinkElement;
  const legend = el('ul');
  const caption = el('p', { class: 'none-note' });
  const buttons = choices.map((c) => el('button', { type: 'button', text: `${c.p.name.replace(/ Design System| Design 3/, '')} ${c.mode}`, onclick: () => { current = c; apply(); } }));
  function apply() {
    sheet.href = `/data/canonical/${current.p.id}.${current.mode}.css`;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i] === current)));
    let answered = 0;
    legend.replaceChildren(...PARTS.map(({ part, names }) => {
      const i = names.findIndex((n) => byName.get(n)?.cells[current.p.id]?.[current.mode]);
      const cell = i >= 0 ? byName.get(names[i])!.cells[current.p.id][current.mode] : undefined;
      if (cell) answered++;
      return el('li', {}, swatch(cell?.d), el('span', {}, part, ' ', cell ? link(conceptHref(names[i]), el('code', { text: names[i] })) : el('span', { class: 'empty', text: '(no answer)' })),
        cell ? el('span', { class: 'none-note', text: i > 0 ? 'fallback' : cell.s === 'nearest' ? 'nearest' : '' }) : el('span'));
    }));
    caption.textContent = `${current.p.name} answers ${answered} of ${PARTS.length} parts in ${current.mode} mode. Dashed outlines are parts it has no approved token for.`;
  }
  apply();
  const ui = el('div', { class: 'specimen', 'aria-label': 'Sample interface rendered with canonical tokens' },
    el('div', { class: 'sp-card' },
      el('h4', { text: 'Payment method' }),
      el('p', { text: 'Cards are charged on the first of each month. You can change this at any time.' }),
      el('div', { class: 'sp-banner', text: 'Your card was declined. Check the number and try again.' }),
      el('div', { class: 'sp-actions' }, el('span', { class: 'sp-btn accent', text: 'Save card' }), el('span', { class: 'sp-btn danger', text: 'Remove card' })),
      el('a', { class: 'sp-link', href: '#', onclick: (e: Event) => e.preventDefault(), text: 'View billing history' })));
  return el('section', { 'aria-labelledby': 'specimen-h' },
    el('div', { class: 'section-head' }, el('h2', { id: 'specimen-h', text: 'One interface, every system' }), el('div', { class: 'switcher', role: 'group', 'aria-label': 'System and mode' }, buttons)),
    el('div', { class: 'specimen-shell' }, ui, el('div', { class: 'specimen-key' }, caption, legend)));
}

export async function home(main: HTMLElement) {
  setTitle('');
  const [m, cs] = await Promise.all([meta(), concepts()]);
  const shared = cs.filter((c) => m.products.every((p) => c.cells[p.id])).sort((a, b) => a.name.localeCompare(b.name));
  const intents = m.facets.intent.filter((v) => cs.some((c) => c.facets.intent?.split('+').includes(v.value)));
  main.replaceChildren(
    el('section', { class: 'hero' },
      el('span', { class: 'eyebrow', text: `${m.products.length} design systems · ${m.concepts} canonical concepts` }),
      el('h1', { text: 'Every design system’s tokens, in one vocabulary.' }),
      el('p', { class: 'lede', text: 'Polaris says critical, Material says error, Carbon says support-error. The index maps each system’s shipped tokens to shared concepts, shows the real values in every mode, and labels every match with how close it is.' })),
    specimen(cs, m.products),
    el('section', {},
      el('h2', { text: 'Systems' }),
      el('div', { class: 'systems' }, m.products.map((p) => {
        const answered = p.counts.answered, total = m.concepts;
        const bar = el('div', { class: 'bar', title: `${answered} of ${total} concepts answered` }, el('i', { class: 'm', style: `width:${(100 * answered) / total}%` }));
        return el('a', { class: 'system-card', href: `/system/${p.id}`, 'data-link': true },
          el('h3', { text: p.name }), el('span', { class: 'org', text: `${p.organization ?? ''} · v${p.version}` }),
          el('div', { class: 'stat-row' }, el('span', {}, el('b', { text: String(p.counts.mapped) }), ' tokens mapped'), el('span', {}, el('b', { text: String(answered) }), ' concepts')), bar);
      }))),
    el('section', {},
      el('div', { class: 'section-head' }, el('h2', { text: 'Concepts every system answers' }), el('span', { class: 'none-note', text: `${shared.length} of ${cs.length}` })),
      el('div', { class: 'list' }, shared.map((c) => conceptRow(c, m.products.map((p) => p.id))))),
    el('section', {},
      el('h2', { text: 'Browse by intent' }),
      el('div', { class: 'chips' }, intents.map((v) => el('a', { class: 'chip', href: `/ontology/intent/${v.value}`, 'data-link': true }, el('small', { text: 'intent' }), v.label)))),
  );
}

export function conceptRow(c: Concept, productIds: string[]) {
  const first = productIds.map((p) => c.cells[p]?.light ?? Object.values(c.cells[p] ?? {})[0]).find(Boolean);
  return el('a', { class: 'row-card', href: conceptHref(c.name), 'data-link': true }, swatch(first?.d),
    el('div', { class: 'meta' }, el('span', { class: 'name', text: c.label }),
      el('span', { class: 'dots', title: productIds.map((p) => `${p}: ${c.cells[p] ? Object.values(c.cells[p])[0].s : 'no answer'}`).join(', ') }, productIds.map((p) => el('i', { class: `dot ${c.cells[p] ? Object.values(c.cells[p])[0].s : ''}` })))));
}
