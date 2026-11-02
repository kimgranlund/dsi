import { concepts, meta, tokens, type Product, type Token } from '../data';
import { conceptHref, el, link, pill, setTitle, swatch, tokenHref } from '../ui';

export async function tokenView(main: HTMLElement, p: Product, t: Token) {
  setTitle(`${t.p} · ${p.name}`);
  const [m, cs, own] = await Promise.all([meta(), concepts(), tokens(p.id)]);
  const known = new Set(own.map((x) => x.p));
  const byIri = new Map(cs.map((c) => [c.iri, c]));
  const themeRows = Object.entries(t.v ?? {}).map(([theme, [display, chain]]) => el('tr', {},
    el('td', {}, el('div', { style: 'width:72px' }, swatch(display))),
    el('td', {}, el('b', { text: theme === 'all' ? 'all themes' : theme }), Object.entries(p.modes).filter(([, th]) => th === theme).map(([mode]) => el('span', { class: 'none-note', text: ` · ${mode} mode` }))),
    el('td', { class: 'mono', text: display }),
    el('td', { class: 'chain' }, chain.length ? [t.p, ...chain].map((x, i) => [i ? ' → ' : '', i && known.has(x) ? link(tokenHref(p.id, x), x) : x]) : 'literal value')));
  const others = t.m.flatMap(([iri]) => { const c = byIri.get(iri); return c ? m.products.filter((o) => o.id !== p.id).map((o) => ({ o, c, cell: c.cells[o.id] ? Object.values(c.cells[o.id])[0] : undefined })) : []; });
  main.replaceChildren(
    el('section', {},
      el('span', { class: 'eyebrow' }, link(`/system/${p.id}`, p.name), ` · ${t.s ?? ''} token${t.vis === 'internal' ? ' · internal (not public API)' : ''}`),
      el('h1', { class: 'mono', style: 'font-family:var(--font-mono);font-size:clamp(1.3rem,3vw,2rem);word-break:break-all', text: t.p }),
      t.d ? el('p', { class: 'lede', text: t.d }) : null,
      el('dl', { class: 'facts' }, el('dt', { text: 'Native name' }), el('dd', {}, el('code', { text: t.n })), el('dt', { text: 'Type' }), el('dd', { text: t.t ?? 'untyped' }))),
    el('section', {}, el('h2', { text: 'Values' }), el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Color' }), el('th', { text: 'Theme' }), el('th', { text: 'Value' }), el('th', { text: 'Alias chain' }))), el('tbody', {}, themeRows)))),
    el('section', {}, el('h2', { text: 'Canonical concept' }),
      t.m.length ? el('div', { class: 'table-wrap' }, el('table', {}, el('tbody', {}, t.m.map(([iri, match, by]) => { const c = byIri.get(iri); return el('tr', {}, el('td', {}, c ? link(conceptHref(c.name), c.label) : el('code', { text: iri })), el('td', {}, pill(match, match, 'SKOS match type: the token is the subject')), el('td', { class: 'none-note', text: by === 'agreement' ? 'two agents agreed' : by === 'agreement+classifier' ? 'two agents and the classifier agreed' : by ? `reviewed by ${by}` : '' })); })))) :
      el('p', { class: 'none-note', text: t.u ? `No canonical concept fits yet: ${t.u}` : 'Not mapped.' })),
    t.e?.length ? el('section', {}, el('h2', { text: 'Evidence' }),
      el('p', { class: 'none-note', text: `What shipped facts say about the approved concept: ${t.e.filter((r) => r[4]).length} of ${t.e.length} checks agree. A check that cannot decide is left out.` }),
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Check' }), el('th', { text: 'Facet' }), el('th', { text: 'Observed' }), el('th', { text: 'Mapping says' }), el('th', { text: 'Agrees' }))),
        el('tbody', {}, t.e.map(([test, field, observed, expected, ok]) => el('tr', {}, el('td', { text: ({ usage: 'Component CSS', B1: 'Contrast ladder (B1)', B3: 'Page sibling (B3)', B4: 'Bold fill contrast (B4)', B6: 'Icon family (B6)', hue: 'Hue', terms: 'Naming terms' } as Record<string, string>)[test] ?? test }), el('td', { text: field }), el('td', { text: observed }), el('td', { text: expected }), el('td', {}, pill(ok ? 'exact' : 'nearest', ok ? 'yes' : 'no', ok ? 'The shipped facts agree with the mapping' : 'The shipped facts disagree with the mapping: a review candidate')))))))) : el('span', { hidden: true }),
    others.length ? el('section', {}, el('h2', { text: 'The same concept elsewhere' }), el('div', { class: 'list' }, others.map(({ o, c, cell }) => el('a', { class: 'row-card', href: cell ? tokenHref(o.id, cell.t) : conceptHref(c.name), 'data-link': true }, swatch(cell?.d), el('div', { class: 'meta' }, el('span', { class: 'name', text: o.name }), el('span', { class: 'sub', text: cell ? `${cell.t}${cell.s === 'nearest' ? ' (nearest)' : ''}` : 'no answer' })))))) : el('span', { hidden: true }),
  );
}
