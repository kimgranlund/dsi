type Child = Node | string | null | undefined | false | Child[];
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = String(v);
    else if (k === 'text') n.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v as EventListener);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => { if (Array.isArray(c)) c.forEach(add); else if (c !== null && c !== undefined && c !== false) n.append(c); };
  kids.forEach(add);
  return n;
}

/** Internal link handled by the router. */
export const link = (href: string, ...kids: Child[]) => el('a', { href, 'data-link': true }, ...kids);

/** A color swatch from a display value like "#da1e28" or "#000000 @ 0.5"; anything else renders as a gap. */
export function swatch(display: string | undefined, title?: string) {
  const m = display ? /^(#[0-9a-f]{6})(?: @ ([\d.]+))?$/i.exec(display) : null;
  const box = el('div', { class: 'swatch' + (m ? '' : ' gap'), title: title ?? display ?? 'no value', role: 'img', 'aria-label': display ? `Color ${display}` : 'No answer' });
  if (m) { const i = el('i'); i.style.background = m[1]; if (m[2]) i.style.opacity = m[2]; box.append(i); }
  return box;
}

export const pill = (cls: string, text: string, title?: string) => el('span', { class: `pill ${cls}`, text, title });

/** URL path segment for a token path (dots and pluses are safe; encode the rest). */
export const tokenHref = (product: string, path: string) => `/token/${product}/${encodeURIComponent(path)}`;
export const conceptHref = (name: string) => `/concept/${encodeURIComponent(name)}`;

export function setTitle(t: string) { document.title = t ? `${t} · DesignSystemsIndex` : 'DesignSystemsIndex'; }

const MODE_ORDER = ['light', 'dark', 'increased-contrast'];
/** Modes in reading order: light, dark, increased contrast, then any others. */
export const orderModes = (modes: string[]) => [...modes].sort((a, b) => (MODE_ORDER.indexOf(a) + 1 || 99) - (MODE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

/** Black or white text, whichever contrasts more with a hex background (WCAG relative luminance). */
export function inkOn(hex: string) {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}

/** A token name that only wraps after its separators ("on-" | "primary-" | "container"), never mid-word. */
export function breakableName(name: string) {
  const span = el('span', { class: 'tname' });
  name.split(/(?<=[.\-_])/).forEach((part, i) => { if (i) span.append(el('wbr')); span.append(part); });
  return span;
}

/**
 * Token tile: a color block for the shown mode (hex printed on it in the contrasting ink), thin strips for the
 * token's other modes, then the name and its concept.
 */
export function tokenTile(opts: { href: string; name: string; full: string; shown?: string; others: { mode: string; display?: string }[]; concept?: string; muted?: boolean }) {
  const hex = opts.shown && /^#[0-9a-f]{6}/i.exec(opts.shown)?.[0];
  const alpha = opts.shown?.match(/@ ([\d.]+)/)?.[1];
  const block = el('div', { class: 'tile-color' + (hex ? '' : ' gap') });
  if (hex) {
    const fill = el('i', { class: 'tile-fill' }); fill.style.background = hex; if (alpha) fill.style.opacity = alpha;
    const ink = alpha && Number(alpha) < 0.5 ? 'var(--ink)' : inkOn(hex);
    block.append(fill, el('span', { class: 'tile-hex', text: opts.shown, style: `color:${ink}` }));
  } else block.append(el('span', { class: 'tile-hex', text: 'no value' }));
  // Other modes as inset circles on the right of the color block.
  if (opts.others.length) block.append(el('span', { class: 'tile-modes' }, opts.others.map((o) => {
    const h = o.display && /^#[0-9a-f]{6}/i.exec(o.display)?.[0];
    const dot = el('i', { title: `${o.mode}: ${o.display ?? 'no value'}`, 'aria-label': `${o.mode} mode ${o.display ?? 'no value'}`, role: 'img' });
    if (h) dot.style.background = h; else dot.classList.add('gap');
    return dot;
  })));
  return el('a', { class: 'tile' + (opts.muted ? ' muted' : ''), href: opts.href, 'data-link': true, title: opts.full },
    block,
    el('div', { class: 'tile-body' }, breakableName(opts.name), el('span', { class: 'tile-concept', text: opts.concept ?? '' })));
}
