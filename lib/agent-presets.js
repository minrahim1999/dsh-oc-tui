// Agent presets ("modes": Standard, PTC, Minimal, Creator…) for TUI sessions.
//
// A preset decides what one agent composes — its tools, prompt sections and
// skills. The bundle mounts the same declarations the Web UI ships
// (presets/*.patch.yml), and every session the TUI opens is bound to one of
// them through the creation-time `setup` hook, exactly as the harness's own
// session controller does: resolve the id, record it in the session header,
// and mount the preset into the unpublished agent's scope. A session that has
// not started a turn can still change preset (`agentPresets.select`); after
// that the choice is locked and applies to the next session instead.
//
// Everything here degrades to "no presets" when the host mounts no registry,
// so a profile without the preset layer keeps the process-wide composition.

// Display names match the Web UI's (Creator is the `cordis` preset).
const MODE_LABEL_KEYS = Object.freeze({
  standard: 'mode.standard',
  ptc: 'mode.ptc',
  minimal: 'mode.minimal',
  cordis: 'mode.cordis',
})

export function modeLabelKey(id) {
  return MODE_LABEL_KEYS[id]
}

export function presetRegistry(ctx) {
  try {
    const registry = ctx.get('agentPresets')
    return registry && typeof registry.mount === 'function' && typeof registry.resolve === 'function' ? registry : undefined
  } catch {
    return undefined
  }
}

export function defaultModeId(registry) {
  try { return registry?.defaultId || undefined } catch { return undefined }
}

// The roster in display order, with the default marked. A broken preset stays
// listed (with its reason) so the user can see why it cannot be chosen.
export async function listModes(registry) {
  if (!registry || typeof registry.list !== 'function') return []
  const defaultId = defaultModeId(registry)
  const rows = await registry.list()
  return rows.map((row) => ({
    id: row.id,
    ...(row.name ? { name: row.name } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.broken ? { broken: String(row.broken) } : {}),
    isDefault: row.id === defaultId,
  }))
}

export function modeOfSession(registry, session) {
  if (!registry || !session || typeof registry.presetForSession !== 'function') return undefined
  try { return registry.presetForSession(session) ?? undefined } catch { return undefined }
}

// The live agent's composed preset, falling back to the session record.
export function modeOfAgent(registry, agent) {
  if (!registry || !agent) return undefined
  try {
    const composed = typeof registry.composedPreset === 'function' ? registry.composedPreset(agent.ctx) : undefined
    if (composed) return composed
  } catch { /* fall back to the session record */ }
  return modeOfSession(registry, agent.session)
}

function notFound(error) {
  const code = error?.code ?? error?.data?.code
  return code === 'agent-preset/not-found' || /unknown agent preset/i.test(String(error?.message ?? error))
}

// Creation-time composition for a new session: the resolved preset id (for the
// session header) and the setup callback that binds the agent to it. `extra`
// runs first in the same setup, for per-agent listeners the host would install.
export async function composeNewSession(registry, requested, extra) {
  if (!registry) return { agentPreset: undefined, setup: extra ? (agentCtx) => { extra(agentCtx) } : undefined }
  const preset = await registry.resolve(requested || undefined)
  if (preset.broken) throw new Error(`agent preset "${preset.id}" is unavailable: ${preset.broken}`)
  const id = preset.id
  return {
    agentPreset: id,
    setup: async (agentCtx) => {
      extra?.(agentCtx)
      await registry.mount(agentCtx, id)
    },
  }
}

// Setup for a resumed session: it runs the preset its log records. A session
// recorded before presets were mounted (or under a preset that no longer
// exists) falls back to the default, and `onFallback` reports which.
export function composeResumedSession(registry, extra, onFallback) {
  if (!registry) return extra ? (agentCtx) => { extra(agentCtx) } : undefined
  return async (agentCtx, agent) => {
    extra?.(agentCtx)
    const recorded = modeOfSession(registry, agent?.session)
    if (recorded) {
      try {
        await registry.mount(agentCtx, recorded)
        return
      } catch (error) {
        if (!notFound(error)) throw error
      }
    }
    const used = await registry.mount(agentCtx)
    onFallback?.({ recorded, used: used?.id })
  }
}

// A fork runs its parent's preset, so the inherited transcript keeps the tools
// it was written against.
export function composeForkedSession(registry, parent, extra) {
  const id = modeOfAgent(registry, parent)
  if (!registry || !id) return { agentPreset: undefined, setup: extra ? (agentCtx) => { extra(agentCtx) } : undefined }
  return {
    agentPreset: id,
    setup: async (agentCtx) => {
      extra?.(agentCtx)
      await registry.mount(agentCtx, id)
    },
  }
}

// Whether a live session can still change preset: no turn has started yet.
export function isBlankSession(ctx, agent) {
  try {
    const boundary = ctx.agents?.turnBoundaryOf?.(agent.session)
    if (boundary) return boundary.openTurnStartSeq === null && boundary.lastTurn === 0
  } catch { /* fall through to the event scan */ }
  try {
    const events = typeof agent.session.snapshotEvents === 'function' ? agent.session.snapshotEvents() : agent.session.events
    return !Array.from(events ?? []).some((event) => event?.type === 'turn/start')
  } catch {
    return false
  }
}

// Parse `/mode` arguments: empty lists the roster; otherwise an id or a label
// (case-insensitive), matched against the roster.
export function matchMode(modes, input, labelOf = (id) => id) {
  const wanted = String(input ?? '').trim().toLowerCase()
  if (!wanted) return undefined
  return modes.find((mode) => mode.id.toLowerCase() === wanted)
    ?? modes.find((mode) => String(labelOf(mode.id) ?? '').toLowerCase() === wanted)
    ?? modes.find((mode) => (mode.name ?? '').toLowerCase() === wanted)
}
