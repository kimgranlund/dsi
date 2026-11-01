import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * A small interpreter for the plain-data subset of ES modules that token packages build their themes with (Fluent:
 * object literals, spreads, arrow functions, template-literal keys, reduce, Object.assign/entries, member patches).
 * It walks the TypeScript syntax tree; package code is never handed to the JavaScript engine, there is no `eval`,
 * no `require`, no globals beyond a short whitelist, and anything outside the subset throws.
 *
 * Provenance: values read from a "palette" module export carry their palette path (grey.14, brandWeb.80), so a
 * theme token whose value is such a read is a proven alias, not a guess from equal hex values.
 */

export class Ref { readonly value: string | number; readonly ref: string; constructor(value: string | number, ref: string) { this.value = value; this.ref = ref; } toString() { return String(this.value); } }
type Fn = { params: ts.ParameterDeclaration[]; body: ts.ConciseBody; scope: Scope; file: string };
type Scope = { vars: Map<string, unknown>; parent?: Scope };

const plain = (v: unknown): unknown => (v instanceof Ref ? v.value : v);

export class StaticModules {
  private cache = new Map<string, Record<string, unknown>>();
  private paths = new WeakMap<object, string>();
  private root: string;
  private palette: (rel: string) => boolean;
  constructor(root: string, palette: (rel: string) => boolean) { this.root = root; this.palette = palette; }

  /** The exports of a module (relative to the package root), evaluated once. */
  load(rel: string): Record<string, unknown> {
    rel = path.normalize(rel);
    const hit = this.cache.get(rel);
    if (hit) return hit;
    const exports: Record<string, unknown> = {};
    this.cache.set(rel, exports);
    const src = ts.createSourceFile(rel, fs.readFileSync(path.join(this.root, rel), 'utf8'), ts.ScriptTarget.ES2022, true);
    const scope: Scope = { vars: new Map() };
    for (const st of src.statements) this.statement(st, scope, rel, exports);
    if (this.palette(rel)) for (const [k, v] of Object.entries(exports)) {
      if (v && typeof v === 'object' && !this.paths.has(v)) this.paths.set(v, k);
      else if (typeof v === 'string' || typeof v === 'number') exports[k] = new Ref(v, k); // a palette constant (white, hcCanvas)
    }
    return exports;
  }

  private statement(st: ts.Statement, scope: Scope, file: string, exports?: Record<string, unknown>): { ret?: unknown } | undefined {
    if (ts.isImportDeclaration(st)) {
      const from = path.join(path.dirname(file), (st.moduleSpecifier as ts.StringLiteral).text);
      const mod = this.load(from);
      for (const el of (st.importClause?.namedBindings as ts.NamedImports | undefined)?.elements ?? []) scope.vars.set(el.name.text, mod[(el.propertyName ?? el.name).text]);
      return;
    }
    if (ts.isExportDeclaration(st)) {
      const mod = st.moduleSpecifier ? this.load(path.join(path.dirname(file), (st.moduleSpecifier as ts.StringLiteral).text)) : undefined;
      for (const el of (st.exportClause as ts.NamedExports | undefined)?.elements ?? []) exports![el.name.text] = mod ? mod[(el.propertyName ?? el.name).text] : this.lookup(scope, (el.propertyName ?? el.name).text);
      return;
    }
    const exported = (n: ts.Node) => ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const v = d.initializer ? this.expr(d.initializer, scope, file) : undefined;
        if (ts.isIdentifier(d.name)) { scope.vars.set(d.name.text, v); if (exported(st) && exports) exports[d.name.text] = v; }
        else if (ts.isArrayBindingPattern(d.name)) d.name.elements.forEach((e, i) => { if (ts.isBindingElement(e) && ts.isIdentifier(e.name)) scope.vars.set(e.name.text, (v as unknown[])[i]); });
        else throw new Error(`${file}: unsupported binding`);
      }
      return;
    }
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      const fn: Fn = { params: [...st.parameters], body: st.body, scope, file };
      scope.vars.set(st.name.text, fn);
      if (exported(st) && exports) exports[st.name.text] = fn;
      return;
    }
    if (ts.isExpressionStatement(st)) { this.expr(st.expression, scope, file); return; }
    if (ts.isReturnStatement(st)) return { ret: st.expression ? this.expr(st.expression, scope, file) : undefined };
    if (ts.isEmptyStatement(st)) return;
    throw new Error(`${file}: unsupported statement ${ts.SyntaxKind[st.kind]}`);
  }

  private lookup(scope: Scope | undefined, name: string): unknown {
    for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    if (name === 'undefined') return undefined;
    throw new Error(`unknown identifier ${name}`);
  }

  private call(fn: unknown, args: unknown[], file: string): unknown {
    if (typeof fn === 'function') return fn(...args);
    const f = fn as Fn;
    if (!f || !f.body) throw new Error(`${file}: call of a non-function`);
    const scope: Scope = { vars: new Map(), parent: f.scope };
    f.params.forEach((p, i) => {
      const v = args[i] !== undefined ? args[i] : p.initializer ? this.expr(p.initializer, scope, f.file) : undefined;
      if (ts.isIdentifier(p.name)) scope.vars.set(p.name.text, v);
      else if (ts.isArrayBindingPattern(p.name)) p.name.elements.forEach((e, j) => { if (ts.isBindingElement(e) && ts.isIdentifier(e.name)) scope.vars.set(e.name.text, (v as unknown[])[j]); });
      else throw new Error(`${f.file}: unsupported parameter`);
    });
    if (!ts.isBlock(f.body)) return this.expr(f.body, scope, f.file);
    for (const st of f.body.statements) { const r = this.statement(st, scope, f.file); if (r && 'ret' in r) return r.ret; }
    return undefined;
  }

  /** Bound built-ins: only what theme code uses. */
  private method(obj: unknown, name: string, file: string): unknown {
    const o = plain(obj);
    if (typeof o === 'string' && ['slice', 'toUpperCase', 'toLowerCase', 'charAt', 'concat'].includes(name)) return (...a: unknown[]) => (o as any)[name](...a.map(plain));
    if (Array.isArray(o)) {
      if (name === 'reduce') return (fn: unknown, init: unknown) => o.reduce((acc, x, i) => this.call(fn, [acc, x, i], file), init);
      if (name === 'map') return (fn: unknown) => o.map((x, i) => this.call(fn, [x, i], file));
      if (name === 'forEach') return (fn: unknown) => { o.forEach((x, i) => this.call(fn, [x, i], file)); };
      if (name === 'length') return o.length;
    }
    throw new Error(`${file}: unsupported method ${name}`);
  }

  private member(obj: unknown, key: string | number, file: string): unknown {
    if (obj === OBJECT) {
      if (key === 'assign') return (t: Record<string, unknown>, ...s: Record<string, unknown>[]) => Object.assign(t, ...s);
      if (key === 'entries') return (o: Record<string, unknown>) => Object.entries(o);
      if (key === 'keys') return (o: Record<string, unknown>) => Object.keys(o);
      throw new Error(`${file}: Object.${key} unsupported`);
    }
    const o = plain(obj) as Record<string | number, unknown>;
    if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key)) {
      const v = o[key];
      const base = this.paths.get(o as object);
      if (base !== undefined) {
        if (v && typeof v === 'object' && !this.paths.has(v)) this.paths.set(v, `${base}.${key}`);
        if (typeof v === 'string' || typeof v === 'number') return new Ref(v, `${base}.${key}`);
      }
      return v;
    }
    return this.method(obj, String(key), file);
  }

  private key(name: ts.PropertyName, scope: Scope, file: string): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return String(plain(this.expr(name.expression, scope, file)));
    throw new Error(`${file}: unsupported key`);
  }

  expr(e: ts.Expression, scope: Scope, file: string): unknown {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return this.expr(e.expression, scope, file);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) return -Number(plain(this.expr(e.operand, scope, file)));
    if (ts.isIdentifier(e)) return e.text === 'Object' ? OBJECT : this.lookup(scope, e.text);
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => String(plain(this.expr(s.expression, scope, file))) + s.literal.text).join('');
    if (ts.isBinaryExpression(e)) {
      if (e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = e.left;
        const v = this.expr(e.right, scope, file);
        if (ts.isPropertyAccessExpression(target)) (plain(this.expr(target.expression, scope, file)) as Record<string, unknown>)[target.name.text] = v;
        else if (ts.isElementAccessExpression(target)) (plain(this.expr(target.expression, scope, file)) as Record<string, unknown>)[String(plain(this.expr(target.argumentExpression, scope, file)))] = v;
        else throw new Error(`${file}: unsupported assignment`);
        return v;
      }
      const l = plain(this.expr(e.left, scope, file)) as any, r = plain(this.expr(e.right, scope, file)) as any;
      switch (e.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return l + r;
        case ts.SyntaxKind.MinusToken: return l - r;
        case ts.SyntaxKind.AsteriskToken: return l * r;
        case ts.SyntaxKind.SlashToken: return l / r;
        case ts.SyntaxKind.BarBarToken: return l || r;
        case ts.SyntaxKind.QuestionQuestionToken: return l ?? r;
        case ts.SyntaxKind.EqualsEqualsEqualsToken: return l === r;
      }
      throw new Error(`${file}: unsupported operator ${ts.SyntaxKind[e.operatorToken.kind]}`);
    }
    if (ts.isConditionalExpression(e)) return plain(this.expr(e.condition, scope, file)) ? this.expr(e.whenTrue, scope, file) : this.expr(e.whenFalse, scope, file);
    if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => (ts.isSpreadElement(x) ? (plain(this.expr(x.expression, scope, file)) as unknown[]) : [this.expr(x, scope, file)]));
    if (ts.isObjectLiteralExpression(e)) {
      const out: Record<string, unknown> = {};
      for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) Object.assign(out, plain(this.expr(p.expression, scope, file)) as object);
        else if (ts.isPropertyAssignment(p)) out[this.key(p.name, scope, file)] = this.expr(p.initializer, scope, file);
        else if (ts.isShorthandPropertyAssignment(p)) out[p.name.text] = this.lookup(scope, p.name.text);
        else throw new Error(`${file}: unsupported object member`);
      }
      return out;
    }
    if (ts.isPropertyAccessExpression(e)) return this.member(this.expr(e.expression, scope, file), e.name.text, file);
    if (ts.isElementAccessExpression(e)) { const k = plain(this.expr(e.argumentExpression, scope, file)); return this.member(this.expr(e.expression, scope, file), typeof k === 'number' ? k : String(k), file); }
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { params: [...e.parameters], body: e.body, scope, file } satisfies Fn;
    if (ts.isCallExpression(e)) {
      const args = e.arguments.map((a) => this.expr(a, scope, file));
      return this.call(this.expr(e.expression, scope, file), args, file);
    }
    throw new Error(`${file}: unsupported expression ${ts.SyntaxKind[e.kind]} at ${e.getText().slice(0, 60)}`);
  }
}
const OBJECT = Symbol('Object');
