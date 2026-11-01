import type { Token } from './dtcg.ts';

export interface SourceConfig {
  product: string;
  implementation?: string;
  package: { registry: 'npm'; name: string; version: string };
  dependencies?: { registry: 'npm'; name: string; version: string }[];
  entries: { path: string; format: string; theme?: string; package?: string; nativeName?: string; group?: string; variables?: string[]; flatten?: boolean; skipKeys?: string[]; modules?: string[] }[];
  /** A theme that only overrides another: its lookups fall back to that theme, then to the base files. */
  themeExtends?: Record<string, string>;
  themes?: string[];
  adapter: string;
}

/** One output file: tokens keyed by dot path, plus the native theme it holds, if any. */
export interface OutputSet { file: string; theme?: string; tokens: Map<string, Token> }

export interface AdapterResult {
  sets: OutputSet[];
  /** Shipped grouping and ordering evidence, written to structure.json. */
  structure?: import('./structure.ts').ShippedStructure;
  /** Theme whose values live in the mode-independent files rather than a theme file (Polaris: light). */
  defaultTheme?: string;
  /** Counts and per-token notes for the ingest report. */
  report: { notes: string[]; counts: Record<string, number> };
}

/** Unpacked package directories by package name: the main package and every dependency. */
export type Packages = Record<string, { dir: string; version: string }>;

export type Adapter = (pkgs: Packages, source: SourceConfig) => Promise<AdapterResult> | AdapterResult;
