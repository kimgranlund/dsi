import fs from 'node:fs';
import path from 'node:path';

export const EXT = 'io.nonoun.dsi';
const ALIAS = /^\{([^{}]+)\}$/;
export const isAlias = (v: unknown): v is string => typeof v === 'string' && ALIAS.test(v);

export type RawToken = Record<string, unknown>;

export interface NativeToken {
  path: string;
  type?: string;
  description?: string;
  deprecated?: unknown;
  prov: Record<string, unknown>;
  /** Raw DTCG token per theme ('' when the product has no themes). */
  byTheme: Map<string, RawToken>;
}

export interface NativeSet {
  product: string;
  version: string;
  implementation?: string;
  themes: string[];
  defaultTheme?: string;
  /** Canonical mode slug -> the native theme that represents it. */
  modes: Record<string, string>;
  tokens: Map<string, NativeToken>;
  /** A token path in a theme: the theme's file first, then the mode-independent files. */
  lookup(theme: string, p: string): RawToken | undefined;
}

function leaves(tree: Record<string, unknown>, prefix = ''): [string, RawToken][] {
  const out: [string, RawToken][] = [];
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('$') || !v || typeof v !== 'object') continue;
    if ('$value' in v) out.push([prefix + k, v as RawToken]);
    else out.push(...leaves(v as Record<string, unknown>, prefix + k + '.'));
  }
  return out;
}

/** Load data/native/<product>/<version>: every token, per theme, with a theme-aware lookup. */
export function loadNative(root: string, product: string, version: string): NativeSet {
  const dir = path.join(root, 'data/native', product, version);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { implementation?: string; themes?: string[]; defaultTheme?: string; modes?: Record<string, string>; themeExtends?: Record<string, string>; files: { file: string; theme?: string }[] };
  const base = new Map<string, RawToken>();
  const themed = new Map<string, Map<string, RawToken>>();
  for (const f of manifest.files) {
    const target = f.theme ? (themed.get(f.theme) ?? themed.set(f.theme, new Map()).get(f.theme)!) : base;
    for (const [p, t] of leaves(JSON.parse(fs.readFileSync(path.join(dir, f.file), 'utf8')))) target.set(p, t);
  }
  const themes = manifest.themes ?? [];
  // An extending theme (Material expressive extends light) falls back to its parent theme before the base files.
  const parent = manifest.themeExtends ?? {};
  const lookup = (theme: string, p: string): RawToken | undefined => themed.get(theme)?.get(p) ?? (parent[theme] ? lookup(parent[theme], p) : base.get(p));
  const tokens = new Map<string, NativeToken>();
  const add = (p: string, t: RawToken, theme: string) => {
    const cur = tokens.get(p) ?? { path: p, type: t.$type as string | undefined, description: t.$description as string | undefined, deprecated: t.$deprecated, prov: (t.$extensions as Record<string, Record<string, unknown>>)[EXT], byTheme: new Map() };
    cur.description ??= t.$description as string | undefined;
    cur.type ??= t.$type as string | undefined;
    cur.byTheme.set(theme, t);
    tokens.set(p, cur);
  };
  if (themes.length) {
    for (const theme of themes) {
      for (const [p] of base) add(p, lookup(theme, p)!, theme);
      for (let t: string | undefined = theme; t; t = parent[t]) for (const [p] of themed.get(t) ?? []) add(p, lookup(theme, p)!, theme);
    }
  } else for (const [p, t] of base) add(p, t, '');
  return { product, version, implementation: manifest.implementation, themes, defaultTheme: manifest.defaultTheme, modes: manifest.modes ?? {}, tokens, lookup };
}

export interface Resolved {
  /** Alias targets followed, in order. */
  chain: string[];
  /** The literal token at the end of the chain, if any. */
  literal?: RawToken;
  /** The DTCG type: the first explicit $type along the chain, else the literal's. */
  type?: string;
  /** The fully resolved value: aliases nested inside composite values are resolved too. */
  value?: unknown;
  problem?: 'unresolved' | 'cycle';
}

/** Follow aliases to a literal in one theme and resolve any aliases nested in its value. */
export function resolve(set: NativeSet, theme: string, p: string): Resolved {
  const chain: string[] = [];
  let cur = set.lookup(theme, p);
  let type = cur?.$type as string | undefined;
  const seen = new Set([p]);
  while (cur && isAlias(cur.$value)) {
    const ref = cur.$value.slice(1, -1);
    if (seen.has(ref)) return { chain, type, problem: 'cycle' };
    seen.add(ref);
    chain.push(ref);
    cur = set.lookup(theme, ref);
    type ??= cur?.$type as string | undefined;
  }
  if (!cur) return { chain, type, problem: 'unresolved' };
  const deep = (v: unknown, depth: number): unknown => {
    if (depth > 32) return v;
    if (isAlias(v)) { const r = resolve(set, theme, v.slice(1, -1)); return r.value ?? v; }
    if (Array.isArray(v)) return v.map((x) => deep(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, depth + 1)]));
    return v;
  };
  return { chain, literal: cur, type, value: deep(cur.$value, 0) };
}

/** The theme that answers a canonical mode, or the default/first theme when no mode is asked. */
export function themeFor(set: NativeSet, mode?: string): string | undefined {
  if (!set.themes.length) return '';
  if (!mode) return set.defaultTheme ?? set.modes.light ?? set.themes[0];
  return set.modes[mode];
}

/** Human-readable value: hex (with alpha when not opaque) for colors, value+unit for dimensions. */
export function showValue(type: string | undefined, value: unknown): string {
  if (value === undefined) return '(unresolved)';
  const v = value as Record<string, unknown>;
  if (type === 'color' && v && typeof v === 'object' && Array.isArray(v.components)) {
    const hex = (v.hex as string) ?? '#' + (v.components as number[]).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    return v.alpha !== undefined && v.alpha !== 1 ? `${hex} @ ${v.alpha}` : hex;
  }
  if (v && typeof v === 'object' && 'value' in v && 'unit' in v) return `${v.value}${v.unit}`;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
