import fs from 'node:fs';
import path from 'node:path';

const EXT = 'io.nonoun.dsi';
const ALIAS = /^\{([^{}]+)\}$/;

export interface NativeToken {
  path: string;
  type?: string;
  description?: string;
  deprecated?: unknown;
  prov: Record<string, unknown>;
  /** Raw DTCG token per theme ('' when the product has no themes for this token). */
  byTheme: Map<string, Record<string, unknown>>;
}

export interface NativeSet {
  product: string;
  version: string;
  implementation?: string;
  themes: string[];
  tokens: Map<string, NativeToken>;
  /** Resolve a token path in a theme: theme file first, then mode-independent files. */
  lookup(theme: string, p: string): Record<string, unknown> | undefined;
}

function leaves(tree: Record<string, unknown>, prefix = ''): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = [];
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('$') || !v || typeof v !== 'object') continue;
    if ('$value' in v) out.push([prefix + k, v as Record<string, unknown>]);
    else out.push(...leaves(v as Record<string, unknown>, prefix + k + '.'));
  }
  return out;
}

export function loadNative(root: string, product: string, version: string): NativeSet {
  const dir = path.join(root, 'data/native', product, version);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { implementation?: string; themes?: string[]; defaultTheme?: string; files: { file: string; theme?: string }[] };
  const base = new Map<string, Record<string, unknown>>();
  const themed = new Map<string, Map<string, Record<string, unknown>>>();
  for (const f of manifest.files) {
    const target = f.theme ? (themed.get(f.theme) ?? themed.set(f.theme, new Map()).get(f.theme)!) : base;
    for (const [p, t] of leaves(JSON.parse(fs.readFileSync(path.join(dir, f.file), 'utf8')))) target.set(p, t);
  }
  const themes = manifest.themes ?? [];
  const lookup = (theme: string, p: string) => themed.get(theme)?.get(p) ?? base.get(p);
  const tokens = new Map<string, NativeToken>();
  const add = (p: string, t: Record<string, unknown>, theme: string) => {
    const cur = tokens.get(p) ?? { path: p, type: t.$type as string | undefined, description: t.$description as string | undefined, deprecated: t.$deprecated, prov: (t.$extensions as Record<string, Record<string, unknown>>)[EXT], byTheme: new Map() };
    cur.description ??= t.$description as string | undefined;
    cur.type ??= t.$type as string | undefined;
    cur.byTheme.set(theme, t);
    tokens.set(p, cur);
  };
  if (themes.length) {
    for (const theme of themes) {
      for (const [p] of base) add(p, lookup(theme, p)!, theme);
      for (const [p, t] of themed.get(theme) ?? []) add(p, t, theme);
    }
  } else for (const [p, t] of base) add(p, t, '');
  return { product, version, implementation: manifest.implementation, themes, tokens, lookup };
}

/** Follow aliases to a literal in one theme. Returns the chain of alias targets and the literal token. */
export function resolve(set: NativeSet, theme: string, p: string): { chain: string[]; literal?: Record<string, unknown> } {
  const chain: string[] = [];
  let cur = set.lookup(theme, p);
  const seen = new Set([p]);
  while (cur && typeof cur.$value === 'string' && ALIAS.test(cur.$value)) {
    const ref = (cur.$value as string).slice(1, -1);
    if (seen.has(ref)) break;
    seen.add(ref);
    chain.push(ref);
    cur = set.lookup(theme, ref);
  }
  return { chain, literal: cur };
}

/** Human-readable color: hex plus alpha when not opaque. */
export function showValue(t: Record<string, unknown> | undefined): string {
  if (!t) return '(unresolved)';
  const v = t.$value as Record<string, unknown>;
  if (t.$type === 'color' && v && typeof v === 'object') {
    const comps = v.components as number[];
    const hex = (v.hex as string) ?? '#' + comps.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    return v.alpha !== undefined && v.alpha !== 1 ? `${hex} @ ${v.alpha}` : hex;
  }
  return typeof t.$value === 'string' ? t.$value : JSON.stringify(t.$value);
}
