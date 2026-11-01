// L4 audit of registered concept definitions (docs/controlled-language.md section 6): each is either the generated
// frame for its IRI, or a hand-written sentence of at most 25 words with no product names.
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology, parseConcept, conceptDefinition, conceptName, readLexicon } from './index.ts';

const root = process.argv[2] ?? '.';
const o = await loadOntology(path.join(root, 'ontology'));
const lex = readLexicon(root);
const reg = JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as any[];
const products = fs.readdirSync(path.join(root, 'catalog')).map((f) => f.replace(/\.json$/, '')).concat(['Material', 'Carbon', 'Polaris', 'Atlassian', 'Primer', 'Spectrum', 'Fluent', 'GitHub', 'Shopify', 'Adobe', 'IBM', 'Microsoft']);
const productRe = new RegExp(`\\b(${products.join('|')})\\b`, 'i');
const out: Record<string, string[]> = {};
const add = (k: string, s: string) => (out[k] ??= []).push(s);
for (const c of reg) {
  const p = parseConcept(o, c.id);
  if (typeof p === 'string') { add('L1 invalid IRI', `${c.id}: ${p}`); continue; }
  const gen = conceptDefinition(lex, p), name = conceptName(lex, p);
  const d = String(c.definition ?? '');
  if (!d) { add('missing definition', c.id); continue; }
  if (c.prefLabel !== name) add('name differs from generated L3 (override)', `${c.prefLabel} | generated: ${name}`);
  if (d === gen) continue;
  const words = d.split(/\s+/).length;
  if (words > 25) add('hand-written over 25 words', `${c.id}: ${words} words`);
  if (productRe.test(d)) add('hand-written names a product', `${c.id}: ${d}`);
  if (!/^[A-Z]/.test(d) || !/\.$/.test(d)) add('hand-written not one sentence', `${c.id}: ${d}`);
  add('hand-written (differs from frame)', `${c.id}: "${d}" | frame: "${gen}"`);
}
for (const [k, v] of Object.entries(out)) { console.log(`${v.length}  ${k}`); for (const x of v.slice(0, 6)) console.log(`     ${x}`); }
console.log(`${reg.length} registered concepts checked`);
