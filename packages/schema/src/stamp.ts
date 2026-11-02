import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Version stamps on mapping records (ADR 0027). A mapping is a judgment against one state of the concept registry
 * (ontology/schemes) and one resolver: the stamp records which, as content hashes, so a later change to either shows
 * which judgments were made before it.
 */
const hashFiles = (files: string[]) => { const h = crypto.createHash('sha1'); for (const f of [...files].sort()) h.update(path.basename(f) + '\0' + fs.readFileSync(f)); return h.digest('hex').slice(0, 12); };

const list = (dir: string, keep: (f: string) => boolean) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(keep).map((f) => path.join(dir, f)) : []);

export function stampVersions(root: string): { registry: string; resolver: string } {
  return {
    registry: 'ontology@' + hashFiles(list(path.join(root, 'ontology/schemes'), (f) => f.endsWith('.jsonld'))),
    resolver: 'resolve@' + hashFiles(list(path.join(root, 'packages/resolve/src'), (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))),
  };
}

/**
 * Write a mappings file, stamping each record this write adds or changes. Records identical to the file on disk
 * keep what they have (unstamped history stays unstamped). A changed record that already carries a stamp keeps it
 * only when the stamp is current.
 */
export function writeMappingFile(root: string, file: string, data: { mappings?: any[]; [k: string]: unknown }): number {
  const before = new Map<string, string>();
  if (fs.existsSync(file)) for (const m of JSON.parse(fs.readFileSync(file, 'utf8')).mappings ?? []) before.set(m.id + '|' + m.status, JSON.stringify(m));
  const v = stampVersions(root);
  let n = 0;
  for (const m of data.mappings ?? []) {
    if (!m.provenance || before.get(m.id + '|' + m.status) === JSON.stringify(m)) continue;
    if (m.provenance.registry === v.registry && m.provenance.resolver === v.resolver) continue;
    m.provenance.registry = v.registry;
    m.provenance.resolver = v.resolver;
    n++;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return n;
}
