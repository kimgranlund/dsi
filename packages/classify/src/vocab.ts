import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createAjv, inScheme, type Ontology } from '@dsi/schema';
import { facetValue, words, type Term, type TermsFile } from './classify.ts';

export interface TermProposal { term: string; concept?: string; match?: string; confidence?: number; ignore?: string; rationale: string }
export interface TermProposalFile { packet: string; role: 'a' | 'b'; model: string; at: string; terms: TermProposal[] }

/** Words and 2-3 word sequences in the given token paths (noise removed), with counts and examples. */
export function vocabulary(paths: string[], noise: string[]) {
  const ns = new Set(noise);
  const seen = new Map<string, { count: number; examples: string[] }>();
  for (const p of paths) {
    const w = words(p).filter((x) => !ns.has(x) && !/^\d+$/.test(x));
    const grams = new Set<string>();
    for (let i = 0; i < w.length; i++) for (let n = 1; n <= 3 && i + n <= w.length; n++) grams.add(w.slice(i, i + n).join('-'));
    for (const g of grams) { const e = seen.get(g) ?? { count: 0, examples: [] }; e.count++; if (e.examples.length < 4) e.examples.push(p); seen.set(g, e); }
  }
  // Single words always; sequences only when they recur (a sequence seen once is just one token name).
  return [...seen].filter(([g, e]) => !g.includes('-') || e.count >= 2).sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b)).map(([term, e]) => ({ term, ...e }));
}

export function readTermProposals(file: string, o: Ontology, requiredWords: Set<string>): TermProposalFile {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = createAjv().getSchema('https://dsi.nonoun.io/schema/term-proposals.schema.json')!;
  if (!v(data)) throw new Error(`${file}: ${v.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  const pf = data as TermProposalFile;
  for (const t of pf.terms) {
    if (!t.concept) continue;
    const fv = facetValue(t.concept);
    if (!fv || !inScheme(o, t.concept, `dsi:scheme/${fv.facet}`)) throw new Error(`${file}: ${t.term}: ${t.concept} is not a value of a facet scheme`);
    if (o.deprecated.has(`https://dsi.nonoun.io/ontology/${fv.facet}/${fv.value}`)) throw new Error(`${file}: ${t.term}: ${t.concept} is deprecated`);
  }
  const answered = new Set(pf.terms.map((t) => t.term));
  const missing = [...requiredWords].filter((w) => !answered.has(w));
  if (missing.length) throw new Error(`${file}: ${missing.length} vocabulary word(s) unanswered, e.g. ${missing.slice(0, 5).join(', ')}`);
  return pf;
}

const key = (t: TermProposal) => (t.concept ? `${t.term}|${t.concept}|${t.match}` : `${t.term}|ignore|${t.ignore}`);
const facetKey = (term: string, concept: string) => `${term}|${facetValue(concept)?.facet}`;

/**
 * Agreement: a mapped term with the same facet, value and match from both agents, both confidence >= 0.85, is
 * Approved; both ignoring a word as noise adds it to `noise`. Everything else is Proposed (each answer kept) for
 * human review. Approved and rejected terms already in the file are never changed.
 */
export function mergeTermProposals(file: TermsFile, a: TermProposalFile, b: TermProposalFile, now = new Date().toISOString()) {
  if (a.model === b.model) throw new Error(`both proposal files come from ${a.model}; agreement needs two different models`);
  const settled = new Set(file.terms.filter((t) => t.status !== 'proposed').map((t) => facetKey(t.term, t.concept)));
  const A = new Map(a.terms.map((t) => [key(t), t])), B = new Map(b.terms.map((t) => [key(t), t]));
  const prov = (pf: TermProposalFile) => ({ agent: 'dsi-classify', model: pf.model, at: pf.at, method: 'terms-v1' });
  const terms: Term[] = file.terms.filter((t) => t.status !== 'proposed' || t.provenance.method === 'derive-from-approved-mappings');
  const noise = new Set(file.noise ?? []);
  const counts = { approved: 0, noise: 0, proposed: 0 };
  const queued = new Set<string>();
  for (const [k, ta] of A) {
    const tb = B.get(k);
    if (ta.concept) {
      if (settled.has(facetKey(ta.term, ta.concept))) continue;
      if (tb && Math.min(ta.confidence!, tb.confidence!) >= 0.85) {
        terms.push({ term: ta.term, concept: ta.concept, match: ta.match!, status: 'approved', note: ta.rationale, provenance: prov(a), review: { by: 'agreement', at: now, note: `${a.model} and ${b.model} agreed independently` } } as Term);
        counts.approved++;
      }
    } else if (tb && ta.ignore === 'noise') { noise.add(ta.term); counts.noise++; }
  }
  // Remove derived candidates that agreement just settled.
  const approvedKeys = new Set(terms.filter((t) => t.status === 'approved').map((t) => facetKey(t.term, t.concept)));
  const kept = terms.filter((t) => t.status !== 'proposed' || !approvedKeys.has(facetKey(t.term, t.concept)));
  for (const [pf, other] of [[a, B], [b, A]] as const) {
    for (const t of pf.terms) {
      if (!t.concept) continue;
      if (approvedKeys.has(facetKey(t.term, t.concept)) || settled.has(facetKey(t.term, t.concept))) continue;
      // Both agents agreeing below the confidence bar is one queued record, not two.
      const same = kept.find((x) => x.status === 'proposed' && x.provenance.method === 'terms-v1' && x.term === t.term && x.concept === t.concept && x.match === t.match);
      if (same) { if (same.provenance.model !== pf.model && !/both agents/.test(same.note ?? '')) same.note = `${same.note}; both agents gave this, ${pf.model} at confidence ${t.confidence}`; continue; }
      kept.push({ term: t.term, concept: t.concept, match: t.match!, status: 'proposed', note: `${t.rationale} (confidence ${t.confidence}${other.has(key(t)) ? '' : '; the other agent disagreed'})`, provenance: prov(pf) } as Term);
      queued.add(t.term);
    }
  }
  counts.proposed = queued.size;
  return { file: { ...file, noise: [...noise].sort(), terms: kept.sort((x, y) => x.term.localeCompare(y.term) || x.concept.localeCompare(y.concept) || x.status.localeCompare(y.status)) }, counts };
}

export const termId = (product: string, t: { term: string; concept: string; match: string; provenance: { model?: string; agent: string } }) =>
  't-' + crypto.createHash('sha1').update([product, t.term, t.concept, t.match, t.provenance.model ?? t.provenance.agent].join('|')).digest('hex').slice(0, 12);

export const packetPath = (runDir: string, product: string, role: string) => path.join(runDir, `${product}.${role}.packet.json`);
