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
