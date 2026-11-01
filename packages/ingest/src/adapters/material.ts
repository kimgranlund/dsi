import fs from 'node:fs';
import path from 'node:path';
import * as sass from 'sass';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, isAlias, type Token } from '../dtcg.ts';
import { materialDocGroups } from '../structure.ts';
import { sassModuleVariables } from '../sass-module.ts';

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
  // Newer token sets shipped beside the one components consume (tokens/versions/latest): plain `$var: value;` modules
  // whose `///` comment gives the M3 token name. Stored in their own theme; a token whose name matches a consumed
  // token's path (md.sys.shape.corner-large) overrides it there, the rest are new. Variable-font axis settings are
  // not ingested: no DTCG type fits them and no role uses them.
  const AXES = /-(crsv|fill|grad|hexp|opsz|rond|slnt|wdth|wght)$/;
  for (const e of source.entries.filter((e) => e.format === 'sass-vars')) {
    const theme = e.theme!;
    const file = `md.${theme}.tokens.json`;
    const set = sets.get(file) ?? sets.set(file, { file, theme, tokens: new Map() }).get(file)!;
    const nameOf = new Map<string, Map<string, string>>(); // module -> sass var -> token path
    const valueOf = new Map<string, string>();
    let axes = 0;
    for (const mod of e.modules ?? []) {
      const rel = `${e.path}/_${mod}.scss`;
      const src = fs.readFileSync(path.join(pkgs[source.package.name].dir, rel), 'utf8');
      const refs = new Map([...src.matchAll(/^\$([a-z0-9-]+):\s*([a-z0-9-]+)\.\$([a-z0-9-]+);/gm)].map((m) => [m[1], [m[2], m[3]] as const]));
      const names = new Map<string, string>();
      nameOf.set(mod, names);
      for (const v of sassModuleVariables(pkgs, source.package.name, rel)) {
        const native = v.description?.match(/^(md\.[a-z0-9.-]+)/)?.[1];
        if (!native) throw new Error(`${rel}: $${v.name} has no md.* name comment`);
        const [a, b, c, ...rest] = native.split('.');
        const tokenPath = `${a}.${b}.${c}.${rest.join('-')}`;
        if (AXES.test(tokenPath)) { axes++; continue; }
        const raw = String(v.value);
        names.set(v.name, tokenPath);
        valueOf.set(tokenPath, raw);
        const prov = { product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file: rel, nativeName: native, theme, rawValue: raw };
        const ref = refs.get(v.name);
        const target = ref && nameOf.get(ref[0])?.get(ref[1]);
        let token: Token;
        if (target && valueOf.get(target) === raw) { token = { $value: `{${target}}`, $extensions: { [EXT]: prov } }; counts.aliases++; }
        else {
          if (ref) notes.push(`${tokenPath}: references ${ref[0]}.$${ref[1]} but the value could not be proven; stored as literal`);
          const t = inferLiteral(raw, tokenPath.split('.').pop()!);
          token = { ...t, $extensions: { [EXT]: t.$type ? prov : { ...prov, untyped: true } } };
          counts.literals++;
          if (!t.$type) counts.untyped++;
        }
        const group = v.description!.match(/\((.+)\)\s*$/)?.[1];
        if (group) (token as Token & { $description?: string }).$description = group;
        set.tokens.set(tokenPath, token);
        counts.tokens++;
      }
    }
    notes.push(`${e.path}: theme "${theme}" from ${(e.modules ?? []).length} modules; ${axes} variable-font axis tokens not ingested`);
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
