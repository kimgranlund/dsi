export const meta = {
  name: 'dsi-audit',
  description: 'DesignSystemsIndex evidence audit: audit-prepare, a fable auditor that mapped none, audit-check, audit-merge',
  whenToUse: 'Stage 7 of the add-design-system skill. args: {product, version, run, docs?, scope?}',
  phases: [
    { title: 'Prepare', detail: 'deterministic checks + auditor packets' },
    { title: 'Audit', detail: 'fable auditor, blind to who approved; checked, one re-prompt', model: 'fable' },
    { title: 'Merge', detail: 'audit-merge, disputes listed' },
  ],
}

const ROOT = args.root || '/Users/kimba/Projects/design-system-index'
const SKILL = `${ROOT}/.claude/skills/add-design-system`
const { product, version, run } = args
if (!product || !version || !run) throw new Error('args: {product, version, run, docs?, scope?} required')
const scope = args.scope || 'color-v1'
const docs = args.docs || 'the URLs listed in the packet `docs`'
const CLI = 'node packages/mapper/src/cli.ts'
const RUN = { type: 'object', properties: { exitCode: { type: 'number' }, output: { type: 'string' } }, required: ['exitCode', 'output'] }
const sh = (cmd, label, phase) => agent(`Run this one shell command from ${ROOT} exactly as written, once. Do not edit any file, fix anything or run anything else.\n\n${cmd}\n\nReturn its exit code and the last 60 lines of its combined output verbatim.`, { label, phase, schema: RUN, model: 'sonnet', effort: 'low' })
const brief = (file, vars) => `Read the brief ${SKILL}/prompts/${file} and follow it. Values for its {placeholders}:\n` + Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n')

phase('Prepare')
const prep = await sh(`${CLI} audit-prepare ${scope} ${run}`, 'audit-prepare', 'Prepare')
if (!prep || prep.exitCode !== 0) return { ok: false, stage: 'audit-prepare', output: prep && prep.output }
log((prep.output.split('\n').find((l) => l.startsWith(`${product}:`)) || `${product}: no packet line`).slice(0, 200))

phase('Audit')
const check = `${CLI} audit-check ${scope} ${run} ${product}`
const prompt = brief('audit.md', { product, version, docs, packet: `${ROOT}/.cache/audit/${run}/${product}.audit-packet.json`, check })
let report = await agent(prompt, { label: `audit-${product}`, phase: 'Audit', model: 'fable' })
let r = await sh(check, 'audit-check', 'Audit')
if (!r || r.exitCode !== 0) {
  report = await agent(`${prompt}\n\nThe verdicts file failed its check. Fix it by judgment until it passes:\n${check}\nFailure:\n${r ? r.output : 'check did not run'}`, { label: `audit-${product} retry`, phase: 'Audit', model: 'fable' })
  r = await sh(check, 'audit-recheck', 'Audit')
  if (!r || r.exitCode !== 0) return { ok: false, stage: 'audit-check', output: r && r.output, report }
}

phase('Merge')
// audit-merge skips products without verdicts in this run.
const merged = await sh(`${CLI} audit-merge ${scope} ${run}`, 'audit-merge', 'Merge')
const out = (merged && merged.output) || ''
const lines = out.split('\n')
const i = lines.findIndex((l) => l.startsWith(`${product}: {`))
let counts = null
try { counts = i >= 0 ? JSON.parse(lines[i].slice(product.length + 2, lines[i].indexOf(' ->'))) : null } catch (e) { counts = null }
const disputes = []
for (let j = i + 1; i >= 0 && j < lines.length && lines[j].startsWith('  disputed '); j++) disputes.push(lines[j].trim())
return { ok: !!merged && merged.exitCode === 0, run, counts, disputes, check: r.output, report }
