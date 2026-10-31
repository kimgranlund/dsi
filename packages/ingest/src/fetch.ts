import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface Fetched { dir: string; integrity: string; tarball: string }

/**
 * Download an exact npm package version into the cache and unpack it.
 * Never runs package scripts: npm pack only downloads, tar only extracts.
 */
export function fetchNpm(cacheRoot: string, name: string, version: string): Fetched {
  const slug = `${name.replace('@', '').replace('/', '__')}@${version}`;
  const dest = path.join(cacheRoot, 'npm', slug);
  const meta = path.join(dest, 'pack.json');
  if (!fs.existsSync(meta)) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const out = execFileSync('npm', ['pack', `${name}@${version}`, '--json', '--ignore-scripts', '--pack-destination', dest], { encoding: 'utf8' });
    const [info] = JSON.parse(out) as { filename: string; integrity: string; version: string }[];
    if (info.version !== version) throw new Error(`npm returned ${info.version}, expected ${version}`);
    execFileSync('tar', ['-xzf', path.join(dest, info.filename), '-C', dest]);
    fs.writeFileSync(meta, JSON.stringify({ integrity: info.integrity, tarball: info.filename }));
  }
  const { integrity, tarball } = JSON.parse(fs.readFileSync(meta, 'utf8'));
  return { dir: path.join(dest, 'package'), integrity, tarball };
}
