// Homepage specimen probe (runbook §9): computed colors and WCAG contrast per part, system and mode, with the canonical
// token chain behind each part. Env: PW = Playwright package dir, D = output dir, URL (default http://localhost:4173/).
// Prints only systems/modes with a pair under 3:1 or a missing part; writes $D/probe.json and $D/home.png.
const { chromium } = require(process.env.PW);
const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const alpha = (c) => { const m = c.match(/[\d.]+/g).map(Number); return m.length > 3 ? m[3] : 1; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
  await p.goto(process.env.URL || 'http://localhost:4173/'); await p.waitForSelector('.multi');
  const concepts = await p.evaluate(async () => (await (await fetch('/data/concepts.json')).json()));
  const byName = Object.fromEntries(concepts.map((c) => [c.name, c]));
  const PARTS = { page: ['page-background'], card: ['surface-background'], border: ['border'], heading: ['text', 'surface-foreground'], body: ['text-subtle', 'foreground-subtle'], banner: ['danger-surface-background', 'danger-background-subtle'], bannerText: ['danger-text'], accent: ['accent-background'], accentLabel: ['accent-on-fill-foreground', 'accent-on-fill-text', 'on-fill-text'], danger: ['danger-background'], dangerLabel: ['danger-on-fill-foreground', 'on-fill-text'], link: ['link-text'] };
  const out = [];
  for (const mode of ['light', 'dark']) {
    await p.click(`.switcher button:text-is("${mode === 'light' ? 'Light' : 'Dark'}")`); await p.waitForTimeout(200);
    const rows = await p.$$eval('.multi', (els) => els.map((f) => { const g = (s, prop) => getComputedStyle(f.querySelector(s))[prop]; return { sys: f.querySelector('figcaption a').textContent, page: g('.specimen', 'backgroundColor'), card: g('.sp-card', 'backgroundColor'), heading: g('.sp-card h4', 'color'), body: g('.sp-card p', 'color'), banner: g('.sp-banner', 'backgroundColor'), bannerText: g('.sp-banner', 'color'), accent: g('.sp-btn.accent', 'backgroundColor'), accentLabel: g('.sp-btn.accent', 'color'), danger: g('.sp-btn.danger', 'backgroundColor'), dangerLabel: g('.sp-btn.danger', 'color'), link: g('.sp-link', 'color') }; }));
    for (const r of rows) {
      const id = { 'Fluent 2': 'fluent' }[r.sys] ?? r.sys.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-'); // caption -> product id; add a case when a caption differs
      const src = {}; for (const [part, names] of Object.entries(PARTS)) { for (const n of names) { const c = byName[n]?.cells?.[id]?.[mode]; if (c) { src[part] = `${n}<-${c.t} [${c.s}${c.via ? '/' + c.via : ''}] ${c.d}`; break; } } src[part] ??= '(none)'; }
      const pairs = { 'heading/card': [r.heading, r.card], 'body/card': [r.body, r.card], 'bannerText/banner': [r.bannerText, r.banner], 'accentLabel/accent': [r.accentLabel, r.accent], 'dangerLabel/danger': [r.dangerLabel, r.danger], 'link/card': [r.link, r.card] };
      const low = Object.entries(pairs).filter(([, [f, bg]]) => alpha(bg) > 0.5 && contrast(f, bg) < 3).map(([k, [f, bg]]) => `${k} ${contrast(f, bg)}`);
      out.push({ mode, sys: id, low, src });
    }
  }
  await p.screenshot({ path: process.env.D + '/home.png', fullPage: false });
  require('fs').writeFileSync(process.env.D + '/probe.json', JSON.stringify(out, null, 1));
  for (const o of out) if (o.low.length || Object.values(o.src).some((s) => s === '(none)')) console.log(o.mode, o.sys, 'LOW:', o.low.join('; ') || '-', '| MISSING:', Object.entries(o.src).filter(([, s]) => s === '(none)').map(([k]) => k).join(','));
  await b.close();
})();
