/** Scored answers: one per facet question (or per registry/noul question), with Jev's confidence. */
export interface Scored { item: string; product: string; tier: string; facet: string; gold: string; pred: string; confidence: number; correct: boolean }

export function isCorrect(gold: string | undefined, pred: string): boolean {
  return pred === 'none' ? !gold : (gold ?? '').split('+').includes(pred);
}

const pct = (x: number) => Math.round(x * 1000) / 10;

/** Expected calibration error over equal-width confidence bins. */
export function ece(xs: Scored[], bins = 10): number {
  if (!xs.length) return 0;
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const inBin = xs.filter((x) => Math.min(bins - 1, Math.floor(x.confidence * bins)) === b);
    if (!inBin.length) continue;
    const acc = inBin.filter((x) => x.correct).length / inBin.length;
    const conf = inBin.reduce((n, x) => n + x.confidence, 0) / inBin.length;
    e += (inBin.length / xs.length) * Math.abs(acc - conf);
  }
  return e;
}

export function summarize(xs: Scored[]) {
  const acc = (ys: Scored[]) => (ys.length ? pct(ys.filter((y) => y.correct).length / ys.length) : null);
  const facets = [...new Set(xs.map((x) => x.facet))];
  const items = [...new Set(xs.map((x) => x.item))];
  const byItem = new Map<string, Scored[]>();
  for (const x of xs) (byItem.get(x.item) ?? byItem.set(x.item, []).get(x.item)!).push(x);
  const joint = [...byItem.values()].map((ys) => ({ ok: ys.every((y) => y.correct), conf: Math.min(...ys.map((y) => y.confidence)), product: ys[0].product, tier: ys[0].tier }));
  const selective = (t: number) => { const kept = joint.filter((j) => j.conf >= t); return { threshold: t, coverage: pct(kept.length / (joint.length || 1)), accuracy: kept.length ? pct(kept.filter((j) => j.ok).length / kept.length) : null }; };
  const group = (key: 'product' | 'tier') => Object.fromEntries([...new Set(joint.map((j) => j[key]))].map((k) => { const js = joint.filter((j) => j[key] === k); return [k, { n: js.length, joint: pct(js.filter((j) => j.ok).length / js.length) }]; }));
  return {
    items: items.length,
    answers: xs.length,
    joint: pct(joint.filter((j) => j.ok).length / (joint.length || 1)),
    perFacet: Object.fromEntries(facets.map((f) => { const ys = xs.filter((x) => x.facet === f); return [f, { accuracy: acc(ys), ece: pct(ece(ys)), meanConfidence: pct(ys.reduce((n, y) => n + y.confidence, 0) / (ys.length || 1)) }]; })),
    ece: pct(ece(xs)),
    selective: [0.5, 0.7, 0.8, 0.9].map(selective),
    byProduct: group('product'),
    byTier: group('tier'),
  };
}

/** Most common gold -> predicted confusions for one facet. */
export function confusions(xs: Scored[], facet?: string, top = 15): [string, number][] {
  const c = new Map<string, number>();
  for (const x of xs) if (!x.correct && (!facet || x.facet === facet)) { const k = `${x.facet}: ${x.gold || 'none'} -> ${x.pred}`; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, top);
}
