import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, isAlias, type Provenance, type Token } from '../dtcg.ts';
import { sassModuleVariables, type SassValue } from '../sass-module.ts';
import { carbonTokenGroups } from '../structure.ts';

/**
 * For products that already ship DTCG 2025.10 files. Source entries:
 *   { format: "dtcg", path, package? }           a mode-independent token file
 *   { format: "dtcg-resolver", path, package? }  a resolver whose `theme`-style modifier lists per-context files
 *   { format: "sass-module", path, package, group, variables?, flatten?, skipKeys? }
 *       public variables of a shipped Sass module (for packages that ship no DTCG file, e.g. @carbon/type), evaluated
 *       with Sass and stored under `<group>.<variable>.<map key>...`; `flatten` drops the variable segment
 * Curly-brace aliases are kept as shipped. JSON Pointer `$ref`s inside a value (partial references, e.g. a palette
 * colour with a new alpha) are resolved to a literal against the shipped files, and the token is noted as derived.
 * Group `$type`s are inherited onto tokens. `$description`, `$deprecated` and foreign `$extensions` are kept.
 */

type Json = Record<string, unknown>;

interface RawToken { path: string; node: Json; type?: string }

function walk(node: Json, prefix: string[] = [], inherited?: string): RawToken[] {
  const out: RawToken[] = [];
  const type = (node.$type as string | undefined) ?? inherited;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$') || !v || typeof v !== 'object') continue;
    const child = v as Json;
    if ('$value' in child) out.push({ path: [...prefix, k].join('.'), node: child, type: (child.$type as string | undefined) ?? type });
    else out.push(...walk(child, [...prefix, k], type));
  }
  return out;
}

const hasRef = (v: unknown): boolean => !!v && typeof v === 'object' && ('$ref' in (v as Json) || Object.values(v as Json).some(hasRef));

function pointer(docs: Json[], ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`external $ref ${ref} is not supported`);
  const parts = ref.slice(2).split('/').map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  for (const doc of docs) {
    let cur: unknown = doc;
    for (const p of parts) cur = cur && typeof cur === 'object' ? (cur as Json)[p] : undefined;
    if (cur !== undefined) return cur;
  }
  throw new Error(`$ref ${ref} does not resolve`);
}

function resolveRefs(v: unknown, docs: Json[]): unknown {
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, docs));
  if (v && typeof v === 'object') {
    const o = v as Json;
    if (typeof o.$ref === 'string') return resolveRefs(pointer(docs, o.$ref), docs);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, resolveRefs(x, docs)]));
  }
  return v;
}

export const dtcg: Adapter = (pkgs, source) => {
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, derived: 0 };
  const read = (pkg: string, rel: string) => JSON.parse(fs.readFileSync(path.join(pkgs[pkg].dir, rel), 'utf8')) as Json;
  const pkgOf = (e: { package?: string }) => e.package ?? source.package.name;
  /** nativeName from the entry's pattern ("--cds-{path}"), else the DTCG path itself, which is the shipped name. */
  const named = (e: { nativeName?: string }) => (p: string) => (e.nativeName ? e.nativeName.replace('{path}', p) : p);

  const baseEntries = source.entries.filter((e) => e.format === 'dtcg');
  const baseDocs = baseEntries.map((e) => read(pkgOf(e), e.path));
  const sets: OutputSet[] = [];

  const convert = (doc: Json, set: OutputSet, pkg: string, file: string, theme: string | undefined, docs: Json[], nativeName: (p: string) => string) => {
    for (const t of walk(doc)) {
      if (set.tokens.has(t.path)) throw new Error(`duplicate token ${t.path} in ${set.file}`);
      const shipped = t.node.$value;
      const prov: Provenance = { product: source.product, implementation: source.implementation, package: pkg, version: pkgs[pkg].version, file, nativeName: nativeName(t.path), ...(theme ? { theme } : {}), rawValue: typeof shipped === 'string' ? shipped : JSON.stringify(shipped) };
      let value = shipped;
      if (hasRef(shipped)) {
        value = resolveRefs(shipped, docs);
        counts.derived++;
        notes.push(`${t.path}${theme ? ` (${theme})` : ''}: partial $ref resolved to a literal`);
      }
      const foreign = (t.node.$extensions as Json | undefined) ?? {};
      const token: Token & Json = { $value: value, $extensions: { ...foreign, [EXT]: prov } as Token['$extensions'] };
      const alias = typeof value === 'string' && isAlias(value);
      if (!alias && t.type) token.$type = t.type;
      if (alias && t.node.$type) token.$type = t.node.$type as string;
      if (!alias && !t.type) (prov as Provenance).untyped = true;
      for (const k of ['$description', '$deprecated'] as const) if (k in t.node) token[k] = t.node[k];
      set.tokens.set(t.path, token);
      counts.tokens++;
      if (alias) counts.aliases++;
      else counts.literals++;
    }
  };

  baseEntries.forEach((e, i) => {
    const pkg = pkgOf(e);
    const short = pkg.split('/').at(-1)!;
    const name = path.basename(e.path, '.tokens.json');
    const set: OutputSet = { file: `${short}${name === short ? '' : '.' + name}.tokens.json`, tokens: new Map() };
    convert(baseDocs[i], set, pkg, e.path, undefined, [baseDocs[i], ...baseDocs], named(e));
    sets.push(set);
  });

  for (const e of source.entries.filter((e) => e.format === 'dtcg-resolver')) {
    const pkg = pkgOf(e);
    const resolver = read(pkg, e.path);
    const modifiers = Object.entries((resolver.modifiers ?? {}) as Record<string, { contexts: Record<string, { $ref: string }[]> }>);
    if (modifiers.length !== 1) throw new Error(`${e.path}: expected exactly one modifier, found ${modifiers.length}`);
    const [modifier, { contexts }] = modifiers[0];
    notes.push(`${e.path}: modifier "${modifier}" -> themes ${Object.keys(contexts).join(', ')}; resolver sets are supplied by the source's dtcg entries`);
    for (const [ctx, refs] of Object.entries(contexts)) {
      const set: OutputSet = { file: `${modifier}.${ctx}.tokens.json`, theme: ctx, tokens: new Map() };
      for (const r of refs) {
        const rel = path.join(path.dirname(e.path), r.$ref);
        const doc = read(pkg, rel);
        convert(doc, set, pkg, rel, ctx, [doc, ...baseDocs], named(e));
      }
      sets.push(set);
    }
  }
  for (const e of source.entries.filter((e) => e.format === 'sass-module')) {
    const pkg = pkgOf(e);
    const short = pkg.split('/').at(-1)!;
    const file = `${short}${e.group === short ? "" : "." + e.group}.tokens.json`;
    let set = sets.find((x) => x.file === file);
    if (!set) sets.push((set = { file, tokens: new Map() }));
    const vars = sassModuleVariables(pkgs, pkg, e.path).filter((v) => (!e.variables || e.variables.includes(v.name)) && !e.exclude?.includes(v.name));
    if (e.variables) for (const name of e.variables) if (!vars.some((v) => v.name === name)) throw new Error(`${e.path}: no public variable $${name}`);
    let skipped = 0;
    const put = (keys: string[], v: SassValue, meta: { description?: string; deprecated?: boolean }, varName: string) => {
      if (Array.isArray(v) || typeof v === 'object') {
        for (const [k, x] of Array.isArray(v) ? v.map((x, i) => [String(i + 1), x] as const) : Object.entries(v)) {
          if (e.skipKeys?.includes(k)) { skipped++; continue; }
          put([...keys, k], x, meta, varName);
        }
        return;
      }
      const p = [e.group!, ...(e.flatten ? [] : [varName]), ...keys].join('.');
      if (set!.tokens.has(p)) throw new Error(`duplicate token ${p} in ${file}`);
      const lit = inferLiteral(v, [varName, ...keys].join('-'));
      const prov: Provenance = { product: source.product, implementation: source.implementation, package: pkg, version: pkgs[pkg].version, file: e.path, nativeName: `$${varName}${keys.map((k) => '.' + k).join('')}`, rawValue: v };
      if (!lit.$type) prov.untyped = true;
      const token: Token & Record<string, unknown> = { $value: lit.$value, ...(lit.$type ? { $type: lit.$type } : {}), $extensions: { [EXT]: prov } };
      if (meta.description) token.$description = meta.description;
      if (meta.deprecated) token.$deprecated = true;
      set!.tokens.set(p, token);
      counts.tokens++;
      counts.literals++;
    };
    for (const v of vars) put([], v.value, v, v.name);
    notes.push(`${e.path}: ${vars.length} Sass variables evaluated${e.exclude ? ` (${e.exclude.map((x) => '$' + x).join(', ')} excluded: an index of the others)` : ''} to literals (references inside Sass maps are not proven, so no aliases)${skipped ? `; ${skipped} ${e.skipKeys!.join('/')} entries skipped` : ''}`);
  }
  const groupsEntry = source.entries.find((e) => e.format === 'ts-token-groups');
  const structure = groupsEntry ? carbonTokenGroups(path.join(pkgs[pkgOf(groupsEntry)].dir, groupsEntry.path), groupsEntry.path) : undefined;
  return { sets, structure, report: { notes, counts } };
};
