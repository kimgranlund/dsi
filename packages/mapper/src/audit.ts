import fs from 'node:fs';
import { evidenceOf, loadUsage } from './usage-evidence.ts';
import path from 'node:path';
import { createAjv, parseConcept, type Ontology } from '@dsi/schema';
import { loadNative, resolve, showValue, isAlias, type NativeSet } from '@dsi/resolve';
import { classify, type TermsFile } from '@dsi/classify';
import { readMappings, type Scope } from './packet.ts';

// ---------- color math ----------
export function rgbOf(value: unknown): [number, number, number, number] | undefined {
  const v = value as { components?: number[]; alpha?: number };
  if (!v || !Array.isArray(v.components) || v.components.length !== 3) return undefined;
  return [v.components[0], v.components[1], v.components[2], v.alpha ?? 1];
}
export function hsl([r, g, b]: [number, number, number, number]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}
const lum = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function contrast(a: [number, number, number, number], b: [number, number, number, number]) {
  const L = (x: [number, number, number, number]) => 0.2126 * lum(x[0]) + 0.7152 * lum(x[1]) + 0.0722 * lum(x[2]);
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Hue ranges (degrees) an intent's colors are expected in; null = not hue-bound. */
const INTENT_HUES: Record<string, [number, number][] | null> = {
  danger: [[330, 360], [0, 25]], destructive: [[330, 360], [0, 25]], success: [[75, 175]], warning: [[15, 65]], caution: [[30, 70]],
  info: [[180, 265]], ai: [[200, 330]], accent: null, neutral: null, highlight: null,
};
const inRanges = (h: number, rs: [number, number][]) => rs.some(([a, b]) => h >= a && h <= b);

// ---------- usage evidence from the alias graph ----------
const ROLE_WORDS: [RegExp, string][] = [[/(container|background|bg|fill|surface)(-color)?$/, 'background'], [/(label-text|text|headline|supporting-text)(-color)?$/, 'text'], [/icon(-color)?$/, 'icon'], [/(outline|border|divider)(-color)?$/, 'border'], [/focus(-ring)?(-color)?$/, 'focus-ring'], [/state-layer(-color)?$/, 'state-layer']];
export function usageOf(set: NativeSet): Map<string, { users: string[]; roles: Record<string, number> }> {
  const out = new Map<string, { users: string[]; roles: Record<string, number> }>();
  const themes = set.themes.length ? set.themes : [''];
  for (const [p] of set.tokens) {
    const targets = new Set<string>();
    for (const th of themes) { const t = set.lookup(th, p); if (t && isAlias(t.$value)) targets.add((t.$value as string).slice(1, -1)); }
    for (const target of targets) {
      const u = out.get(target) ?? { users: [], roles: {} };
      u.users.push(p);
      const role = ROLE_WORDS.find(([re]) => re.test(p))?.[1];
      if (role) u.roles[role] = (u.roles[role] ?? 0) + 1;
      out.set(target, u);
    }
  }
  return out;
}

// ---------- deterministic checks ----------
export interface Finding { token: string; check: string; detail: string }

/** Name-based pairing of on-fill content with its fill (Material on-X -> X; Polaris text-I-on-bg-fill -> bg-fill-I). */
function fillFor(product: string, token: string): string | undefined {
  if (product === 'material') { const m = token.match(/^md\.sys\.color\.on-(.+)$/); return m ? `md.sys.color.${m[1]}` : undefined; }
  if (product === 'polaris') { const m = token.match(/^color-(?:text|icon)-(.+)-on-bg-fill(-.*)?$/); return m ? `color-bg-fill-${m[1]}${m[2] ?? ''}` : undefined; }
  return undefined;
}

export function runChecks(o: Ontology, product: string, set: NativeSet, approved: { id: string; token: string; concept: string; match: string }[], terms?: TermsFile): Finding[] {
  const out: Finding[] = [];
  const themes = set.themes.length ? set.themes : [''];
  const modeTheme = set.modes.light ?? themes[0];
  const usage = usageOf(set);
  const byToken = new Map(approved.map((m) => [m.token, m]));
  for (const m of approved) {
    const p = parseConcept(o, m.concept);
    if (typeof p === 'string') continue;
    const r = resolve(set, modeTheme, m.token);
    const rgb = rgbOf(r.value);
    // 1. hue vs intent
    const ranges = p.facets.intent ? INTENT_HUES[String(p.facets.intent).split('+')[0]] : undefined;
    if (rgb && ranges && rgb[3] > 0.2) {
      const c = hsl(rgb);
      if (c.s > 0.3 && c.l > 0.08 && c.l < 0.92 && !inRanges(c.h, ranges)) out.push({ token: m.token, check: 'hue-vs-intent', detail: `intent ${p.facets.intent} but ${showValue(r.type, r.value)} has hue ${Math.round(c.h)}° (${modeTheme || 'default'})` });
    }
    if (rgb && p.facets.intent === 'neutral') { const c = hsl(rgb); if (c.s > 0.35 && c.l > 0.1 && c.l < 0.9) out.push({ token: m.token, check: 'hue-vs-intent', detail: `intent neutral but ${showValue(r.type, r.value)} is saturated (${Math.round(c.s * 100)}%)` }); }
    // 2. property vs how the shipped code uses the token
    const u = usage.get(m.token);
    if (u && p.facets.property) {
      const total = Object.values(u.roles).reduce((a, b) => a + b, 0);
      const [top, n] = Object.entries(u.roles).sort((a, b) => b[1] - a[1])[0] ?? [];
      const prop = String(p.facets.property);
      const compatible = (role: string) => role === prop || (prop === 'foreground' && (role === 'text' || role === 'icon')) || role === 'state-layer';
      if (top && total >= 3 && n / total >= 0.7 && !compatible(top)) out.push({ token: m.token, check: 'property-vs-usage', detail: `mapped property ${prop}, but ${n} of ${total} shipped uses are ${top} (e.g. ${u.users.slice(0, 3).join(', ')})` });
    }
    // 3. on-fill contrast against the paired fill
    const fill = p.facets.usage && String(p.facets.usage).includes('on-fill') ? fillFor(product, m.token) : undefined;
    if (fill && set.tokens.has(fill)) {
      for (const th of themes) {
        const a = rgbOf(resolve(set, th, m.token).value), b = rgbOf(resolve(set, th, fill).value);
        if (a && b && a[3] > 0.5 && b[3] > 0.5) { const cr = contrast(a, b); if (cr < 4.5) out.push({ token: m.token, check: 'on-fill-contrast', detail: `contrast ${cr}:1 against ${fill} in ${th || 'default'} (WCAG AA text needs 4.5:1)` }); }
      }
    }
    // 4. classifier (approved terms) contradicts the mapping: a facet both bind with different values, or a facet
    //    only the classifier binds. A less specific classifier answer is not a contradiction.
    if (terms && (m.match === 'exact' || m.match === 'close')) {
      const c = classify(terms, m.token, String(set.tokens.get(m.token)?.prov.file ?? ''), 'color');
      const diffs = Object.entries(c.facets).filter(([f, v]) => (p.facets as Record<string, string>)[f] !== v).map(([f, v]) => `${f}: ${(p.facets as Record<string, string>)[f] ?? '(unbound)'} vs terms ${v}`);
      if (diffs.length && !c.conflicts.length) out.push({ token: m.token, check: 'terms-contradict-mapping', detail: `${diffs.join('; ')} (terms: ${c.matchedTerms.join(', ')})` });
    }
  }
  // 5. tokens resolving identically in every theme but mapped to different intents
  const sig = new Map<string, string[]>();
  for (const m of approved) sig.set(themes.map((th) => resolve(set, th, m.token).chain.at(-1) ?? '').join('|'), [...(sig.get(themes.map((th) => resolve(set, th, m.token).chain.at(-1) ?? '').join('|')) ?? []), m.token]);
  for (const [s, toks] of sig) {
    if (!s.replaceAll('|', '') || toks.length < 2) continue;
    const intents = new Set(toks.map((t) => { const p = parseConcept(o, byToken.get(t)!.concept); return typeof p === 'string' ? '' : String(p.facets.intent ?? ''); }));
    if (intents.size > 1 && !intents.has('')) out.push({ token: toks[0], check: 'same-value-different-intent', detail: `${toks.join(', ')} resolve to the same tokens in every theme but map to intents ${[...intents].join(', ')}` });
  }
  return out;
}

/**
 * Each approved term against the approved exact/close mappings of tokens containing it: how many of those bind the
 * term's value. A term most of its own tokens disagree with is suspect.
 */
export function auditTerms(o: Ontology, terms: TermsFile, approved: { token: string; concept: string; match: string }[]): Finding[] {
  const out: Finding[] = [];
  const words = (t: string) => t.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().split(/[.\-_]+/).filter(Boolean);
  for (const t of terms.terms.filter((x) => x.status === 'approved')) {
    const fv = t.concept.match(/^dsi:([a-z]+)\/([a-z0-9-]+)$/);
    if (!fv) continue;
    const parts = t.term.split('-');
    const has = (tok: string) => { const w = words(tok); return w.some((_, i) => parts.every((p, k) => w[i + k] === p)); };
    // Only tokens where this term decides its facet: a longer approved term on the same facet that matches the token
    // (border-radius over border, font-size over text) takes over there, so those tokens say nothing about this one.
    const longer = terms.terms.filter((x) => x.status === 'approved' && x.term !== t.term && x.term.split('-').length > parts.length && x.term.split('-').join(' ').includes(parts.join(' ')) && x.concept.split('/')[0] === t.concept.split('/')[0]);
    const facetOf = (c: string) => c.match(/^dsi:([a-z]+)\//)?.[1];
    const overridden = (tok: string) => terms.terms.some((x) => x.status === 'approved' && x.term !== t.term && x.term.split('-').length > parts.length && facetOf(x.concept) === fv[1] && (() => { const xp = x.term.split('-'); const w = words(tok); return w.some((_, i) => xp.every((q, k) => w[i + k] === q)); })());
    void longer;
    const rel = approved.filter((m) => (m.match === 'exact' || m.match === 'close') && has(m.token) && !overridden(m.token));
    if (rel.length < 3) continue;
    const agree = rel.filter((m) => { const p = parseConcept(o, m.concept); return typeof p !== 'string' && String((p.facets as Record<string, string>)[fv[1]] ?? '').split('+').includes(fv[2]); });
    if (agree.length / rel.length < 0.6) out.push({ token: `term:${t.term}`, check: 'term-vs-mappings', detail: `${t.term} -> ${t.concept}, but only ${agree.length} of ${rel.length} approved exact/close mappings of tokens containing it bind that (e.g. ${rel.filter((m) => !agree.includes(m)).slice(0, 2).map((m) => `${m.token} = ${m.concept.replace('dsi:concept/color/', '')}`).join('; ')})` });
  }
  return out;
}

// ---------- auditor packets ----------
const DOCS: Record<string, string[]> = {
  material: ['https://m3.material.io/styles/color/roles', 'https://github.com/material-components/material-web/blob/main/docs/theming/color.md'],
  carbon: ['https://carbondesignsystem.com/elements/color/tokens/', 'https://carbondesignsystem.com/elements/color/usage/'],
  polaris: ['https://polaris-react.shopify.com/tokens/color'],
};

export function prepareAudit(root: string, o: Ontology, scope: Scope, product: string, runDir: string, only?: Set<string>) {
  const { version } = scope.products[product];
  const set = loadNative(root, product, version);
  const file = readMappings(root, product, version) as any;
  // `only`: audit just these tokens (for example the Jev pre-screen's flags, `audit-prepare --only <file>`).
  const approved = (file?.mappings ?? []).filter((m: any) => m.status === 'approved' && (!only || only.has(m.token)));
  const termsPath = path.join(root, 'mappings', product, 'terms.json');
  const terms = fs.existsSync(termsPath) ? (JSON.parse(fs.readFileSync(termsPath, 'utf8')) as TermsFile) : undefined;
  const findings = runChecks(o, product, set, approved, terms);
  const termFindings = terms ? auditTerms(o, terms, approved) : [];
  const usage = usageOf(set);
  // Observed uses in the system's own component CSS (docs/planning/usage-graph.md), when a usage graph exists.
  const observed = loadUsage(root, product, version);
  const themes = set.themes.length ? set.themes : [''];
  const valueKey = (t: string) => themes.map((th) => showValue(resolve(set, th, t).type, resolve(set, th, t).value)).join('|');
  const byValue = new Map<string, string[]>();
  for (const m of approved) byValue.set(valueKey(m.token), [...(byValue.get(valueKey(m.token)) ?? []), m.token]);
  const conceptOfToken = new Map(approved.map((m: any) => [m.token, `${m.concept} (${m.match})`]));
  const items = approved.map((m: any) => {
    const t = set.tokens.get(m.token);
    const u = usage.get(m.token);
    return {
      token: m.token, mappingId: m.id, nativeName: t?.prov.nativeName, description: t?.description,
      mapping: { concept: m.concept, match: m.match },
      values: Object.fromEntries(themes.map((th) => { const r = resolve(set, th, m.token); return [th || 'all', { aliases: r.chain, value: showValue(r.type, r.value) }]; })),
      usedBy: u ? { count: u.users.length, roles: u.roles, examples: u.users.slice(0, 6) } : undefined,
      observedUses: (() => { const xs = observed?.get(m.token); if (!xs?.length) return undefined; const e = evidenceOf(xs); return { count: e.uses, components: e.components, property: e.property, propertyShare: +e.propertyShare.toFixed(2), state: e.state, stateShare: +e.stateShare.toFixed(2), examples: xs.slice(0, 8).map((x) => `${x.component}: ${x.selector} { ${x.property} }${x.state ? ' [' + x.state + ']' : ''}`) }; })(),
      sameValueSiblings: (byValue.get(valueKey(m.token)) ?? []).filter((x) => x !== m.token).slice(0, 5).map((x) => `${x} -> ${conceptOfToken.get(x)}`),
      checks: findings.filter((f) => f.token === m.token).map((f) => `${f.check}: ${f.detail}`),
    };
  });
  const packet = { id: `audit-color-v1/${product}@${version}`, product, version, instructions: 'packages/mapper/prompts/audit-v1.md', output: path.join(runDir, `${product}.verdicts.json`), docs: DOCS[product] ?? [], items };
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, `${product}.audit-packet.json`), JSON.stringify(packet, null, 1) + '\n');
  return { count: items.length, findings: [...findings, ...termFindings] };
}

export function readVerdicts(file: string, o: Ontology, expected: Map<string, string>) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = createAjv().getSchema('https://dsi.nonoun.io/schema/audit.schema.json')!;
  if (!v(data)) throw new Error(`${file}: ${v.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  const seen = new Set<string>();
  for (const x of data.verdicts as any[]) {
    if (expected.get(x.token) !== x.mappingId) throw new Error(`${file}: ${x.token}: mappingId ${x.mappingId} is not the audited mapping`);
    if (seen.has(x.token)) throw new Error(`${file}: ${x.token} judged twice`);
    seen.add(x.token);
    if (x.suggested) { const p = parseConcept(o, x.suggested.concept); if (typeof p === 'string') throw new Error(`${file}: ${x.token}: suggested ${x.suggested.concept} ${p}`); }
    if (x.verdict !== 'insufficient' && !x.evidence.length) throw new Error(`${file}: ${x.token}: a ${x.verdict} verdict needs evidence`);
  }
  const missing = [...expected.keys()].filter((t) => !seen.has(t));
  if (missing.length) throw new Error(`${file}: ${missing.length} mapping(s) unjudged, e.g. ${missing.slice(0, 3).join(', ')}`);
  return data;
}
