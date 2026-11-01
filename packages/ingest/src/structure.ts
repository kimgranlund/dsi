import fs from 'node:fs';
import ts from 'typescript';

/**
 * Shipped structure evidence: how a product itself groups and orders its tokens. Written next to the native tokens
 * as structure.json. `kind` says what the evidence is: designer-declared groups, or only the authored source order.
 */
export interface ShippedGroup { label: string; properties?: string[]; tokens: string[]; groups: ShippedGroup[] }
export interface ShippedStructure { kind: 'shipped-groups' | 'shipped-order'; file: string; groups: ShippedGroup[] }

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
