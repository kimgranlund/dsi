export interface Product { id: string; name: string; organization?: string; homepage?: string; license?: string; description: string; version: string; implementation?: string; redistribution?: string; modes: Record<string, string>; counts: { tokens: number; mapped: number; unmapped: number; answered: number }; home?: { byCat: Record<string, number>; tokensByScope: Record<string, number>; proposed: number; audit?: Record<string, number>; components: number; license?: string; status: 'mapped' | 'in-progress' | 'not-started'; chain?: string[] } }
export interface FacetValue { value: string; label: string; definition: string | null; broader?: string }
export interface Meta { products: Product[]; catalog: { id: string; name: string; category: string; organization?: string; homepage?: string; description: string }[]; facets: Record<string, FacetValue[]>; concepts: number; featured?: { product: string; steps: string[]; value: string; scopes: (string | null)[] } }
export interface Cell { s: 'match' | 'nearest'; t: string; m: string; via: string; d: string }
export interface Concept { iri: string; group: string; name: string; label: string; facets: Record<string, string>; cells: Record<string, Record<string, Cell>>; members?: Record<string, [string, string, string][]> }
export interface Token { p: string; n: string; t?: string; d?: string; s?: string; vis?: string; dep?: string; v?: Record<string, [string, string[]]>; m: [string, string, string][]; u?: string; e?: [string, string, string, string, boolean][] }
export type SearchRow = [kind: string, key: string, title: string, body: string];

const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) cache.set(file, fetch(`/data/${file}`).then((r) => { if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.json(); }));
  return cache.get(file) as Promise<T>;
}
export const meta = () => load<Meta>('meta.json');
export const concepts = () => load<Concept[]>('concepts.json');
export const tokens = (product: string) => load<Token[]>(`tokens.${product}.json`);
export const search = () => load<SearchRow[]>('search.json');
export interface SlotCell { native: string; computed?: string; inputs?: string[]; media?: string; also?: string[]; token?: string; name?: string; type?: string; value?: string; chain?: string[]; literal?: string; deprecated?: string; position?: string; css: { selector: string; property: string; how: string; file: string; line?: number; media?: string; chain: string[]; token?: string }[] }
export interface ComponentDoc { id: string; label: string; definition: string | null; systems: Record<string, { native?: string; match?: string; variant?: string; evidence?: string; absent?: boolean }[]>; parts: string[]; slots: { concept: string; part: string; role: string; axis?: string; state?: string; label: string; cells: Record<string, SlotCell[]> }[] }
export const components = () => load<ComponentDoc[]>('components.json');

export async function conceptByName(name: string) { return (await concepts()).find((c) => c.name === name); }
export async function conceptByIri(iri: string) { return (await concepts()).find((c) => c.iri === iri); }

/** Facet value label, e.g. intent:danger -> Danger. */
export async function facetLabel(facet: string, value: string) {
  const m = await meta();
  return value.split('+').map((v) => m.facets[facet]?.find((x) => x.value === v)?.label ?? v).join(' + ');
}

export interface Group { id: string; label: string; native?: string; meaning?: string; source: 'shipped-group' | 'name-family'; order: 'shipped' | 'progression'; properties?: string[]; tokens: string[]; subgroups: { label: string; tokens: string[] }[] }
export interface Groups { kind: 'shipped-groups' | 'shipped-order' | 'name-family'; groups: Group[] }
export const groups = (product: string) => load<Groups>(`groups.${product}.json`).catch(() => undefined);
