#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { merge, readProposals, APPROVE_AT, APPROVE_WITH_CLASSIFIER_AT, type ClassifierVotes } from './merge.ts';
import { classify, type TermsFile } from '@dsi/classify';
import { loadNative, type NativeSet } from '@dsi/resolve';
import { preparePacket, readMappings, type Scope } from './packet.ts';
import { auditTerms, prepareAudit, readVerdicts } from './audit.ts';
import { rankEmphasis } from './rank.ts';
import { applyDefinitions, normalizeConcept, conceptName, gateUnregistered, isRegistered, parseConcept, readLexicon, registerConcepts } from '@dsi/schema';
import { resolve as resolveToken, showValue } from '@dsi/resolve';
import { applyDecisions, applyDisputes, applyTermDecisions, collectDisputes, collectQueue, collectTermQueue, disputeKey, enrichQueue, renderPage, type Decision, type DisputeDecision, type TermDecision } from './review.ts';

const USAGE = `usage:
  dsi-map prepare <scope> <run>   write <product>.{a,b}.packet.json for every product in the scope
  dsi-map merge <scope> <run>     merge <product>.{a,b}.proposals.json into mappings/ by two-agent agreement
  dsi-map check <scope> <run> <product> <role>   validate one proposals file against its packet
  dsi-map queue <scope>           list tokens whose mappings still need a human decision
  dsi-map audit-prepare <scope> <run> [--only <prescreen.json>]  deterministic checks + auditor packets for every approved mapping (or only the flagged ones)
  dsi-map audit-check <scope> <run> <product>    validate an auditor's verdicts
  dsi-map audit-merge <scope> <run>              write mappings/<product>/<version>.audit.json and list disputes
  dsi-map review <scope> <run> <out.html> [vocab run[,run]] [--words-only] [--third <run>] [--definitions <drafts.json>] [--jev]  render the review page for the token queue (details from <run>) and term queue (from .cache/classify/<vocab run>)
  dsi-map tiebreak <scope> <run> <product> <first run>   two of three: approve where a third model agrees with one of the first two
  dsi-map settle <scope> <run> <product> <first run>     settle rules: three agree (cautious match), emphasis-only splits (rank or broad), two of three at 0.5
  dsi-map reconcile <scope> [--dry]               fold single-system concepts into shared ones where one facet separates them (ADR 0019)
  dsi-map boundary-rules <scope> [--dry] [--jev]  apply the deciding tests B1, B3, B4, B6 to the queue (ADR 0021); --jev judges B4 where code cannot
  dsi-map triage-conflicts <scope>                Jev judges approved boundary conflicts (B4, B6): test or approval likely right
  dsi-map usage-check <scope> [product...]         measure the token-usage graph against approved mappings
  dsi-map boundaries <scope> [--top N] [--jev <run>]  rank the vocabulary boundaries answers disagree on
  dsi-map rank-emphasis <scope> <run> <product>   settle emphasis by contrast rank where both agents agree on the rest (ADR 0018)
  dsi-map apply-review <scope> <decisions.json> <reviewer>  apply decisions exported from the review page`;

const [cmd, scopeId, run] = process.argv.slice(2);

/** Values and description of a token, for review cards. */
function valuesOf(product: string, token: string) {
  const set = loadNative(root, product, scope.products[product].version);
  const themes = set.themes.length ? set.themes : [''];
  return { themes: Object.fromEntries(themes.map((th) => { const r = resolveToken(set, th, token); return [th || 'all', { aliases: r.chain, value: showValue(r.type, r.value) }]; })), description: set.tokens.get(token)?.description };
}
/** Approved terms most of their own approved tokens disagree with. */
function termFindingsFor() {
  const out: { product: string; term: string; detail: string }[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const tp = path.join(root, 'mappings', product, 'terms.json');
    const m = readMappings(root, product, version) as any;
    if (!fs.existsSync(tp) || !m) continue;
    for (const f of auditTerms(ontology, JSON.parse(fs.readFileSync(tp, 'utf8')), m.mappings.filter((x: any) => x.status === 'approved'))) out.push({ product, term: f.token.replace(/^term:/, ''), detail: f.detail });
  }
  return out;
}
const root = process.cwd();
if (!cmd || !scopeId) { console.error(USAGE); process.exit(2); }
const scope = JSON.parse(fs.readFileSync(path.join(root, 'packages/mapper/scopes', `${scopeId}.json`), 'utf8')) as Scope;
const runDir = run ? path.join(root, '.cache/mapper', run) : '';
let ontology = await loadOntology(path.join(root, 'ontology'));
if (ontology.issues.length) { console.error('ontology has issues; run corepack pnpm check'); process.exit(1); }

if (cmd === 'prepare') {
  if (!run) { console.error(USAGE); process.exit(2); }
  for (const product of Object.keys(scope.products))
    for (const role of ['a', 'b'] as const) {
      // --only <tokens.json> ({"<product>": ["token", ...]}): only these tokens; products not listed are skipped.
      const onlyFile = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
      const onlyList = onlyFile ? (JSON.parse(fs.readFileSync(onlyFile, 'utf8'))[product] as string[] | undefined) : undefined;
      if (onlyFile && !onlyList?.length) break;
      const r = preparePacket(root, ontology, scope, product, role, runDir, onlyList ? new Set(onlyList) : undefined);
      if (role === 'a') console.log(`${product}: ${r.count} tokens to map (${r.skipped} already approved) -> ${path.relative(root, r.file).replace('.a.', '.{a,b}.')}`);
    }
} else if (cmd === 'merge') {
  if (!run) { console.error(USAGE); process.exit(2); }
  for (const [product, { version }] of Object.entries(scope.products)) {
    // A run may cover only some products (a newly added system): skip those with no proposals.
    if (!fs.existsSync(path.join(runDir, `${product}.a.proposals.json`)) && !fs.existsSync(path.join(runDir, `${product}.b.proposals.json`))) { console.log(`${product}: no proposals in this run, skipped`); continue; }
    const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.a.packet.json`), 'utf8'));
    const tokens = new Set<string>(packet.tokens.map((t: { token: string }) => t.token));
    const a = readProposals(path.join(runDir, `${product}.a.proposals.json`), ontology, tokens);
    const b = readProposals(path.join(runDir, `${product}.b.proposals.json`), ontology, tokens);
    const impl = JSON.parse(fs.readFileSync(path.join(root, 'data/native', product, version, 'manifest.json'), 'utf8')).implementation;
    // Third vote: the classifier with approved terms only, counted only when it explains the whole name.
    const votes: ClassifierVotes = new Map();
    const termsPath = path.join(root, 'mappings', product, 'terms.json');
    if (fs.existsSync(termsPath)) {
      const terms = JSON.parse(fs.readFileSync(termsPath, 'utf8')) as TermsFile;
      const set = loadNative(root, product, version);
      for (const t of tokens) { const c = classify(terms, t, String(set.tokens.get(t)?.prov.file ?? ''), scope.domain); if (c.concept && c.explained === 1 && !c.conflicts.length) votes.set(t, c.concept); }
    }
    const r = merge(root, product, version, impl, a, b, scope.id, undefined, votes, ontology);
    console.log(`${product}: ${r.approved} approved, ${r.approvedWithClassifier} approved with the classifier's vote, ${r.approvedUnmapped} agreed unmapped, ${r.queued} queued for review -> ${r.file}`);
  }
  console.log(`approval rule: same concept and match from two models, both confidence >= ${APPROVE_AT}; or >= ${APPROVE_WITH_CLASSIFIER_AT} when the classifier (approved terms, whole name explained) gives the same concept and the match is exact or close`);
} else if (cmd === 'check') {
  const [product, role] = process.argv.slice(5);
  if (!run || !product || !role) { console.error(USAGE); process.exit(2); }
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.${role}.packet.json`), 'utf8'));
  try {
    const pf = readProposals(path.join(runDir, `${product}.${role}.proposals.json`), ontology, new Set(packet.tokens.map((t: { token: string }) => t.token)));
    console.log(`OK: ${pf.proposals.length} proposals, all packet tokens answered, all concepts valid`);
    // L6 (docs/controlled-language.md): warn, never refuse.
    const lint = (r: string) => { const out: string[] = []; const n = r.trim().split(/\s+/).length; if (n > 40) out.push(`${n} words (max 40)`); if (!/\bEvidence:/.test(r)) out.push('no "Evidence:" sentence'); const h = r.match(/\b(probably|seems?|maybe|perhaps|likely|might)\b/i); if (h) out.push(`hedging word "${h[0]}"`); return out; };
    const bad = (pf.proposals as any[]).map((p) => [p.token, lint(p.rationale ?? '')] as const).filter(([, w]) => w.length);
    if (bad.length) { console.log(`WARN: ${bad.length} rationale(s) break L6`); for (const [t, w] of bad.slice(0, 10)) console.log(`  ${t}: ${w.join('; ')}`); }
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
} else if (cmd === 'reopen') {
  // reopen <scope> <tokens.json> <adr>: an owner decision (G5) re-opens approved "no concept fits" records after the
  // ontology gained the words they lacked. Each becomes rejected with a note, so the next map run sees it again.
  const [file, adr] = [process.argv[4], process.argv[5]];
  if (!file || !adr) { console.error('usage: dsi-map reopen <scope> <tokens.json> <ADR number>'); process.exit(2); }
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]>;
  const at = new Date().toISOString();
  for (const [product, tokens] of Object.entries(list)) {
    const { version } = scope.products[product];
    const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const want = new Set(tokens);
    let n = 0;
    for (const u of m.unmapped ?? []) if (want.has(u.token) && u.status === 'approved') { u.status = 'rejected'; u.review = { by: 'owner-decision', at, note: `Re-opened: the ontology gained the concepts this token lacked (ADR ${adr}). Earlier review: ${u.review?.by ?? '?'}.` }; n++; }
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
    console.log(`${product}: ${n} of ${tokens.length} re-opened`);
  }
} else if (cmd === 'language-sweep') {
  // Controlled-language sweep of open review items (docs/controlled-language.md section 11).
  const third = process.argv.includes('--third') ? process.argv[process.argv.indexOf('--third') + 1] : undefined;
  const { sweep } = await import('./language-sweep.ts');
  const r = sweep(root, ontology, scope.products, third);
  console.log(`${r.items} open proposals swept (${third ? 'with third opinion ' + third : 'agents a and b'})`);
  console.log(`L1 grammar failures: ${r.grammar.length}`); for (const g of r.grammar.slice(0, 20)) console.log(`  ${g}`);
  console.log(`New (unregistered) concepts proposed: ${r.fresh.length}; L3 name collisions with registered concepts: ${r.collisions.length}`); for (const c of r.collisions) console.log(`  ${c}`);
  console.log(`L6 rationales breaking a rule: ${r.bad}/${r.items} ` + JSON.stringify(Object.fromEntries(r.l6))); for (const e of r.l6Examples) console.log(`  ${e}`);
  fs.writeFileSync(path.join(root, '.cache/language-sweep.json'), JSON.stringify(r, null, 2));
} else if (cmd === 'review') {
  const [out, vocabRun] = [process.argv[5], process.argv[6]];
  if (!run || !out) { console.error(USAGE); process.exit(2); }
  // --words-only leaves the token queue out (a round that settles naming terms first); vocab runs may be comma-separated.
  const wordsOnly = process.argv.includes('--words-only');
  // --third <run>: the third opinion's answers join each card's votes.
  const thirdRun = process.argv.includes('--third') ? process.argv[process.argv.indexOf('--third') + 1] : undefined;
  const sets = new Map<string, NativeSet>();
  const setOf = (p: string) => sets.get(p) ?? sets.set(p, loadNative(root, p, scope.products[p].version)).get(p)!;
  const third = (p: string) => {
    const f = thirdRun && path.join(root, '.cache/mapper', thirdRun, `${p}.c.proposals.json`);
    if (!f || !fs.existsSync(f)) return new Map<string, any>();
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return new Map<string, any>(j.proposals.map((x: any) => [x.token, { ...x, ...(x.concept ? { concept: normalizeConcept(x.concept) } : {}), model: j.model }]));
  };
  const hexIn = (p: string, t: string, mode: string) => { const s = setOf(p); const r = resolveToken(s, s.themes.includes(mode) ? mode : s.themes[0] ?? '', t); return r.value ? showValue(r.type, r.value) : undefined; };
  const near = (p: string, t: string) => { const s = setOf(p); return [...s.tokens.keys()].filter((k) => k === t || k.startsWith(t + '.') || k.startsWith(t + '-')); };
  const lex = readLexicon(root);
  const items = wordsOnly ? [] : enrichQueue(root, scope, collectQueue(root, scope, runDir), third, hexIn, near, (c) => { const p = parseConcept(ontology, c); return { name: typeof p === 'string' ? undefined : conceptName(lex, p), registered: isRegistered(ontology, c) }; });
  // --jev: Jev's two-stage pick per card (G9, 2026-11-01). It preselects only when no precedent or majority did and its
  // confidence is at least SUGGEST_AT; a pick outside the answers shows as its own option. It never approves.
  if (process.argv.includes('--jev') && items.length) {
    const { suggest, SUGGEST_AT } = await import('@dsi/jev/roles');
    const picks = await suggest(root, ontology, items.map((i) => ({ product: i.product, version: i.version, token: i.token })));
    for (const it of items as any[]) {
      const s = picks.get(`${it.product}__${it.token}`);
      if (!s) continue;
      const p = parseConcept(ontology, s.concept);
      it.jev = { ...s, name: typeof p === 'string' ? s.concept : conceptName(lex, p), confident: s.confidence >= SUGGEST_AT };
      const idx = it.options.findIndex((o: any) => o.concept === s.concept);
      if (idx >= 0) it.options[idx].jev = s.confidence;
      if (it.preselect == null && s.confidence >= SUGGEST_AT && idx >= 0) { it.preselect = idx; it.preselectWhy = `Jev ${s.confidence.toFixed(2)} (${s.model})`; }
    }
    console.log(`jev: ${picks.size} picks, ${[...picks.values()].filter((s) => s.confidence >= SUGGEST_AT).length} at ${SUGGEST_AT} or more`);
    // Kept so apply-review can grade Jev against the owner's decisions.
    fs.mkdirSync(path.join(root, '.cache/jev'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cache/jev/review-picks.json'), JSON.stringify({ at: new Date().toISOString(), suggestAt: SUGGEST_AT, picks: Object.fromEntries(picks) }, null, 1));
  }
  // Several vocabulary runs: one card per word, examples from the first run that counted it.
  const termItems = [...(vocabRun && !vocabRun.startsWith('--') ? vocabRun.split(',').flatMap((r) => collectTermQueue(root, Object.keys(scope.products), path.join(root, '.cache/classify', r))) : [])
    .reduce((m, t) => { const prev = m.get(t.key); if (!prev || (!prev.examples.length && t.examples.length)) m.set(t.key, t); return m; }, new Map<string, any>()).values()];
  const disputes = collectDisputes(root, scope, termFindingsFor(), valuesOf);
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${Object.keys(scope.products)[0]}.a.packet.json`), 'utf8'));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // --definitions <drafts.json>: drafted L4 definitions for lexicon words ({ "<iri>": "<text>" }), shown with the current text.
  const defFile = process.argv.includes('--definitions') ? process.argv[process.argv.indexOf('--definitions') + 1] : undefined;
  const lexNow = readLexicon(root);
  const definitions = defFile ? Object.entries(JSON.parse(fs.readFileSync(defFile, 'utf8')) as Record<string, string>).map(([iri, text]) => ({ key: iri.replace(/[^a-z0-9-]/gi, '_'), product: iri.split('/')[0].replace('dsi:', ''), iri, label: lexNow.get(iri)?.label ?? iri, current: lexNow.get(iri)?.definition ?? null, proposed: text })) : [];
  fs.writeFileSync(out, renderPage(root, items, packet.ontology, new Date().toISOString(), termItems, disputes, definitions));
  console.log(`${items.length} queued tokens, ${termItems.length} queued words, ${disputes.length} disputes, ${definitions.length} definitions -> ${out}`);
} else if (cmd === 'apply-review') {
  const [file, reviewer] = [process.argv[4], process.argv[5]];
  if (!file || !reviewer) { console.error(USAGE); process.exit(2); }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = (Array.isArray(raw) ? raw : raw.documents ?? raw.docs ?? []).map((d: any) => d.data ?? d);
  // Grade Jev's review picks against the owner's token decisions (ADR 0020 follow-up): before applying, while the
  // chosen candidate records still read as proposed. Appends to packages/jev/experiments/OWNER-SCORES.md.
  const picksFile = path.join(root, '.cache/jev/review-picks.json');
  const tokenDecisions = all.filter((d: any) => 'token' in d && !('iri' in d));
  if (fs.existsSync(picksFile) && tokenDecisions.length) {
    const pk = JSON.parse(fs.readFileSync(picksFile, 'utf8'));
    const rows: { product: string; confident: boolean; right: boolean }[] = [];
    for (const d of tokenDecisions) {
      const p = pk.picks[d.key];
      if (!p) continue;
      let owner: string | undefined;
      if (d.action === 'custom') owner = d.concept;
      else if (d.action === 'accept') { const m = (readMappings(root, d.product, scope.products[d.product].version) as any)?.mappings.find((x: any) => x.id === d.candidateId); owner = m?.concept; }
      else if (d.action === 'unmapped') owner = '(none)';
      if (!owner) continue;
      rows.push({ product: d.product, confident: p.confidence >= pk.suggestAt, right: p.concept === owner });
    }
    if (rows.length) {
      const pct = (xs: typeof rows) => (xs.length ? `${Math.round((1000 * xs.filter((x) => x.right).length) / xs.length) / 10}% of ${xs.length}` : '-');
      const f = path.join(root, 'packages/jev/experiments/OWNER-SCORES.md');
      if (!fs.existsSync(f)) fs.writeFileSync(f, '# Jev picks graded against owner decisions\n\nAppended by `apply-review` (picks from `review --jev`).\n\n| Date | Picks graded | All picks right | Confident picks right | By product (confident) |\n|---|---|---|---|---|\n');
      const byP = [...new Set(rows.map((r) => r.product))].map((p) => `${p} ${pct(rows.filter((r) => r.product === p && r.confident))}`).join('; ');
      fs.appendFileSync(f, `| ${new Date().toISOString().slice(0, 10)} | ${rows.length} | ${pct(rows)} | ${pct(rows.filter((r) => r.confident))} | ${byP} |\n`);
      console.log(`jev graded: all ${pct(rows)}, confident ${pct(rows.filter((r) => r.confident))}`);
    }
  }
  // Token decisions and term decisions may come in one export; term decisions carry a `term` field.
  console.log('tokens', JSON.stringify(applyDecisions(root, scope, all.filter((d: any) => 'token' in d) as Decision[], reviewer)));
  console.log('terms ', JSON.stringify(applyTermDecisions(root, all.filter((d: any) => 'term' in d && !('kind' in d) && !('iri' in d)) as TermDecision[], reviewer)));
  const disputeDecisions = all.filter((d: any) => 'kind' in d && 'subject' in d) as DisputeDecision[];
  if (disputeDecisions.length) {
    const open = collectDisputes(root, scope, termFindingsFor(), valuesOf);
    const suggestions = new Map(open.filter((x) => x.suggested).map((x) => [x.key, x.suggested!]));
    const disputedTerms = new Map(open.filter((x) => x.kind === 'term').map((x) => [x.key, x.current.concept]));
    console.log('disputes', JSON.stringify(applyDisputes(root, scope, disputeDecisions, reviewer, suggestions, disputedTerms)));
  }
  // Lexicon definitions (L4) reviewed on the Definitions tab carry an `iri`.
  const defDecisions = all.filter((d: any) => 'iri' in d);
  if (defDecisions.length) console.log('definitions', JSON.stringify(applyDefinitions(root, defDecisions)));
  // ADR 0019: what the owner approved is registered (generated name and definition; edit concepts.jsonld to refine).
  const fresh: string[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) { const m = readMappings(root, product, version) as any; for (const x of m?.mappings ?? []) if (x.status === 'approved' && !isRegistered(ontology, x.concept)) fresh.push(x.concept); }
  if (fresh.length) console.log('registered', registerConcepts(root, ontology, fresh).length, 'new concept(s)');
} else if (cmd === 'tiebreak') {
  // Two of three (ADR 0005 amended): a third agent on another model answers the still-contested tokens blind; when its
  // concept and match equal one of the first two answers (each confidence >= APPROVE_AT), that answer is approved.
  const [product, firstRun] = [process.argv[5], process.argv[6]];
  if (!run || !product || !firstRun) { console.error(USAGE); process.exit(2); }
  const { version } = scope.products[product];
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.c.packet.json`), 'utf8'));
  const tokens = new Set<string>(packet.tokens.map((t: { token: string }) => t.token));
  const c = readProposals(path.join(runDir, `${product}.c.proposals.json`), ontology, tokens);
  const firstDir = path.join(root, '.cache/mapper', firstRun);
  const all = (r: string) => new Map<string, any>(JSON.parse(fs.readFileSync(path.join(firstDir, `${product}.${r}.proposals.json`), 'utf8')).proposals.map((p: any) => [p.token, p]));
  const [a, b] = [all('a'), all('b')];
  const models = new Set([JSON.parse(fs.readFileSync(path.join(firstDir, `${product}.a.proposals.json`), 'utf8')).model, JSON.parse(fs.readFileSync(path.join(firstDir, `${product}.b.proposals.json`), 'utf8')).model]);
  if (models.has(c.model)) { console.error(`third opinion must come from a third model, got ${c.model}`); process.exit(1); }
  const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
  const file = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const approved = new Set(file.mappings.filter((m: any) => m.status === 'approved').map((m: any) => m.token));
  const at = new Date().toISOString();
  let n = 0, unmappedN = 0;
  const same = (x: any, y: any) => x && y && (x.concept ? x.concept === y.concept && x.match === y.match : !y.concept && x.unmapped && y.unmapped);
  for (const p of c.proposals as any[]) {
    if (approved.has(p.token)) continue;
    const pick = [a.get(p.token), b.get(p.token)].find((x) => same(x, p) && (x.confidence ?? 1) >= APPROVE_AT && (p.confidence ?? 1) >= APPROVE_AT);
    if (!pick) continue;
    if (!p.concept) {
      for (const m of file.mappings) if (m.token === p.token && m.status === 'proposed') { m.status = 'rejected'; m.review = { by: 'two-of-three', at, note: `Third opinion (${c.model}) agreed no concept fits.` }; }
      file.unmapped = (file.unmapped ?? []).filter((u: any) => u.token !== p.token);
      file.unmapped.push({ token: p.token, status: 'approved', rationale: p.rationale ?? 'No concept fits (two of three agents).', provenance: { agent: 'dsi-mapper', at, method: 'two-of-three-v1' }, review: { by: 'two-of-three', at, note: `${c.model} agreed with an earlier agent` } });
      unmappedN++; continue;
    }
    const id = 'm-' + crypto.createHash('sha1').update([p.token, p.concept, p.match].join('|')).digest('hex').slice(0, 12);
    for (const m of file.mappings) if (m.token === p.token && m.status === 'proposed' && m.id !== id) { m.status = 'rejected'; m.review = { by: 'two-of-three', at, note: `Third opinion (${c.model}) agreed with another answer.` }; }
    const existing = file.mappings.find((m: any) => m.id === id);
    const record = { id, token: p.token, concept: p.concept, match: p.match, confidence: Math.min(pick.confidence ?? 1, p.confidence ?? 1), status: 'approved', rationale: p.rationale ?? pick.rationale, provenance: { agent: 'dsi-mapper', at, method: 'two-of-three-v1' }, review: { by: 'two-of-three', at, note: `${c.model} (blind, web research) agreed with an earlier agent's answer` } };
    if (existing) Object.assign(existing, record); else file.mappings.push(record);
    n++;
  }
  file.mappings.sort((x: any, y: any) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id));
  { const held = gateUnregistered(ontology, file); if (held.length) console.log(`${held.length} answer(s) use new concepts and wait for owner approval (ADR 0019)`); }
  fs.writeFileSync(mf, JSON.stringify(file, null, 2) + '\n');
  console.log(`${product}: ${n} approved and ${unmappedN} agreed unmapped by two of three (third: ${c.model})`);
} else if (cmd === 'settle') {
  // ADR 0005 amended (settle rules), for tokens still contested after tiebreak:
  //  1. all three agree on the concept: approve with the most cautious match (exact < close < broad|narrow; a
  //     broad/narrow split or any `related` stays queued);
  //  2. all three agree on every facet but emphasis: contrast rank (ADR 0018) when it computes, else the shared
  //     concept without emphasis, matched broad (the token is one member of it);
  //  3. two of three give the same concept and match, each confidence >= SETTLE_AT: approve; the third is rejected.
  const SETTLE_AT = 0.5;
  const [product, firstRun] = [process.argv[5], process.argv[6]];
  if (!run || !product || !firstRun) { console.error(USAGE); process.exit(2); }
  const { version } = scope.products[product];
  const load = (dir: string, r: string) => { const j = JSON.parse(fs.readFileSync(path.join(root, '.cache/mapper', dir, `${product}.${r}.proposals.json`), 'utf8')); for (const x of j.proposals) if (x.concept) x.concept = normalizeConcept(x.concept); return j; };
  const [A, B, C] = [load(firstRun, 'a'), load(firstRun, 'b'), load(run, 'c')];
  const byTok = (f: any) => new Map<string, any>(f.proposals.map((p: any) => [p.token, p]));
  const [a, b, c] = [byTok(A), byTok(B), byTok(C)];
  const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
  const file = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const approved = new Set([...file.mappings, ...(file.unmapped ?? [])].filter((m: any) => m.status === 'approved').map((m: any) => m.token));
  const at = new Date().toISOString();
  const strip = (x: string) => x.split('/').filter((s) => !s.startsWith('emphasis-')).join('/');
  const RANK: Record<string, number> = { exact: 0, close: 1, broad: 2, narrow: 2 };
  const cautious = (ms: string[]) => {
    if (ms.some((m) => RANK[m] === undefined) || (ms.includes('broad') && ms.includes('narrow'))) return undefined;
    return ms.reduce((x, y) => (RANK[y] > RANK[x] ? y : x));
  };
  const counts = { three: 0, rank: 0, broad: 0, two: 0, unmapped: 0 };
  const left: string[] = [];
  const approve = (token: string, concept: string, match: string, confidence: number, rationale: string, method: string, note: string) => {
    const id = 'm-' + crypto.createHash('sha1').update([token, concept, match].join('|')).digest('hex').slice(0, 12);
    for (const m of file.mappings) if (m.token === token && m.status === 'proposed' && m.id !== id) { m.status = 'rejected'; m.review = { by: 'settle-rule', at, note: `Settled (${method}): ${concept} ${match}.` }; }
    file.unmapped = (file.unmapped ?? []).filter((u: any) => !(u.token === token && u.status === 'proposed'));
    file.mappings = file.mappings.filter((m: any) => m.id !== id);
    file.mappings.push({ id, token, concept, match, confidence, status: 'approved', rationale, provenance: { agent: 'dsi-mapper', at, method }, review: { by: 'settle-rule', at, note } });
  };
  const approveUnmapped = (token: string, rationale: string, note: string) => {
    for (const m of file.mappings) if (m.token === token && m.status === 'proposed') { m.status = 'rejected'; m.review = { by: 'settle-rule', at, note: 'Settled: no concept fits.' }; }
    file.unmapped = (file.unmapped ?? []).filter((u: any) => u.token !== token);
    file.unmapped.push({ token, status: 'approved', rationale, provenance: { agent: 'dsi-mapper', at, method: 'settle-v1' }, review: { by: 'settle-rule', at, note } });
    counts.unmapped++;
  };
  const valid = (x: string) => typeof parseConcept(ontology, x) !== 'string';
  const emphasisOnly: string[] = [];
  const queued = new Set<string>([...file.mappings, ...(file.unmapped ?? [])].filter((m: any) => m.status === 'proposed').map((m: any) => m.token));
  for (const token of [...queued].sort()) {
    if (approved.has(token)) continue;
    const xs = [a.get(token), b.get(token), c.get(token)];
    if (xs.some((x) => !x)) { left.push(token); continue; }
    const concepts = xs.map((x) => x.concept ?? null);
    const conf = Math.min(...xs.map((x) => x.confidence ?? 1));
    // Rule 1
    if (concepts.every((x) => x === concepts[0])) {
      if (!concepts[0]) { approveUnmapped(token, xs[0].rationale ?? 'No concept fits (three agents).', 'All three agents agree no concept fits.'); continue; }
      const m = cautious(xs.map((x) => x.match));
      if (m && valid(concepts[0])) { approve(token, concepts[0], m, conf, xs[2].rationale ?? xs[0].rationale, 'settle-three-v1', `All three agents (${A.model}, ${B.model}, ${C.model}) agree on the concept; most cautious match.`); counts.three++; continue; }
    }
    // Rule 2 (collected; ranked below)
    if (concepts.every((x) => x && strip(x) === strip(concepts[0]!)) && new Set(concepts).size > 1) { emphasisOnly.push(token); continue; }
    // Rule 3
    const pairs = [[0, 1], [0, 2], [1, 2]] as const;
    const pair = pairs.find(([i, j]) => concepts[i] === concepts[j] && (xs[i].concept ? xs[i].match === xs[j].match : true) && (xs[i].confidence ?? 1) >= SETTLE_AT && (xs[j].confidence ?? 1) >= SETTLE_AT);
    if (pair) {
      const [i, j] = pair;
      const odd = xs[3 - i - j];
      const note = `Two of three agents agree (each >= ${SETTLE_AT}); the third answered ${odd.concept ?? 'no concept'} ${odd.match ?? ''}`.trim() + '.';
      if (!concepts[i]) { approveUnmapped(token, xs[i].rationale ?? 'No concept fits (two of three agents).', note); continue; }
      if (valid(concepts[i]!)) { approve(token, concepts[i]!, xs[i].match, Math.min(xs[i].confidence ?? 1, xs[j].confidence ?? 1), xs[i].rationale ?? xs[j].rationale, 'settle-two-v1', note); counts.two++; continue; }
    }
    left.push(token);
  }
  // Rule 2: rank with all three agreeing, then broad without emphasis for what the rank cannot settle.
  if (emphasisOnly.length) {
    const pageTok = file.mappings.find((m: any) => m.status === 'approved' && m.concept === 'dsi:concept/color/usage-page/property-background')?.token;
    const pick = (m: Map<string, any>) => emphasisOnly.map((t) => m.get(t));
    const r = rankEmphasis(root, product, version, pick(a), pick(c), () => pageTok);
    const ranked = new Map(r.out.map((x) => [x.token, x]));
    for (const token of emphasisOnly) {
      const x = ranked.get(token);
      if (x && valid(x.concept)) { approve(token, x.concept, x.match, 1, `All three agents agree on every facet but emphasis; ${x.note} (ADR 0018).`, 'emphasis-rank-three-v1', 'Deterministic: contrast against the page in every mode.'); counts.rank++; continue; }
      const base = strip(a.get(token).concept);
      if (valid(base)) { approve(token, base, 'broad', Math.min(...[a, b, c].map((m) => m.get(token).confidence ?? 1)), `All three agents agree on every facet but emphasis; the rank does not compute, so the token is one member of ${base}.`, 'settle-broad-v1', 'Emphasis left unbound: the agents split and the contrast rank does not compute.'); counts.broad++; continue; }
      left.push(token);
    }
  }
  file.mappings.sort((x: any, y: any) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id));
  { const held = gateUnregistered(ontology, file); if (held.length) console.log(`${held.length} answer(s) use new concepts and wait for owner approval (ADR 0019)`); }
  fs.writeFileSync(mf, JSON.stringify(file, null, 2) + '\n');
  console.log(`${product}: ${JSON.stringify(counts)}; ${left.length} left for review`);
} else if (cmd === 'reconcile') {
  // ADR 0019: a concept only one system uses folds into a shared one (used by 2+ systems) as broad when dropping
  // exactly one facet reaches it, the system maps nothing else there, and no other token of the system folds there
  // too (a ladder). Owner decisions (human review) are never changed. Pass --dry to only report.
  const dry = process.argv.includes('--dry');
  const files = new Map<string, { mf: string; file: any }>();
  for (const [product, { version }] of Object.entries(scope.products)) {
    const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
    if (fs.existsSync(mf)) files.set(product, { mf, file: JSON.parse(fs.readFileSync(mf, 'utf8')) });
  }
  const usedBy = new Map<string, Set<string>>();
  for (const [product, { file }] of files) for (const m of file.mappings) if (m.status === 'approved') (usedBy.get(m.concept) ?? usedBy.set(m.concept, new Set()).get(m.concept)!).add(product);
  const at = new Date().toISOString();
  const counts: Record<string, number> = { folded: 0, unique: 0, ambiguous: 0, ladder: 0, owner: 0, narrowOrRelated: 0 };
  for (const [product, { mf, file }] of files) {
    const mine = new Set(file.mappings.filter((m: any) => m.status === 'approved').map((m: any) => m.concept));
    const plans = new Map<string, any[]>();
    for (const m of file.mappings.filter((m: any) => m.status === 'approved' && usedBy.get(m.concept)!.size === 1)) {
      if (m.provenance?.method === 'human-review' || m.review?.by === 'kimgranlund') { counts.owner++; continue; }
      if (m.match === 'narrow' || m.match === 'related') { counts.narrowOrRelated++; continue; }
      const segs = m.concept.split('/');
      const segs2: string[] = segs; const cands = [...new Set<string>(segs2.slice(2).map((_, i) => [...segs2.slice(0, 2 + i), ...segs2.slice(3 + i)].join('/')))]
        .filter((b) => b.split('/').length > 2 && (usedBy.get(b)?.size ?? 0) >= 2 && !mine.has(b) && typeof parseConcept(ontology, b) !== 'string');
      if (!cands.length) { counts.unique++; continue; }
      if (cands.length > 1) { counts.ambiguous++; continue; }
      (plans.get(cands[0]) ?? plans.set(cands[0], []).get(cands[0])!).push(m);
    }
    for (const [b, ms] of plans) {
      if (ms.length > 1) { counts.ladder += ms.length; continue; }
      const m = ms[0];
      counts.folded++;
      if (dry) { console.log(`  ${product} ${m.token}: ${m.concept.replace('dsi:concept/', '')} -> ${b.replace('dsi:concept/', '')} broad`); continue; }
      const id = 'm-' + crypto.createHash('sha1').update([m.token, b, 'broad'].join('|')).digest('hex').slice(0, 12);
      m.status = 'superseded'; m.supersededBy = id; m.review = { by: 'reconcile-rule', at, note: `Folded into the shared concept ${b} (ADR 0019).` };
      file.mappings = file.mappings.filter((x: any) => x.id !== id);
      file.mappings.push({ id, token: m.token, concept: b, match: 'broad', confidence: m.confidence ?? 1, status: 'approved', rationale: `${m.rationale ?? ''} Reconciled: ${m.concept} was used by ${product} only; the token is one specific kind of the shared ${b}.`.trim(), provenance: { agent: 'dsi-mapper', at, method: 'reconcile-v1' }, review: { by: 'reconcile-rule', at, note: 'Dropping one facet reaches a concept other systems share; nothing else of this system maps there (ADR 0019).' } });
    }
    if (!dry) { file.mappings.sort((x: any, y: any) => x.token.localeCompare(y.token) || x.id.localeCompare(y.id)); fs.writeFileSync(mf, JSON.stringify(file, null, 2) + '\n'); }
  }
  console.log(`reconcile${dry ? ' (dry run)' : ''}: ${JSON.stringify(counts)}`);
} else if (cmd === 'boundary-rules') {
  // ADR 0021: apply the deciding tests B1, B3, B4, B6. Queued tokens: normalize every answer; when all normalized
  // answers agree (or one is left after B1 filtering), approve it (most cautious match, registry gate). Approved
  // mappings are never changed; ones that break a test are listed. --dry only reports.
  const { BoundaryTests, normalize } = await import('./boundary-rules.ts');
  const dry = process.argv.includes('--dry');
  const RANK: Record<string, number> = { exact: 0, close: 1, broad: 2, narrow: 2 };
  const at = new Date().toISOString();
  const totals: Record<string, number> = { settled: 0, stillOpen: 0, approvedBreaking: 0 };
  const conflicts: string[] = [];
  const judgeFn = process.argv.includes('--jev') ? await (await import('@dsi/jev/roles')).boundaryJudge(root, ontology) : undefined;
  for (const [product, { version }] of Object.entries(scope.products)) {
    const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
    if (!fs.existsSync(mf)) continue;
    const file = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const pageTok = file.mappings.find((m: any) => m.status === 'approved' && m.concept === 'dsi:concept/color/usage-page/property-background')?.token;
    const t = new BoundaryTests(root, product, version, pageTok);
    const by = new Map<string, any[]>();
    for (const m of file.mappings) if (m.concept.startsWith('dsi:concept/color/')) (by.get(m.token) ?? by.set(m.token, []).get(m.token)!).push(m);
    // --jev: B4 statement judgements for queued tokens the code test cannot decide (ADR 0021 amended).
    const jevB4 = new Map<string, boolean | undefined>();
    if (judgeFn) await Promise.all([...by].filter(([tok, ms]) => !ms.some((m) => m.status === 'approved') && ms.some((m) => m.status === 'proposed' && /on-fill/.test(m.concept)) && t.onFill(tok) === undefined).map(async ([tok]) => { const j = await judgeFn!(product, version, tok, 'B4'); jevB4.set(tok, j.decided); }));
    // B7: Jev's "colors code" judgement for queued tokens the namespace and description leave undecided.
    const jevB7 = new Map<string, boolean | undefined>();
    if (judgeFn) {
      const { codeByName } = await import('./boundary-rules.ts');
      await Promise.all([...by].filter(([tok, ms]) => !ms.some((m) => m.status === 'approved') && ms.some((m) => m.status === 'proposed') && codeByName(t, tok) === undefined && ms.some((m) => /code-surface|syntax-/.test(m.concept))).map(async ([tok]) => { const j = await judgeFn!(product, version, tok, 'B7'); jevB7.set(tok, j.decided); }));
    }
    const breaking: string[] = [];
    let settled = 0, open = 0;
    for (const [token, ms] of by) {
      const ap = ms.find((m) => m.status === 'approved');
      if (ap) { const n = normalize(t, token, ap.concept, !!pageTok, jevB4, jevB7); if (n.applied.length && !n.applied.every((r) => r === 'B1' && /usage-categorical/.test(ap.concept))) breaking.push(`${token}: ${n.applied.join(',')} -> ${n.concept.replace('dsi:concept/color/', '')}`); continue; }
      const props = ms.filter((m) => m.status === 'proposed');
      if (props.length < 1) continue;
      const norm = props.map((m) => ({ m, n: normalize(t, token, m.concept, !!pageTok, jevB4, jevB7) }));
      let keep = norm;
      if (norm.some((x) => x.n.needsEmphasis)) { const withE = norm.filter((x) => /emphasis-/.test(x.n.concept)); if (withE.length) keep = withE; }
      const concepts = [...new Set(keep.map((x) => x.n.concept))];
      if (concepts.length !== 1 || !keep.some((x) => x.n.applied.length) && new Set(props.map((m) => m.concept)).size === 1) { open++; continue; }
      const concept = concepts[0];
      const matches = keep.map((x) => x.m.match);
      if (matches.includes('related') || (matches.includes('broad') && matches.includes('narrow')) || typeof parseConcept(ontology, concept) === 'string') { open++; continue; }
      // ADR 0022: the owner ruled that visual colors bind graphic exactly.
      const match = keep.some((x) => x.n.applied.includes('B5')) ? 'exact' : matches.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
      settled++;
      if (dry) { console.log(`  ${product} ${token} -> ${concept.replace('dsi:concept/color/', '')} ${match} [${[...new Set(keep.flatMap((x) => x.n.applied))].join(',') || 'filter'}]`); continue; }
      const id = 'm-' + crypto.createHash('sha1').update([token, concept, match].join('|')).digest('hex').slice(0, 12);
      for (const m of props) if (m.id !== id) { m.status = 'rejected'; m.review = { by: 'boundary-rule', at, note: `Settled by boundary tests (ADR 0021): ${concept} ${match}.` }; }
      file.mappings = file.mappings.filter((m: any) => m.id !== id);
      file.mappings.push({ id, token, concept, match, confidence: Math.min(...keep.map((x) => x.m.confidence ?? 1)), status: 'approved', rationale: `Answers normalized by the boundary tests (${[...new Set(keep.flatMap((x) => x.n.applied))].join(', ') || 'B1 filter'}) agree. Evidence: values and names (ADR 0021).`, provenance: { agent: 'dsi-mapper', at, method: 'boundary-rule-v1' }, review: { by: 'boundary-rule', at, note: 'Deterministic boundary tests (ADR 0021).' } });
    }
    totals.settled += settled; totals.stillOpen += open; totals.approvedBreaking += breaking.length;
    conflicts.push(...breaking.map((b) => `${product} ${b}`));
    console.log(`${product}: ${settled} settled, ${open} still open, ${breaking.length} approved mappings break a test`);
    for (const b of breaking.slice(0, 3)) console.log('    breaks: ' + b);
    if (!dry && settled) {
      const b5 = file.mappings.filter((m: any) => m.status === 'approved' && m.provenance?.method === 'boundary-rule-v1' && /property-graphic/.test(m.concept) && !isRegistered(ontology, m.concept)).map((m: any) => m.concept);
      if (b5.length) { registerConcepts(root, ontology, b5); ontology = await loadOntology(path.join(root, 'ontology')); console.log(`  registered ${new Set(b5).size} graphic concept(s) (ADR 0022)`); }
    }
    if (!dry && settled) { const held = gateUnregistered(ontology, file); if (held.length) console.log(`  ${held.length} held: new concepts`); file.mappings.sort((a: any, b: any) => a.token.localeCompare(b.token) || a.id.localeCompare(b.id)); fs.writeFileSync(mf, JSON.stringify(file, null, 2) + '\n'); }
  }
  fs.writeFileSync(path.join(root, '.cache/boundary-conflicts.txt'), conflicts.join('\n') + '\n');
  console.log(`boundary-rules${dry ? ' (dry run)' : ''}: ${JSON.stringify(totals)}; approved conflicts -> .cache/boundary-conflicts.txt`);
} else if (cmd === 'triage-conflicts') {
  // ADR 0021 amended: Jev's statement judgement on approved mappings that break a boundary test (B4, B6 only).
  const { triageConflicts } = await import('./triage.ts');
  const { boundaryJudge } = await import('@dsi/jev/roles');
  const list = await triageConflicts(root, scope, await boundaryJudge(root, ontology));
  fs.writeFileSync(path.join(root, '.cache/boundary-triage.json'), JSON.stringify(list, null, 1));
  const c: Record<string, number> = {};
  for (const x of list) c[x.verdict] = (c[x.verdict] ?? 0) + 1;
  console.log(`triage: ${JSON.stringify(c)} -> .cache/boundary-triage.json`);
  for (const x of list.filter((x) => x.verdict !== 'owner').slice(0, 40)) console.log(`  ${x.verdict.padEnd(8)} ${x.product} ${x.token} [${x.rules}] ${x.detail}`);
} else if (cmd === 'usage-check') {
  // Measure the token-usage graph against approved mappings: coverage and agreement per facet (property, state,
  // container), plus how many open and conflicting tokens have usage evidence.
  const { loadUsage, evidenceOf, agrees } = await import('./usage-evidence.ts');
  for (const product of process.argv.slice(4).length ? process.argv.slice(4) : Object.keys(scope.products)) {
    const { version } = scope.products[product];
    const usage = loadUsage(root, product, version);
    if (!usage) { console.log(`${product}: no usage graph`); continue; }
    const file = readMappings(root, product, version) as any;
    const approved = file.mappings.filter((m: any) => m.status === 'approved' && m.concept.startsWith('dsi:concept/color/'));
    const open = new Set(file.mappings.filter((m: any) => m.status === 'proposed').map((m: any) => m.token));
    const tally: Record<string, [number, number]> = { property: [0, 0], state: [0, 0], container: [0, 0] };
    const disagree: string[] = [];
    let covered = 0;
    for (const m of approved) {
      const uses = usage.get(m.token);
      if (!uses?.length) continue;
      covered++;
      const e = evidenceOf(uses);
      const a = agrees(e, m.concept);
      for (const k of ['property', 'state', 'container'] as const) if (a[k] !== undefined) { tally[k][1]++; if (a[k]) tally[k][0]++; else if (disagree.length < 400) disagree.push(`${k}: ${m.token} approved ${m.concept.replace('dsi:concept/color/', '')}; usage ${k === 'property' ? e.property : k === 'state' ? e.state ?? 'none' : e.container} (${e.uses} uses: ${e.components.slice(0, 3).join(', ')})`); }
    }
    const openCovered = [...open].filter((t) => usage.get(t as string)?.length).length;
    const pct = ([a, n]: [number, number]) => (n ? `${Math.round((1000 * a) / n) / 10}% of ${n}` : '-');
    console.log(`${product}: approved color mappings ${approved.length}, with usage ${covered} (${Math.round((100 * covered) / approved.length)}%); agreement property ${pct(tally.property)}, state ${pct(tally.state)}, container ${pct(tally.container)}; open tokens with usage ${openCovered} of ${open.size}`);
    fs.writeFileSync(path.join(root, `.cache/usage-disagreements.${product}.txt`), disagree.join('\n') + '\n');
  }
} else if (cmd === 'boundaries') {
  // Rank the vocabulary boundaries the answers disagree on (docs/planning/boundaries.md; one owner decision per pair).
  const { mineBoundaries } = await import('./boundaries.ts');
  const jevRun = process.argv.includes('--jev') ? process.argv[process.argv.indexOf('--jev') + 1] : 'r5-c-contrastive';
  const list = mineBoundaries(root, scope, jevRun);
  const out = path.join(root, '.cache/boundaries.json');
  fs.writeFileSync(out, JSON.stringify(list, null, 1));
  const top = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 25);
  console.log(`${list.length} boundary pairs -> ${path.relative(root, out)}`);
  for (const b of list.slice(0, top)) console.log(`${b.score.toFixed(0).padStart(4)}  ${b.key}  open ${b.open}, decided ${b.history} (${b.a.value} ${b.a.won} : ${b.b.value} ${b.b.won}), audit ${b.audit}, jev ${b.jev}, ${b.systems.length} systems`);
} else if (cmd === 'rank-emphasis') {
  // ADR 0018: settle emphasis by contrast rank where both agents agree on everything else.
  const product = process.argv[5];
  if (!run || !product) { console.error(USAGE); process.exit(2); }
  const { version } = scope.products[product];
  const rd = (r: string) => JSON.parse(fs.readFileSync(path.join(runDir, `${product}.${r}.proposals.json`), 'utf8')).proposals;
  const mf = path.join(root, 'mappings', product, `${version}.mappings.json`);
  const file = JSON.parse(fs.readFileSync(mf, 'utf8'));
  // Its own earlier answers (method emphasis-rank-*) are re-derived; every other approval is left alone.
  const approved = new Set(file.mappings.filter((m: any) => m.status === 'approved' && !String(m.provenance?.method ?? '').startsWith('emphasis-rank')).map((m: any) => m.token));
  const pageTok = file.mappings.find((m: any) => m.status === 'approved' && m.concept === 'dsi:concept/color/usage-page/property-background')?.token;
  const r = rankEmphasis(root, product, version, rd('a'), rd('b'), () => pageTok);
  const at = new Date().toISOString();
  let added = 0;
  for (const x of r.out) {
    if (approved.has(x.token)) continue;
    if (typeof parseConcept(ontology, x.concept) === 'string') { r.skipped.push(`${x.token}: invalid ${x.concept}`); continue; }
    const newId = r.id(x.token, x.concept, x.match);
    const prior = file.mappings.find((m: any) => m.token === x.token && m.status === 'approved' && String(m.provenance?.method ?? '').startsWith('emphasis-rank'));
    if (prior && prior.concept === x.concept && prior.match === x.match) continue;
    if (prior) { prior.status = 'superseded'; prior.supersededBy = newId; prior.review = { ...prior.review, at, note: `Re-derived by contrast rank: ${x.concept}.` }; }
    for (const m of file.mappings) if (m.token === x.token && m.status === 'proposed') { m.status = 'rejected'; m.review = { by: 'rank-rule', at, note: `Emphasis settled by contrast rank (ADR 0018): ${x.concept}.` }; }
    file.mappings = file.mappings.filter((m: any) => m.id !== newId); // an agent proposal of the same answer is replaced, not duplicated
    file.mappings.push({ id: newId, token: x.token, concept: x.concept, match: x.match, confidence: 1, status: 'approved', rationale: `Both agents agree on every facet but emphasis; ${x.note} (ADR 0018).`, provenance: { agent: 'dsi-mapper', at, method: 'emphasis-rank-v1' }, review: { by: 'rank-rule', at, note: 'Deterministic: contrast against the page in every mode.' } });
    added++;
  }
  file.mappings.sort((a: any, b: any) => a.token.localeCompare(b.token) || a.id.localeCompare(b.id));
  { const held = gateUnregistered(ontology, file); if (held.length) console.log(`${held.length} answer(s) use new concepts and wait for owner approval (ADR 0019)`); }
  fs.writeFileSync(mf, JSON.stringify(file, null, 2) + '\n');
  console.log(`${product}: ${added} settled by contrast rank; ${r.skipped.length} families or tokens skipped`);
  for (const s of r.skipped.slice(0, 15)) console.log('  ' + s);
} else if (cmd === 'audit-prepare') {
  if (!run) { console.error(USAGE); process.exit(2); }
  const dir = path.join(root, '.cache/audit', run);
  for (const product of Object.keys(scope.products)) {
    // --only <prescreen.json>: audit only the flagged tokens (`dsi-jev prescreen` writes the file).
    const onlyFile = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
    const only = onlyFile ? new Set<string>((JSON.parse(fs.readFileSync(onlyFile, 'utf8')).flags as any[]).filter((f) => f.product === product).map((f) => f.token)) : undefined;
    if (only && !only.size) continue;
    const r = prepareAudit(root, ontology, scope, product, dir, only);
    const by: Record<string, number> = {};
    for (const f of r.findings) by[f.check] = (by[f.check] ?? 0) + 1;
    console.log(`${product}: ${r.count} approved mappings to audit; check findings ${JSON.stringify(by)}`);
    for (const f of r.findings.slice(0, 50)) console.log(`  ${f.check}  ${f.token}: ${f.detail}`);
  }
} else if (cmd === 'audit-check' || cmd === 'audit-merge') {
  if (!run) { console.error(USAGE); process.exit(2); }
  const dir = path.join(root, '.cache/audit', run);
  const products = cmd === 'audit-check' ? [process.argv[5]] : Object.keys(scope.products);
  for (const product of products) {
    // An audit run may cover only some products: merge skips those without verdicts.
    if (cmd === 'audit-merge' && !fs.existsSync(path.join(dir, `${product}.verdicts.json`))) { console.log(`${product}: no verdicts in this run, skipped`); continue; }
    const packet = JSON.parse(fs.readFileSync(path.join(dir, `${product}.audit-packet.json`), 'utf8'));
    const expected = new Map<string, string>(packet.items.map((i: any) => [i.token, i.mappingId]));
    try {
      const v = readVerdicts(path.join(dir, `${product}.verdicts.json`), ontology, expected);
      const c: Record<string, number> = {};
      for (const x of v.verdicts) c[x.verdict] = (c[x.verdict] ?? 0) + 1;
      if (cmd === 'audit-check') { console.log(`OK: ${v.verdicts.length} verdicts ${JSON.stringify(c)}`); continue; }
      const checks = packet.items.flatMap((i: any) => i.checks.map((d: string) => ({ token: i.token, finding: d })));
      const out = path.join(root, 'mappings', product, `${scope.products[product].version}.audit.json`);
      if (process.argv.includes('--partial')) {
        // --partial: a re-audit of some tokens replaces only their verdicts; each keeps the run and the verdict it replaced.
        const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
        const byTok = new Map<string, any>(prev.verdicts.map((x: any) => [x.token, x]));
        for (const x of v.verdicts as any[]) { const old = byTok.get(x.token); byTok.set(x.token, { ...x, rerun: { run, model: v.model, at: v.at, previous: old?.rerun ? old.rerun.previous : old?.verdict ?? x.verdict } }); }
        prev.verdicts = [...byTok.values()].sort((a: any, b: any) => a.token.localeCompare(b.token));
        fs.writeFileSync(out, JSON.stringify(prev, null, 2) + '\n');
      } else fs.writeFileSync(out, JSON.stringify({ packet: v.packet, model: v.model, at: v.at, checks, verdicts: v.verdicts.sort((a: any, b: any) => a.token.localeCompare(b.token)) }, null, 2) + '\n');
      console.log(`${product}: ${JSON.stringify(c)} -> ${path.relative(root, out)}`);
      for (const x of v.verdicts.filter((x: any) => x.verdict === 'contradicted')) console.log(`  disputed ${x.token}: ${packet.items.find((i: any) => i.token === x.token).mapping.concept.replace('dsi:concept/color/', '')} -> ${x.suggested.concept.replace('dsi:concept/color/', '')} ${x.suggested.match}`);
    } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
  }
} else if (cmd === 'queue') {
  for (const [product, { version }] of Object.entries(scope.products)) {
    const m = readMappings(root, product, version) as any;
    if (!m) continue;
    const open = new Map<string, any[]>();
    for (const x of m.mappings ?? []) if (x.status === 'proposed') (open.get(x.token) ?? open.set(x.token, []).get(x.token)!).push(x);
    for (const x of m.unmapped ?? []) if (x.status === 'proposed') (open.get(x.token) ?? open.set(x.token, []).get(x.token)!).push({ ...x, concept: '(unmapped)', match: '' });
    if (!open.size) continue;
    console.log(`\n${product}@${version}: ${open.size} token(s) need a decision`);
    for (const [token, xs] of [...open].sort()) console.log(`  ${token}\n${xs.map((x) => `    ${x.provenance.model}: ${x.concept} ${x.match}${x.confidence !== undefined ? ` (${x.confidence})` : ''}`).join('\n')}`);
  }
} else { console.error(USAGE); process.exit(2); }
