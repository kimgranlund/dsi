import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as sass from 'sass';
import type { Packages } from './adapter.ts';

/**
 * Read the public variables of a shipped Sass module by evaluating it (never running package JS). Packages are
 * linked into a temporary node_modules so the module's own `@use '@carbon/...'` lines resolve to the pinned versions.
 * Maps and lists become nested objects and arrays of printed literals; `///` doc comments give descriptions and
 * `@deprecated`.
 */
export interface SassVariable { name: string; value: SassValue; description?: string; deprecated?: boolean }
export type SassValue = string | SassValue[] | { [k: string]: SassValue };

function convert(v: sass.Value): SassValue {
  if (v instanceof sass.SassMap) return Object.fromEntries([...v.contents.entries()].map(([k, x]) => [String(convert(k)), convert(x)]));
  if (v instanceof sass.SassNumber) return `${+v.value.toFixed(5)}${v.numeratorUnits.toArray().join('')}`;
  if (v instanceof sass.SassString) return v.text;
  const list = v.asList;
  if (list.size > 1) return list.toArray().map(convert);
  return String(v);
}

function docs(file: string): Map<string, { description?: string; deprecated?: boolean }> {
  const out = new Map<string, { description?: string; deprecated?: boolean }>();
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  lines.forEach((line, i) => {
    const m = line.match(/^\$([a-z0-9-]+)\s*:/i);
    if (!m) return;
    const block: string[] = [];
    for (let j = i - 1; j >= 0 && lines[j].startsWith('///'); j--) block.unshift(lines[j].replace(/^\/\/\/\s?/, ''));
    const text = block.filter((l) => !l.startsWith('@')).join(' ').trim();
    out.set(m[1], { ...(text ? { description: text } : {}), ...(block.some((l) => l.startsWith('@deprecated')) ? { deprecated: true } : {}) });
  });
  return out;
}

export function sassModuleVariables(pkgs: Packages, pkg: string, modulePath: string): SassVariable[] {
  const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-sass-'));
  try {
    for (const [name, { dir }] of Object.entries(pkgs)) {
      fs.mkdirSync(path.join(nm, path.dirname(name)), { recursive: true });
      fs.symlinkSync(path.resolve(dir), path.join(nm, name), 'dir');
    }
    const url = `${pkg}/${modulePath.replace(/(^|\/)_([^/]+)\.scss$/, '$1$2').replace(/\.scss$/, '')}`;
    let vars: Record<string, SassValue> = {};
    sass.compileString(`@use 'sass:meta'; @use '${url}' as m; $_: dsi-emit(meta.module-variables('m'));`, {
      loadPaths: [nm], logger: sass.Logger.silent,
      functions: { 'dsi-emit($v)': ([v]) => { vars = convert(v) as Record<string, SassValue>; return sass.sassNull; } },
    });
    const meta = docs(path.join(pkgs[pkg].dir, modulePath));
    return Object.entries(vars).map(([name, value]) => ({ name, value, ...meta.get(name) }));
  } finally {
    fs.rmSync(nm, { recursive: true, force: true });
  }
}
