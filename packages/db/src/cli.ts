#!/usr/bin/env node
import path from 'node:path';
import { buildDatabase } from './build.ts';
import { exportSite } from './export.ts';

// Usage (from the repo root):
//   dsi-db build [out.sqlite]            build the query database (default .cache/db/dsi.sqlite)
//   dsi-db export [db] [out dir]          export the site's static data (default site/public/data)
const [cmd, a, b] = process.argv.slice(2);
const root = process.cwd();
const dbFile = path.resolve(a ?? '.cache/db/dsi.sqlite');
if (cmd === 'build') {
  console.log(`built ${path.relative(root, dbFile)}: ${JSON.stringify(buildDatabase(root, dbFile))}`);
} else if (cmd === 'export') {
  const out = path.resolve(b ?? 'site/public/data');
  const sizes = exportSite(root, dbFile, out);
  console.log(`exported ${path.relative(root, out)}: ${Object.entries(sizes).map(([k, v]) => `${k} ${Math.round(v / 1024)}KB`).join(', ')}`);
} else { console.error('usage: dsi-db build [out.sqlite] | export [db] [out dir]'); process.exit(2); }
