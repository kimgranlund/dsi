import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createAjv, parseConcept, type Ontology } from '@dsi/schema';
import { mappingPath, readMappings, type MappingFileShape } from './packet.ts';

export const APPROVE_AT = 0.7; // ADR 0005 amended 2026-11-01 (was 0.85)
/** With the classifier as a third vote (approved terms only, name fully explained, same concept), the bar drops to this. */
export const APPROVE_WITH_CLASSIFIER_AT = 0.6;

/** The classifier's concept per token, computed from approved terms only and only when the whole name is explained. */
export type ClassifierVotes = Map<string, string>;

type Proposal = { token: string; concept: string; match: string; confidence: number; rationale: string } | { token: string; unmapped: true; rationale: string };
export interface ProposalFile { packet: string; role: 'a' | 'b' | 'c'; model: string; at: string; proposals: Proposal[] }

const idOf = (...parts: string[]) => 'm-' + crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const isMap = (p: Proposal): p is Extract<Proposal, { concept: string }> => 'concept' in p;

export function readProposals(file: string, o: Ontology, expectedTokens: Set<string>): ProposalFile {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = createAjv().getSchema('https://dsi.nonoun.io/schema/mapper-proposals.schema.json')!;
  if (!v(data)) throw new Error(`${file}: ${v.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  const pf = data as ProposalFile;
  const seen = new Set<string>();
  for (const p of pf.proposals) {
    if (!expectedTokens.has(p.token)) throw new Error(`${file}: token ${p.token} is not in the packet`);
    if (seen.has(p.token)) throw new Error(`${file}: token ${p.token} answered twice`);
    seen.add(p.token);
    if (isMap(p)) { const r = parseConcept(o, p.concept); if (typeof r === 'string') throw new Error(`${file}: ${p.token}: ${p.concept} ${r}`); }
  }
  const missing = [...expectedTokens].filter((t) => !seen.has(t));
  if (missing.length) throw new Error(`${file}: ${missing.length} packet token(s) unanswered, e.g. ${missing.slice(0, 3).join(', ')}`);
  return pf;
}

export interface MergeResult { approved: number; approvedWithClassifier: number; approvedUnmapped: number; queued: number; skippedSettled: number; file: string }

/**
 * Two-agent agreement. Approved when both agents give the same concept AND match type with confidence >= APPROVE_AT,
 * or both say unmapped. Anything else becomes Proposed records for human review. Approved and rejected records are
 * never modified; an agreement that equals a rejected answer stays Proposed.
 */
export function merge(root: string, product: string, version: string, implementation: string | undefined, a: ProposalFile, b: ProposalFile, method: string, now = new Date().toISOString(), votes: ClassifierVotes = new Map()): MergeResult {
  if (a.model === b.model) throw new Error(`both proposal files come from ${a.model}; agreement needs two different models`);
  const file: MappingFileShape & { mappings: any[]; unmapped: any[] } = { product, ...(implementation ? { implementation } : {}), sourceVersion: version, mappings: [], unmapped: [], ...(readMappings(root, product, version) ?? {}) } as any;
  file.mappings ??= [];
  file.unmapped ??= [];
  const settled = new Set([...file.mappings.filter((m) => m.status === 'approved').map((m) => m.token), ...file.unmapped.filter((u) => u.status === 'approved').map((u) => u.token)]);
  const rejected = new Set(file.mappings.filter((m) => m.status === 'rejected').map((m) => `${m.token}|${m.concept}|${m.match}`));
  const byToken = (pf: ProposalFile) => new Map(pf.proposals.map((p) => [p.token, p]));
  const A = byToken(a), B = byToken(b);
  const prov = (pf: ProposalFile) => ({ agent: 'dsi-mapper', model: pf.model, at: pf.at, method });
  const res: MergeResult = { approved: 0, approvedWithClassifier: 0, approvedUnmapped: 0, queued: 0, skippedSettled: 0, file: path.relative(root, mappingPath(root, product, version)) };

  for (const token of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    if (settled.has(token)) { res.skippedSettled++; continue; }
    const pa = A.get(token), pb = B.get(token);
    // Earlier proposed records for this token are replaced by this run's outcome.
    const fresh: any[] = [];
    const agreementNote = `${a.model} and ${b.model} agreed independently`;
    const agree = pa && pb && isMap(pa) && isMap(pb) && pa.concept === pb.concept && pa.match === pb.match && !rejected.has(`${token}|${pa.concept}|${pa.match}`) ? pa : undefined;
    const conf = agree && isMap(pb!) ? Math.min(agree.confidence, pb.confidence) : 0;
    const classifierAgrees = !!agree && (agree.match === 'exact' || agree.match === 'close') && votes.get(token) === agree.concept;
    if (agree && (conf >= APPROVE_AT || (classifierAgrees && conf >= APPROVE_WITH_CLASSIFIER_AT))) {
      const third = classifierAgrees && conf < APPROVE_AT;
      fresh.push({ id: idOf(token, agree.concept, agree.match), token, concept: agree.concept, match: agree.match, confidence: conf, status: 'approved', rationale: agree.rationale, provenance: prov(a), review: { by: third ? 'agreement+classifier' : 'agreement', at: now, note: third ? `${agreementNote}; the classifier reached the same concept from approved terms` : agreementNote } });
      if (third) res.approvedWithClassifier++; else res.approved++;
    } else if (pa && pb && !isMap(pa) && !isMap(pb)) {
      file.unmapped = file.unmapped.filter((u) => u.token !== token || u.status === 'approved');
      file.unmapped.push({ token, status: 'approved', rationale: pa.rationale, provenance: prov(a), review: { by: 'agreement', at: now, note: `${agreementNote}: no concept fits. Other rationale: ${pb.rationale}` } });
      res.approvedUnmapped++;
    } else {
      const seen = new Set<string>();
      for (const [p, pf] of [[pa, a], [pb, b]] as const) {
        if (!p) continue;
        if (!isMap(p)) {
          file.unmapped = file.unmapped.filter((u) => u.token !== token || u.status === 'approved');
          file.unmapped.push({ token, status: 'proposed', rationale: p.rationale, provenance: prov(pf) });
          continue;
        }
        const id = idOf(token, p.concept, p.match);
        if (seen.has(id)) continue;
        seen.add(id);
        const prior = rejected.has(`${token}|${p.concept}|${p.match}`) ? ' (matches a previously rejected answer)' : '';
        fresh.push({ id, token, concept: p.concept, match: p.match, confidence: p.confidence, status: 'proposed', rationale: p.rationale + prior, provenance: prov(pf) });
      }
      res.queued++;
    }
    file.mappings = file.mappings.filter((m) => m.token !== token || m.status === 'approved' || m.status === 'rejected' || m.status === 'superseded');
    file.mappings.push(...fresh);
    // Once a token is settled either way, earlier rounds' proposals of the other kind are stale.
    if (fresh.some((f) => f.status === 'approved')) file.unmapped = file.unmapped.filter((u) => u.token !== token || u.status !== 'proposed');
    if (file.unmapped.some((u) => u.token === token && u.status === 'approved')) file.mappings = file.mappings.filter((m) => m.token !== token || m.status !== 'proposed');
  }
  file.mappings.sort((x, y) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id));
  file.unmapped.sort((x, y) => x.token.localeCompare(y.token));
  if (!file.unmapped.length) delete (file as any).unmapped;
  const out = mappingPath(root, product, version);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  return res;
}
