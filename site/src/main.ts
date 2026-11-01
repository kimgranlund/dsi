import { conceptByIri, conceptByName, meta, search, tokens } from './data';
import { conceptHref, el, setTitle, tokenHref } from './ui';
import { home } from './views/home';
import { conceptView } from './views/concept';
import { systemView } from './views/system';
import { tokenView } from './views/token';
import { ontologyView } from './views/ontology';
import { componentIndex, componentView } from './views/component';

const main = document.getElementById('main')!;

function notFound(what: string) {
  setTitle('Not found');
  main.replaceChildren(el('section', {}, el('h1', { text: 'Not found' }), el('p', { class: 'lede', text: `${what} is not in the index.` }), el('a', { href: '/', 'data-link': true, text: 'Back to the index' })));
}

async function route() {
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  main.replaceChildren(el('p', { class: 'loading', text: 'Loading…' }));
  try {
    const m = await meta();
    if (!parts.length) return home(main);
    const [kind, a, ...rest] = parts;
    if (kind === 'concept' && a) { const c = await conceptByName(a); return c ? conceptView(main, c) : notFound(`Concept ${a}`); }
    if (kind === 'system' && a) { const p = m.products.find((x) => x.id === a); return p ? systemView(main, p) : notFound(`System ${a}`); }
    if (kind === 'token' && a) {
      const p = m.products.find((x) => x.id === a);
      const path = rest.join('/');
      const t = p && (await tokens(p.id)).find((x) => x.p === path);
      return p && t ? tokenView(main, p, t) : notFound(`Token ${path}`);
    }
    if (kind === 'component') { if (!a) return componentIndex(main); return (await componentView(main, a)) || notFound(`Component ${a}`); }
    if (kind === 'ontology') {
      if (a === 'concept') { const c = await conceptByIri(`dsi:concept/${rest.join('/')}`); return c ? conceptView(main, c) : notFound(`Concept dsi:concept/${rest.join('/')}`); }
      return ontologyView(main, a, rest[0]);
    }
    notFound(location.pathname);
  } catch (e) {
    main.replaceChildren(el('section', {}, el('h1', { text: 'Could not load the index' }), el('p', { class: 'lede', text: `${(e as Error).message}. Reload the page to try again.` })));
  } finally { window.scrollTo(0, 0); }
}

document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest('a[data-link]') as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  if (a.pathname !== location.pathname) history.pushState(null, '', a.pathname);
  closeResults();
  route();
});
window.addEventListener('popstate', route);

// Systems nav
meta().then((m) => document.getElementById('systems-nav')!.replaceChildren(...m.products.map((p) => el('a', { href: `/system/${p.id}`, 'data-link': true, text: p.name.replace(/ Design System| Design 3/, '') })), el('a', { href: '/component', 'data-link': true, text: 'Components' }), el('a', { href: '/ontology', 'data-link': true, text: 'Ontology' })));

// Search: every query word must appear in a row's title or body; title matches rank first.
const input = document.getElementById('q') as HTMLInputElement;
const results = document.getElementById('results')!;
function closeResults() { results.hidden = true; }
async function hrefOf(kind: string, key: string) {
  if (kind === 'concept') { const c = await conceptByIri(key); return c ? conceptHref(c.name) : '/'; }
  if (kind === 'token') { const i = key.indexOf('/'); return tokenHref(key.slice(0, i), key.slice(i + 1)); }
  return `/system/${key}`;
}
input.addEventListener('input', async () => {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return closeResults();
  const rows = await search();
  const scored = rows.map((r) => { const t = r[2].toLowerCase(), b = r[3].toLowerCase(); if (!words.every((w) => t.includes(w) || b.includes(w))) return null; return { r, s: (t.startsWith(words[0]) ? 0 : t.includes(words[0]) ? 1 : 2) + (r[0] === 'concept' ? -0.5 : 0) + t.length / 1000 }; }).filter(Boolean) as { r: (typeof rows)[number]; s: number }[];
  scored.sort((a, b) => a.s - b.s);
  const top = scored.slice(0, 14);
  results.replaceChildren(...(top.length ? await Promise.all(top.map(async ({ r }) => el('a', { href: await hrefOf(r[0], r[1]), 'data-link': true }, el('span', { class: 'k', text: r[0] }), el('span', { class: 't', text: r[2] }), el('span', { class: 'b', text: r[3] })))) : [el('p', { class: 'none-note', style: 'padding:8px 10px', text: 'No matches.' })]));
  results.hidden = false;
});
document.getElementById('search-form')!.addEventListener('submit', (e) => { e.preventDefault(); (results.querySelector('a') as HTMLAnchorElement | null)?.click(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeResults(); if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); } });
document.addEventListener('click', (e) => { if (!(e.target as Element).closest('.search')) closeResults(); });

route();
