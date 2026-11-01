import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildDatabase, exportSite } from '../src/index.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-db-'));
const dbFile = path.join(dir, 'dsi.sqlite');
const counts = await buildDatabase(REPO, dbFile);
const db = new DatabaseSync(dbFile, { readOnly: true });
const one = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as Record<string, any>;

test('only approved records reach the database', () => {
  let approved = 0, other = 0;
  for (const p of fs.readdirSync(path.join(REPO, 'sources')).filter((d) => fs.existsSync(path.join(REPO, 'sources', d, 'source.json')))) {
    const v = JSON.parse(fs.readFileSync(path.join(REPO, 'sources', p, 'source.json'), 'utf8')).package.version;
    for (const m of JSON.parse(fs.readFileSync(path.join(REPO, 'mappings', p, `${v}.mappings.json`), 'utf8')).mappings) m.status === 'approved' ? approved++ : other++;
  }
  assert.ok(other > 0, 'the repo has superseded or rejected records to exclude');
  assert.equal(counts.mappings, approved);
  assert.equal(one("SELECT count(*) n FROM mappings WHERE status != 'approved'").n, 0);
});

test('coverage holds a cell per concept, product and mode, and never a value for unknown', () => {
  const modes = one('SELECT count(*) n FROM modes').n;
  const colorConcepts = one("SELECT count(*) n FROM concepts WHERE grp = 'color'").n;
  assert.equal(counts.coverage, colorConcepts * modes);
  assert.equal(one("SELECT count(*) n FROM coverage WHERE status IN ('unknown','absent') AND display IS NOT NULL").n, 0);
});

test('full-text search finds tokens by native vocabulary and concepts by label', () => {
  const tokenHit = db.prepare("SELECT key FROM search WHERE search MATCH 'critical'").all().map((r: any) => r.key);
  assert.ok(tokenHit.includes('polaris/color-text-critical'));
  const conceptHit = db.prepare("SELECT key FROM search WHERE search MATCH 'danger' AND kind = 'concept'").all().map((r: any) => r.key);
  assert.ok(conceptHit.includes('dsi:concept/color/intent-danger/property-text'));
});

test('site export: concepts carry only answered cells; token files keep alias chains', () => {
  const out = path.join(dir, 'site');
  exportSite(REPO, dbFile, out);
  const concepts = JSON.parse(fs.readFileSync(path.join(out, 'concepts.json'), 'utf8'));
  const dt = concepts.find((c: any) => c.name === 'danger-text');
  assert.equal(dt.cells.carbon.dark.t, 'text-error');
  // ADR 0006 amended: Material error (mapped to the broader Danger) answers danger text, flagged nearest.
  assert.deepEqual([dt.cells.material.light.s, dt.cells.material.light.t, dt.cells.material.light.via], ['nearest', 'md.sys.color.error', 'less-specific']);
  const carbon = JSON.parse(fs.readFileSync(path.join(out, 'tokens.carbon.json'), 'utf8'));
  const se = carbon.find((t: any) => t.p === 'support-error');
  assert.deepEqual(se.v.g100, ['#fa4d56', ['red.50']]);
  assert.ok(fs.existsSync(path.join(out, 'canonical/carbon.dark.css')));
});
