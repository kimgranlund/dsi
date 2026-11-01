import crypto from 'node:crypto';
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
export function collectQueue(root: string, scope: Scope, runDir: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const m = readMappings(root, product, version) as any;
    if (!m) continue;
    const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.a.packet.json`), 'utf8'));
    const info = new Map<string, any>(packet.tokens.map((t: any) => [t.token, t]));
    const settled = new Set([...(m.mappings ?? []).filter((x: any) => x.status === 'approved').map((x: any) => x.token), ...(m.unmapped ?? []).filter((x: any) => x.status === 'approved').map((x: any) => x.token)]);
    const byToken = new Map<string, QueueItem['candidates']>();
    const push = (t: string, c: QueueItem['candidates'][number]) => (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(c);
    for (const x of m.mappings ?? []) if (x.status === 'proposed' && !settled.has(x.token)) push(x.token, { id: x.id, kind: 'mapping', model: x.provenance.model, concept: x.concept, match: x.match, confidence: x.confidence, rationale: x.rationale });
    for (const x of m.unmapped ?? []) if (x.status === 'proposed' && !settled.has(x.token)) push(x.token, { id: 'u-' + crypto.createHash('sha1').update(x.token + x.provenance.model).digest('hex').slice(0, 12), kind: 'unmapped', model: x.provenance.model, rationale: x.rationale });
    for (const [token, candidates] of [...byToken].sort(([a], [b]) => a.localeCompare(b))) {
      const t = info.get(token);
      if (!t) throw new Error(`${product}: queued token ${token} is missing from ${runDir}; pass the latest run`);
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
export function renderPage(root: string, items: QueueItem[], ontology: unknown, generatedAt: string, termItems: TermQueueItem[] = [], disputes: DisputeItem[] = []): string {
  const tpl = fs.readFileSync(path.join(root, 'packages/mapper/review/review.html'), 'utf8');
  const data = JSON.stringify({ generatedAt, items, termItems, disputes, ontology }).replaceAll('</', '<\\/');
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
export function applyDisputes(root: string, scope: Scope, decisions: DisputeDecision[], reviewer: string, suggestions: Map<string, { concept: string; match: string }>): Record<string, number> {
  const counts: Record<string, number> = { kept: 0, suggestion: 0, custom: 0, 'reject-term': 0, skipped: 0 };
  for (const [product, { version }] of Object.entries(scope.products)) {
    const mine = decisions.filter((d) => d.product === product);
    if (!mine.length) continue;
    const mp = path.join(root, 'mappings', product, `${version}.mappings.json`), ap = path.join(root, 'mappings', product, `${version}.audit.json`), tp = path.join(root, 'mappings', product, 'terms.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8')), audit = fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : { verdicts: [] }, terms = fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp, 'utf8')) : { terms: [] };
    for (const d of mine) {
      const review = { by: reviewer, at: d.at, ...(d.note ? { note: d.note } : {}) };
      if (d.kind === 'term') {
        const t = terms.terms.find((x: any) => x.term === d.subject && x.status === 'approved');
        if (!t) { counts.skipped++; continue; }
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
