import { concepts, groups as loadGroups, meta, tokens, type Product, type Token } from '../data';
import { el, orderModes, pill, setTitle, swatch, tokenHref } from '../ui';

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
  const body = el('div', { class: 'groups' });
  const jump = el('nav', { class: 'chips jump', 'aria-label': 'Token groups' });

  const card = (t: Token) => {
    const v = t.v?.[themeOf()] ?? t.v?.all ?? Object.values(t.v ?? {})[0];
    const c = t.m[0] && byIri.get(t.m[0][0]);
    return el('a', { class: 'row-card', href: tokenHref(p.id, t.p), 'data-link': true }, swatch(v?.[0]),
      el('div', { class: 'meta' }, el('span', { class: 'name mono', text: t.p }), el('span', { class: 'sub', text: c ? `→ ${c.label}` : t.u ? 'no concept fits' : t.n })));
  };
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const ok = (t: Token | undefined): t is Token => !!t && (!q || t.p.toLowerCase().includes(q) || t.n.toLowerCase().includes(q) || (t.d ?? '').toLowerCase().includes(q)) && (!status.value || (status.value === 'mapped' ? t.m.length > 0 : !!t.u));
    const list = gs?.groups ?? [{ id: 'all', label: 'Tokens', source: 'name-family' as const, order: 'progression' as const, tokens: [...ts].sort((a, b) => a.p.localeCompare(b.p)).map((t) => t.p), subgroups: [] }];
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
          el('span', { class: 'none-note', text: `${n} token${n === 1 ? '' : 's'}${g.native && g.native !== g.label.toLowerCase() ? ` · ${g.native}-` : ''}${g.properties?.length ? ` · paints ${g.properties.join(', ')}` : ''}` })),
        main.length ? el('div', { class: 'list' }, main.map(card)) : null,
        subs.map(({ s, items }) => el('div', { class: 'subgroup' }, el('h4', { text: s.label }), el('div', { class: 'list' }, items.map(card))))));
    }
    jump.replaceChildren(...chips);
    body.replaceChildren(...(sections.length ? sections : [el('p', { class: 'none-note', text: 'No tokens match this filter.' })]));
  };
  filter.addEventListener('input', render); status.addEventListener('change', render); modePick.addEventListener('change', render);
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
      el('div', { class: 'section-head' }, el('h2', { text: 'Semantic and mapped tokens' }), el('span', { class: 'none-note', text: gs ? SOURCE[gs.kind] : `${ts.length} tokens` })),
      el('div', { class: 'filters' }, filter, status, modeNames.length > 1 ? modePick : null),
      jump,
      body),
  );
}
