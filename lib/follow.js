// Launch-time sync: the TUI profile follows the Desktop/Web profile.
//
// A dsh profile reads its plugin list and patch layer only at boot, so the
// launcher (bin/dsh-oc-tui.js) runs this before it starts dsh and once more
// after dsh exits:
//
//   * plugins — one way, source → TUI. Every bundle the source profile lists
//     (and the dependency that provides it) is mirrored into the TUI profile,
//     except the configured exclusions (the Web server and Web-only bundles
//     that never activate in a terminal). Bundles the TUI added itself stay; a
//     bundle mirrored earlier and since removed from the source is removed.
//   * settings — two ways, for the configured patch entries (model providers,
//     default model, access control, default mode, …). A three-way merge
//     against the state of the last sync: an entry changed on one side wins,
//     an entry changed on both sides takes the most recently written file.
//
// The source is the Desktop app's profile (`desktop`), or `web` when there is
// no Desktop profile. Configuration lives in `<tui profile>/tui-follow.json`;
// the merge state in `<tui profile>/.tui-follow-state.json`. No dsh imports:
// this runs in plain Node before any dsh code is loaded.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_FILE = 'tui-follow.json'
export const STATE_FILE = '.tui-follow-state.json'
const PACKAGE_FILE = 'package.json'
const PATCH_FILE = 'cordis.patch.yml'
const STATE_VERSION = 1

// The TUI's own layers: never mirrored, never removed, and ordered first so
// the preset declarations exist before a mirrored bundle inserts into them —
// the position dsh-web-app holds in the Web profiles.
export const OWN_BUNDLES = Object.freeze(['@deepseek-ai/dsh-base', 'dsh-oc-tui'])

export const DEFAULT_CONFIG = Object.freeze({
  source: 'auto',
  plugins: true,
  // The Web server itself, and shipped bundles whose rows wait for Web-only
  // services (webServer, connection, sessionController) and so never activate
  // in a terminal process; mirroring them only adds an exit warning.
  excludeBundles: [
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-experimental-inspector-profile',
    '@deepseek-ai/dsh-experimental-cot-translation-bundle',
    '@deepseek-ai/dsh-deepseek-chat-import',
  ],
  // Patch entries kept identical in both directions. Each id must exist in the
  // TUI's composition (dsh-base or this bundle's preset layers).
  settings: ['llm-pi-ai', 'agent-default-model', 'permission', 'agent-preset-registry', 'agent-team', 'ptc-runtime'],
})

// ---- small fs helpers -------------------------------------------------------

function readText(path) {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}

function mtimeOf(path) {
  try { return statSync(path).mtimeMs } catch { return 0 }
}

function writeAtomic(path, content) {
  let mode
  try { mode = statSync(path).mode & 0o777 } catch { mode = undefined }
  const tmp = `${path}.tui-follow-${process.pid}.tmp`
  writeFileSync(tmp, content, 'utf8')
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, path)
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  return [...new Set(value.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))]
}

// ---- cordis.patch.yml as top-level entries, without a YAML round-trip --------
// Entries are copied as raw text, so comments and `!!js` tags survive.

const ITEM_START = /^-(\s|$)/
const BLANK_OR_COMMENT = /^\s*(#.*)?$/

function unquote(value) {
  const v = value.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1)
  return v
}

export function normalizeBlock(lines) {
  return lines.filter((l) => !BLANK_OR_COMMENT.test(l)).map((l) => l.trimEnd()).join('\n')
}

function blockKey(lines) {
  const content = lines.filter((l) => !BLANK_OR_COMMENT.test(l))
  const first = content[0] ?? ''
  let m = /^-\s+id:\s*(.+?)\s*$/.exec(first)
  if (m) return `id:${unquote(m[1])}`
  for (const line of content.slice(1)) {
    m = /^ {2}id:\s*(.+?)\s*$/.exec(line)
    if (m) return `id:${unquote(m[1])}`
  }
  return `text:${normalizeBlock(lines)}`
}

export function parsePatch(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const header = []
  const blocks = []
  let pending = []
  let current = null
  let afterBlank = false
  for (const line of lines) {
    if (line.trim() === '[]') continue
    if (ITEM_START.test(line)) {
      current = { lines: [...pending, line] }
      pending = []
      blocks.push(current)
      afterBlank = false
      continue
    }
    if (current === null) {
      header.push(line)
      continue
    }
    if (line.trim() === '') {
      afterBlank = true
      pending.push(line)
      continue
    }
    if (/^\s*#/.test(line) && afterBlank) {
      pending.push(line)
      continue
    }
    current.lines.push(...pending, line)
    pending = []
    afterBlank = false
  }
  const seen = new Map()
  for (const block of blocks) {
    while (block.lines.length > 0 && block.lines[block.lines.length - 1].trim() === '') block.lines.pop()
    const base = blockKey(block.lines)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    block.key = n === 1 ? base : `${base}#${n}`
    block.norm = normalizeBlock(block.lines)
  }
  return { header, blocks, trailer: pending }
}

export function serializePatch(header, blocks, trailer) {
  const out = [...header]
  for (const block of blocks) out.push(...block.lines)
  if (blocks.length === 0) out.push('[]')
  out.push(...trailer)
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return `${out.join('\n')}\n`
}

const leadingLines = (lines) => {
  const i = lines.findIndex((l) => ITEM_START.test(l))
  return i <= 0 ? [] : lines.slice(0, i)
}
const withoutLeading = (lines) => {
  const i = lines.findIndex((l) => ITEM_START.test(l))
  return i <= 0 ? lines : lines.slice(i)
}

// The three-way choice for one item. `sides` carry `{ v, mtime }`, where an
// undefined `v` means "absent"; `base` is the item at the last sync.
export function choose(sides, hasBase, base) {
  const changed = hasBase ? sides.filter((s) => s.v !== base) : sides.filter((s) => s.v !== undefined)
  if (changed.length === 0) {
    if (!hasBase || base === undefined) return { side: null, conflict: false }
    return { side: sides.find((s) => s.v === base) ?? null, conflict: false }
  }
  const distinct = new Set(changed.map((s) => s.v))
  const winner = distinct.size === 1 ? changed[0] : [...changed].sort((a, b) => b.mtime - a.mtime)[0]
  return { side: winner.v === undefined ? null : winner, conflict: distinct.size > 1 }
}

function rebuildPatch(parsed, originalText, merged, managed) {
  const blocks = []
  const placed = new Set()
  for (const block of parsed.blocks) {
    if (!managed.has(block.key)) {
      blocks.push(block)
      continue
    }
    const win = merged.get(block.key)
    if (win === undefined) continue
    blocks.push(win.norm === block.norm ? block : { ...win, lines: [...leadingLines(block.lines), ...withoutLeading(win.lines)] })
    placed.add(block.key)
  }
  for (const [key, block] of merged) {
    if (placed.has(key)) continue
    const lead = block.lines[0]?.trim() === '' ? [] : ['']
    blocks.push({ ...block, lines: [...lead, ...block.lines] })
  }
  const changed = blocks.length !== parsed.blocks.length || blocks.some((b, i) => b !== parsed.blocks[i])
  return changed ? serializePatch(parsed.header, blocks, parsed.trailer) : originalText
}

/**
 * Two-way merge of the configured patch entries between two patch files.
 * @returns new texts for both sides, the next base, and the changed/conflicting keys.
 */
export function mergeSettings({ target, source, base, entries }) {
  const keys = [...new Set(entries)].map((id) => `id:${id}`)
  const managed = new Set(keys)
  const hasBase = base !== undefined
  const t = parsePatch(target.text)
  const s = parsePatch(source.text)
  const merged = new Map()
  const conflicts = []
  for (const key of keys) {
    const tb = t.blocks.find((b) => b.key === key)
    const sb = s.blocks.find((b) => b.key === key)
    const r = choose([
      { v: tb?.norm, block: tb, mtime: target.mtime },
      { v: sb?.norm, block: sb, mtime: source.mtime },
    ], hasBase, base?.[key])
    if (r.conflict) conflicts.push(key.slice(3))
    if (r.side) merged.set(key, r.side.block)
  }
  const targetText = rebuildPatch(t, target.text, merged, managed)
  const sourceText = rebuildPatch(s, source.text, merged, managed)
  const changed = keys.filter((key) => {
    const before = [t.blocks.find((b) => b.key === key)?.norm, s.blocks.find((b) => b.key === key)?.norm]
    const after = merged.get(key)?.norm
    return before[0] !== after || before[1] !== after
  }).map((key) => key.slice(3))
  return {
    targetText,
    sourceText,
    base: Object.fromEntries([...merged].map(([k, b]) => [k, b.norm])),
    changed,
    conflicts,
  }
}

/**
 * One-way mirror of the source profile's bundles and their dependencies.
 * @param target - the TUI profile manifest.
 * @param source - the source profile manifest.
 * @param previous - what the last mirror added: `{ bundles: [], deps: {} }`.
 * @param exclude - bundle/package names never mirrored.
 */
export function mirrorPlugins({ target, source, previous = { bundles: [], deps: {} }, exclude = [] }) {
  const excluded = new Set([...exclude, ...OWN_BUNDLES])
  const sourceBundles = source?.dsh?.profile?.bundles ?? []
  const sourceDeps = source?.dependencies ?? {}
  const targetBundles = target?.dsh?.profile?.bundles ?? []
  const targetDeps = target?.dependencies ?? {}
  const wasMirrored = new Set(previous.bundles ?? [])

  const mirrored = sourceBundles.filter((name) => !excluded.has(name))
  // Bundles the TUI profile has on its own: anything it lists that the last
  // mirror did not put there.
  const own = targetBundles.filter((name) => !wasMirrored.has(name) && !OWN_BUNDLES.includes(name) && !mirrored.includes(name))
  const ownFirst = OWN_BUNDLES.filter((name) => targetBundles.includes(name) || name === OWN_BUNDLES[0])
  const bundles = [...new Set([...ownFirst, ...mirrored, ...own])]

  const deps = { ...targetDeps }
  const mirroredDeps = {}
  for (const name of Object.keys(previous.deps ?? {})) {
    // A dependency the last mirror added and the source no longer provides.
    if (!mirrored.includes(name) && deps[name] === previous.deps[name]) delete deps[name]
  }
  for (const name of mirrored) {
    if (sourceDeps[name] === undefined) continue // a bundle shipped with dsh itself
    deps[name] = sourceDeps[name]
    mirroredDeps[name] = sourceDeps[name]
  }
  const sortedDeps = Object.fromEntries(Object.keys(deps).sort().map((name) => [name, deps[name]]))
  const added = bundles.filter((name) => !targetBundles.includes(name))
  const removed = targetBundles.filter((name) => !bundles.includes(name))
  const depsChanged = JSON.stringify(Object.entries(targetDeps).sort()) !== JSON.stringify(Object.entries(sortedDeps).sort())
  const bundlesChanged = JSON.stringify(targetBundles) !== JSON.stringify(bundles)
  const next = structuredClone(target ?? {})
  if (bundlesChanged || depsChanged) {
    next.dsh ??= {}
    next.dsh.profile ??= {}
    next.dsh.profile.bundles = bundles
    next.dependencies = sortedDeps
  }
  return {
    manifest: next,
    changed: bundlesChanged || depsChanged,
    depsChanged,
    added,
    removed,
    state: { bundles: mirrored, deps: mirroredDeps },
  }
}

export function loadConfig(profileDir) {
  const text = readText(join(profileDir, CONFIG_FILE))
  let raw = {}
  if (text !== undefined) {
    try { raw = JSON.parse(text) } catch (error) { throw new Error(`${CONFIG_FILE}: ${error.message}`) }
  }
  // `excludeBundles` adds to the built-in Web-only list; `includeBundles`
  // takes a built-in exclusion back out. `settings` replaces the default list.
  const include = new Set(stringList(raw.includeBundles, []))
  const exclude = [...DEFAULT_CONFIG.excludeBundles, ...stringList(raw.excludeBundles, [])].filter((name) => !include.has(name))
  return {
    source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : DEFAULT_CONFIG.source,
    plugins: raw.plugins !== false,
    excludeBundles: [...new Set(exclude)],
    settings: stringList(raw.settings, DEFAULT_CONFIG.settings),
  }
}

export function resolveSource(profilesDir, wanted, target) {
  const candidates = wanted === 'auto' ? ['desktop', 'web'] : [wanted]
  return candidates.find((name) => name !== target && existsSync(join(profilesDir, name, PACKAGE_FILE)))
}

/**
 * Run one sync.
 * @param options.phase - 'launch' mirrors plugins and settings; 'exit' only
 *   settings (a running profile cannot gain plugins, but its edits flow back).
 * @returns a summary; `needsInstall` asks the caller to install packages.
 */
export function followProfile({ dshHome, target = 'tui', phase = 'launch', dryRun = false }) {
  const profilesDir = join(dshHome, 'profiles')
  const targetDir = join(profilesDir, target)
  const result = { source: undefined, plugins: null, settings: null, needsInstall: false, previousManifest: undefined }
  if (!existsSync(join(targetDir, PACKAGE_FILE))) return result
  const config = loadConfig(targetDir)
  const source = resolveSource(profilesDir, config.source, target)
  if (!source) return result
  result.source = source
  const sourceDir = join(profilesDir, source)
  const statePath = join(targetDir, STATE_FILE)
  let state = {}
  try { state = JSON.parse(readText(statePath) ?? '{}') } catch { state = {} }
  if (state.version !== STATE_VERSION || state.source !== source) state = { version: STATE_VERSION, source }

  if (phase === 'launch' && config.plugins) {
    const targetText = readFileSync(join(targetDir, PACKAGE_FILE), 'utf8')
    const mirror = mirrorPlugins({
      target: JSON.parse(targetText),
      source: JSON.parse(readFileSync(join(sourceDir, PACKAGE_FILE), 'utf8')),
      previous: state.plugins,
      exclude: config.excludeBundles,
    })
    result.plugins = { added: mirror.added, removed: mirror.removed, changed: mirror.changed }
    if (mirror.changed && !dryRun) {
      result.previousManifest = targetText
      writeAtomic(join(targetDir, PACKAGE_FILE), `${JSON.stringify(mirror.manifest, null, 2)}\n`)
      result.needsInstall = mirror.depsChanged
    }
    if (!dryRun) state.plugins = mirror.state
  }

  if (config.settings.length > 0) {
    const targetPatch = join(targetDir, PATCH_FILE)
    const sourcePatch = join(sourceDir, PATCH_FILE)
    const merged = mergeSettings({
      target: { text: readText(targetPatch) ?? '', mtime: mtimeOf(targetPatch) },
      source: { text: readText(sourcePatch) ?? '', mtime: mtimeOf(sourcePatch) },
      base: state.settings,
      entries: config.settings,
    })
    result.settings = { changed: merged.changed, conflicts: merged.conflicts }
    if (!dryRun) {
      if (merged.targetText !== (readText(targetPatch) ?? '')) writeAtomic(targetPatch, merged.targetText)
      if (merged.sourceText !== (readText(sourcePatch) ?? '')) writeAtomic(sourcePatch, merged.sourceText)
      state.settings = merged.base
    }
  }

  if (!dryRun) writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return result
}

// Undo a plugin mirror whose install failed, so dsh boots the last working set.
export function restoreManifest(dshHome, target, text) {
  if (typeof text === 'string') writeAtomic(join(dshHome, 'profiles', target, PACKAGE_FILE), text)
}

export function describeSync(result) {
  const parts = []
  if (result.plugins?.added?.length) parts.push(`+${result.plugins.added.length} plugin${result.plugins.added.length === 1 ? '' : 's'}`)
  if (result.plugins?.removed?.length) parts.push(`-${result.plugins.removed.length} plugin${result.plugins.removed.length === 1 ? '' : 's'}`)
  if (result.settings?.changed?.length) parts.push(`settings: ${result.settings.changed.join(', ')}`)
  if (result.settings?.conflicts?.length) parts.push(`newest file won for: ${result.settings.conflicts.join(', ')}`)
  return parts.length ? `synced with ${result.source} (${parts.join('; ')})` : ''
}
