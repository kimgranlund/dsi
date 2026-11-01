import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, type Provenance, type Token } from '../dtcg.ts';

/**
 * @shopify/polaris-tokens ships its public API as CSS custom properties (dist/css/styles.css): `:root,.p-theme-light`
 * holds every token for the default theme; each `.p-theme-<name>` block overrides some of them. Values there are
 * literals or `var(--p-<token>)`, which is an alias we read directly.
 *
 * Aliases to the internal palette (`gray[6]`) and size scale (`size[400]`) are only visible in the token modules
 * (dist/esm/src). We PARSE those modules with the TypeScript parser, never execute them, and accept a palette alias
 * only when the palette literal equals the CSS value for that theme.
 */

type Claim = { kind: 'scale'; target: string } | { kind: 'var'; target: string } | { kind: 'other' };
interface ModuleTokens { claims: Map<string, Claim>; descriptions: Map<string, string> }

const parse = (file: string) => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const keyOf = (n: ts.PropertyName) => (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : undefined);
const literal = (e: ts.Expression) => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) ? e.text : undefined);

/** `var gray = { 1: 'rgba(...)', ... }` -> scale -> key -> literal. */
function scales(file: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const st of parse(file).statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isObjectLiteralExpression(d.initializer)) continue;
      const m = new Map<string, string>();
      for (const p of d.initializer.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const k = keyOf(p.name), v = literal(p.initializer);
        if (k !== undefined && v !== undefined) m.set(k, v);
      }
      if (m.size) out.set(d.name.text, m);
    }
  }
  return out;
}

function claimOf(e: ts.Expression, scaleOf: Map<string, string>): Claim {
  if (ts.isElementAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const scale = scaleOf.get(e.expression.text), k = literal(e.argumentExpression);
    if (scale && k !== undefined) return { kind: 'scale', target: scale === 'size' ? `size.${k}` : `colors.${e.expression.text}.${k}` };
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'createVar' && e.arguments.length === 1) {
    const k = literal(e.arguments[0]);
    if (k !== undefined) return { kind: 'var', target: k };
  }
  return { kind: 'other' };
}

/** Collect `'token': { value: EXPR, description: '...' }` entries anywhere in a token module. */
function tokensIn(file: string, scaleOf: Map<string, string>): ModuleTokens {
  const claims = new Map<string, Claim>(), descriptions = new Map<string, string>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer)) {
      const name = keyOf(n.name);
      const props = new Map(n.initializer.properties.filter(ts.isPropertyAssignment).map((p) => [keyOf(p.name), p.initializer] as const));
      const value = props.get('value');
      if (name && value) {
        claims.set(name, claimOf(value, scaleOf));
        const d = props.get('description');
        const dt = d && literal(d);
        if (dt) descriptions.set(name, dt);
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file));
  return { claims, descriptions };
}

/** Parse styles.css into theme -> token -> value. `:root,.p-theme-light` is the default theme. */
function cssThemes(css: string): { defaultTheme: string; themes: Map<string, Map<string, string>> } {
  const themes = new Map<string, Map<string, string>>();
  let defaultTheme = '';
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    const named = selectors.map((s) => s.match(/^\.p-theme-([a-z0-9-]+)$/)?.[1]).find(Boolean);
    if (!named) continue;
    if (selectors.includes(':root')) defaultTheme = named;
    const decls = new Map<string, string>();
    for (const d of m[2].matchAll(/--p-([a-z0-9-]+):([^;]*)/g)) decls.set(d[1], d[2].trim());
    themes.set(named, decls);
  }
  if (!defaultTheme) throw new Error('no :root theme block in styles.css');
  return { defaultTheme, themes };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();

export const polaris: Adapter = (pkgs, source) => {
  const pkg = pkgs[source.package.name];
  const esm = path.join(pkg.dir, 'dist/esm/src');
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, internal: 0, aliasRejected: 0 };
  const base = (file: string, nativeName: string, rawValue: string, theme?: string, extra: Partial<Provenance> = {}): Provenance => ({ product: source.product, implementation: source.implementation, package: source.package.name, version: pkg.version, file, nativeName, ...(theme ? { theme } : {}), rawValue, ...extra });

  // Internal scales.
  const colorScales = scales(path.join(esm, 'colors.mjs'));
  const sizeScale = scales(path.join(esm, 'size.mjs')).get('size') ?? new Map();
  const scaleOf = new Map<string, string>([...[...colorScales.keys()].map((k) => [k, 'colors'] as [string, string]), ['size', 'size']]);
  const scaleSet: OutputSet = { file: 'scales.tokens.json', tokens: new Map() };
  // The package build converts px to rem (16px root) before writing CSS, so the size scale is stored as shipped: rem.
  const pxToRem = (v: string) => { const m = v.match(/^(-?\d*\.?\d+)px$/); return m ? `${+m[1] / 16}rem` : v; };
  const scaleValue = (target: string) => {
    const [s, a, b] = target.split('.');
    return s === 'size' ? (sizeScale.get(a) && pxToRem(sizeScale.get(a)!)) : colorScales.get(a)?.get(b);
  };
  const addScale = (p: string, raw: string, file: string, native: string) => {
    const t = inferLiteral(p.startsWith('size.') ? pxToRem(raw) : raw, p.startsWith('size.') ? 'size' : 'color');
    const prov = base(file, native, raw, undefined, { visibility: 'internal', ...(t.$type ? {} : { untyped: true as const }) });
    scaleSet.tokens.set(p, { ...t, $extensions: { [EXT]: prov } });
    counts.tokens++; counts.literals++; counts.internal++;
  };
  for (const [scale, m] of colorScales) for (const [k, v] of m) addScale(`colors.${scale}.${k}`, v, 'dist/esm/src/colors.mjs', `colors.${scale}[${k}]`);
  for (const [k, v] of sizeScale) addScale(`size.${k}`, v, 'dist/esm/src/size.mjs', `size[${k}]`);

  // Claims from token modules: base for the default theme, one partial per other theme.
  const baseDir = path.join(esm, 'themes/base');
  const baseTokens: ModuleTokens = { claims: new Map(), descriptions: new Map() };
  // Shipped order: each base module is one group, its tokens in authored order (the base, then states, then variants).
  const structure = { kind: 'shipped-order' as const, file: 'dist/esm/src/themes/base', groups: [] as { label: string; tokens: string[]; groups: [] }[] };
  for (const f of fs.readdirSync(baseDir).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs').sort()) {
    const t = tokensIn(path.join(baseDir, f), scaleOf);
    structure.groups.push({ label: f.replace(/\.mjs$/, ''), tokens: [...t.claims.keys()], groups: [] });
    t.claims.forEach((v, k) => baseTokens.claims.set(k, v));
    t.descriptions.forEach((v, k) => baseTokens.descriptions.set(k, v));
  }
  // Theme modules drop the -experimental suffix of the theme name (dark-experimental -> themes/dark.mjs).
  const themeClaims = (theme: string) => {
    const f = [theme, theme.replace(/-experimental$/, '')].map((n) => path.join(esm, 'themes', `${n}.mjs`)).find((p) => fs.existsSync(p));
    if (!f) { notes.push(`theme ${theme}: no token module found; palette aliases cannot be recovered, values stored as literals`); return new Map<string, Claim>(); }
    return tokensIn(f, scaleOf).claims;
  };

  const { defaultTheme, themes } = cssThemes(fs.readFileSync(path.join(pkg.dir, 'dist/css/styles.css'), 'utf8'));
  notes.push('size scale converted from px to rem (16px root) as the package build does; rawValue keeps the px literal');
  notes.push(`default theme "${defaultTheme}" is the base file; other themes are override files`);
  const sets: OutputSet[] = [scaleSet];
  for (const [theme, decls] of themes) {
    const isDefault = theme === defaultTheme;
    const set: OutputSet = isDefault ? { file: 'polaris.tokens.json', tokens: new Map() } : { file: `theme.${theme}.tokens.json`, theme, tokens: new Map() };
    const claims = isDefault ? baseTokens.claims : themeClaims(theme);
    for (const [name, raw] of decls) {
      const prov = base('dist/css/styles.css', `--p-${name}`, raw, isDefault ? undefined : theme);
      const desc = baseTokens.descriptions.get(name);
      let token: Token & { $description?: string };
      const v = raw.match(/^var\(--p-([a-z0-9-]+)\)$/);
      const claim = claims.get(name);
      if (v) {
        token = { $value: `{${v[1]}}`, $extensions: { [EXT]: prov } };
        counts.aliases++;
      } else if (claim?.kind === 'scale' && norm(scaleValue(claim.target) ?? '') === norm(raw)) {
        token = { $value: `{${claim.target}}`, $extensions: { [EXT]: prov } };
        counts.aliases++;
      } else {
        if (claim?.kind === 'scale') { counts.aliasRejected++; notes.push(`${name}${isDefault ? '' : ` (${theme})`}: module says ${claim.target} = ${scaleValue(claim.target)} but CSS ships ${raw}; stored as literal`); }
        const t = inferLiteral(raw, name);
        token = { ...t, $extensions: { [EXT]: t.$type ? prov : { ...prov, untyped: true } } };
        counts.literals++;
        if (!t.$type) counts.untyped++;
      }
      if (desc) token.$description = desc;
      set.tokens.set(name, token);
      counts.tokens++;
    }
    sets.push(set);
  }
  return { sets, defaultTheme, structure, report: { notes, counts } };
};
