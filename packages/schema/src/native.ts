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
const isRef = (v: unknown) => typeof v === 'string' && ALIAS.test(v);

/** Every {alias} string anywhere inside a value, including composite sub-values. */
function refsIn(v: unknown): string[] {
  if (isRef(v)) return [(v as string).slice(1, -1)];
  if (Array.isArray(v)) return v.flatMap(refsIn);
  if (v && typeof v === 'object') return Object.values(v).flatMap(refsIn);
  return [];
}

/** A sub-value of a composite is valid if it is an alias or a valid value of the given type. */
const sub = (type: string, v: unknown) => isRef(v) || valueIssue({ $type: type, $value: v }) === undefined;

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
    case 'transition':
      return v && sub('duration', v.duration) && sub('duration', v.delay) && sub('cubicBezier', v.timingFunction) ? undefined : 'transition must be { duration, delay, timingFunction }';
    case 'shadow': {
      const layers = Array.isArray(t.$value) ? t.$value : [t.$value];
      return layers.every((l: any) => l && sub('color', l.color) && ['offsetX', 'offsetY', 'blur', 'spread'].every((k) => sub('dimension', l[k])) && (l.inset === undefined || typeof l.inset === 'boolean')) ? undefined : 'shadow must be { color, offsetX, offsetY, blur, spread, inset? } or an array of them';
    }
    case 'gradient':
      return Array.isArray(t.$value) && t.$value.every((st: any) => st && sub('color', st.color) && (isRef(st.position) || (isNum(st.position) && st.position >= 0 && st.position <= 1))) ? undefined : 'gradient must be [{ color, position 0..1 }]';
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
  const dirs = (p: string) => fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const product of dirs(nativeRoot)) {
    for (const version of dirs(path.join(nativeRoot, product))) {
      const dir = path.join(nativeRoot, product, version);
      const at = (f: string) => path.relative(root, path.join(dir, f));
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) { issues.push({ file: at(''), message: 'missing manifest.json' }); continue; }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { product: string; package: { name: string; version: string }; dependencies?: { name: string; version: string }[]; themes?: string[]; defaultTheme?: string; files: { file: string; theme?: string; tokens: number }[] };
      const packages = new Map([manifest.package, ...(manifest.dependencies ?? [])].map((p) => [p.name, p.version]));
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
            if (prov!.product !== product) issues.push({ file: at(entry.file), message: `${tp}: provenance says product ${prov!.product}` });
            if (packages.get(prov!.package as string) !== prov!.version) issues.push({ file: at(entry.file), message: `${tp}: provenance package ${prov!.package}@${prov!.version} is not the manifest's package or a dependency` });
            if ((prov!.theme ?? undefined) !== entry.theme) issues.push({ file: at(entry.file), message: `${tp}: provenance theme ${prov!.theme} differs from file theme ${entry.theme}` });
          }
          const isAlias = isRef(token.$value);
          if (!isAlias && !token.$type && !prov?.untyped) issues.push({ file: at(entry.file), message: `${tp}: literal without $type must be marked untyped` });
          const vi = isAlias ? undefined : valueIssue(token);
          if (vi) issues.push({ file: at(entry.file), message: `${tp}: ${vi}` });
        }
      }
      // Each declared theme resolves against the mode-independent files plus its own file (the default theme may have none).
      for (const t of themed.keys()) if (manifest.themes && !manifest.themes.includes(t)) issues.push({ file: at('manifest.json'), message: `theme file for "${t}", which is not in themes` });
      for (const t of manifest.themes ?? []) if (!themed.has(t) && t !== manifest.defaultTheme) issues.push({ file: at('manifest.json'), message: `theme "${t}" has no file and is not the defaultTheme` });
      const names = manifest.themes ?? [...themed.keys()];
      const contexts = names.length ? names.map((name) => ({ name, all: new Map([...base, ...(themed.get(name) ?? [])]) })) : [{ name: '', all: base }];
      for (const { name, all } of contexts) {
        for (const [tp, token] of all) {
          // Every reference inside the value must resolve; whole-value aliases are followed to detect cycles.
          for (const ref of refsIn(token.$value)) {
            if (ref === tp) { issues.push({ file: at(fileOf.get(token)!), message: `${tp}: alias cycle through ${ref}` }); continue; }
            if (!all.has(ref)) issues.push({ file: at(fileOf.get(token)!), message: `${tp}: alias {${ref}} does not resolve${name ? ` in theme ${name}` : ''}` });
          }
          const seen = new Set([tp]);
          let cur = token;
          while (isRef(cur.$value)) {
            const ref = (cur.$value as string).slice(1, -1);
            const next = all.get(ref);
            if (!next) break;
            if (seen.has(ref)) { issues.push({ file: at(fileOf.get(token)!), message: `${tp}: alias cycle through ${ref}` }); break; }
            seen.add(ref);
            cur = next;
          }
        }
      }
    }
  }
}
