import { concepts, meta } from '../data';
import { el, link, setTitle } from '../ui';
import { conceptRow } from './home';

export async function ontologyView(main: HTMLElement, facet?: string, value?: string) {
  const [m, cs] = await Promise.all([meta(), concepts()]);
  if (!facet) {
    setTitle('Ontology');
    main.replaceChildren(el('section', {}, el('span', { class: 'eyebrow', text: 'https://dsi.nonoun.io/ontology/' }), el('h1', { text: 'Facets' }), el('p', { class: 'lede', text: 'Every canonical concept is a combination of facet values. Identifiers here are permanent.' })),
      ...Object.entries(m.facets).map(([f, vals]) => el('section', {}, el('h2', { text: f[0].toUpperCase() + f.slice(1) }), el('div', { class: 'chips' }, vals.map((v) => link(`/ontology/${f}/${v.value}`, v.label))))));
    main.querySelectorAll('.chips a').forEach((a) => a.classList.add('chip'));
    return;
  }
  const v = m.facets[facet]?.find((x) => x.value === value);
  if (!v) { main.replaceChildren(el('section', {}, el('h1', { text: 'Not in the ontology' }), el('p', { class: 'lede' }, `dsi:${facet}/${value} is not defined. `, link('/ontology', 'See all facets.')))); return; }
  setTitle(`${v.label} (${facet})`);
  const using = cs.filter((c) => c.facets[facet]?.split('+').includes(v.value));
  main.replaceChildren(
    el('section', {}, el('span', { class: 'eyebrow' }, link('/ontology', 'Ontology'), ` · ${facet}`), el('h1', { text: v.label }), v.definition ? el('p', { class: 'lede', text: v.definition }) : null, el('p', { class: 'chain' }, el('code', { text: `https://dsi.nonoun.io/ontology/${facet}/${v.value}` }))),
    el('section', {}, el('div', { class: 'section-head' }, el('h2', { text: 'Concepts with this value' }), el('span', { class: 'none-note', text: String(using.length) })), using.length ? el('div', { class: 'list' }, using.map((c) => conceptRow(c, m.products.map((p) => p.id)))) : el('p', { class: 'none-note', text: 'No mapped concept uses this value yet.' })),
  );
}
