import fs from 'node:fs';
import path from 'node:path';

/**
 * Triage approved mappings that break a boundary test (.cache/boundary-conflicts.txt): where Jev's statement
 * judgement is reliable for the rule (B4, B6), it says whether the test or the approval is likely right.
 * B1 and B3 stay computed-only (Jev is weak there), so those conflicts are listed as "owner".
 */
export async function triageConflicts(root: string, scope: { products: Record<string, { version: string }> }, judge: (p: string, v: string, t: string, b: string) => Promise<{ decided?: boolean; margin: number; model: string }>) {
  const lines = fs.readFileSync(path.join(root, '.cache/boundary-conflicts.txt'), 'utf8').split('\n').filter(Boolean);
  const out: { product: string; token: string; rules: string; suggested: string; verdict: 'test' | 'approval' | 'unclear' | 'owner'; detail: string }[] = [];
  await Promise.all(lines.map(async (l) => {
    const m = /^(\S+) (.+?): (\S+) -> (.+)$/.exec(l);
    if (!m) return;
    const [, product, token, rules, suggested] = m;
    const rs = rules.split(',');
    const reliable = rs.filter((r) => r === 'B4' || r === 'B6');
    if (!reliable.length || rs.some((r) => r === 'B1' || r === 'B3')) { out.push({ product, token, rules, suggested, verdict: 'owner', detail: 'B1/B3: computed test only' }); return; }
    const votes: string[] = [];
    let verdict: 'test' | 'approval' | 'unclear' = 'test';
    for (const r of reliable) {
      const j = await judge(product, scope.products[product].version, token, r);
      // B4 test says NOT on-fill; B6 test result is in the suggested concept (foreground = statement true).
      const testSays = r === 'B4' ? false : /property-foreground/.test(suggested);
      votes.push(`${r} ${j.margin.toFixed(2)}`);
      if (j.decided === undefined) verdict = verdict === 'approval' ? 'approval' : 'unclear';
      else if (j.decided !== testSays) verdict = 'approval';
    }
    out.push({ product, token, rules, suggested, verdict, detail: votes.join('; ') });
  }));
  return out.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.product.localeCompare(b.product) || a.token.localeCompare(b.token));
}
