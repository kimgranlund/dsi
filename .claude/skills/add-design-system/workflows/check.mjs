// Syntax check for the stage workflows. `node --check` rejects them: the Workflow runtime runs the body as an async
// function (top-level await and return), so this compiles each body the same way and checks meta.
// Usage: node .claude/skills/add-design-system/workflows/check.mjs [file.js ...]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
let failed = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    if (!src.startsWith('export const meta = {')) throw new Error('must begin with `export const meta = {`');
    const end = src.indexOf('\n}\n');
    const meta = vm.runInNewContext('(' + src.slice('export const meta = '.length, end + 2) + ')'); // pure literal or it throws
    if (!meta.name || !meta.description) throw new Error('meta needs name and description');
    new vm.Script(`(async () => {\n${src.replace('export const meta', 'const meta')}\n})`, { filename: file });
    const titles = new Set((meta.phases ?? []).map((p) => p.title));
    const used = [...src.matchAll(/phase\('([^']+)'\)|phase: '([^']+)'/g)].map((m) => m[1] ?? m[2]);
    const stray = used.filter((t) => !titles.has(t));
    if (stray.length) throw new Error(`phase titles not in meta.phases: ${[...new Set(stray)].join(', ')}`);
    if (/Date\.now\(\)|Math\.random\(\)|new Date\(\)/.test(src)) throw new Error('Date.now/Math.random/new Date() are not allowed');
    console.log(`OK ${path.basename(file)} (${meta.name})`);
  } catch (e) { failed++; console.error(`FAIL ${path.basename(file)}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
