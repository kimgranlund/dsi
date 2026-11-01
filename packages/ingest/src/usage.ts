import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * Token-usage graph: every place a system's own component CSS uses one of its tokens. Shipped CSS is read as data
 * (postcss parse, never executed). Component-level custom properties are followed to the token they end at
 * (`--spectrum-button-background-color-default: var(--spectrum-accent-background-color-default)`).
 */
export interface Use { token: string; component: string; selector: string; property: string; state?: string; background?: string; file: string }

const VAR = /var\(\s*(--[\w-]+)/g;
const STATE: [RegExp, string][] = [
  [/:hover|\.is-hover(ed)?\b|\[data-hover/i, 'hover'],
  [/:active|\.is-active\b|\.is-down\b|\[data-pressed|:checked:active/i, 'active'],
  [/:focus-visible|:focus\b|\.focus-ring\b|\.is-focused\b|\.is-keyboardFocused\b/i, 'focus'],
  [/:disabled|\.is-disabled\b|\[disabled\]|\[aria-disabled/i, 'disabled'],
  [/\.is-selected\b|\[aria-selected="?true|:checked|\[aria-current|\.selected\b|\[aria-pressed="?true/i, 'selected'],
  [/:visited/i, 'visited'],
];

export function readUses(files: { file: string; component: string }[], tokenOf: (cssVar: string) => string | undefined): Use[] {
  // Pass 1: custom property definitions anywhere in the package (union over selectors; first token reached wins).
  const defs = new Map<string, Set<string>>();
  const roots: { root: postcss.Root; file: string; component: string }[] = [];
  for (const f of files) {
    let root: postcss.Root;
    try { root = postcss.parse(fs.readFileSync(f.file, 'utf8')); } catch { continue; }
    roots.push({ root, ...f });
    root.walkDecls((d) => { if (!d.prop.startsWith('--')) return; for (const m of d.value.matchAll(VAR)) (defs.get(d.prop) ?? defs.set(d.prop, new Set()).get(d.prop)!).add(m[1]); });
  }
  const resolve = (v: string, seen = new Set<string>()): string[] => {
    const t = tokenOf(v);
    if (t) return [t];
    if (seen.has(v)) return [];
    seen.add(v);
    return [...(defs.get(v) ?? [])].flatMap((x) => resolve(x, seen));
  };
  // Pass 2: real property uses, with the background used in the same rule.
  const uses: Use[] = [];
  for (const { root, file, component } of roots) {
    root.walkRules((r) => {
      const decls = r.nodes.filter((n): n is postcss.Declaration => n.type === 'decl' && !n.prop.startsWith('--'));
      const tokensIn = (d: postcss.Declaration) => [...new Set([...d.value.matchAll(VAR)].flatMap((m) => resolve(m[1])))];
      const bg = decls.filter((d) => /^background(-color)?$/.test(d.prop)).flatMap(tokensIn)[0];
      const state = STATE.find(([re]) => re.test(r.selector))?.[1];
      for (const d of decls) for (const token of tokensIn(d)) uses.push({ token, component, selector: r.selector.slice(0, 200), property: d.prop, ...(state ? { state } : {}), ...(bg && bg !== token && !/^background/.test(d.prop) ? { background: bg } : {}), file: path.basename(file) });
    });
  }
  return uses;
}
