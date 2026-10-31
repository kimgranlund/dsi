import fs from 'node:fs';
import path from 'node:path';
import type { Ajv2020 } from 'ajv/dist/2020.js';
import type { Issue } from './ontology.ts';

const EXT = 'io.nonoun.dsi';
const ALIAS = /^\{([^{}]+)\}$/;

type Tok = { $value: unknown; $type?: string; $extensions?: Record<string, unknown> };
type Leaf = { path: string; token: Tok };

function leaves(tree: Record<string, unknown>, prefix = ''): Leaf[] {
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object' && '$value' in v) out.push({ path: prefix + k, token: v as Tok });
    else if (v && typeof v === 'object') out.push(...leaves(v as Record<string, unknown>, prefix + k + '.'));
  }
  return out;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Minimal DTCG 2025.10 value-shape checks for the types the adapters emit. */
function valueIssue(t: Tok): string | undefined {
  const v = t.$value as Record<string, unknown>;
  switch (t.$type) {
    case 'color':
      return v?.colorSpace === 'srgb' && Array.isArray(v.components) && v.components.length === 3 && v.components.every((c) => isNum(c) && c >= 0 && c <= 1) && (v.alpha === undefined || (isNum(v.alpha) && v.alpha >= 0 && v.alpha <= 1)) ? undefined : 'color must be { colorSpace: "srgb", components: [r,g,b] in 0..1, alpha? }';
    case 'dimension':
      return isNum(v?.value) && (v.unit === 'px' || v.unit === 'rem') ? undefined : 'dimension must be { value: number, unit: "px" | "rem" }';
    case 'duration':
      return isNum(v?.value) && (v.unit === 'ms' || v.unit === 's') ? undefined : 'duration must be { value: number, unit: "ms" | "s" }';
    case 'cubicBezier': {
      const a = t.$value as unknown[];
      return Array.isArray(a) && a.length === 4 && a.every(isNum) && (a[0] as number) >= 0 && (a[0] as number) <= 1 && (a[2] as number) >= 0 && (a[2] as number) <= 1 ? undefined : 'cubicBezier must be [x1, y1, x2, y2] with x in 0..1';
    }
    case 'number':
      return isNum(t.$value) ? undefined : 'number must be a number';
    case 'fontWeight':
      return (isNum(t.$value) && t.$value >= 1 && t.$value <= 1000) || typeof t.$value === 'string' ? undefined : 'fontWeight must be 1..1000 or a keyword';
    case 'fontFamily':
      return typeof t.$value === 'string' || (Array.isArray(t.$value) && t.$value.every((f) => typeof f === 'string')) ? undefined : 'fontFamily must be a string or string[]';
    case undefined:
      return undefined;
    default:
      return `type ${t.$type} is not checked yet; add a rule before emitting it`;
  }
}

/**
 * Validate data/native/<product>/<version>/: provenance on every token, DTCG value shapes, aliases resolve
 * (themed files resolve against the mode-independent files plus that theme), no alias cycles, manifest matches.
 */
export function validateNative(root: string, ajv: Ajv2020, issues: Issue[]) {
  const nativeRoot = path.join(root, 'data', 'native');
  if (!fs.existsSync(nativeRoot)) return;
  const ext = ajv.getSchema('https://dsi.nonoun.io/schema/dtcg-extension.schema.json')!;
  for (const product of fs.readdirSync(nativeRoot)) {
    for (const version of fs.readdirSync(path.join(nativeRoot, product))) {
      const dir = path.join(nativeRoot, product, version);
      const at = (f: string) => path.relative(root, path.join(dir, f));
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) { issues.push({ file: at(''), message: 'missing manifest.json' }); continue; }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { product: string; package: { version: string }; files: { file: string; theme?: string; tokens: number }[] };
      if (manifest.product !== product || manifest.package.version !== version) issues.push({ file: at('manifest.json'), message: `manifest says ${manifest.product}@${manifest.package.version}, folder is ${product}/${version}` });
      const listed = new Set(manifest.files.map((f) => f.file));
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.tokens.json'))) if (!listed.has(f)) issues.push({ file: at(f), message: 'token file not listed in manifest.json' });

      const base = new Map<string, Tok>();
      const themed = new Map<string, Map<string, Tok>>();
      const fileOf = new Map<Tok, string>();
      for (const entry of manifest.files) {
        const p = path.join(dir, entry.file);
        if (!fs.existsSync(p)) { issues.push({ file: at(entry.file), message: 'listed in manifest.json but missing' }); continue; }
        const ls = leaves(JSON.parse(fs.readFileSync(p, 'utf8')));
        if (ls.length !== entry.tokens) issues.push({ file: at(entry.file), message: `manifest says ${entry.tokens} tokens, file has ${ls.length}` });
        const target = entry.theme ? (themed.get(entry.theme) ?? themed.set(entry.theme, new Map()).get(entry.theme)!) : base;
        for (const { path: tp, token } of ls) {
          if (target.has(tp)) issues.push({ file: at(entry.file), message: `${tp}: duplicate token path` });
          target.set(tp, token);
          fileOf.set(token, entry.file);
          const prov = token.$extensions?.[EXT] as Record<string, unknown> | undefined;
          if (!ext(prov)) issues.push({ file: at(entry.file), message: `${tp}: $extensions["${EXT}"] ${ext.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}` });
          else {
            if (prov!.product !== product || prov!.version !== version) issues.push({ file: at(entry.file), message: `${tp}: provenance says ${prov!.product}@${prov!.version}` });
            if ((prov!.theme ?? undefined) !== entry.theme) issues.push({ file: at(entry.file), message: `${tp}: provenance theme ${prov!.theme} differs from file theme ${entry.theme}` });
          }
          const isAlias = typeof token.$value === 'string' && ALIAS.test(token.$value);
          if (!isAlias && !token.$type && !prov?.untyped) issues.push({ file: at(entry.file), message: `${tp}: literal without $type must be marked untyped` });
          const vi = isAlias ? undefined : valueIssue(token);
          if (vi) issues.push({ file: at(entry.file), message: `${tp}: ${vi}` });
        }
      }
      const contexts = themed.size ? [...themed].map(([name, m]) => ({ name, all: new Map([...base, ...m]) })) : [{ name: '', all: base }];
      for (const { name, all } of contexts) {
        for (const [tp, token] of all) {
          const seen = new Set([tp]);
          let cur = token;
          while (typeof cur.$value === 'string' && ALIAS.test(cur.$value)) {
            const ref = cur.$value.slice(1, -1);
            const next = all.get(ref);
            if (!next) { issues.push({ file: at(fileOf.get(token)!), message: `${tp}: alias ${cur.$value} does not resolve${name ? ` in theme ${name}` : ''}` }); break; }
            if (seen.has(ref)) { issues.push({ file: at(fileOf.get(token)!), message: `${tp}: alias cycle through ${ref}` }); break; }
            seen.add(ref);
            cur = next;
          }
        }
      }
    }
  }
}
