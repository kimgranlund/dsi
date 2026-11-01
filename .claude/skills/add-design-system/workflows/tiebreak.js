export const meta = {
  name: 'dsi-tiebreak',
  description: 'DesignSystemsIndex two of three: a blind third model (fable) answers what the first two split on, then vocab-tiebreak or dsi-map tiebreak',
  whenToUse: 'Stages 4 and 6 of the add-design-system skill. args: {kind: "words"|"map", product, version, run, firstRun (map only), docs?, scope?}',
  phases: [
    { title: 'Prepare', detail: 'role-c packet of the contested items' },
    { title: 'Third', detail: 'fable, blind, web research; checked, one re-prompt', model: 'fable' },
    { title: 'Tiebreak', detail: 'approve where the third agrees with one of the first two' },
  ],
}

const ROOT = args.root || '/Users/kimba/Projects/design-system-index'
const SKILL = `${ROOT}/.claude/skills/add-design-system`
const { kind, product, version, run, firstRun } = args
if (!['words', 'map'].includes(kind) || !product || !version || !run || (kind === 'map' && !firstRun)) throw new Error('args: {kind: "words"|"map", product, version, run, firstRun (map), docs?, scope?} required')
const scope = args.scope || 'color-v1'
const docs = args.docs || 'the official docs of the system'
const RUN = { type: 'object', properties: { exitCode: { type: 'number' }, output: { type: 'string' } }, required: ['exitCode', 'output'] }
const sh = (cmd, label, phase) => agent(`Run this one shell command from ${ROOT} exactly as written, once. Do not edit any file, fix anything or run anything else.\n\n${cmd}\n\nReturn its exit code and the last 40 lines of its combined output verbatim.`, { label, phase, schema: RUN, model: 'sonnet', effort: 'low' })
const brief = (file, vars) => `Read the brief ${SKILL}/prompts/${file} and follow it. Values for its {placeholders}:\n` + Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n')

const words = kind === 'words'
const dir = words ? `.cache/classify/${run}` : `.cache/mapper/${run}`
const packet = `${ROOT}/${dir}/${product}.c.packet.json`
const check = words ? `node packages/classify/src/cli.ts vocab-check ${product} ${run} c` : `node packages/mapper/src/cli.ts check ${scope} ${run} ${product} c`
// The map packet for role c is the role-a packet of a fresh prepare (only still-unapproved tokens), relabelled.
const copyC = `python3 -c "import json;R='${dir}/';d=json.load(open(R+'${product}.a.packet.json'));d['role']='c';d['output']=d['output'].replace('.a.proposals','.c.proposals');json.dump(d,open(R+'${product}.c.packet.json','w'),indent=1);print('${product}:',len(d['tokens']),'contested tokens')"`
const prepCmd = words ? `node packages/classify/src/cli.ts vocab-third ${product} ${run}` : `node packages/mapper/src/cli.ts prepare ${scope} ${run} && ${copyC}`

phase('Prepare')
const prep = await sh(prepCmd, 'prepare-c', 'Prepare')
if (!prep || prep.exitCode !== 0) return { ok: false, stage: 'prepare', output: prep && prep.output }
const prepLine = prep.output.trim().split('\n').pop()
log(prepLine)
if (/: 0 (split words|contested tokens)/.test(prepLine)) return { ok: true, skipped: 'nothing contested', output: prepLine }

phase('Third')
const vars = words
  ? { product, version, docs, packet, check }
  : { product, version, docs, packet, check, firstRunDir: `.cache/mapper/${firstRun}/` }
const prompt = brief(words ? 'words-third.md' : 'map-third.md', vars)
const label = `third-${kind}-${product}`
let report = await agent(prompt, { label, phase: 'Third', model: 'fable' })
let r = await sh(check, `${label} check`, 'Third')
if (!r || r.exitCode !== 0) {
  report = await agent(`${prompt}\n\nThe output file failed its check. Fix the file by judgment (not a deciding script) until it passes:\n${check}\nFailure:\n${r ? r.output : 'check did not run'}`, { label: `${label} retry`, phase: 'Third', model: 'fable' })
  r = await sh(check, `${label} recheck`, 'Third')
  if (!r || r.exitCode !== 0) return { ok: false, stage: 'check', output: r && r.output, report }
}

phase('Tiebreak')
const tb = await sh(words ? `node packages/classify/src/cli.ts vocab-tiebreak ${product} ${run}` : `node packages/mapper/src/cli.ts tiebreak ${scope} ${run} ${product} ${firstRun}`, 'tiebreak', 'Tiebreak')
const out = (tb && tb.output) || ''
const m = words
  ? /(\d+) terms, (\d+) noise and (\d+) step words settled/.exec(out)
  : /(\d+) approved and (\d+) agreed unmapped by two of three/.exec(out)
const contested = +((/: (\d+) /.exec(prepLine) || [])[1] || 0)
const settled = m ? (words ? +m[1] + +m[2] + +m[3] : +m[1] + +m[2]) : null
return {
  ok: !!tb && tb.exitCode === 0,
  kind, run,
  // Map: each contested token settles at most once, so the rest is queued. Words: the packet also lists recurring
  // sequences, so only the settled counts are exact.
  counts: m ? (words ? { contested, approved: +m[1], noise: +m[2], steps: +m[3] } : { contested, approved: +m[1], unmapped: +m[2], queued: contested - settled }) : null,
  tiebreak: out, check: r.output, report,
}
