import type { Adapter, OutputSet } from '../adapter.ts';
import { EXT, inferLiteral, type Provenance, type Token } from '../dtcg.ts';
import { Ref, StaticModules } from '../static-eval.ts';

/**
 * @fluentui/tokens ships no token data file: its themes are built in JS (createLightTheme(brandWeb) spreads global
 * scales and generated alias maps). We evaluate the shipped ESM modules with a small syntax-tree interpreter
 * (src/static-eval.ts): no package code runs. A theme token is an alias when its value was read from a palette
 * module export (global/colors.js grey[14], global/brandColors.js brandWeb[80]); the palette is emitted as internal
 * tokens under those paths. Tokens equal in every theme go to the base file.
 *
 * Source entries:
 *   { format: "fluent-palette", path }          a palette module: every export becomes internal tokens
 *   { format: "fluent-themes", path }           the module exporting the themes (lib/themes/index.js)
 *   source.themeExports: { <theme name>: <export name> }
 */

const typed = (key: string, v: string | number): { $type?: string; $value: unknown } => {
  if (/^fontWeight/.test(key) && typeof v === 'number') return { $type: 'fontWeight', $value: v };
  if (/^fontFamily/.test(key) && typeof v === 'string') return { $type: 'fontFamily', $value: v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) };
  if (/^(spacing|strokeWidth|borderRadius|fontSize|lineHeight)/.test(key) && (v === '0' || v === 0)) return { $type: 'dimension', $value: { value: 0, unit: 'px' } };
  if (typeof v === 'number') return { $type: 'number', $value: v };
  return inferLiteral(v, key);
};

export const fluent: Adapter = (pkgs, source) => {
  const dir = pkgs[source.package.name].dir;
  const paletteFiles = source.entries.filter((e) => e.format === 'fluent-palette').map((e) => e.path);
  const m = new StaticModules(dir, (rel) => paletteFiles.includes(rel));
  const notes: string[] = [];
  const counts: Record<string, number> = { tokens: 0, aliases: 0, literals: 0, untyped: 0, palette: 0 };
  const sets = new Map<string, OutputSet>();
  const setFor = (file: string, theme?: string) => sets.get(file) ?? sets.set(file, { file, theme, tokens: new Map() }).get(file)!;
  const prov = (file: string, nativeName: string, raw: unknown, theme?: string, internal = false): Provenance => ({ product: source.product, implementation: source.implementation, package: source.package.name, version: source.package.version, file, nativeName, ...(theme ? { theme } : {}), rawValue: String(raw), ...(internal ? { visibility: 'internal' as const } : {}) });
  const put = (set: OutputSet, p: string, t: Token) => { if (set.tokens.has(p)) throw new Error(`duplicate token ${p}`); set.tokens.set(p, t); counts.tokens++; };

  // Palette: every string or number reachable from a palette module export, by its path.
  const palette = new Map<string, string>();
  for (const rel of paletteFiles) {
    const walk = (v: unknown, p: string) => {
      if (v instanceof Ref) { if (!palette.has(p)) { palette.set(p, String(v.value)); put(setFor('palette.tokens.json'), p, { ...typed(p, v.value), $extensions: { [EXT]: prov(rel, p, v.value, undefined, true) } } as Token); counts.palette++; } return; }
      if (typeof v === 'string' || typeof v === 'number') { if (!palette.has(p)) { palette.set(p, String(v)); put(setFor('palette.tokens.json'), p, { ...typed(p, v), $extensions: { [EXT]: prov(rel, p, v, undefined, true) } } as Token); counts.palette++; } return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    };
    for (const [k, v] of Object.entries(m.load(rel))) walk(v, k);
  }

  const themesEntry = source.entries.find((e) => e.format === 'fluent-themes')!;
  const exportsOf = m.load(themesEntry.path);
  const themeExports = (source as unknown as { themeExports: Record<string, string> }).themeExports;
  const themes = Object.entries(themeExports).map(([name, exp]) => {
    const t = exportsOf[exp] as Record<string, unknown> | undefined;
    if (!t) throw new Error(`${themesEntry.path} has no export ${exp}`);
    return { name, exp, t };
  });
  const keys = [...new Set(themes.flatMap((x) => Object.keys(x.t)))].sort();
  const sig = (v: unknown) => (v instanceof Ref ? `ref:${v.ref}` : `lit:${JSON.stringify(v)}`);
  for (const key of keys) {
    const vals = themes.map((x) => x.t[key]);
    const same = vals.every((v) => v !== undefined && sig(v) === sig(vals[0]));
    const emit = (set: OutputSet, theme: string | undefined, v: unknown) => {
      const pv = prov(themesEntry.path, `--${key}`, v instanceof Ref ? v.value : v, theme);
      if (v instanceof Ref && palette.get(v.ref) === String(v.value)) { put(set, key, { $value: `{${v.ref}}`, $extensions: { [EXT]: pv } } as Token); counts.aliases++; return; }
      const t = typed(key, (v instanceof Ref ? v.value : v) as string | number);
      if (!t.$type) { pv.untyped = true; counts.untyped++; }
      put(set, key, { ...t, $extensions: { [EXT]: pv } } as Token);
      counts.literals++;
    };
    if (same) emit(setFor('global.tokens.json'), undefined, vals[0]);
    else themes.forEach((x, i) => { if (vals[i] !== undefined) emit(setFor(`theme.${x.name}.tokens.json`, x.name), x.name, vals[i]); });
  }
  notes.push(`Themes evaluated statically from ${themesEntry.path}: ${themes.map((x) => `${x.name} = ${x.exp}`).join(', ')}. Shadows are CSS shorthands, stored untyped.`);
  return { sets: [...sets.values()], report: { notes, counts } };
};
