export interface Product { id: string; name: string; organization?: string; homepage?: string; license?: string; description: string; version: string; implementation?: string; redistribution?: string; modes: Record<string, string>; counts: { tokens: number; mapped: number; unmapped: number; answered: number } }
export interface FacetValue { value: string; label: string; definition: string | null; broader?: string }
export interface Meta { products: Product[]; catalog: { id: string; name: string; category: string; organization?: string; homepage?: string; description: string }[]; facets: Record<string, FacetValue[]>; concepts: number }
export interface Cell { s: 'match' | 'nearest'; t: string; m: string; via: string; d: string }
export interface Concept { iri: string; group: string; name: string; label: string; facets: Record<string, string>; cells: Record<string, Record<string, Cell>>; members?: Record<string, [string, string, string][]> }
export interface Token { p: string; n: string; t?: string; d?: string; s?: string; vis?: string; v?: Record<string, [string, string[]]>; m: [string, string, string][]; u?: string }
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
