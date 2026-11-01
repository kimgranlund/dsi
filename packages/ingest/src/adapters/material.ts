import fs from 'node:fs';
import path from 'node:path';
import * as sass from 'sass';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, isAlias, type Token } from '../dtcg.ts';
import { materialDocGroups } from '../structure.ts';

/**
 * @material/web ships tokens as Sass modules (tokens/_md-{ref,sys,comp}-*.scss). Each exposes values() (or
 * values-light()/values-dark() for md-sys-color) returning a map whose entries are map.get($deps, <module>, <key>)
 * lookups or literals. We evaluate every module twice:
 *   1. real deps   -> the literal value the component actually receives;
 *   2. placeholder deps, where every dependency value is the string "{md.sys.color.primary}" -> the alias, if any.
 * A token is an alias only when pass 2 yields exactly one placeholder AND its real value equals the target's real
 * value. Anything else (computed or partially derived) is stored as the literal from pass 1.
 */

const SKIP = new Set(['md-comp-test-table']);
const modPath = (mod: string) => mod.replace(/^md-(ref|sys|comp)-/, 'md.$1.');

interface ModuleInfo {
  name: string;
  file: string;
  fns: string[];
  excludeCustomProps: boolean;
  deps: { key: string; fn: string }[];
}

function readModule(tokensDir: string, file: string): ModuleInfo {
  const src = fs.readFileSync(path.join(tokensDir, file), 'utf8');
  const name = file.replace(/^_/, '').replace(/\.scss$/, '');
  const fns = [...src.matchAll(/@function ([a-z-]+)\(/g)].map((m) => m[1]).filter((f) => f.startsWith('values'));
  const deps = new Map<string, string>();
  for (const block of src.matchAll(/\$_default[a-z-]*:\s*\(([\s\S]*?)\);/g))
    for (const m of block[1].matchAll(/'([a-z-]+)':\s*([a-z-]+)\.([a-z-]+)\(\)/g)) if (m[1] === m[2]) deps.set(m[1], m[3]);
  return { name, file, fns, excludeCustomProps: src.includes('$exclude-custom-properties'), deps: [...deps].map(([key, fn]) => ({ key, fn })) };
}

/** Compile a snippet that emits `--<key>: <inspected value>;` for each entry of a map, and parse it back. */
function emit(tokensDir: string, uses: string[], mapExpr: string): Map<string, string> {
  const scss = [
    "@use 'sass:map';",
    "@use 'sass:meta';",
    "@use 'sass:string';",
    ...uses,
    '@function dsi-placeholders($path, $values) {',
    '  $out: ();',
    '  @each $k, $v in $values { $out: map.set($out, $k, if($v == null, null, string.unquote("{#{$path}.#{$k}}"))); }',
    '  @return $out;',
    '}',
    `$dsi-out: ${mapExpr};`,
    ':root { @each $k, $v in $dsi-out { --#{$k}: #{meta.inspect($v)}; } }',
  ].join('\n');
  const css = sass.compileString(scss, { loadPaths: [tokensDir], style: 'expanded', logger: sass.Logger.silent }).css;
  const out = new Map<string, string>();
  for (const m of css.matchAll(/^\s*--([a-z0-9-]+):\s*(.*);$/gm)) out.set(m[1], m[2]);
  return out;
}

export const material: Adapter = (pkgs, source) => {
  const tokensDir = path.join(pkgs[source.package.name].dir, 'tokens');
  const modules = fs.readdirSync(tokensDir).filter((f) => /^_md-(ref|sys|comp)-.*\.scss$/.test(f)).map((f) => readModule(tokensDir, f)).filter((m) => !SKIP.has(m.name));
  const byName = new Map(modules.map((m) => [m.name, m]));
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, nullSkipped: 0, aliasRejected: 0 };

  const call = (m: ModuleInfo, fn: string, depsExpr?: string) => {
    const args = [depsExpr ? `$deps: ${depsExpr}` : '', m.excludeCustomProps ? '$exclude-custom-properties: true' : ''].filter(Boolean).join(', ');
    return `m.${fn}(${args})`;
  };
  /** Expression for a dependency's real values, with its own dependencies resolved the same way, all custom properties excluded. */
  const depCall = (key: string, fn: string, uses: Set<string>, mode: 'real' | 'placeholder'): string => {
    const d = byName.get(key);
    if (!d) throw new Error(`unknown dependency module ${key}`);
    uses.add(key);
    const nested = d.deps.length ? `$deps: (${d.deps.map((n) => `'${n.key}': ${depCall(n.key, n.fn, uses, 'real')}`).join(', ')})` : '';
    const args = [nested, d.excludeCustomProps ? '$exclude-custom-properties: true' : ''].filter(Boolean).join(', ');
    const expr = `${key.replaceAll('-', '_')}.${fn}(${args})`;
    return mode === 'placeholder' ? `dsi-placeholders('${modPath(key)}', ${expr})` : expr;
  };

  /** Real values by mode variant ('' = mode-independent), keyed by token path. */
  const real = new Map<string, Map<string, string>>();
  type Raw = { mod: ModuleInfo; variant: string; values: Map<string, string>; aliases: Map<string, string> };
  const raws: Raw[] = [];

  for (const m of modules) {
    const used = new Set<string>();
    const realDeps = m.deps.length ? `(${m.deps.map((d) => `'${d.key}': ${depCall(d.key, d.fn, used, 'real')}`).join(', ')})` : undefined;
    const placeholderDeps = m.deps.length ? `(${m.deps.map((d) => `'${d.key}': ${depCall(d.key, d.fn, used, 'placeholder')}`).join(', ')})` : undefined;
    const uses = [`@use '${m.name}' as m;`, ...[...used].map((k) => `@use '${k}' as ${k.replaceAll('-', '_')};`)];
    for (const fn of m.fns) {
      const variant = fn === 'values' ? '' : fn.replace('values-', '');
      const values = emit(tokensDir, uses, call(m, fn, realDeps));
      let aliases = new Map<string, string>();
      if (placeholderDeps) {
        try { aliases = emit(tokensDir, uses, call(m, fn, placeholderDeps)); }
        catch (e) { notes.push(`${m.name}.${fn}: placeholder pass failed, all values stored as literals (${(e as Error).message.split('\n')[0]})`); }
      }
      const r = real.get(variant) ?? real.set(variant, new Map()).get(variant)!;
      for (const [k, v] of values) r.set(`${modPath(m.name)}.${k}`, v);
      raws.push({ mod: m, variant, values, aliases });
    }
  }
  // Mode-independent modules were evaluated against light defaults, so their targets resolve in light.
  const realOf = (variant: string, p: string) => real.get(variant)?.get(p) ?? real.get('')?.get(p) ?? (variant ? undefined : real.get('light')?.get(p));

  const sets = new Map<string, OutputSet>();
  const setFor = (mod: string, variant: string): OutputSet => {
    const tier = mod.split('-')[1];
    const file = variant ? `${modPath(mod)}.${variant}.tokens.json` : `md.${tier}.tokens.json`;
    return sets.get(file) ?? sets.set(file, { file, theme: variant || undefined, tokens: new Map() }).get(file)!;
  };

  for (const { mod, variant, values, aliases } of raws) {
    const set = setFor(mod.name, variant);
    for (const [key, raw] of values) {
      if (raw === 'null') { counts.nullSkipped++; continue; }
      const tokenPath = `${modPath(mod.name)}.${key}`;
      const nativeName = mod.name.startsWith('md-comp-') ? `--md-${mod.name.slice(8)}-${key}` : mod.excludeCustomProps ? `--${mod.name}-${key}` : `${mod.name}.${key}`;
      const prov = { product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file: `tokens/${mod.file}`, nativeName, ...(variant ? { theme: variant } : {}), rawValue: raw };
      let token: Token | undefined;
      const a = aliases.get(key);
      if (a && isAlias(a)) {
        const target = a.slice(1, -1);
        const targetReal = realOf(variant, target);
        if (targetReal === raw) {
          token = { $value: a, $extensions: { [EXT]: prov } };
          counts.aliases++;
        } else {
          counts.aliasRejected++;
          notes.push(`${tokenPath}: placeholder pointed at ${a} but real value ${raw} != ${targetReal}; stored as literal`);
        }
      }
      if (!token) {
        const t = inferLiteral(raw, key);
        token = { ...t, $extensions: { [EXT]: t.$type ? prov : { ...prov, untyped: true } } };
        counts.literals++;
        if (!t.$type) counts.untyped++;
      }
      set.tokens.set(tokenPath, token);
      counts.tokens++;
    }
  }
  // Shipped groups and descriptions from the documented token file, when the source lists it.
  const doc = source.entries.find((e) => e.format === 'sass-doc-groups') as (typeof source.entries)[number] & { groupOrder?: string[]; groupOrderSource?: string } | undefined;
  let structure;
  if (doc) {
    const r = materialDocGroups(path.join(pkgs[source.package.name].dir, doc.path), doc.path, doc.groupOrder, doc.groupOrderSource);
    structure = r.structure;
    for (const s of sets.values()) for (const [p, t] of s.tokens) { const d = r.descriptions.get(p); if (d) (t as Token & { $description?: string }).$description = d; }
    counts.described = r.descriptions.size;
  }
  return { sets: [...sets.values()], structure, report: { notes, counts } };
};
