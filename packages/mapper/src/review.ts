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
export function renderPage(root: string, items: QueueItem[], ontology: unknown, generatedAt: string, termItems: TermQueueItem[] = []): string {
  const tpl = fs.readFileSync(path.join(root, 'packages/mapper/review/review.html'), 'utf8');
  const data = JSON.stringify({ generatedAt, items, termItems, ontology }).replaceAll('</', '<\\/');
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
