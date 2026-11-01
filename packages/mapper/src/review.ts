import crypto from 'node:crypto';
import { lintRationale } from './language-sweep.ts';
import fs from 'node:fs';
import path from 'node:path';
import { readMappings, mappingPath, type Scope } from './packet.ts';

/** One token awaiting a human decision, with what both agents said and how it looks per theme. */
export interface QueueItem {
  key: string;
  product: string;
  version: string;
  token: string;
  nativeName?: string;
  description?: string;
  themes: Record<string, { aliases: string[]; value: string }>;
  candidates: { id: string; kind: 'mapping' | 'unmapped'; model: string; concept?: string; match?: string; confidence?: number; rationale: string }[];
}

export const decisionKey = (product: string, token: string) => `${product}__${token}`;

/** Collect the queue: tokens with Proposed records and nothing Approved. Token details come from the run's packets. */
// A rule-settled answer the registry gate held (ADR 0019) has no single model: name the rule that agreed.
const agreedBy = (x: any) => ({ 'settle-three-v1': 'all three models', 'settle-two-v1': 'two of three models', 'two-of-three-v1': 'two of three models', 'emphasis-rank-v1': 'contrast rank' } as Record<string, string>)[x.provenance?.method] ?? x.provenance?.method ?? x.provenance?.agent ?? 'rule';

export function collectQueue(root: string, scope: Scope, runDir: string | string[]): QueueItem[] {
  // Several map runs may hold queued tokens (a re-opened set mapped later); a later run's packet wins.
  const dirs = Array.isArray(runDir) ? runDir : [runDir];
  const items: QueueItem[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const m = readMappings(root, product, version) as any;
    if (!m) continue;
    const info = new Map<string, any>();
    for (const d of dirs) { const f = path.join(d, `${product}.a.packet.json`); if (fs.existsSync(f)) for (const t of JSON.parse(fs.readFileSync(f, 'utf8')).tokens) info.set(t.token, t); }
    const settled = new Set([...(m.mappings ?? []).filter((x: any) => x.status === 'approved').map((x: any) => x.token), ...(m.unmapped ?? []).filter((x: any) => x.status === 'approved').map((x: any) => x.token)]);
    const byToken = new Map<string, QueueItem['candidates']>();
    const push = (t: string, c: QueueItem['candidates'][number]) => (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(c);
    for (const x of m.mappings ?? []) if (x.status === 'proposed' && !settled.has(x.token)) push(x.token, { id: x.id, kind: 'mapping', model: x.provenance.model ?? agreedBy(x), concept: x.concept, match: x.match, confidence: x.confidence, rationale: x.rationale });
    for (const x of m.unmapped ?? []) if (x.status === 'proposed' && !settled.has(x.token)) push(x.token, { id: 'u-' + crypto.createHash('sha1').update(x.token + x.provenance.model).digest('hex').slice(0, 12), kind: 'unmapped', model: x.provenance.model ?? agreedBy(x), rationale: x.rationale });
    for (const [token, candidates] of [...byToken].sort(([a], [b]) => a.localeCompare(b))) {
      const t = info.get(token);
      if (!t) throw new Error(`${product}: queued token ${token} is missing from ${dirs.join(', ')}; pass the latest run`);
      items.push({ key: decisionKey(product, token), product, version, token, nativeName: t.nativeName, description: t.description, themes: t.themes, candidates });
    }
  }
  return items;
}

export interface Decision { key: string; product: string; token: string; action: 'accept' | 'custom' | 'unmapped' | 'reject'; candidateId?: string; concept?: string; match?: string; note?: string; at: string }

/**
 * Apply human decisions to mapping files. accept: the chosen candidate becomes Approved, the others Rejected.
 * custom: a new Approved mapping by the reviewer, all candidates Rejected. unmapped: an Approved unmapped record,
 * mapping candidates Rejected. reject: every candidate Rejected (the token is asked again next round).
 */
export function applyDecisions(root: string, scope: Scope, decisions: Decision[], reviewer: string): Record<string, number> {
  const counts: Record<string, number> = { accept: 0, custom: 0, unmapped: 0, reject: 0, skipped: 0 };
  for (const [product, { version }] of Object.entries(scope.products)) {
    const m = readMappings(root, product, version) as any;
    if (!m) continue;
    let changed = false;
    for (const d of decisions.filter((d) => d.product === product)) {
      const review = { by: reviewer, at: d.at, ...(d.note ? { note: d.note } : {}) };
      const open = (m.mappings ?? []).filter((x: any) => x.token === d.token && x.status === 'proposed');
      const openU = (m.unmapped ?? []).filter((x: any) => x.token === d.token && x.status === 'proposed');
      if (!open.length && !openU.length) { counts.skipped++; continue; }
      const reject = (xs: any[]) => xs.forEach((x) => Object.assign(x, { status: 'rejected', review }));
      if (d.action === 'accept') {
        const chosen = open.find((x: any) => x.id === d.candidateId);
        if (chosen) { Object.assign(chosen, { status: 'approved', review }); reject(open.filter((x: any) => x !== chosen)); reject(openU); }
        else if (d.candidateId?.startsWith('u-') && openU.length) { Object.assign(openU[0], { status: 'approved', review }); m.unmapped = m.unmapped.filter((x: any) => !(x.token === d.token && x.status === 'proposed')); reject(open); }
        else { counts.skipped++; continue; }
      } else if (d.action === 'custom') {
        if (!d.concept || !d.match) { counts.skipped++; continue; }
        reject(open); reject(openU);
        const id = 'm-' + crypto.createHash('sha1').update([d.token, d.concept, d.match].join('|')).digest('hex').slice(0, 12);
        m.mappings = (m.mappings ?? []).filter((x: any) => x.id !== id);
        m.mappings.push({ id, token: d.token, concept: d.concept, match: d.match, confidence: 1, status: 'approved', rationale: d.note || 'Chosen in human review.', provenance: { agent: reviewer, at: d.at, method: 'human-review' }, review });
      } else if (d.action === 'unmapped') {
        reject(open);
        m.unmapped = (m.unmapped ?? []).filter((x: any) => x.token !== d.token || x.status === 'approved');
        m.unmapped.push({ token: d.token, status: 'approved', rationale: d.note || 'No concept fits (human review).', provenance: { agent: reviewer, at: d.at, method: 'human-review' }, review });
      } else { reject(open); reject(openU); }
      counts[d.action]++;
      changed = true;
    }
    // Rejected unmapped records carry no value once a decision exists; keep the file readable.
    if (m.unmapped) m.unmapped = m.unmapped.filter((x: any) => x.status !== 'rejected');
    if (changed) {
      m.mappings.sort((x: any, y: any) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id));
      fs.writeFileSync(mappingPath(root, product, version), JSON.stringify(m, null, 2) + '\n');
    }
  }
  return counts;
}

/** Render the review page from the template, embedding the queue and allowed facet values. */
export function renderPage(root: string, items: QueueItem[], ontology: unknown, generatedAt: string, termItems: TermQueueItem[] = [], disputes: DisputeItem[] = [], definitions: unknown[] = []): string {
  const tpl = fs.readFileSync(path.join(root, 'packages/mapper/review/review.html'), 'utf8');
  const data = JSON.stringify({ generatedAt, items, termItems, disputes, definitions, ontology }).replaceAll('</', '<\\/');
  return tpl.replace('/*__DATA__*/null', data);
}

/** One naming word awaiting a decision: every proposed term for it, with how often it appears in names. */
export interface TermQueueItem {
  key: string;
  product: string;
  term: string;
  count?: number;
  examples: string[];
  approved: { concept: string; match: string }[];
  candidates: { id: string; concept: string; match: string; by: string; note?: string; evidence?: { support: number; agree: number; precision: number } }[];
}

export const termDecisionKey = (product: string, term: string) => `${product}__${term}`;
const termCandidateId = (t: any) => 't-' + crypto.createHash('sha1').update([t.term, t.concept, t.match, t.provenance.model ?? t.provenance.method].join('|')).digest('hex').slice(0, 12);

/** Words with Proposed terms (agent drafts or evidence candidates). Counts and examples come from the vocabulary run. */
export function collectTermQueue(root: string, products: string[], vocabRunDir: string): TermQueueItem[] {
  const out: TermQueueItem[] = [];
  for (const product of products) {
    const f = path.join(root, 'mappings', product, 'terms.json');
    if (!fs.existsSync(f)) continue;
    const terms = JSON.parse(fs.readFileSync(f, 'utf8')).terms as any[];
    const pk = path.join(vocabRunDir, `${product}.a.packet.json`);
    const vocab = new Map<string, any>(fs.existsSync(pk) ? JSON.parse(fs.readFileSync(pk, 'utf8')).vocabulary.map((v: any) => [v.term, v]) : []);
    const words = [...new Set(terms.filter((t) => t.status === 'proposed').map((t) => t.term))].sort();
    for (const term of words) {
      const v = vocab.get(term);
      out.push({
        key: termDecisionKey(product, term), product, term, count: v?.count, examples: v?.examples ?? [],
        approved: terms.filter((t) => t.term === term && t.status === 'approved').map(({ concept, match }) => ({ concept, match })),
        candidates: terms.filter((t) => t.term === term && t.status === 'proposed').map((t) => ({ id: termCandidateId(t), concept: t.concept, match: t.match, by: t.provenance.model ?? 'evidence from approved mappings', note: t.note, evidence: t.evidence })),
      });
    }
  }
  return out;
}

export interface TermDecision { key: string; product: string; term: string; action: 'accept' | 'custom' | 'ignore' | 'reject'; candidateId?: string; concept?: string; match?: string; ignore?: 'noise' | 'no-concept' | 'component'; note?: string; at: string }

/**
 * accept: the chosen term becomes Approved, other proposals for the word Rejected. custom: a new Approved term.
 * ignore noise: the word joins `noise`; other ignores just reject the proposals. reject: all proposals Rejected.
 */
export function applyTermDecisions(root: string, decisions: TermDecision[], reviewer: string): Record<string, number> {
  const counts: Record<string, number> = { accept: 0, custom: 0, ignore: 0, reject: 0, skipped: 0 };
  for (const product of [...new Set(decisions.map((d) => d.product))]) {
    const f = path.join(root, 'mappings', product, 'terms.json');
    if (!fs.existsSync(f)) continue;
    const file = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const d of decisions.filter((x) => x.product === product)) {
      const review = { by: reviewer, at: d.at, ...(d.note ? { note: d.note } : {}) };
      const open = file.terms.filter((t: any) => t.term === d.term && t.status === 'proposed');
      if (!open.length) { counts.skipped++; continue; }
      const reject = (xs: any[]) => xs.forEach((x) => Object.assign(x, { status: 'rejected', review }));
      if (d.action === 'accept') {
        const chosen = open.find((t: any) => termCandidateId(t) === d.candidateId);
        if (!chosen) { counts.skipped++; continue; }
        Object.assign(chosen, { status: 'approved', review });
        reject(open.filter((t: any) => t !== chosen));
      } else if (d.action === 'custom') {
        if (!d.concept || !d.match) { counts.skipped++; continue; }
        reject(open);
        file.terms.push({ term: d.term, concept: d.concept, match: d.match, status: 'approved', note: d.note || 'Chosen in human review.', provenance: { agent: reviewer, at: d.at, method: 'human-review' }, review });
      } else if (d.action === 'ignore') {
        reject(open);
        if (d.ignore === 'noise') file.noise = [...new Set([...(file.noise ?? []), d.term])].sort();
      } else reject(open);
      counts[d.action]++;
    }
    file.terms.sort((a: any, b: any) => a.term.localeCompare(b.term) || a.concept.localeCompare(b.concept) || a.status.localeCompare(b.status));
    fs.writeFileSync(f, JSON.stringify(file, null, 2) + '\n');
  }
  return counts;
}

/** A disputed approved mapping (auditor contradicted it) or a suspect approved term, with the evidence. */
export interface DisputeItem {
  key: string;
  kind: 'mapping' | 'term';
  product: string;
  version: string;
  subject: string;
  current: { concept: string; match: string; by: string; id?: string };
  suggested?: { concept: string; match: string };
  evidence: { kind: string; source: string; says: string }[];
  themes?: Record<string, { aliases: string[]; value: string }>;
  description?: string;
  note?: string;
}

export const disputeKey = (product: string, kind: string, subject: string) => `${product}__${kind}__${subject}`;

export function collectDisputes(root: string, scope: Scope, termFindings: { product: string; term: string; detail: string }[], valuesOf: (product: string, token: string) => { themes: Record<string, { aliases: string[]; value: string }>; description?: string }): DisputeItem[] {
  const out: DisputeItem[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const af = path.join(root, 'mappings', product, `${version}.audit.json`);
    if (!fs.existsSync(af)) continue;
    const audit = JSON.parse(fs.readFileSync(af, 'utf8'));
    const m = readMappings(root, product, version) as any;
    for (const v of audit.verdicts.filter((x: any) => x.verdict === 'contradicted' && !x.resolution)) {
      const cur = m.mappings.find((x: any) => x.id === v.mappingId && x.status === 'approved');
      if (!cur) continue;
      out.push({ key: disputeKey(product, 'mapping', v.token), kind: 'mapping', product, version, subject: v.token, current: { concept: cur.concept, match: cur.match, by: cur.review?.by ?? 'unknown', id: cur.id }, suggested: v.suggested, evidence: v.evidence, note: v.note, ...valuesOf(product, v.token) });
    }
    const tf = path.join(root, 'mappings', product, 'terms.json');
    const terms = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')).terms : [];
    for (const f of termFindings.filter((x) => x.product === product)) {
      const t = terms.find((x: any) => x.term === f.term && x.status === 'approved' && f.detail.includes(x.concept));
      if (!t) continue;
      out.push({ key: disputeKey(product, 'term', f.term), kind: 'term', product, version, subject: f.term, current: { concept: t.concept, match: t.match, by: t.review?.by ?? 'unknown' }, evidence: [{ kind: 'sibling', source: `mappings/${product}/${version}.mappings.json`, says: f.detail }] });
    }
  }
  return out;
}

export interface DisputeDecision { key: string; kind: 'mapping' | 'term'; product: string; subject: string; action: 'kept' | 'suggestion' | 'custom' | 'reject-term'; concept?: string; match?: string; note?: string; at: string }

/**
 * kept: the approved record stays; the verdict records the resolution. suggestion/custom: the approved mapping is
 * Superseded by a new Approved mapping from the reviewer. reject-term: the term becomes Rejected.
 */
export function applyDisputes(root: string, scope: Scope, decisions: DisputeDecision[], reviewer: string, suggestions: Map<string, { concept: string; match: string }>, disputedTerms: Map<string, string> = new Map()): Record<string, number> {
  const counts: Record<string, number> = { kept: 0, suggestion: 0, custom: 0, 'reject-term': 0, skipped: 0 };
  for (const [product, { version }] of Object.entries(scope.products)) {
    const mine = decisions.filter((d) => d.product === product);
    if (!mine.length) continue;
    const mp = path.join(root, 'mappings', product, `${version}.mappings.json`), ap = path.join(root, 'mappings', product, `${version}.audit.json`), tp = path.join(root, 'mappings', product, 'terms.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8')), audit = fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : { verdicts: [] }, terms = fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp, 'utf8')) : { terms: [] };
    for (const d of mine) {
      const review = { by: reviewer, at: d.at, ...(d.note ? { note: d.note } : {}) };
      if (d.kind === 'term') {
        // The disputed term is identified by word AND concept: a word may have several approved terms (one per facet).
        const disputed = disputedTerms.get(d.key);
        const t = terms.terms.find((x: any) => x.term === d.subject && x.status === 'approved' && (!disputed || x.concept === disputed));
        if (!t || !disputed) { counts.skipped++; continue; }
        if (d.action === 'reject-term') Object.assign(t, { status: 'rejected', review: { ...review, note: d.note ?? 'Rejected after audit: most of its own approved tokens disagree.' } });
        counts[d.action]++;
        continue;
      }
      const v = audit.verdicts.find((x: any) => x.token === d.subject && x.verdict === 'contradicted');
      const cur = v && m.mappings.find((x: any) => x.id === v.mappingId && x.status === 'approved');
      if (!cur) { counts.skipped++; continue; }
      if (d.action !== 'kept') {
        const target = d.action === 'suggestion' ? suggestions.get(d.key) : d.concept && d.match ? { concept: d.concept, match: d.match } : undefined;
        if (!target) { counts.skipped++; continue; }
        const id = 'm-' + crypto.createHash('sha1').update([d.subject, target.concept, target.match].join('|')).digest('hex').slice(0, 12);
        if (id === cur.id) { counts.skipped++; continue; }
        m.mappings = m.mappings.filter((x: any) => x.id !== id);
        m.mappings.push({ id, token: d.subject, concept: target.concept, match: target.match, confidence: 1, status: 'approved', rationale: d.note || `Changed after evidence audit (${audit.model}): ${v.evidence.map((e: any) => e.says).join(' ').slice(0, 300)}`, provenance: { agent: reviewer, at: d.at, method: 'audit-review' }, review });
        Object.assign(cur, { status: 'superseded', supersededBy: id });
      }
      v.resolution = { by: reviewer, at: d.at, action: d.action, ...(d.note ? { note: d.note } : {}) };
      counts[d.action]++;
    }
    m.mappings.sort((x: any, y: any) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id));
    fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
    if (fs.existsSync(ap)) fs.writeFileSync(ap, JSON.stringify(audit, null, 2) + '\n');
    if (fs.existsSync(tp)) fs.writeFileSync(tp, JSON.stringify(terms, null, 2) + '\n');
  }
  return counts;
}

/** One answer on a card: identical concept+match answers from several models merge into one option with all voters. */
export interface ReviewOption { concept?: string; match?: string; name?: string; registered?: boolean; usedBy?: string[]; voters: { model: string; confidence?: number; rationale: string; l6?: string[] }[]; recordId?: string; shape: string }
export interface ReviewExtras {
  options: ReviewOption[];
  preselect?: number;
  preselectWhy?: string;
  family?: { key: string; label: string; approved: { token: string; concept: string; match: string }[]; precedent?: { shape: string; count: number; of: number } };
  context: { property: 'fg' | 'bg' | 'border' | 'other'; modes: string[]; page: Record<string, string>; text: Record<string, string>; pair?: { token: string; values: Record<string, string> } };
}

const lumOf = (v?: string) => { const m = /^#([0-9a-f]{6})/i.exec(v ?? ''); if (!m) return undefined; return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0); };
const contrastOf = (a?: string, b?: string) => { const [x, y] = [lumOf(a), lumOf(b)]; if (x === undefined || y === undefined) return 0; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const words = (name: string) => name.split(/[.\-_]/).flatMap((s) => s.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [s]);
/** A concept and match with the facets that vary within a family (hue, emphasis) wildcarded: "the same kind of answer". */
export const shapeOf = (concept: string | undefined, match: string | undefined) => concept ? concept.split('/').map((s) => s.replace(/^(hue|emphasis)-.*/, '$1-*')).join('/') + ' ' + match : '(no concept)';

/**
 * Add what a reviewer needs to decide fast: merged options with all three votes, the family of sibling tokens and
 * how its approved members were mapped (the precedent), a preselected option, and colors to draw the token in use.
 */
export function enrichQueue(root: string, scope: Scope, items: QueueItem[], third: (product: string) => Map<string, any>, value: (product: string, token: string, mode: string) => string | undefined, near: (product: string, token: string) => string[], describe: (concept: string) => { name?: string; registered: boolean } = () => ({ registered: true })): (QueueItem & ReviewExtras)[] {
  const out: (QueueItem & ReviewExtras)[] = [];
  // Which systems use each concept in an approved mapping (ADR 0019: reuse first).
  const usage = new Map<string, Set<string>>();
  for (const [product, { version }] of Object.entries(scope.products)) for (const x of ((readMappings(root, product, version) as any)?.mappings ?? [])) if (x.status === 'approved') (usage.get(x.concept) ?? usage.set(x.concept, new Set()).get(x.concept)!).add(product);
  for (const [product, { version }] of Object.entries(scope.products)) {
    const mine = items.filter((i) => i.product === product);
    if (!mine.length) continue;
    const m = readMappings(root, product, version) as any;
    const approved = (m.mappings ?? []).filter((x: any) => x.status === 'approved') as { token: string; concept: string; match: string }[];
    const approvedU = new Set<string>((m.unmapped ?? []).filter((x: any) => x.status === 'approved').map((x: any) => x.token));
    const universe = [...new Set([...approved.map((x) => x.token), ...approvedU, ...mine.map((i) => i.token)])].map((t) => ({ t, w: words(t) }));
    const c = third(product);
    const pageTok = approved.find((x) => x.concept === 'dsi:concept/color/usage-page/property-background')?.token;
    const textTok = approved.filter((x) => /\/property-(text|foreground)$/.test(x.concept) && x.concept.split('/').length <= 4).sort((a, b) => a.concept.length - b.concept.length || a.token.length - b.token.length)[0]?.token;
    for (const item of mine) {
      // Options
      const options: ReviewOption[] = [];
      const add = (concept: string | undefined, match: string | undefined, voter: ReviewOption['voters'][number], recordId?: string) => {
        const o = options.find((x) => x.concept === concept && x.match === match);
        if (o) { o.voters.push(voter); o.recordId ??= recordId; } else options.push({ concept, match, voters: [voter], recordId, shape: shapeOf(concept, match) });
      };
      for (const x of item.candidates) add(x.kind === 'mapping' ? x.concept : undefined, x.kind === 'mapping' ? x.match : undefined, { model: x.model, confidence: x.confidence, rationale: x.rationale, l6: lintRationale(x.rationale ?? '') }, x.kind === 'mapping' ? x.id : x.id);
      const cp = c.get(item.token);
      if (cp) add(cp.concept ?? undefined, cp.concept ? cp.match : undefined, { model: cp.model ?? 'third opinion', confidence: cp.confidence, rationale: cp.rationale ?? '', l6: lintRationale(cp.rationale ?? '') });
      for (const o of options) if (o.concept) { const d = describe(o.concept); o.name = d.name; o.registered = d.registered; o.usedBy = [...(usage.get(o.concept) ?? [])].sort(); }
      options.sort((a, b) => b.voters.length - a.voters.length || Number(!!b.registered) - Number(!!a.registered) || (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0));
      // Family: the word position whose variation has the most siblings (later positions win ties).
      const w = words(item.token);
      let best: { i: number; sibs: string[] } | undefined;
      for (let i = 0; i < w.length; i++) {
        const sibs = universe.filter((u) => u.t !== item.token && u.w.length === w.length && u.w.every((x, j) => j === i || x === w[j])).map((u) => u.t);
        if (sibs.length && (!best || sibs.length >= best.sibs.length)) best = { i, sibs };
      }
      let family: ReviewExtras['family'];
      if (best) {
        const label = w.map((x, j) => (j === best!.i ? '*' : x)).join(' ');
        const fam = approved.filter((x) => best!.sibs.includes(x.token));
        const tally = new Map<string, number>();
        for (const x of fam) tally.set(shapeOf(x.concept, x.match), (tally.get(shapeOf(x.concept, x.match)) ?? 0) + 1);
        const top = [...tally].sort((a, b) => b[1] - a[1])[0];
        family = { key: product + ' ' + label, label, approved: fam.slice(0, 12).map(({ token, concept, match }) => ({ token, concept, match })), ...(top && top[1] * 2 > fam.length ? { precedent: { shape: top[0], count: top[1], of: fam.length } } : {}) };
      }
      // Preselect: the option matching the family precedent, else a majority (2+ votes), else none.
      let preselect: number | undefined, preselectWhy: string | undefined;
      const p = family?.precedent ? options.findIndex((o) => o.shape === family!.precedent!.shape) : -1;
      if (p >= 0) { preselect = p; preselectWhy = `matches ${family!.precedent!.count} of ${family!.precedent!.of} approved siblings`; }
      else if (options[0]?.voters.length >= 2) { preselect = 0; preselectWhy = `${options[0].voters.length} of ${options.reduce((n, o) => n + o.voters.length, 0)} models`; }
      else { const shared = options.filter((o) => o.registered && (o.usedBy?.length ?? 0) >= 2); if (shared.length === 1) { preselect = options.indexOf(shared[0]); preselectWhy = `the only shared concept (${shared[0].usedBy!.join(', ')})`; } }
      // Context
      const ref = options[preselect ?? 0]?.concept ?? '';
      const property = /property-(text|icon|foreground|link)/.test(ref) ? 'fg' : /property-(border|divider|outline|focus-ring|stroke)/.test(ref) ? 'border' : /property-(background|fill|surface)/.test(ref) ? 'bg' : 'other';
      const themes = Object.keys(item.themes);
      const modes = themes.includes('light') && themes.includes('dark') ? ['light', 'dark'] : themes.slice(0, 2);
      const vals = (t?: string) => Object.fromEntries(modes.map((md) => [md, t ? value(product, t, md) ?? '' : '']));
      let pair: ReviewExtras['context']['pair'];
      if (property === 'fg' || property === 'border') {
        const cands = [/\b(text|icon|border)\b/, /(Foreground|Stroke)/, /(content|border)/, /\bfg(Color)?\b/].map((re) => item.token.replace(re, (s) => (/[A-Z]/.test(s[0]) ? 'Background' : s.startsWith('fg') ? 'bgColor' : 'background')));
        // Among the sibling backgrounds, the one this foreground reads best on is its likely pair.
        const md = modes[0], fg = value(product, item.token, md);
        const pool = [...new Set(cands.filter((t) => t !== item.token).flatMap((t) => [t, t.replace(/[.-](default|rest|bolder|bold|boldest|subtle|subtler|subtlest|muted|emphasis|strong)$/, '')]).flatMap((t) => near(product, t)))].filter((t) => t !== item.token).filter((t) => !/(hover|pressed|active|selected|disabled)/i.test(t));
        const hit = pool.map((t) => ({ t, c: contrastOf(fg, value(product, t, md)) })).sort((a, b) => b.c - a.c)[0];
        if (hit && hit.c > 0) pair = { token: hit.t, values: vals(hit.t) };
      }
      out.push({ ...item, options, preselect, preselectWhy, family, context: { property, modes, page: vals(pageTok), text: vals(textTok), pair } });
    }
  }
  return out;
}
