#!/usr/bin/env node
import path from 'node:path';
import { validateRepo } from './validate.ts';

const root = path.resolve(process.argv[2] ?? '.');
const issues = await validateRepo({ root });
for (const i of issues) console.log(`${i.file}: ${i.message}`);
console.log(issues.length ? `\n${issues.length} issue(s)` : 'dsi-validate: ontology, catalog, sources, mappings, data/native, data/skos OK');
process.exit(issues.length ? 1 : 0);
