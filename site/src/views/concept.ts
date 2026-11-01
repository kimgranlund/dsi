import { concepts, meta, type Concept, type Product } from '../data';
import { conceptHref, el, link, orderModes, pill, setTitle, swatch, tokenHref } from '../ui';
import { conceptRow } from './home';

export async function conceptView(main: HTMLElement, c: Concept) {
  setTitle(c.label);
  const [m, cs] = await Promise.all([meta(), concepts()]);
  const facetChips = el('div', { class: 'chips' }, Object.entries(c.facets).map(([f, v]) => el('a', { class: 'chip', href: `/ontology/${f}/${v.split('+')[0]}`, 'data-link': true }, el('small', { text: f }), v.split('+').map((x) => m.facets[f]?.find((y) => y.value === x)?.label ?? x).join(' + '))));
  const related = cs.filter((x) => x !== c && c.facets.intent && x.facets.intent === c.facets.intent).slice(0, 12);
  main.replaceChildren(
    el('section', {},
      el('span', { class: 'eyebrow', text: `Canonical concept · ${c.group}` }),
      el('h1', { text: c.label }),
      facetChips,
      el('p', { class: 'chain' }, el('span', { text: 'Token ' }), el('code', { text: `${c.group}.${c.name}` }), el('span', { text: ' · IRI ' }), el('code', { text: c.iri.replace('dsi:', 'https://dsi.nonoun.io/ontology/') }))),
    el('section', {},
      el('h2', { text: 'How each system answers' }),
      el('div', { class: 'compare' }, m.products.map((p) => systemColumn(p, c)))),
    related.length ? el('section', {}, el('h2', { text: 'Related concepts' }), el('div', { class: 'list' }, related.map((x) => conceptRow(x, m.products.map((p) => p.id))))) : el('span', { hidden: true }),
  );
}

function systemColumn(p: Product, c: Concept) {
  const cells = c.cells[p.id];
  const head = el('div', { class: 'sys-head' }, link(`/system/${p.id}`, p.name), cells ? pill(Object.values(cells)[0].s, Object.values(cells)[0].s === 'match' ? Object.values(cells)[0].m : `nearest · ${Object.values(cells)[0].m}`) : null);
  if (!cells) return el('div', { class: 'sys' }, head, el('p', { class: 'none-note', text: 'No approved token answers this concept. That means unknown, not absent: the index has no mapping either way.' }));
  const tokenNames = [...new Set(Object.values(cells).map((x) => x.t))];
  return el('div', { class: 'sys' }, head,
    el('div', { class: 'modes' }, orderModes(Object.keys(p.modes)).map((mode) => {
      const x = cells[mode];
      return el('div', { class: 'mode' }, swatch(x?.d), el('span', { class: 'mode-label' }, el('b', { text: mode }), el('span', { class: 'mono', text: x?.d ?? '—' })));
    })),
    el('div', { class: 'tok' }, tokenNames.map((t) => link(tokenHref(p.id, t), t))),
    Object.values(cells)[0].via === 'more-specific' ? el('p', { class: 'none-note', text: 'Answered by a token mapped to a more specific concept.' }) : null);
}

export const href = conceptHref;
