import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, isAlias, type Provenance, type Token } from '../dtcg.ts';

/**
 * @adobe/spectrum-tokens ships one JSON file per token group (src/<group>.json): flat names, each token with a
 * `$schema` naming its type (color, dimension, alias, color-set, scale-set, drop-shadow, typography ...), a `value`,
 * or `sets` keyed by color theme (light, dark, wireframe) or by platform scale (desktop, mobile). Sets never nest.
 * Aliases are shipped as `{name}` and kept as shipped. Desktop values are the mode-independent default; mobile
 * values form the `mobile` theme (which extends light, as Polaris light-mobile is a platform variant, not a mode).
 *
 * Source entries: { format: "spectrum", path } -- a src directory; every *.json in it is a token group.
 */

type T = { $schema?: string; value?: unknown; sets?: Record<string, T>; uuid?: string; description?: string; deprecated?: boolean; deprecated_comment?: string; renamed?: string; private?: boolean; component?: string };

const WEIGHTS: Record<string, number> = { thin: 100, 'extra-light': 200, light: 300, regular: 400, normal: 400, medium: 500, 'semi-bold': 600, bold: 700, 'extra-bold': 800, black: 900 };
const typeOf = (t: T) => (t.$schema ?? '').split('/').pop()!.replace(/\.json$/, '');
const dim = (s: unknown) => { const t = inferLiteral(String(s), 'x'); return t.$type === 'dimension' ? t.$value : undefined; };

/** DTCG value for a Spectrum value of the given schema type; no $type when DTCG has none (alignment, text-transform). */
function convert(kind: string, v: unknown): { $type?: string; $value: unknown } {
  if (typeof v === 'string' && isAlias(v)) return { $value: v };
  switch (kind) {
    case 'color': { const t = inferLiteral(String(v), 'color'); return t.$type ? t : { $value: String(v) }; }
    case 'dimension': case 'font-size': { const d = dim(v); return d ? { $type: 'dimension', $value: d } : { $value: String(v) }; }
    case 'multiplier': case 'opacity': case 'gradient-stop': case 'angle': return { $type: 'number', $value: Number(v) };
    case 'font-weight': return WEIGHTS[String(v)] ? { $type: 'fontWeight', $value: WEIGHTS[String(v)] } : { $value: String(v) };
    case 'font-family': return { $type: 'fontFamily', $value: String(v) };
    case 'drop-shadow': {
      const layers = (v as Record<string, string>[]).map((s) => ({ color: isAlias(s.color) ? s.color : (inferLiteral(s.color, 'color').$value), offsetX: dim(s.x), offsetY: dim(s.y), blur: dim(s.blur), spread: dim(s.spread) }));
      if (layers.every((l) => l.offsetX && l.offsetY && l.blur && l.spread)) return { $type: 'shadow', $value: layers.length === 1 ? layers[0] : layers };
      return { $value: JSON.stringify(v).replace(/^\[/, '(').replace(/\]$/, ')') };
    }
    case 'typography': {
      const o = v as Record<string, string>;
      if (['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'].every((k) => isAlias(o[k]))) return { $type: 'typography', $value: o };
      return { $value: Object.entries(o).map(([k, x]) => `${k}: ${x}`).join('; ') };
    }
    default: return { $value: typeof v === 'string' ? v : JSON.stringify(v) };
  }
}

export const spectrum: Adapter = (pkgs, source) => {
  const dir = pkgs[source.package.name].dir;
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, deprecated: 0, private: 0 };
  const sets = new Map<string, OutputSet>();
  const setFor = (file: string, theme?: string) => sets.get(file) ?? sets.set(file, { file, theme, tokens: new Map() }).get(file)!;
  const themesSeen = new Set<string>();

  for (const e of source.entries.filter((e) => e.format === 'spectrum')) {
    for (const f of fs.readdirSync(path.join(dir, e.path)).filter((f) => f.endsWith('.json')).sort()) {
      const rel = `${e.path}/${f}`;
      const group = path.basename(f, '.json');
      const doc = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')) as Record<string, T>;
      for (const [name, t] of Object.entries(doc)) {
        const meta: Record<string, unknown> = {
          ...(t.description ? { $description: t.description } : {}),
          ...(t.deprecated ? { $deprecated: t.renamed ? `Use ${t.renamed}` : (t.deprecated_comment ?? true) } : {}),
        };
        const foreign = { 'com.adobe.spectrum': { uuid: t.uuid, ...(t.component ? { component: t.component } : {}) } };
        if (t.deprecated) counts.deprecated++;
        if (t.private) counts.private++;
        const one = (file: string, theme: string | undefined, v: T, kind: string) => {
          const c = convert(kind, v.value);
          const prov: Provenance = { product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file: rel, nativeName: `--spectrum-${name}`, ...(theme ? { theme } : {}), rawValue: typeof v.value === 'string' ? v.value : JSON.stringify(v.value), ...(t.private ? { visibility: 'internal' as const } : {}) };
          const alias = typeof c.$value === 'string' && isAlias(c.$value);
          if (!alias && !c.$type) { prov.untyped = true; counts.untyped++; }
          const set = setFor(file, theme);
          if (set.tokens.has(name)) throw new Error(`duplicate token ${name} in ${file}`);
          set.tokens.set(name, { ...(c.$type ? { $type: c.$type } : {}), $value: c.$value, ...meta, $extensions: { ...foreign, [EXT]: prov } } as Token);
          counts.tokens++;
          if (alias) counts.aliases++; else counts.literals++;
        };
        if (!t.sets) { one(`${group}.tokens.json`, undefined, t, typeOf(t)); continue; }
        const keys = Object.keys(t.sets);
        if (keys.every((k) => k === 'desktop' || k === 'mobile')) {
          one(`${group}.tokens.json`, undefined, t.sets.desktop, typeOf(t.sets.desktop));
          if (t.sets.mobile) { one('scale.mobile.tokens.json', 'mobile', t.sets.mobile, typeOf(t.sets.mobile)); themesSeen.add('mobile'); }
          continue;
        }
        for (const k of keys) { one(`theme.${k}.tokens.json`, k, t.sets[k], typeOf(t.sets[k])); themesSeen.add(k); }
      }
    }
  }
  notes.push(`Themes from sets: ${[...themesSeen].sort().join(', ')}. Desktop scale values are the default; mobile values are the mobile theme.`);
  return { sets: [...sets.values()], report: { notes, counts } };
};
