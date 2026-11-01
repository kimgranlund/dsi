import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, type Provenance, type Token } from '../dtcg.ts';

/**
 * @primer/primitives ships DTCG-style JSON5 sources and, per theme, the built token list it generates its CSS from
 * (dist/docs/functional/themes/<theme>.json, dist/docs/{base,functional}/<group>/*.json): each entry has the
 * resolved `value` for that theme, `original.$value` (an alias or a DTCG literal), `$extensions` with per-theme
 * `org.primer.overrides`, and `name` (the CSS custom property without `--`). Nothing is executed.
 *
 * Base color palettes are not emitted by the build; they are read from src/tokens/base/color/**.json5, layered per
 * theme as Primer's theme config layers them (light.json5, then light.high-contrast.json5 ...). An alias is written
 * only when the theme's alias (override for that theme, else the fallback, else original) names a token whose value
 * in that theme equals the token's resolved value: which palette a theme uses is proven, not assumed.
 *
 * Source entries:
 *   { format: "primer-palette", path, theme }   a JSON5 base color file; listed in layer order per theme
 *   { format: "primer-theme", path, theme }     a built theme token list (colors, shadows, borders)
 *   { format: "primer-docs", path }             a built mode-independent token list (size, spacing, typography...)
 */

type Doc = { name: string; path: string[]; value: unknown; original: { $value: unknown; $type?: string; $description?: string; $deprecated?: unknown; $extensions?: Record<string, any> }; $extensions?: Record<string, any>; description?: string };

const OVERRIDE_KEY = (theme: string) => theme.replace('colorblind', 'protanopia-deuteranopia');
const isAlias = (v: unknown): v is string => typeof v === 'string' && /^\{[^{}]+\}$/.test(v);
const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/\s+/g, '') : JSON.stringify(v));

/** A DTCG color from a Primer color literal: hex wins (sRGB), keeping the shipped color space in rawValue. */
function colorOf(v: unknown): Record<string, unknown> | undefined {
  const hex = typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { hex?: string }).hex : undefined;
  if (!hex) return undefined;
  const t = inferLiteral(hex, 'color');
  return t.$type === 'color' ? (t.$value as Record<string, unknown>) : undefined;
}

function literal(d: Doc): { $type?: string; $value: unknown } {
  const type = d.original.$type;
  const ov = d.original.$value;
  if (type === 'color') { const c = colorOf(d.value) ?? colorOf(ov); if (c) return { $type: 'color', $value: c }; }
  if (type === 'shadow' && Array.isArray(d.value ?? ov)) {
    const layers: Record<string, any>[] = ((Array.isArray(d.value) ? d.value : ov) as Record<string, any>[]).map((s) => ({ ...s, color: colorOf(s.color) }));
    if (layers.every((l) => l.color && l.offsetX)) return { $type: 'shadow', $value: layers.map(({ alpha, ...l }) => (alpha !== undefined && alpha !== 1 ? { ...l, color: { ...l.color, alpha: Math.round(Number(alpha) * Number(l.color.alpha ?? 1) * 10000) / 10000 } } : l)) };
  }
  if ((type === 'dimension' || type === 'duration') && ov && typeof ov === 'object' && 'value' in (ov as object)) {
    const unit = (ov as { unit?: string }).unit;
    if (type === 'duration' ? /^(ms|s)$/.test(unit ?? '') : /^(px|rem)$/.test(unit ?? '')) return { $type: type, $value: ov };
    return { $value: typeof d.value === 'string' ? d.value : `${(ov as { value: number }).value}${unit}` }; // em, %: no DTCG unit
  }
  if (type === 'number' || type === 'fontWeight') { const n = Number(typeof ov === 'number' ? ov : d.value); if (!Number.isNaN(n)) return { $type: type, $value: n }; }
  if (type === 'cubicBezier' && Array.isArray(ov)) return { $type: type, $value: ov };
  if (type === 'transition' && ov && typeof ov === 'object') {
    const o = ov as { duration?: unknown; delay?: unknown; timingFunction?: unknown };
    const ms = (x: unknown) => (x && typeof x === 'object' && 'value' in (x as object) ? x : { value: 0, unit: 'ms' });
    // Parts may be shipped aliases ({motion.duration.medium}): DTCG composites allow them, so keep them.
    const part = (x: unknown, ok: (y: unknown) => boolean) => (isAlias(x) ? x : ok(x) ? x : undefined);
    const dur = part(o.duration, (y) => !!y && typeof y === 'object' && 'value' in (y as object));
    const tf = part(o.timingFunction, Array.isArray);
    if (dur && tf) return { $type: 'transition', $value: { duration: dur, delay: o.delay === undefined ? { value: 0, unit: 'ms' } : (part(o.delay, (y) => !!y && typeof y === 'object') ?? { value: 0, unit: 'ms' }), timingFunction: tf } };
  }
  if (type === 'fontFamily') return { $type: type, $value: ov };
  if (typeof d.value === 'string') { const t = inferLiteral(d.value, d.path.at(-1) ?? ''); if (t.$type) return t; return { $value: d.value }; }
  return { $value: JSON.stringify(d.value ?? ov).replace(/^\{/, '(').replace(/\}$/, ')') };
}

export const primer: Adapter = (pkgs, source) => {
  const dir = pkgs[source.package.name].dir;
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, palette: 0, aliasRejected: 0 };
  const sets = new Map<string, OutputSet>();
  const setFor = (file: string, theme?: string) => sets.get(file) ?? sets.set(file, { file, theme, tokens: new Map() }).get(file)!;
  const prov = (file: string, nativeName: string, raw: unknown, theme?: string, internal = false): Provenance => ({ product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file, nativeName, ...(theme ? { theme } : {}), rawValue: typeof raw === 'string' ? raw : JSON.stringify(raw), ...(internal ? { visibility: 'internal' as const } : {}) });

  // Base palettes per theme, layered in entry order.
  const paletteOf = new Map<string, Map<string, { value: unknown; file: string; desc?: string }>>();
  for (const e of source.entries.filter((e) => e.format === 'primer-palette')) {
    const doc = JSON5.parse(fs.readFileSync(path.join(dir, e.path), 'utf8'));
    const pal = paletteOf.get(e.theme!) ?? paletteOf.set(e.theme!, new Map()).get(e.theme!)!;
    const walk = (o: Record<string, any>, p: string[]) => { for (const [k, v] of Object.entries(o)) { if (k.startsWith('$') || !v || typeof v !== 'object') continue; if ('$value' in v) pal.set([...p, k].join('.'), { value: v.$value, file: e.path, desc: v.$description }); else walk(v, [...p, k]); } };
    walk(doc, []);
  }
  const values = new Map<string, Map<string, unknown>>(); // theme -> token path -> resolved value (for alias proofs)
  for (const [theme, pal] of paletteOf) {
    const set = setFor(`base.${theme}.tokens.json`, theme);
    const vals = values.get(theme) ?? values.set(theme, new Map()).get(theme)!;
    const resolvePal = (v: unknown, seen = 0): unknown => (isAlias(v) && seen < 10 ? resolvePal(pal.get(v.slice(1, -1))?.value, seen + 1) : v);
    for (const [p, { value, file, desc }] of pal) {
      if (isAlias(value)) {
        // Palette entries that name another entry (base.color.neutral.13 = {base.color.black}) stay aliases.
        if (!pal.has(value.slice(1, -1))) throw new Error(`${p}: palette alias ${value} does not resolve`);
        set.tokens.set(p, { $value: value, ...(desc ? { $description: desc } : {}), $extensions: { [EXT]: prov(file, p, value, theme, true) } } as Token);
        vals.set(p, (resolvePal(value) as { hex?: string })?.hex ?? resolvePal(value));
        counts.tokens++; counts.palette++; counts.aliases++;
        continue;
      }
      const c = colorOf(value);
      const pv = prov(file, p, value, theme, true);
      if (!c) { pv.untyped = true; counts.untyped++; }
      set.tokens.set(p, { ...(c ? { $type: 'color' } : {}), $value: c ?? JSON.stringify(value), ...(desc ? { $description: desc } : {}), $extensions: { [EXT]: pv } } as Token);
      vals.set(p, (value as { hex?: string })?.hex ?? value);
      counts.tokens++; counts.palette++;
    }
  }

  const docsOf = (rel: string) => Object.values(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')) as Record<string, Doc>);
  const write = (set: OutputSet, d: Doc, rel: string, theme: string | undefined, alias: string | undefined, vals: Map<string, unknown>) => {
    const p = d.path.join('.');
    if (set.tokens.has(p)) throw new Error(`duplicate token ${p} in ${set.file}`);
    const pv = prov(rel, `--${d.name}`, d.value, theme);
    const desc = d.original.$description ?? d.description;
    const extra: Record<string, unknown> = { ...(desc ? { $description: desc } : {}), ...(d.original.$deprecated !== undefined ? { $deprecated: isAlias(d.original.$deprecated) ? `Use ${d.original.$deprecated.slice(1, -1)}` : d.original.$deprecated } : {}) };
    const foreign = Object.fromEntries(Object.entries(d.original.$extensions ?? {}).filter(([k]) => k === 'org.primer.llm' || k === 'org.primer.figma'));
    const target = alias?.slice(1, -1);
    if (target && vals.has(target) && norm(vals.get(target)) === norm(d.value)) {
      set.tokens.set(p, { $value: alias, ...extra, $extensions: { ...foreign, [EXT]: pv } } as Token);
      counts.aliases++;
    } else {
      if (target) { counts.aliasRejected++; if (counts.aliasRejected <= 40) notes.push(`${p}${theme ? ` (${theme})` : ''}: ${alias} = ${JSON.stringify(vals.get(target))} does not equal ${JSON.stringify(d.value)}; stored as literal`); }
      const t = literal(d);
      if (!t.$type) { pv.untyped = true; counts.untyped++; }
      set.tokens.set(p, { ...t, ...extra, $extensions: { ...foreign, [EXT]: pv } } as Token);
      counts.literals++;
    }
    vals.set(p, d.value);
    counts.tokens++;
  };

  // Mode-independent groups (base first, so functional aliases into base resolve).
  const shared = new Map<string, unknown>();
  const docEntries = source.entries.filter((e) => e.format === 'primer-docs').map((e) => ({ e, docs: docsOf(e.path) }));
  for (const { docs } of docEntries) for (const d of docs) shared.set(d.path.join('.'), d.value); // every file first: aliases cross files
  const proof = new Map(shared);
  const written = new Map<string, unknown>();
  for (const { e, docs } of docEntries) {
    const set = setFor(`${e.path.split('/').slice(-3, -1).join('.')}.${path.basename(e.path, '.json')}.tokens.json`.replace(/^docs\./, ''));
    for (const d of docs) {
      const p = d.path.join('.');
      const first = written.get(p);
      if (first !== undefined) { if (norm(first) !== norm(d.value)) throw new Error(`${p}: ${e.path} disagrees with an earlier file`); notes.push(`${p}: repeated in ${e.path} with the same value`); continue; }
      written.set(p, d.value);
      const o = d.original.$value; write(set, d, e.path, undefined, isAlias(o) ? o : undefined, proof);
    }
  }

  for (const e of source.entries.filter((e) => e.format === 'primer-theme')) {
    const theme = e.theme!;
    const docs = docsOf(e.path);
    const vals = values.get(theme) ?? values.set(theme, new Map()).get(theme)!;
    for (const [k, v] of shared) if (!vals.has(k)) vals.set(k, v);
    for (const d of docs) vals.set(d.path.join('.'), d.value);
    const set = setFor(`functional.${theme}.tokens.json`, theme);
    const key = OVERRIDE_KEY(theme);
    for (const d of docs) {
      const ov = (d.original.$extensions?.['org.primer.overrides'] ?? {}) as Record<string, unknown>;
      const fallback = theme.startsWith('dark') ? ov.dark : undefined;
      const pick = (x: unknown) => (x && typeof x === 'object' && '$value' in (x as object) ? (x as { $value: unknown }).$value : x);
      const a = pick(ov[key]) ?? (theme.includes('high-contrast') ? pick(ov[theme.startsWith('dark') ? 'dark-high-contrast' : 'light-high-contrast']) : undefined) ?? pick(fallback) ?? d.original.$value;
      write(set, d, e.path, theme, isAlias(a) ? a : undefined, vals);
    }
  }
  if (counts.aliasRejected > 40) notes.push(`... ${counts.aliasRejected - 40} more aliases not proven`);
  return { sets: [...sets.values()], report: { notes, counts } };
};
