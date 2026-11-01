export const meta = {
  name: 'dsi-verify-ingest',
  description: 'DesignSystemsIndex second derivation: compare ingested values with the package\'s own consumer output; a second model re-checks the mismatch claims',
  whenToUse: 'Stage 3 of the add-design-system skill. args: {product, version, consumer, scratch}',
  phases: [
    { title: 'Derive', detail: 'independent derivation from built CSS/JSON/alias files (sonnet)' },
    { title: 'Confirm', detail: 'a second model reproduces each mismatch pattern (opus)' },
  ],
}

const ROOT = args.root || '/Users/kimba/Projects/design-system-index'
const SKILL = `${ROOT}/.claude/skills/add-design-system`
const { product, version, consumer, scratch } = args
if (!product || !version || !consumer || !scratch) throw new Error('args: {product, version, consumer (the built output to compare against), scratch (writable dir)} required')
const brief = (file, vars) => `Read the brief ${SKILL}/prompts/${file} and follow it. Values for its {placeholders}:\n` + Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n')

const RESULT = {
  type: 'object',
  properties: {
    compared: { type: 'number' }, matches: { type: 'number' }, mismatches: { type: 'number' },
    missingInOurs: { type: 'number' }, extraInOurs: { type: 'number' },
    patterns: { type: 'array', items: { type: 'object', properties: { pattern: { type: 'string' }, count: { type: 'number' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['pattern', 'count', 'examples'] } },
    unchecked: { type: 'string' },
  },
  required: ['compared', 'matches', 'mismatches', 'missingInOurs', 'extraInOurs', 'patterns', 'unchecked'],
}
const CONFIRM = {
  type: 'object',
  properties: { results: { type: 'array', items: { type: 'object', properties: { pattern: { type: 'string' }, reproduced: { type: 'boolean' }, cause: { type: 'string' } }, required: ['pattern', 'reproduced', 'cause'] } } },
  required: ['results'],
}

phase('Derive')
const derived = await agent(brief('verify-ingest.md', { product, version, consumer, scratch: `${scratch}/verify-${product}` }), { label: `verify-${product}`, phase: 'Derive', model: 'sonnet', schema: RESULT })
if (!derived) return { ok: false, stage: 'derive' }
if (!derived.patterns.length) return { ok: derived.mismatches === 0, ...derived, confirmed: [] }

phase('Confirm')
// A mismatch claim is checked by another model before anyone changes the adapter.
const confirmed = await agent(`Independent re-check for DesignSystemsIndex (repo ${ROOT}). Read-only in the repo; scratch only under ${scratch}/confirm-${product}. Never execute package JavaScript. Another agent compared data/native/${product}/${version}/ (resolve with packages/resolve/src/native.ts) against ${consumer} and reports these mismatch patterns:\n\n${JSON.stringify(derived.patterns, null, 1)}\n\nFor each pattern, reproduce its examples yourself from the files (ours and shipped) and say whether the mismatch is real, and its likely cause in the adapter or source config (file and function when you can find it). Report only what you reproduced.`, { label: `confirm-${product}`, phase: 'Confirm', model: 'opus', schema: CONFIRM })
return { ok: false, ...derived, confirmed: confirmed ? confirmed.results : null }
