#!/usr/bin/env node
// Register concepts (ADR 0019): `register.ts <root> --approved` adds every concept used by an approved mapping that
// is not registered yet; `register.ts <root> <iri>...` adds the given ones.
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from './ontology.ts';
import { registerConcepts } from './concepts.ts';

const root = path.resolve(process.argv[2] ?? '.');
const o = await loadOntology(path.join(root, 'ontology'));
let iris = process.argv.slice(3).filter((a) => !a.startsWith('--'));
if (process.argv.includes('--approved')) {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mappings.json') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(root, 'mappings'))) for (const m of JSON.parse(fs.readFileSync(f, 'utf8')).mappings) if (m.status === 'approved') iris.push(m.concept);
}
const added = registerConcepts(root, o, iris);
console.log(`${added.length} concept(s) registered`);
