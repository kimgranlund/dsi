import type { Token } from './dtcg.ts';

export interface SourceConfig {
  product: string;
  implementation?: string;
  package: { registry: 'npm'; name: string; version: string };
  entries: { path: string; format: string; theme?: string }[];
  themes?: string[];
  adapter: string;
}

/** One output file: tokens keyed by dot path, plus the native theme it holds, if any. */
export interface OutputSet { file: string; theme?: string; tokens: Map<string, Token> }

export interface AdapterResult {
  sets: OutputSet[];
  /** Counts and per-token notes for the ingest report. */
  report: { notes: string[]; counts: Record<string, number> };
}

export type Adapter = (pkgDir: string, source: SourceConfig) => Promise<AdapterResult> | AdapterResult;
