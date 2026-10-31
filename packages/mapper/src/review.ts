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
export function renderPage(root: string, items: QueueItem[], ontology: unknown, generatedAt: string): string {
  const tpl = fs.readFileSync(path.join(root, 'packages/mapper/review/review.html'), 'utf8');
  const data = JSON.stringify({ generatedAt, items, ontology }).replaceAll('</', '<\\/');
  return tpl.replace('/*__DATA__*/null', data);
}
