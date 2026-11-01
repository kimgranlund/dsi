import fs from 'node:fs';
import ts from 'typescript';

/**
 * Shipped structure evidence: how a product itself groups and orders its tokens. Written next to the native tokens
 * as structure.json. `kind` says what the evidence is: designer-declared groups, or only the authored source order.
 */
export interface ShippedGroup { label: string; properties?: string[]; tokens: string[]; groups: ShippedGroup[] }
export interface ShippedStructure {
  kind: 'shipped-groups' | 'shipped-order';
  file: string;
  /** False when the shipped file lists tokens in no meaningful order (alphabetical): groups count, order does not. */
  ordered?: boolean;
  groupOrderSource?: string;
  groups: ShippedGroup[];
}

const str = (e: ts.Expression | undefined) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined);

/**
 * Carbon's src/tokens/v11TokenGroup.ts: `export const x = TokenGroup.create({ name, properties, tokens: [...] })`,
 * where tokens are strings, `{ name: '...' }` objects or references to other groups. Parsed, never executed. The
 * root group ('All') gives the order of groups; loose tokens at the root become a 'Misc' group.
 */
export function carbonTokenGroups(file: string, rel: string): ShippedStructure {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const defs = new Map<string, ts.ObjectLiteralExpression>();
  const order: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (ts.isIdentifier(d.name) && init && ts.isCallExpression(init) && init.expression.getText(sf) === 'TokenGroup.create' && init.arguments[0] && ts.isObjectLiteralExpression(init.arguments[0])) { defs.set(d.name.text, init.arguments[0]); order.push(d.name.text); }
    }
  }
  const prop = (o: ts.ObjectLiteralExpression, k: string) => o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === k)?.initializer;
  const build = (id: string, seen: Set<string>): ShippedGroup => {
    const o = defs.get(id)!;
    const g: ShippedGroup = { label: str(prop(o, 'name')) ?? id, tokens: [], groups: [] };
    const props = prop(o, 'properties');
    if (props && ts.isArrayLiteralExpression(props)) g.properties = props.elements.map((e) => str(e)).filter((x): x is string => !!x);
    const toks = prop(o, 'tokens');
    if (toks && ts.isArrayLiteralExpression(toks)) for (const e of toks.elements) {
      if (ts.isIdentifier(e) && defs.has(e.text) && !seen.has(e.text)) g.groups.push(build(e.text, new Set([...seen, e.text])));
      else if (str(e)) g.tokens.push(str(e)!);
      else if (ts.isObjectLiteralExpression(e) && str(prop(e, 'name'))) g.tokens.push(str(prop(e, 'name'))!);
    }
    return g;
  };
  const root = order.find((id) => str(prop(defs.get(id)!, 'name')) === 'All');
  if (!root) return { kind: 'shipped-groups', file: rel, groups: order.map((id) => build(id, new Set([id]))) };
  const all = build(root, new Set([root]));
  return { kind: 'shipped-groups', file: rel, groups: [...all.groups, ...(all.tokens.length ? [{ label: 'Misc', tokens: all.tokens, groups: [] }] : [])] };
}

/**
 * material-web tokens/versions/latest/sass/_md-sys-color.scss documents every token as
 *   /// md.sys.color.<key> (<Group> / <Subgroup>)
 *   ///
 *   /// <description>
 * Returns the groups (nested on " / ") and each token's description. The file is alphabetical, so token order inside
 * groups is not evidence; group order comes from the docs (groupOrder).
 */
export function materialDocGroups(file: string, rel: string, groupOrder: string[] = [], groupOrderSource?: string): { structure: ShippedStructure; descriptions: Map<string, string> } {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const descriptions = new Map<string, string>();
  const top = new Map<string, ShippedGroup>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\/\/\/ (md\.sys\.color\.[a-z0-9-]+) \((.+)\)\s*$/);
    if (!m) continue;
    const desc: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].startsWith('///'); j++) { const t = lines[j].replace(/^\/\/\/ ?/, '').trim(); if (t) desc.push(t); }
    if (desc.length) descriptions.set(m[1], desc.join(' ').replace(/^Note: /, ''));
    const [g, sub] = m[2].split(' / ').map((x) => x.trim());
    const group = top.get(g) ?? top.set(g, { label: g, tokens: [], groups: [] }).get(g)!;
    if (sub) { let sg = group.groups.find((x) => x.label === sub); if (!sg) group.groups.push((sg = { label: sub, tokens: [], groups: [] })); sg.tokens.push(m[1]); }
    else group.tokens.push(m[1]);
  }
  const rank = (l: string) => { const i = groupOrder.indexOf(l); return i < 0 ? 99 : i; };
  const groups = [...top.values()].sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  return { structure: { kind: 'shipped-groups', file: rel, ordered: false, ...(groupOrderSource ? { groupOrderSource } : {}), groups }, descriptions };
}
