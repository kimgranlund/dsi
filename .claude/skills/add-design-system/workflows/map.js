export const meta = {
  name: 'dsi-map',
  description: 'DesignSystemsIndex color-v1 mapping round: prepare, two blind agents (opus, sonnet), check, merge',
  whenToUse: 'Stage 5 of the add-design-system skill. args: {product, version, run, docs?, scope?}. Also runs rank-emphasis and map-scales.',
  phases: [
    { title: 'Prepare', detail: 'dsi-map prepare' },
    { title: 'Map', detail: 'roles a (opus) and b (sonnet), checked, one re-prompt' },
    { title: 'Merge', detail: 'merge, rank-emphasis, map-scales' },
  ],
}

const ROOT = args.root || '/Users/kimba/Projects/design-system-index'
const SKILL = `${ROOT}/.claude/skills/add-design-system`
const { product, version, run } = args
if (!product || !version || !run) throw new Error('args: {product, version, run, docs?, scope?} required')
const scope = args.scope || 'color-v1'
const docs = args.docs || 'the official color docs of the system'
const CLI = 'node packages/mapper/src/cli.ts'
const RUN = { type: 'object', properties: { exitCode: { type: 'number' }, output: { type: 'string' } }, required: ['exitCode', 'output'] }
const sh = (cmd, label, phase) => agent(`Run this one shell command from ${ROOT} exactly as written, once. Do not edit any file, fix anything or run anything else.\n\n${cmd}\n\nReturn its exit code and the last 40 lines of its combined output verbatim.`, { label, phase, schema: RUN, model: 'sonnet', effort: 'low' })
const brief = (file, vars) => `Read the brief ${SKILL}/prompts/${file} and follow it. Values for its {placeholders}:\n` + Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n')

async function judged(prompt, model, label, phase, check) {
  const first = await agent(prompt, { label, phase, model })
  let r = await sh(check, `${label} check`, phase)
  if (r && r.exitCode === 0) return { label, ok: true, check: r.output, report: first }
  const again = await agent(`${prompt}\n\nThe output file failed its check. Fix the file by judgment (not a deciding script) until it passes:\n${check}\nFailure:\n${r ? r.output : 'check did not run'}`, { label: `${label} retry`, phase, model })
  r = await sh(check, `${label} recheck`, phase)
  return { label, ok: !!r && r.exitCode === 0, check: r ? r.output : 'check did not run', report: again }
}

phase('Prepare')
const prep = await sh(`${CLI} prepare ${scope} ${run}`, 'prepare', 'Prepare')
if (!prep || prep.exitCode !== 0) return { ok: false, stage: 'prepare', output: prep && prep.output }
const line = prep.output.split('\n').find((l) => l.startsWith(`${product}:`))
if (!line) return { ok: false, stage: 'prepare', output: `no packet line for ${product}; is it in packages/mapper/scopes/${scope}.json?\n${prep.output}` }
log(line)

phase('Map')
const roles = [{ role: 'a', model: 'opus' }, { role: 'b', model: 'sonnet' }]
const answers = await parallel(roles.map(({ role, model }) => () => {
  const check = `${CLI} check ${scope} ${run} ${product} ${role}`
  return judged(brief('map.md', { product, version, role, docs, packet: `${ROOT}/.cache/mapper/${run}/${product}.${role}.packet.json`, check }), model, `map-${product}-${role}`, 'Map', check)
}))
if (answers.some((x) => !x || !x.ok)) return { ok: false, stage: 'check', answers }

phase('Merge')
const merged = await sh(`${CLI} merge ${scope} ${run}`, 'merge', 'Merge')
const out = (merged && merged.output) || ''
const rank = merged && merged.exitCode === 0 ? await sh(`${CLI} rank-emphasis ${scope} ${run} ${product}`, 'rank-emphasis', 'Merge') : null
const scales = rank && rank.exitCode === 0 ? await sh(`node packages/classify/src/cli.ts map-scales ${product}`, 'map-scales', 'Merge') : null
const m = new RegExp(`${product}: (\\d+) approved, (\\d+) approved with the classifier's vote, (\\d+) agreed unmapped, (\\d+) queued`).exec(out)
return {
  ok: !!scales && scales.exitCode === 0,
  run,
  counts: m ? { approved: +m[1], approvedWithClassifier: +m[2], unmapped: +m[3], queued: +m[4] } : null,
  merge: out,
  rank: rank && rank.output.trim().split('\n')[0],
  scales: scales && scales.output.trim().split('\n')[0],
  reports: answers.map((x) => ({ label: x.label, check: x.check, report: x.report })),
}
