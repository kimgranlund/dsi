import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, type Provenance, type Token } from '../dtcg.ts';

/**
 * @atlaskit/tokens ships its tokens as generated JS modules whose body is one JSON array literal
 * (`var tokens = [...]`): artifacts/tokens-raw/<theme>.js and artifacts/palettes-raw/<palette>.js. We read the
 * literal as JSON text; the module is never executed. Each token has its resolved `value` and the palette name it
 * came from (`original.value: "Lime100"`); a token is an alias only when that palette token exists and its value
 * equals the resolved value. Native names come from artifacts/token-names.js (also a literal map).
 *
 * Source entries:
 *   { format: "atlassian-palette", path, theme? }   a palette file (theme: only that theme uses it, e.g. brand refresh)
 *   { format: "atlassian-tokens", path, theme? }    a token file; no theme = mode-independent (spacing, shape...)
 *   { format: "atlassian-names", path }             the cleanName -> CSS custom property map
 */

type Raw = { name: string; cleanName?: string; path: string[]; value: unknown; original?: { value: unknown }; attributes?: Record<string, string> };

/** The JSON literal assigned in a generated module (`var tokens = [...]` or `= {...}`), without running it. */
export function literalOf(src: string): unknown {
  const start = src.search(/=\s*[[{]/);
  if (start < 0) throw new Error('no literal assignment');
  const open = src.slice(start).search(/[[{]/) + start;
  const close = src[open] === '[' ? src.lastIndexOf(']') : src.lastIndexOf('}');
  const body = src.slice(open, close + 1);
  // token-names.js uses single-quoted keys and values: make them JSON.
  return JSON.parse(src[open] === '{' ? body.replace(/'([^'\\]*)'/g, '"$1"').replace(/,\s*}/g, '}') : body);
}

const px = (n: number) => ({ value: n, unit: 'px' });
const hexColor = (hex: string, opacity?: number) => {
  const t = inferLiteral(hex, 'color');
  if (t.$type !== 'color') return undefined;
  const v = { ...(t.$value as Record<string, unknown>) };
  // The shipped CSS uses the shadow's opacity as the color's alpha (it replaces, not multiplies, a hex8 alpha).
  if (opacity !== undefined) { if (opacity === 1) delete v.alpha; else v.alpha = Math.round(opacity * 10000) / 10000; }
  return v;
};

/** Typed DTCG value from an Atlassian raw value; undefined $type when nothing fits (font shorthands). */
function typed(raw: Raw): { $type?: string; $value: unknown; foreign?: Record<string, unknown> } {
  const v = raw.value;
  const group = raw.attributes?.group ?? '';
  if (Array.isArray(v) && v.every((s) => s && typeof s === 'object' && 'offset' in s)) {
    const layers = (v as { radius: number; spread?: number; offset: { x: number; y: number }; color: string; opacity: number; inset?: boolean }[]).map((s) => ({ color: hexColor(s.color, s.opacity), offsetX: px(s.offset.x), offsetY: px(s.offset.y), blur: px(s.radius), spread: px(s.spread ?? 0), ...(s.inset ? { inset: true } : {}) }));
    if (layers.every((l) => l.color)) return { $type: 'shadow', $value: layers.length === 1 ? layers[0] : layers };
  }
  if (v && typeof v === 'object' && 'duration' in v && 'curve' in v) {
    const m = v as { duration: number; curve: string; keyframes?: string[]; fill?: string };
    const curve = inferLiteral(String(m.curve), 'curve');
    const foreign = { 'com.atlassian': { keyframes: m.keyframes ?? [], fill: m.fill ?? null } };
    if (curve.$type === 'cubicBezier') return { $type: 'transition', $value: { duration: { value: m.duration, unit: 'ms' }, delay: { value: 0, unit: 'ms' }, timingFunction: curve.$value }, foreign };
    // CSS linear() easing has no DTCG type: keep the shipped transition as CSS text, untyped.
    return { $value: `${m.duration}ms ${m.curve}`, foreign };
  }
  if (typeof v === 'number') {
    if (/duration/i.test(group)) return { $type: 'duration', $value: { value: v, unit: 'ms' } };
    if (/fontWeight/.test(group)) return { $type: 'fontWeight', $value: v };
    return { $type: 'number', $value: v };
  }
  if (typeof v === 'string') {
    if (/fontFamily/.test(group)) return { $type: 'fontFamily', $value: v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) };
    if (/fontWeight/.test(group) && /^\d+$/.test(v)) return { $type: 'fontWeight', $value: Number(v) };
    const t = inferLiteral(v, raw.path.at(-1) ?? '');
    return t;
  }
  // Anything else stays shipped text; JSON text must not start with '{' (DTCG alias syntax).
  return { $value: typeof v === 'string' ? v : JSON.stringify(v).replace(/^\{/, '(').replace(/\}$/, ')') };
}

/** DTCG path from the shipped path: a group's own value ([default]) becomes `default` (no shipped name collides), so tokens never nest inside tokens. */
const tokenPath = (raw: Raw) => raw.path.map((s) => (s === '[default]' ? 'default' : s.replace(/[^A-Za-z0-9-]/g, ''))).join('.');

export const atlassian: Adapter = (pkgs, source) => {
  const dir = pkgs[source.package.name].dir;
  const read = (rel: string) => literalOf(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, palette: 0, aliasRejected: 0 };
  const namesEntry = source.entries.find((e) => e.format === 'atlassian-names');
  const cssName = new Map(Object.entries((namesEntry ? read(namesEntry.path) : {}) as Record<string, string>));

  const sets = new Map<string, OutputSet>();
  const setFor = (file: string, theme?: string) => sets.get(file) ?? sets.set(file, { file, theme, tokens: new Map() }).get(file)!;
  // Palette tokens by their last segment (Lime100), per theme scope: '' = everywhere, else only that theme.
  const palette = new Map<string, Map<string, { path: string; value: unknown; typed: string }>>();
  const prov = (raw: Raw, file: string, theme?: string, internal = false): Provenance => ({ product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file, nativeName: internal ? raw.name : (cssName.get(raw.cleanName ?? raw.name) ?? raw.name), ...(theme ? { theme } : {}), rawValue: typeof raw.value === 'string' ? raw.value : JSON.stringify(raw.value), ...(internal ? { visibility: 'internal' as const } : {}) });
  const put = (set: OutputSet, p: string, raw: Raw, token: Token) => {
    const d = raw.attributes?.description;
    const t = token as Token & Record<string, unknown>;
    if (d) t.$description = d;
    if (raw.attributes?.state === 'deprecated' || raw.attributes?.state === 'deleted') t.$deprecated = raw.attributes.replacement ? `Use ${raw.attributes.replacement}` : true;
    if (set.tokens.has(p)) throw new Error(`duplicate token ${p} in ${set.file}`);
    set.tokens.set(p, token);
    counts.tokens++;
  };

  for (const e of source.entries.filter((e) => e.format === 'atlassian-palette')) {
    const scope = e.theme ?? '';
    const byName = palette.get(scope) ?? palette.set(scope, new Map()).get(scope)!;
    const file = e.theme ? `palette.${e.theme}.tokens.json` : 'palette.tokens.json';
    for (const raw of read(e.path) as Raw[]) {
      const p = tokenPath(raw);
      const set = setFor(file, e.theme);
      // Palettes repeat shared scales (opacity) with equal values: keep the first, fail on a conflict.
      const prev = set.tokens.get(p);
      if (prev) { if (JSON.stringify(prev.$extensions[EXT].rawValue) !== JSON.stringify(typeof raw.value === 'string' ? raw.value : JSON.stringify(raw.value))) throw new Error(`${p}: palettes disagree`); notes.push(`${p}: repeated in ${e.path} with the same value`); continue; }
      const t = typed(raw);
      const pv = prov(raw, e.path, e.theme, true);
      if (!t.$type) pv.untyped = true;
      put(set, p, raw, { ...(t.$type ? { $type: t.$type } : {}), $value: t.$value, $extensions: { [EXT]: pv } });
      byName.set(raw.path.at(-1)!, { path: p, value: raw.value, typed: JSON.stringify(t.$value) });
      counts.palette++;
    }
  }
  const lookup = (theme: string | undefined, name: string) => (theme ? palette.get(theme)?.get(name) : undefined) ?? palette.get('')?.get(name);

  for (const e of source.entries.filter((e) => e.format === 'atlassian-tokens')) {
    const base = path.basename(e.path, '.js');
    const file = e.theme ? `tokens.${e.theme}.tokens.json` : `${base.replace(/^atlassian-/, '')}.tokens.json`;
    const set = setFor(file, e.theme);
    for (const raw of read(e.path) as Raw[]) {
      const p = tokenPath(raw);
      const pv = prov(raw, e.path, e.theme);
      const orig = raw.original?.value;
      const target = typeof orig === 'string' ? lookup(e.theme, orig) : undefined;
      // Equal as typed DTCG values (palette Duration150 = 150 and a token's "150ms" are the same duration).
      if (target && (JSON.stringify(target.value) === JSON.stringify(raw.value) || target.typed === JSON.stringify(typed(raw).$value))) {
        put(set, p, raw, { $value: `{${target.path}}`, $extensions: { [EXT]: pv } });
        counts.aliases++;
        continue;
      }
      if (target) { counts.aliasRejected++; notes.push(`${p}${e.theme ? ` (${e.theme})` : ''}: original ${orig} = ${JSON.stringify(target.value)} differs from ${JSON.stringify(raw.value)}; stored as literal`); }
      const t = typed(raw);
      if (!t.$type) { pv.untyped = true; counts.untyped++; }
      put(set, p, raw, { ...(t.$type ? { $type: t.$type } : {}), $value: t.$value, $extensions: { ...(t.foreign ?? {}), [EXT]: pv } as Token['$extensions'] });
      counts.literals++;
    }
  }
  notes.push('Font shorthands (font.heading.*, font.body.*) are stored untyped as shipped; their palette parts are in the typography palette.');
  return { sets: [...sets.values()], report: { notes, counts } };
};
