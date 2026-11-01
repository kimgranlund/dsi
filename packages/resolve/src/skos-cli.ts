#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { loadNative } from './native.ts';
import { facetLabels, skosGraph } from './skos.ts';

// Usage (from the repo root): dsi-skos [product ...]  -> data/skos/<product>/<version>.jsonld
const root = process.cwd();
const products = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'sources')).filter((p) => fs.existsSync(path.join(root, 'sources', p, 'source.json')));
const o = await loadOntology(path.join(root, 'ontology'));
const labels = facetLabels(root);
const read = (p: string, fallback: unknown) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
for (const product of products) {
  const version = read(path.join(root, 'sources', product, 'source.json'), {}).package.version as string;
  const catalog = fs.readdirSync(path.join(root, 'catalog'), { recursive: true, encoding: 'utf8' }).map((f) => path.join(root, 'catalog', f)).filter((f) => f.endsWith(`/${product}.json`));
  const name = catalog.length ? read(catalog[0], {}).name : product;
  const maps = read(path.join(root, 'mappings', product, `${version}.mappings.json`), {});
  const terms = read(path.join(root, 'mappings', product, 'terms.json'), { terms: [] });
  const g = skosGraph(o, labels, { set: loadNative(root, product, version), mappings: maps.mappings ?? [], noEquivalent: maps.noEquivalent ?? [], terms: terms.terms, productName: name });
  const out = path.join(root, 'data/skos', product, `${version}.jsonld`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(g, null, 1) + '\n');
  const nodes = (g['@graph'] as unknown[]).length;
  console.log(`${product}@${version}: ${nodes} nodes -> ${path.relative(root, out)}`);
}
