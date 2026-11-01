import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Jev System One client (https://docs.typesafe.ai/introduction/quickstart). The key comes from TYPESAFE_API_KEY or
 * the gitignored .env.local at the repo root; it is never logged or written anywhere else. Every response is cached
 * on disk by a hash of its request, so re-running an experiment costs nothing and results are reproducible.
 */
export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };
export interface Request { model: string; state: unknown; questions: Record<string, Question> }
export interface Answer { type: string; choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number> }
export interface Response { model: string; answers: Record<string, Answer>; usage?: { input_tokens: number; output_tokens: number }; cached?: boolean }

export function apiKey(root: string): string | undefined {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  for (const f of ['.env.local', '.env']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^\s*TYPESAFE_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m);
    if (m) return m[1].trim();
  }
  return undefined;
}

export class Jev {
  calls = 0; hits = 0; inputTokens = 0; outputTokens = 0;
  private active = 0; private queue: (() => void)[] = [];
  private root: string; private opts: { concurrency?: number; offline?: boolean; refresh?: boolean };
  constructor(root: string, opts: { concurrency?: number; offline?: boolean; refresh?: boolean } = {}) { this.root = root; this.opts = opts; }
  private cacheFile(req: Request) { return path.join(this.root, '.cache/jev/responses', crypto.createHash('sha256').update(JSON.stringify(req)).digest('hex') + '.json'); }
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= (this.opts.concurrency ?? 8)) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
  /** The model version `jev-latest` serves today, from one tiny uncached request. Cached answers from another version are re-asked. */
  current?: string;
  async version(): Promise<string | undefined> {
    if (this.current || this.opts.offline) return this.current;
    const r = await this.fetchOnce({ model: 'jev-latest', state: 'version probe', questions: { ok: { type: 'noul', instructions: 'This text is a probe' } } });
    this.current = r.model;
    return this.current;
  }
  async ask(req: Request): Promise<Response> {
    const f = this.cacheFile(req);
    if (fs.existsSync(f) && !this.opts.refresh) {
      const c = JSON.parse(fs.readFileSync(f, 'utf8')) as Response;
      if (!this.current || c.model === this.current) { this.hits++; return { ...c, cached: true }; }
    }
    if (this.opts.offline) throw new Error('offline: response not cached');
    const body = await this.fetchOnce(req);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body));
    return body;
  }
  private async fetchOnce(req: Request): Promise<Response> {
    const key = apiKey(this.root);
    if (!key) throw new Error('no TYPESAFE_API_KEY (environment or .env.local)');
    return this.slot(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
        if (res.ok) {
          const body = (await res.json()) as Response;
          this.calls++; this.inputTokens += body.usage?.input_tokens ?? 0; this.outputTokens += body.usage?.output_tokens ?? 0;
          return body;
        }
        const retry = res.status === 429 || res.status >= 500;
        if (!retry || attempt >= 5) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
        await new Promise((r) => setTimeout(r, Math.min(30000, 500 * 2 ** attempt + Math.random() * 250)));
      }
    });
  }
}
