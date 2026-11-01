import { words, facetValue, type Facet, type TermsFile } from './classify.ts';

export interface ShippedGroup { label: string; properties?: string[]; tokens: string[]; groups: ShippedGroup[] }
export interface ShippedStructure { kind: 'shipped-groups' | 'shipped-order'; file: string; ordered?: boolean; groups: ShippedGroup[] }

export interface Group {
  id: string;
  label: string;
  /** The product's own word for the group (name families). */
  native?: string;
  /** Canonical meaning of that word, when an approved term gives one and it differs from the label (primary -> Accent). */
  meaning?: string;
  /** Where the grouping comes from: the product's declared groups, or its token names. */
  source: 'shipped-group' | 'name-family';
  /** Where the order inside the group comes from. */
  order: 'shipped' | 'progression';
  properties?: string[];
  tokens: string[];
  subgroups: { label: string; native?: string; tokens: string[] }[];
}
export interface Structure { kind: ShippedStructure['kind'] | 'name-family'; groups: Group[] }

/** Facet values a token binds, from its approved mapping (best) or the classifier's reading of its name. */
export type FacetsOf = (token: string) => Partial<Record<Facet, string>>;

const STATE_RANK: Record<string, number> = { hover: 1, active: 2, focus: 3, selected: 4, 'hover+selected': 5, 'active+selected': 5, disabled: 6, 'disabled+selected': 6, visited: 7 };
const EMPHASIS_RANK: Record<string, number> = { default: 0, subtle: 1, subtlest: 2, strong: 3, strongest: 4 };
/** Signed emphasis, for families that run both ways from the base (lowest, low, base, high, highest). */
const EMPHASIS_SIGNED: Record<string, number> = { subtlest: -2, subtle: -1, default: 0, strong: 1, strongest: 2 };
const ACRONYMS: Record<string, string> = { ai: 'AI', ui: 'UI' };
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const levelOf = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w]);
export const humanize = (w: string) => w.split('-').map((x) => ACRONYMS[x] ?? x[0].toUpperCase() + x.slice(1)).join(' ');

/**
 * Words that prefix another token's whole name (Material on-primary next to primary), found from the data: a word
 * that does this for at least three tokens. Paired tokens join their base's family and sort right after it.
 */
export function pairingPrefixes(tokens: string[], noise: Set<string>): Map<string, number> {
  const names = new Set(tokens.map((t) => words(t).filter((w) => !noise.has(w)).join('-')));
  const count = new Map<string, number>();
  for (const t of tokens) {
    const w = words(t).filter((x) => !noise.has(x));
    if (w.length > 1 && names.has(w.slice(1).join('-'))) count.set(w[0], (count.get(w[0]) ?? 0) + 1);
  }
  // Rank 1 = the most common pairing word (Material "on"), so the closest pair sorts right after its base.
  return new Map([...count].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([w], i) => [w, i + 1]));
}

/**
 * Group and order one product's tokens with the best evidence available:
 *   1. shipped groups (designer-declared, designer order), with leftovers grouped by name;
 *   2. shipped source order (authored order inside name families);
 *   3. name families ordered by the canonical progression: level, emphasis, variant, base before paired, state.
 * Inside large groups, a following word that is not a state, emphasis or level forms a subgroup.
 */
export function buildStructure(tokens: string[], terms: TermsFile, facetsOf: FacetsOf, shipped?: ShippedStructure): Structure {
  const noise = new Set(terms.noise ?? []);
  const inSet = new Set(tokens);
  const pairs = pairingPrefixes(tokens, noise);
  const facetOfWord = new Map<string, Facet>();
  const labelOfWord = new Map<string, string>();
  for (const t of terms.terms) if (t.status === 'approved') { const fv = facetValue(t.concept); if (fv) { facetOfWord.set(`${t.term}|${fv.facet}`, fv.facet); if (!t.term.includes('-')) labelOfWord.set(t.term, `${fv.facet}:${fv.value}`); } }
  const isModifier = (w: string) => levelOf(w) !== undefined || facetOfWord.has(`${w}|state`) || facetOfWord.has(`${w}|emphasis`);
  // Strip every leading pairing word (inverse-on-surface -> surface), counting them so paired tokens sort after their base.
  const family = (t: string) => { let w = words(t).filter((x) => !noise.has(x)); let paired = 0; while (w.length > 1 && pairs.has(w[0])) { paired = paired * 10 + pairs.get(w[0])!; w = w.slice(1); } return { w, paired }; };

  const shippedIndex = new Map<string, number>();
  let i = 0;
  const walk = (gs: ShippedGroup[]) => gs.forEach((g) => { g.tokens.forEach((t) => !shippedIndex.has(t) && shippedIndex.set(t, i++)); walk(g.groups); });
  if (shipped) walk(shipped.groups);
  // Shipped groups whose files list tokens alphabetically give groups, not order.
  const shippedOrdered = shipped?.ordered !== false;

  // A list whose emphasis runs both below and above the base reads as a ramp; otherwise the base comes first.
  let ramp = false;
  const progression = (t: string) => {
    const f = facetsOf(t), fam = family(t);
    const level = fam.w.map(levelOf).find((n) => n !== undefined) ?? 0;
    const rest = fam.w.slice(1);
    const variant = rest.filter((w) => !isModifier(w)).join('-');
    // Emphasis words as written (variant, secondary, low...) keep their own slot so X, on-X, X-variant, on-X-variant stay paired.
    const mods = rest.filter((w) => facetOfWord.has(`${w}|emphasis`)).join('-');
    const e = f.emphasis ?? 'default';
    return [level, variant, ramp ? EMPHASIS_SIGNED[e] ?? 0 : EMPHASIS_RANK[e] ?? 0, mods, fam.paired, STATE_RANK[f.state ?? ''] ?? 0, t] as const;
  };
  const cmp = (a: string, b: string) => { const x = progression(a), y = progression(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1; return 0; };
  const order = (ts: string[], useShipped: boolean) => {
    const signs = new Set(ts.map((t) => Math.sign(EMPHASIS_SIGNED[facetsOf(t).emphasis ?? 'default'] ?? 0)));
    ramp = signs.has(-1) && signs.has(1);
    const out = useShipped ? [...ts].sort((a, b) => (shippedIndex.get(a) ?? 1e9) - (shippedIndex.get(b) ?? 1e9) || cmp(a, b)) : [...ts].sort(cmp);
    ramp = false;
    return out;
  };

  const subgroupsOf = (ts: string[], prefixLen: number) => {
    if (ts.length <= 6) return { main: ts, subs: [] as Group['subgroups'] };
    const by = new Map<string, string[]>();
    const main: string[] = [];
    for (const t of ts) {
      const w = family(t).w.slice(prefixLen).find((x) => !isModifier(x));
      if (w) (by.get(w) ?? by.set(w, []).get(w)!).push(t); else main.push(t);
    }
    const subs: Group['subgroups'] = [];
    // Subgroups are parts of the native name: keep the product's word.
    for (const [w, members] of by) if (members.length >= 2) subs.push({ label: humanize(w), tokens: members }); else main.push(...members);
    return { main, subs };
  };
  /** The canonical meaning of a native word, when an approved term gives one. */
  const meaningOf = (w: string) => { const l = labelOfWord.get(w); return l ? humanize(l.split(':')[1]) : undefined; };
  /** Group label: the product's own word; short abbreviations (bg, nav) read better as their canonical meaning. */
  const labelFor = (w: string) => (w.length <= 3 && meaningOf(w) ? meaningOf(w)! : humanize(w));

  const groups: Group[] = [];
  const assigned = new Set<string>();
  if (shipped?.kind === 'shipped-groups') {
    const flat = (gs: ShippedGroup[], parent?: string): void => gs.forEach((g) => {
      const members = g.tokens.filter((t) => inSet.has(t) && !assigned.has(t));
      members.forEach((t) => assigned.add(t));
      if (members.length) {
        const ordered = order(members, shippedOrdered);
        const { main, subs } = subgroupsOf(ordered, 1);
        groups.push({ id: `g-${groups.length}`, label: parent ? `${parent}: ${g.label}` : g.label, source: 'shipped-group', order: shippedOrdered ? 'shipped' : 'progression', properties: g.properties, tokens: main, subgroups: subs.map((s) => ({ ...s, tokens: order(s.tokens, shippedOrdered) })) });
      }
      flat(g.groups, g.label);
    });
    flat(shipped.groups);
  }
  // Everything else: families by first meaningful word.
  const rest = tokens.filter((t) => !assigned.has(t));
  const fams = new Map<string, string[]>();
  for (const t of rest) { const k = family(t).w[0] ?? t; (fams.get(k) ?? fams.set(k, []).get(k)!).push(t); }
  const useShippedOrder = shipped?.kind === 'shipped-order';
  // Family order: shipped order when there is one; otherwise larger families first.
  const famOrder = [...fams].sort(([a, x], [b, y]) => (useShippedOrder ? Math.min(...x.map((t) => shippedIndex.get(t) ?? 1e9)) - Math.min(...y.map((t) => shippedIndex.get(t) ?? 1e9)) : y.length - x.length) || a.localeCompare(b));
  // A shipped group that is just a family name (Carbon "Syntax Highlighting" listing three syntax tokens) absorbs the rest of its family.
  for (const [k, ts] of famOrder) {
    const host = groups.find((g) => g.source === 'shipped-group' && [...g.tokens, ...g.subgroups.flatMap((s) => s.tokens)].every((t) => family(t).w[0] === k));
    if (host) { host.tokens = order([...host.tokens, ...ts], true); const { main, subs } = subgroupsOf(host.tokens, 1); host.tokens = main; host.subgroups = subs.map((s) => ({ ...s, tokens: order(s.tokens, true) })); continue; }
    const ordered = order(ts, useShippedOrder);
    const { main, subs } = subgroupsOf(ordered, 1);
    const meaning = meaningOf(k);
    groups.push({ id: `g-${groups.length}`, label: labelFor(k), native: k, ...(meaning && meaning !== labelFor(k) ? { meaning } : {}), source: 'name-family', order: useShippedOrder ? 'shipped' : 'progression', tokens: main, subgroups: subs.map((s) => ({ ...s, tokens: order(s.tokens, useShippedOrder) })) });
  }
  return { kind: shipped?.kind ?? 'name-family', groups };
}
