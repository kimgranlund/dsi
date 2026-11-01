export const meta = {
  name: 'dsi-words',
  description: 'DesignSystemsIndex vocabulary round: vocab-prepare, two blind agents (opus, sonnet), vocab-check, vocab-merge',
  whenToUse: 'Stage 4 of the add-design-system skill. args: {product, version, run, docs?}; a run name containing "scale" drafts foundation words.',
  phases: [
    { title: 'Prepare', detail: 'vocab-prepare' },
    { title: 'Answer', detail: 'roles a (opus) and b (sonnet), checked, one re-prompt' },
    { title: 'Merge', detail: 'vocab-merge' },
  ],
}

const ROOT = args.root || '/Users/kimba/Projects/design-system-index'
const SKILL = `${ROOT}/.claude/skills/add-design-system`
const { product, version, run } = args
if (!product || !version || !run) throw new Error('args: {product, version, run, docs?} required')
const docs = args.docs || 'the official docs of the system'
const CLI = 'node packages/classify/src/cli.ts'
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
const prep = await sh(`${CLI} vocab-prepare ${product} ${run}`, 'vocab-prepare', 'Prepare')
if (!prep || prep.exitCode !== 0) return { ok: false, stage: 'vocab-prepare', output: prep && prep.output }
log(prep.output.trim().split('\n').pop())

phase('Answer')
const roles = [{ role: 'a', model: 'opus' }, { role: 'b', model: 'sonnet' }]
const answers = await parallel(roles.map(({ role, model }) => () => {
  const check = `${CLI} vocab-check ${product} ${run} ${role}`
  return judged(brief('words.md', { product, version, role, docs, packet: `${ROOT}/.cache/classify/${run}/${product}.${role}.packet.json`, check }), model, `words-${product}-${role}`, 'Answer', check)
}))
if (answers.some((x) => !x || !x.ok)) return { ok: false, stage: 'vocab-check', answers }

phase('Merge')
const merged = await sh(`${CLI} vocab-merge ${product} ${run}`, 'vocab-merge', 'Merge')
const m = /(\d+) terms approved by agreement, (\d+) noise words agreed, (\d+) step words agreed, (\d+) words queued/.exec((merged && merged.output) || '')
return {
  ok: !!merged && merged.exitCode === 0,
  run,
  counts: m ? { approved: +m[1], noise: +m[2], steps: +m[3], queued: +m[4] } : null,
  merge: merged && merged.output,
  reports: answers.map((x) => ({ label: x.label, check: x.check, report: x.report })),
}
