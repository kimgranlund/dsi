import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * Token applications: which tokens a component's shipped styles apply to which anatomy slot (ADR 0015).
 * Reads shipped CSS (or CSS compiled from shipped Sass) statically: never runs package code. Each declaration that
 * uses a custom property becomes one row per var(): its selector and CSS property, the var() chain as shipped
 * (component-local properties such as --_leading-space or --pc-button-gap are followed to the token they wrap),
 * the first ingested token in the chain, and the literal fallback. Parts and states come from the source's authored
 * selector map; slot roles from the CSS property.
 */

export interface PartRule { selector: string; part: string; props?: string }
export interface ComponentConfig {
  component: string; native: string; match: string; variant?: string; evidence?: string;
  package?: string; css?: string[]; parts: PartRule[]; exclude?: string;
  /** Custom properties that set another component's API (Material `--md-elevation-level` on md-elevation): kept as applications. */
  apiProps?: string;
  /** Only custom-property definitions from rules matching this (plus :root) count: the default variant's values (Polaris .Polaris-Button--variantSecondary). */
  defScope?: string;
  /** Selectors must match this (one stylesheet for every component: Polaris styles.css). */
  within?: string;
  props?: { file: string; pattern: string; token: string; part: string; property: string; note?: string }[];
}
export interface ApplicationsConfig { product: string; components: ComponentConfig[] }

export interface Row {
  component: string; native: string; part: string; cssProperty: string; state?: string; media?: string;
  selector: string; value: string; chain: string[]; token?: string; literal?: string;
  /** Position of this var() among the value's vars, when there are several (padding: block inline). */
  position?: [number, number];
  how: 'css' | 'prop-default'; file: string; line?: number;
}

// First match wins: a combined selector (.btn:disabled, .btn:hover:disabled) is the disabled state.
const STATES: [RegExp, string][] = [
  [/disabled/, 'disabled'],
  [/:hover|\.hover\b|--hover/, 'hover'],
  [/:focus|\.focus(ed)?\b|--focus/, 'focus'],
  [/:active|\.active\b(?!-)|--active|\.pressed/, 'active'],
  [/selected|aria-selected|--selected/, 'selected'],
  [/dragged/, 'dragged'],
];
export const stateOf = (selector: string) => STATES.find(([re]) => re.test(selector))?.[1];

/** Split a CSS value into its top-level var() calls, each as [name, fallback?]. */
export function vars(value: string): { name: string; fallback?: string }[] {
  const out: { name: string; fallback?: string }[] = [];
  let i = 0;
  while ((i = value.indexOf('var(', i)) >= 0) {
    let depth = 0, j = i + 4;
    for (; j < value.length; j++) { if (value[j] === '(') depth++; else if (value[j] === ')') { if (depth === 0) break; depth--; } }
    const inner = value.slice(i + 4, j);
    const comma = topLevelComma(inner);
    out.push({ name: (comma < 0 ? inner : inner.slice(0, comma)).trim(), ...(comma < 0 ? {} : { fallback: inner.slice(comma + 1).trim() }) });
    i = j + 1;
  }
  return out;
}
function topLevelComma(s: string) { let d = 0; for (let k = 0; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') d--; else if (s[k] === ',' && d === 0) return k; } return -1; }

/** Follow a custom property through local definitions and fallbacks, collecting every name on the way. */
export function chainOf(name: string, fallback: string | undefined, defs: Map<string, string>, isToken: (n: string) => boolean, seen = new Set<string>()): { chain: string[]; literal?: string } {
  const chain = [name];
  if (seen.has(name)) return { chain };
  seen.add(name);
  if (!isToken(name) && defs.has(name)) {
    // clamp(min, preferred, max): follow the preferred value (Carbon layout density and size context).
    const v = preferred(defs.get(name)!);
    const inner = vars(v);
    if (inner.length === 1 && v.trim().startsWith('var(')) { const r = chainOf(inner[0].name, inner[0].fallback, defs, isToken, seen); return { chain: [...chain, ...r.chain], literal: r.literal }; }
    if (!inner.length) return { chain, literal: v.trim() };
    return { chain, literal: v.trim() };
  }
  if (isToken(name)) return { chain, ...(fallback ? { literal: lastLiteral(fallback) } : {}) };
  if (fallback) {
    const inner = vars(fallback);
    if (inner.length === 1 && fallback.startsWith('var(')) { const r = chainOf(inner[0].name, inner[0].fallback, defs, isToken, seen); return { chain: [...chain, ...r.chain], literal: r.literal }; }
    return { chain, literal: fallback };
  }
  return { chain };
}
function preferred(v: string): string {
  const t = v.trim();
  if (!t.startsWith('clamp(')) return t;
  const inner = t.slice(6, -1);
  const args: string[] = []; let d = 0, cur = '';
  for (const ch of inner) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { args.push(cur.trim()); cur = ''; continue; } cur += ch; }
  args.push(cur.trim());
  return args.length === 3 ? args[1] : t;
}
const lastLiteral = (s: string): string => { const v = vars(s); return v.length === 1 && s.startsWith('var(') ? (v[0].fallback ? lastLiteral(v[0].fallback) : '') : s; };

export function extractCss(cfg: ComponentConfig, files: { rel: string; css: string }[], isToken: (n: string) => boolean): { rows: Row[]; skipped: number } {
  const defs = new Map<string, string>();
  const api = cfg.apiProps ? new RegExp(cfg.apiProps) : undefined;
  const scope = cfg.defScope ? new RegExp(cfg.defScope) : undefined;
  const rootDefs = new Set<string>();
  const decls: { sel: string; prop: string; value: string; media?: string; file: string; line?: number }[] = [];
  for (const f of files) postcss.parse(f.css).walkDecls((d) => {
    if (d.prop.startsWith('--') && !(api?.test(d.prop))) {
      const sel = ((d.parent as postcss.Rule)?.selector ?? '').replace(/\s+/g, ' ');
      const inMedia = d.parent?.parent?.type === 'atrule';
      // A :root/:host definition is the default; a nested context (.cds--layer-two) only fills names the root leaves open.
      const isRoot = /^(:root|:host)/.test(sel);
      if (isRoot) { if (!rootDefs.has(d.prop)) { rootDefs.add(d.prop); defs.set(d.prop, d.value); } }
      else if (!rootDefs.has(d.prop) && (!scope || (!inMedia && scope.test(sel)))) defs.set(d.prop, d.value);
      return;
    }
    const parent = d.parent as postcss.Rule;
    if (!parent?.selector || !d.value.includes('var(')) return;
    const media: string[] = [];
    for (let p: postcss.Node | undefined = parent.parent as postcss.Node | undefined; p && p.type !== 'root'; p = p.parent as postcss.Node | undefined) if (p.type === 'atrule' && /^(media|supports|container)$/.test((p as postcss.AtRule).name)) media.push(`@${(p as postcss.AtRule).name} ${(p as postcss.AtRule).params}`);
    decls.push({ sel: parent.selector.replace(/\s+/g, ' '), prop: d.prop, value: d.value, ...(media.length ? { media: media.join(' ') } : {}), file: f.rel, line: d.source?.start?.line });
  });
  const exclude = cfg.exclude ? new RegExp(cfg.exclude) : undefined;
  const within = cfg.within ? new RegExp(cfg.within) : undefined;
  const rows: Row[] = [];
  let skipped = 0;
  for (const d of decls) {
    if (exclude?.test(d.sel) || (within && !within.test(d.sel))) { skipped++; continue; }
    const rule = cfg.parts.find((r) => new RegExp(r.selector).test(d.sel) && (!r.props || new RegExp(r.props).test(d.prop)));
    if (!rule) { skipped++; continue; }
    const vs = vars(d.value);
    for (const [i, v] of vs.entries()) {
      const { chain, literal } = chainOf(v.name, v.fallback, defs, isToken);
      const token = chain.find(isToken);
      const state = stateOf(d.sel);
      rows.push({ component: cfg.component, native: cfg.native, part: rule.part, cssProperty: d.prop, ...(state ? { state } : {}), ...(d.media ? { media: d.media } : {}), selector: d.sel, value: d.value, ...(vs.length > 1 ? { position: [i + 1, vs.length] as [number, number] } : {}), chain, ...(token ? { token } : {}), ...(literal ? { literal } : {}), how: 'css', file: d.file, ...(d.line ? { line: d.line } : {}) });
    }
  }
  return { rows, skipped };
}

/** Prop defaults read from shipped JS source text by an authored pattern (Polaris Card padding = {xs: '400'}). */
export function extractProps(cfg: ComponentConfig, read: (rel: string) => string): Row[] {
  const rows: Row[] = [];
  for (const p of cfg.props ?? []) {
    const src = read(p.file);
    const m = src.match(new RegExp(p.pattern));
    if (!m) throw new Error(`${cfg.component}: pattern ${p.pattern} not found in ${p.file}`);
    const line = src.slice(0, m.index).split('\n').length;
    const name = p.token.replace('{v}', m[1]);
    rows.push({ component: cfg.component, native: cfg.native, part: p.part, cssProperty: p.property, selector: '(prop default)', value: m[0], chain: [name], token: name, how: 'prop-default', file: p.file, line });
  }
  return rows;
}

export const readFiles = (dir: string, rels: string[]) => rels.map((rel) => ({ rel, css: fs.readFileSync(path.join(dir, rel), 'utf8') }));
