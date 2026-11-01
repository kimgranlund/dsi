import { concepts, meta, tokens, type Product } from '../data';
import { conceptHref, el, link, orderModes, pill, setTitle, swatch, tokenHref } from '../ui';

export async function systemView(main: HTMLElement, p: Product) {
  setTitle(p.name);
  const [m, ts, cs] = await Promise.all([meta(), tokens(p.id), concepts()]);
  const byIri = new Map(cs.map((c) => [c.iri, c]));
  const firstTheme = p.modes.light ?? Object.values(p.modes)[0] ?? 'all';
  const filter = el('input', { type: 'search', id: 'tok-filter', placeholder: 'Filter tokens', 'aria-label': 'Filter tokens' });
  const status = el('select', { id: 'tok-status', 'aria-label': 'Mapping status' }, el('option', { value: '', text: 'All tokens' }), el('option', { value: 'mapped', text: 'Mapped' }), el('option', { value: 'unmapped', text: 'No concept fits' }));
  const list = el('div', { class: 'list' });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = [...ts].sort((a, b) => Number(!a.m.length) - Number(!b.m.length) || a.p.localeCompare(b.p)).filter((t) => (!q || t.p.toLowerCase().includes(q) || t.n.toLowerCase().includes(q) || (t.d ?? '').toLowerCase().includes(q)) && (!status.value || (status.value === 'mapped' ? t.m.length : t.u)));
    list.replaceChildren(...shown.slice(0, 400).map((t) => {
      const v = t.v?.[firstTheme] ?? Object.values(t.v ?? {})[0];
      const c = t.m[0] && byIri.get(t.m[0][0]);
      return el('a', { class: 'row-card', href: tokenHref(p.id, t.p), 'data-link': true }, swatch(v?.[0]),
        el('div', { class: 'meta' }, el('span', { class: 'name mono', text: t.p }), el('span', { class: 'sub', text: c ? `→ ${c.label}` : t.u ? 'no concept fits' : t.n })));
    }), ...(shown.length > 400 ? [el('p', { class: 'none-note', text: `Showing 400 of ${shown.length}. Narrow the filter.` })] : []));
  };
  filter.addEventListener('input', render); status.addEventListener('change', render);
  render();
  main.replaceChildren(
    el('section', {},
      el('span', { class: 'eyebrow', text: `${p.organization ?? ''} · design system` }),
      el('h1', { text: p.name }),
      el('p', { class: 'lede', text: p.description }),
      el('dl', { class: 'facts' },
        el('dt', { text: 'Ingested from' }), el('dd', {}, el('code', { text: `${p.implementation} ${p.version}` })),
        el('dt', { text: 'Modes' }), el('dd', { text: orderModes(Object.keys(p.modes)).map((mode) => [mode, p.modes[mode]]).map(([mode, th]) => (mode === th ? mode : `${mode} (${th})`)).join(', ') }),
        el('dt', { text: 'License' }), el('dd', {}, p.license ?? '', p.redistribution === 'restricted' ? ' · ' : '', p.redistribution === 'restricted' ? pill('nearest', 'restricted', 'Published by owner decision; see ADR 0009') : null),
        p.homepage ? el('dt', { text: 'Docs' }) : null, p.homepage ? el('dd', {}, el('a', { href: p.homepage, rel: 'noopener', text: p.homepage })) : null),
      el('div', { class: 'stat-row' }, el('span', {}, el('b', { text: String(p.counts.tokens) }), ' tokens ingested'), el('span', {}, el('b', { text: String(p.counts.mapped) }), ' mapped'), el('span', {}, el('b', { text: String(p.counts.unmapped) }), ' no concept fits'), el('span', {}, el('b', { text: `${p.counts.answered} / ${m.concepts}` }), ' concepts answered'))),
    el('section', {}, el('div', { class: 'section-head' }, el('h2', { text: 'Semantic and mapped tokens' }), el('span', { class: 'none-note', text: `${ts.length} tokens` })), el('div', { class: 'filters' }, filter, status), list),
  );
  void conceptHref; void link;
}
