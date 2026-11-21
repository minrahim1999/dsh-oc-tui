// Agent presets ("modes"): composition of new, resumed and forked sessions
// against a fake registry with the dsh 0.2.2 surface, the roster listing,
// `/mode` argument matching, and the bundle's preset layers.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  composeForkedSession,
  composeNewSession,
  composeResumedSession,
  defaultModeId,
  isBlankSession,
  listModes,
  matchMode,
  modeLabelKey,
  modeOfAgent,
  presetRegistry,
} from '../lib/agent-presets.js'

let failed = 0
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log('ok   ' + name)
  else { console.log('FAIL ' + name + '  got ' + a + '  want ' + e); failed++ }
}
const ok = (name, cond) => cond ? console.log('ok   ' + name) : (console.log('FAIL ' + name), failed++)
async function rejects(name, promise, pattern) {
  try { await promise; console.log('FAIL ' + name + '  (resolved)'); failed++ } catch (error) {
    ok(name, pattern.test(String(error?.message ?? error)))
  }
}

// The registry surface lib/agent-presets.js relies on, as dsh 0.2.2 ships it.
function fakeRegistry({ presets = ['standard', 'ptc', 'minimal', 'cordis'], broken = {}, selectedDefault } = {}) {
  const mounts = []
  const recorded = new Map()
  const composed = new Map()
  const registry = {
    mounts,
    recorded,
    get defaultId() { return selectedDefault ?? 'standard' },
    async list() {
      return presets.map((id, i) => ({ id, order: i + 1, ...(broken[id] ? { broken: broken[id] } : {}) }))
    },
    async resolve(id) {
      const wanted = id ?? this.defaultId
      if (!presets.includes(wanted)) {
        const error = new Error(`Unknown agent preset: ${wanted}`)
        error.code = 'agent-preset/not-found'
        throw error
      }
      return { id: wanted, ...(broken[wanted] ? { broken: broken[wanted] } : {}) }
    },
    async mount(ctx, id) {
      const preset = await this.resolve(id)
      mounts.push({ ctx, id: preset.id })
      composed.set(ctx, preset.id)
      return { id: preset.id }
    },
    composedPreset(ctx) { return composed.get(ctx) },
    presetForSession(session) { return recorded.get(session) ?? null },
    async select(agent, id) {
      if (agent.started) {
        const error = new Error('This session has already started')
        error.code = 'agent-preset/locked'
        throw error
      }
      await this.mount(agent.ctx, id)
      recorded.set(agent.session, id)
      return id
    },
  }
  return registry
}

// ---- discovery -------------------------------------------------------------
{
  const registry = fakeRegistry()
  eq('presetRegistry finds the agentPresets service', presetRegistry({ get: (name) => name === 'agentPresets' ? registry : undefined }) === registry, true)
  eq('presetRegistry ignores a host without it', presetRegistry({ get: () => undefined }), undefined)
  eq('presetRegistry ignores a 0.1.x-shaped service without mount()', presetRegistry({ get: () => ({ list() {} }) }), undefined)
  eq('presetRegistry survives a throwing ctx.get', presetRegistry({ get() { throw new Error('boom') } }), undefined)
  eq('defaultModeId reads the registry default', defaultModeId(fakeRegistry({ selectedDefault: 'ptc' })), 'ptc')
  eq('defaultModeId without a registry', defaultModeId(undefined), undefined)
}

// ---- roster ----------------------------------------------------------------
{
  const registry = fakeRegistry({ broken: { cordis: 'tool-cordis failed to load' }, selectedDefault: 'ptc' })
  const modes = await listModes(registry)
  eq('listModes keeps roster order', modes.map((m) => m.id), ['standard', 'ptc', 'minimal', 'cordis'])
  eq('listModes marks the default', modes.filter((m) => m.isDefault).map((m) => m.id), ['ptc'])
  eq('listModes keeps a broken preset with its reason', modes.find((m) => m.id === 'cordis').broken, 'tool-cordis failed to load')
  eq('listModes without a registry is empty', await listModes(undefined), [])
  eq('Creator is the cordis preset', modeLabelKey('cordis'), 'mode.cordis')
  eq('an unknown preset has no label key', modeLabelKey('custom-review'), undefined)
  const labels = { standard: 'Standard', ptc: 'PTC', minimal: 'Minimal', cordis: 'Creator' }
  eq('matchMode by id', matchMode(modes, 'ptc')?.id, 'ptc')
  eq('matchMode is case-insensitive', matchMode(modes, 'PTC')?.id, 'ptc')
  eq('matchMode by display label', matchMode(modes, 'creator', (id) => labels[id])?.id, 'cordis')
  eq('matchMode with no match', matchMode(modes, 'nope'), undefined)
  eq('matchMode with empty input', matchMode(modes, '  '), undefined)
}

// ---- new sessions ----------------------------------------------------------
{
  const registry = fakeRegistry()
  const composition = await composeNewSession(registry, undefined)
  eq('a new session resolves the default preset', composition.agentPreset, 'standard')
  const agentCtx = {}
  await composition.setup(agentCtx)
  eq('setup mounts the resolved preset into the agent scope', registry.mounts.map((m) => [m.ctx === agentCtx, m.id]), [[true, 'standard']])

  const chosen = await composeNewSession(registry, 'minimal')
  eq('an explicit mode wins over the default', chosen.agentPreset, 'minimal')
  await rejects('an unknown mode rejects with the registry error', composeNewSession(registry, 'nope'), /unknown agent preset/i)
  await rejects('a broken mode is refused before the session exists',
    composeNewSession(fakeRegistry({ broken: { ptc: 'import failed' } }), 'ptc'), /unavailable: import failed/)

  let extraRan = 0
  const plain = await composeNewSession(undefined, 'ptc', () => { extraRan++ })
  eq('without a registry no preset is recorded', plain.agentPreset, undefined)
  plain.setup({})
  eq('without a registry the extra setup still runs', extraRan, 1)
  eq('without a registry or extra there is no setup', (await composeNewSession(undefined)).setup, undefined)
}

// ---- resumed sessions --------------------------------------------------------
{
  const registry = fakeRegistry()
  const session = {}
  registry.recorded.set(session, 'ptc')
  const setup = composeResumedSession(registry)
  const agentCtx = {}
  await setup(agentCtx, { session })
  eq('a resumed session runs the preset its log records', registry.mounts.at(-1).id, 'ptc')

  let fallback
  const legacy = {}
  await composeResumedSession(registry, undefined, (info) => { fallback = info })({}, { session: legacy })
  eq('a session recorded before presets gets the default', registry.mounts.at(-1).id, 'standard')
  eq('...and reports no recorded mode', fallback, { used: 'standard' })

  const gone = {}
  registry.recorded.set(gone, 'custom-review')
  await composeResumedSession(registry, undefined, (info) => { fallback = info })({}, { session: gone })
  eq('a recorded preset that left the roster falls back to the default', fallback, { recorded: 'custom-review', used: 'standard' })
  eq('without a registry a resume has no setup', composeResumedSession(undefined), undefined)
}

// ---- forks -------------------------------------------------------------------
{
  const registry = fakeRegistry()
  const parent = { ctx: {}, session: {} }
  await registry.mount(parent.ctx, 'ptc')
  const fork = composeForkedSession(registry, parent)
  eq('a fork records its parent preset', fork.agentPreset, 'ptc')
  const childCtx = {}
  await fork.setup(childCtx)
  eq('a fork mounts its parent preset', registry.mounts.at(-1).id, 'ptc')
  eq('modeOfAgent reads the composed preset', modeOfAgent(registry, parent), 'ptc')
  const recordedOnly = { ctx: {}, session: {} }
  registry.recorded.set(recordedOnly.session, 'minimal')
  eq('modeOfAgent falls back to the session record', modeOfAgent(registry, recordedOnly), 'minimal')
  eq('a fork of a preset-free parent records nothing', composeForkedSession(registry, { ctx: {}, session: {} }).agentPreset, undefined)
}

// ---- blank sessions ----------------------------------------------------------
{
  const blank = { session: {} }
  const started = { session: {} }
  const ctx = {
    agents: { turnBoundaryOf: (session) => session === blank.session
      ? { openTurnStartSeq: null, lastTurn: 0 }
      : { openTurnStartSeq: null, lastTurn: 1 } },
  }
  ok('a session with no turn is blank', isBlankSession(ctx, blank))
  ok('a session with a finished turn is not blank', !isBlankSession(ctx, started))
  ok('without turnBoundaryOf the event log decides (blank)', isBlankSession({}, { session: { snapshotEvents: () => [{ type: 'session/created' }] } }))
  ok('without turnBoundaryOf the event log decides (started)', !isBlankSession({}, { session: { snapshotEvents: () => [{ type: 'turn/start' }] } }))
}

// ---- bundle layers -------------------------------------------------------------
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const layers = manifest.dsh.bundle.patch
  eq('the TUI patch is the first bundle layer', layers[0], './cordis.patch.yml')
  ok('every listed preset layer exists and is shipped', layers.every((rel) => existsSync(join(root, rel)))
    && manifest.files.includes('presets'))
  const plane = readFileSync(join(root, 'presets/agent-plane.patch.yml'), 'utf8')
  ok('the agent-plane layer mounts the preset registry', /id: agent-preset-registry\n\s+name: '@deepseek-ai\/dsh-agent-preset-registry'/.test(plane))
  ok('the agent-plane layer disables the process-wide bash tool', /- id: tool-bash\n\s+disabled: true/.test(plane))
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
    const text = readFileSync(join(root, `presets/${id}.patch.yml`), 'utf8')
    ok(`preset ${id} is declared with its id`, text.includes(`- id: preset-${id}`) && new RegExp(`\\n\\s+id: ${id}\\n`).test(text))
  }
  ok('the TUI patch no longer declares a process-wide ask-user tool', !/^\s+- id: tool-ask-user/m.test(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')))
  ok('recommended dsh is one of the tested versions', manifest.dshSupport.tested.includes(manifest.dshSupport.recommended))
}

if (failed > 0) process.exit(1)
console.log('agent preset tests passed')
