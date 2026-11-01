// Controlled-language sweep of open review items (docs/controlled-language.md): L1 grammar,
// registry status (Shared/New), L3 name collisions for new concepts, L6 rationale shape.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeConcept, parseConcept, conceptName, readLexicon, isRegistered, type Ontology } from '@dsi/schema';

export const lintRationale = (r: string): string[] => {
  const out: string[] = [];
  const n = r.trim().split(/\s+/).filter(Boolean).length;
  if (!n) return ['empty'];
  if (n > 40) out.push('over 40 words');
  if (!/\bEvidence:/.test(r)) out.push('no Evidence: sentence');
  if (/\b(probably|seems?|maybe|perhaps|likely|might|possibly)\b/i.test(r)) out.push('hedging word');
  return out;
};

type Item = { product: string; token: string; source: string; concept?: string; rationale: string };

export function sweep(root: string, o: Ontology, products: Record<string, { version: string }>, thirdRun?: string) {
  const lex = readLexicon(root);
  const items: Item[] = [];
  for (const [p, { version }] of Object.entries(products)) {
    const f = path.join(root, 'mappings', p, `${version}.mappings.json`);
    if (!fs.existsSync(f)) continue;
    const file = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const m of file.mappings ?? []) if (m.status === 'proposed') items.push({ product: p, token: m.token, source: m.provenance?.model ?? m.provenance?.agent ?? '?', concept: m.concept, rationale: (m.rationale ?? '').replace(/ \(matches a previously rejected answer\)$/, '') });
    for (const u of file.unmapped ?? []) if (u.status === 'proposed') items.push({ product: p, token: u.token, source: u.provenance?.model ?? '?', rationale: u.rationale ?? '' });
    if (thirdRun) {
      const tf = path.join(root, '.cache/mapper', thirdRun, `${p}.c.proposals.json`);
      if (fs.existsSync(tf)) {
        const open = new Set(items.filter((i) => i.product === p).map((i) => i.token));
        for (const x of JSON.parse(fs.readFileSync(tf, 'utf8')).proposals ?? []) if (open.has(x.token)) items.push({ product: p, token: x.token, source: 'third', concept: x.unmapped ? undefined : normalizeConcept(x.concept), rationale: x.rationale ?? '' });
      }
    }
  }
  // Registered names, for collision checks of new concepts.
  const registeredNames = new Map<string, string>();
  const reg = JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'));
  for (const c of reg['@graph'] ?? []) if (c.prefLabel) registeredNames.set(String(c.prefLabel).toLowerCase(), c.id);
  const report = { items: items.length, grammar: [] as string[], fresh: new Map<string, string>(), collisions: [] as string[], l6: new Map<string, number>(), l6Examples: [] as string[] };
  for (const i of items) {
    if (i.concept) {
      const pc = parseConcept(o, i.concept);
      if (typeof pc === 'string') { report.grammar.push(`${i.product} ${i.token} (${i.source}): ${i.concept}: ${pc}`); continue; }
      if (!isRegistered(o, i.concept)) {
        const name = conceptName(lex, pc);
        report.fresh.set(i.concept, name);
        const hit = registeredNames.get(name.toLowerCase());
        if (hit && hit !== i.concept) report.collisions.push(`${i.concept} -> "${name}" already names ${hit}`);
      }
    }
    const w = lintRationale(i.rationale);
    for (const x of w) report.l6.set(x, (report.l6.get(x) ?? 0) + 1);
    if (w.length && report.l6Examples.length < 12) report.l6Examples.push(`${i.product} ${i.token} (${i.source}) [${w.join(', ')}]: ${i.rationale.slice(0, 140)}`);
  }
  const bad = items.filter((i) => lintRationale(i.rationale).length).length;
  return { ...report, bad, fresh: [...report.fresh] };
}
