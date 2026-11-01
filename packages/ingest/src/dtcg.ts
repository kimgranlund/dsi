/** Helpers for turning shipped literal values into DTCG 2025.10 tokens. */

export const EXT = 'io.nonoun.dsi';

export interface Provenance {
  product: string;
  implementation?: string;
  package: string;
  version: string;
  file: string;
  nativeName: string;
  theme?: string;
  rawValue: string;
  untyped?: true;
  visibility?: 'internal';
}

export interface Token {
  $value: unknown;
  $type?: string;
  $extensions: { [EXT]: Provenance };
}

export interface Typed { $type?: string; $value: unknown }

const ALIAS = /^\{[a-z0-9]+([.-][a-z0-9]+)*\}$/;
export const isAlias = (s: string) => ALIAS.test(s);

const NAMED: Record<string, [number, number, number, number]> = { black: [0, 0, 0, 1], white: [255, 255, 255, 1], transparent: [0, 0, 0, 0] };
const round = (n: number) => Math.round(n * 10000) / 10000;
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

function color(r: number, g: number, b: number, a: number): Typed {
  const v: Record<string, unknown> = { colorSpace: 'srgb', components: [round(r / 255), round(g / 255), round(b / 255)], hex: `#${hex2(r)}${hex2(g)}${hex2(b)}` };
  if (a !== 1) v.alpha = round(a);
  return { $type: 'color', $value: v };
}

/**
 * Infer a DTCG type and value from a literal as Sass prints it (meta.inspect).
 * `name` is the token's own key, used only to tell fontWeight and fontFamily from plain numbers and strings.
 * Returns no $type when the literal does not fit a DTCG type; the caller marks it untyped.
 */
export function inferLiteral(raw: string, name: string): Typed {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i))) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return color(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1);
  }
  if ((m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/))) return color(+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]);
  if (s in NAMED) return color(...NAMED[s]);
  if ((m = s.match(/^(-?\d*\.?\d+)(px|rem)$/))) return { $type: 'dimension', $value: { value: +m[1], unit: m[2] } };
  if ((m = s.match(/^(-?\d*\.?\d+)(ms|s)$/))) return { $type: 'duration', $value: { value: +m[1], unit: m[2] } };
  if ((m = s.match(/^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/))) return { $type: 'cubicBezier', $value: [+m[1], +m[2], +m[3], +m[4]] };
  if (/^-?\d*\.?\d+$/.test(s)) return { $type: /(^|-)weights?($|-)/.test(name) ? 'fontWeight' : 'number', $value: +s };
  if (/(^|-)(font|typeface)$|^(brand|plain)$|(^|-)font-famil(y|ies)(-|$)/.test(name)) {
    const families = splitList(s).map(unquote);
    if (families.every((f) => f.length > 0 && !/[(){}]/.test(f))) return { $type: 'fontFamily', $value: families.length === 1 ? families[0] : families };
  }
  return { $value: s };
}

function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const c of s) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const unquote = (s: string) => (/^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s);

/** Insert a token at a dot path into a nested DTCG group tree. */
export function setPath(tree: Record<string, unknown>, path: string, token: Token) {
  const parts = path.split('.');
  let node = tree;
  for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
  const leaf = parts.at(-1)!;
  if (leaf in node) throw new Error(`duplicate token path ${path}`);
  node[leaf] = token;
}

/** Recursively sort object keys so output is byte-stable across runs. */
export function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}
