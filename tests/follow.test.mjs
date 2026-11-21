// Launch-time sync (lib/follow.js): plugin mirroring from the Desktop/Web
// profile into the TUI profile, and the two-way settings merge, against
// throwaway profile directories.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  describeSync,
  followProfile,
  loadConfig,
  mergeSettings,
  mirrorPlugins,
  parsePatch,
  resolveSource,
} from '../lib/follow.js'

let failed = 0
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log('ok   ' + name)
  else { console.log('FAIL ' + name + '  got ' + a + '  want ' + e); failed++ }
}
const ok = (name, cond) => cond ? console.log('ok   ' + name) : (console.log('FAIL ' + name), failed++)

const manifest = (bundles, deps = {}) => ({ name: 'p', private: true, dependencies: deps, dsh: { profile: { bundles } } })

// ---- plugin mirror -------------------------------------------------------------
{
  const desktop = manifest(
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cua-bundle', '@local/web-only', '@deepseek-ai/dsh-subagent-codex'],
    { '@deepseek-ai/dsh-subagent-codex': '0.2.2-rc.5', '@local/web-only': 'link:/x/web-only' },
  )
  const tui = manifest(['@deepseek-ai/dsh-base', 'dsh-oc-tui'], { 'dsh-oc-tui': 'file:/x/tui.tgz' })
  const first = mirrorPlugins({ target: tui, source: desktop, exclude: ['@deepseek-ai/dsh-web-app', '@local/web-only'] })
  eq('mirror: the TUI layers stay first, then the source order', first.manifest.dsh.profile.bundles,
    ['@deepseek-ai/dsh-base', 'dsh-oc-tui', '@deepseek-ai/dsh-cua-bundle', '@deepseek-ai/dsh-subagent-codex'])
  eq('mirror: only a mirrored bundle\'s dependency is copied', first.manifest.dependencies,
    { '@deepseek-ai/dsh-subagent-codex': '0.2.2-rc.5', 'dsh-oc-tui': 'file:/x/tui.tgz' })
  ok('mirror: a dependency change asks for an install', first.depsChanged)
  eq('mirror: reports what it added', first.added, ['@deepseek-ai/dsh-cua-bundle', '@deepseek-ai/dsh-subagent-codex'])

  // The user adds a TUI-only bundle; the source then drops one mirrored bundle.
  const tuiNext = structuredClone(first.manifest)
  tuiNext.dsh.profile.bundles.push('my-tui-only')
  const desktopNext = manifest(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-cua-bundle'], {})
  const second = mirrorPlugins({ target: tuiNext, source: desktopNext, previous: first.state, exclude: [] })
  eq('mirror: a bundle removed from the source is removed', second.removed, ['@deepseek-ai/dsh-subagent-codex'])
  ok('mirror: a TUI-only bundle survives', second.manifest.dsh.profile.bundles.includes('my-tui-only'))
  eq('mirror: its mirrored dependency goes too', Object.keys(second.manifest.dependencies), ['dsh-oc-tui'])

  const third = mirrorPlugins({ target: second.manifest, source: desktopNext, previous: second.state, exclude: [] })
  ok('mirror: a second run with no source change changes nothing', !third.changed)

  const withOwnDep = manifest(['@deepseek-ai/dsh-base', 'dsh-oc-tui'], { 'dsh-oc-tui': 'file:/x/tui.tgz', '@deepseek-ai/dsh-subagent-codex': '9.9.9' })
  const kept = mirrorPlugins({ target: withOwnDep, source: desktopNext, previous: first.state, exclude: [] })
  eq('mirror: a dependency the user changed in the TUI is not removed', kept.manifest.dependencies['@deepseek-ai/dsh-subagent-codex'], '9.9.9')
}

// ---- settings merge ------------------------------------------------------------
{
  const block = (id, value) => `- id: ${id}\n  name: '@x/${id}'\n  config:\n    value: ${value}\n`
  const header = '# header\n'
  const target = header + block('llm-pi-ai', 1) + block('tui-app', 'tui')
  const source = header + block('llm-pi-ai', 1) + block('agent-default-model', 'claude') + block('ui-chat', 'web')
  const first = mergeSettings({ target: { text: target, mtime: 1 }, source: { text: source, mtime: 2 }, base: undefined, entries: ['llm-pi-ai', 'agent-default-model', 'permission'] })
  ok('settings: an entry only the source has reaches the TUI', first.targetText.includes('value: claude'))
  ok('settings: a TUI-only entry outside the list stays local', first.targetText.includes('tui-app') && !first.sourceText.includes('tui-app'))
  ok('settings: a source entry outside the list never reaches the TUI', !first.targetText.includes('ui-chat'))
  ok('settings: comments and order of the TUI file survive', first.targetText.startsWith('# header\n- id: llm-pi-ai'))
  eq('settings: reports the entry it carried', first.changed, ['agent-default-model'])

  // Next run: the TUI changes the default model; the source is untouched.
  const tuiEdited = first.targetText.replace('value: claude', 'value: ollama')
  const second = mergeSettings({ target: { text: tuiEdited, mtime: 5 }, source: { text: first.sourceText, mtime: 2 }, base: first.base, entries: ['llm-pi-ai', 'agent-default-model'] })
  ok('settings: a TUI edit flows back to the source', second.sourceText.includes('value: ollama') && !second.sourceText.includes('value: claude'))

  // Both change the same entry: the newer file wins and it is reported.
  const tuiAgain = second.targetText.replace('value: ollama', 'value: tui-choice')
  const srcAgain = second.sourceText.replace('value: ollama', 'value: desktop-choice')
  const third = mergeSettings({ target: { text: tuiAgain, mtime: 10 }, source: { text: srcAgain, mtime: 20 }, base: second.base, entries: ['agent-default-model'] })
  ok('settings: on a conflict the newer file wins', third.targetText.includes('desktop-choice') && third.sourceText.includes('desktop-choice'))
  eq('settings: the conflict is reported', third.conflicts, ['agent-default-model'])

  // The source deletes an entry the TUI did not touch.
  const srcDeleted = header + block('llm-pi-ai', 1)
  const fourth = mergeSettings({ target: { text: third.targetText, mtime: 30 }, source: { text: srcDeleted, mtime: 40 }, base: third.base, entries: ['agent-default-model'] })
  ok('settings: a removal propagates', !fourth.targetText.includes('agent-default-model'))

  const empty = mergeSettings({ target: { text: '[]\n', mtime: 1 }, source: { text: block('permission', 'full'), mtime: 2 }, base: undefined, entries: ['permission'] })
  ok('settings: an empty `[]` patch receives entries', parsePatch(empty.targetText).blocks.length === 1 && !empty.targetText.includes('[]'))
}

// ---- config and end-to-end on disk ---------------------------------------------
{
  const home = mkdtempSync(join(tmpdir(), 'tui-follow-'))
  const write = (profile, file, text) => {
    mkdirSync(join(home, 'profiles', profile), { recursive: true })
    writeFileSync(join(home, 'profiles', profile, file), text)
  }
  const read = (profile, file) => readFileSync(join(home, 'profiles', profile, file), 'utf8')
  write('tui', 'package.json', JSON.stringify(manifest(['@deepseek-ai/dsh-base', 'dsh-oc-tui'], { 'dsh-oc-tui': 'file:/t.tgz' })))
  write('tui', 'cordis.patch.yml', '[]\n')
  eq('config: defaults when the file is absent', loadConfig(join(home, 'profiles', 'tui')).excludeBundles, DEFAULT_CONFIG.excludeBundles)
  eq('source: none when only the TUI profile exists', resolveSource(join(home, 'profiles'), 'auto', 'tui'), undefined)
  eq('follow: no source means no sync', followProfile({ dshHome: home }).source, undefined)

  write('web', 'package.json', JSON.stringify(manifest(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-ralph'])))
  write('web', 'cordis.patch.yml', "- id: permission\n  name: '@x/permission'\n  config:\n    defaultPreset: danger-full-access\n")
  eq('source: web when there is no Desktop profile', resolveSource(join(home, 'profiles'), 'auto', 'tui'), 'web')
  write('desktop', 'package.json', JSON.stringify(manifest(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cua-bundle', '@local/web-only'], { '@local/web-only': 'link:/w' })))
  write('desktop', 'cordis.patch.yml', "- id: permission\n  name: '@x/permission'\n  config:\n    defaultPreset: workspace-write\n")
  eq('source: Desktop wins when it exists', resolveSource(join(home, 'profiles'), 'auto', 'tui'), 'desktop')

  write('tui', CONFIG_FILE, JSON.stringify({ excludeBundles: ['@local/web-only'], settings: ['permission'] }))
  const config = loadConfig(join(home, 'profiles', 'tui'))
  ok('config: a user exclusion adds to the built-in list', config.excludeBundles.includes('@local/web-only') && config.excludeBundles.includes('@deepseek-ai/dsh-web-app'))

  const dry = followProfile({ dshHome: home, dryRun: true })
  ok('follow: a dry run reports without writing', dry.plugins.changed && read('tui', 'cordis.patch.yml') === '[]\n')

  const launch = followProfile({ dshHome: home })
  eq('follow: plugins mirrored at launch', JSON.parse(read('tui', 'package.json')).dsh.profile.bundles,
    ['@deepseek-ai/dsh-base', 'dsh-oc-tui', '@deepseek-ai/dsh-cua-bundle'])
  ok('follow: a built-in bundle needs no install', !launch.needsInstall)
  ok('follow: settings carried at launch', read('tui', 'cordis.patch.yml').includes('workspace-write'))
  ok('follow: the summary names the source', describeSync(launch).startsWith('synced with desktop ('))

  // The TUI changes the permission preset while running; exit sends it back.
  write('tui', 'cordis.patch.yml', read('tui', 'cordis.patch.yml').replace('workspace-write', 'read-only'))
  const later = new Date(Date.now() + 5000)
  utimesSync(join(home, 'profiles', 'tui', 'cordis.patch.yml'), later, later)
  const exit = followProfile({ dshHome: home, phase: 'exit' })
  eq('follow: exit does not touch plugins', exit.plugins, null)
  ok('follow: exit carries the TUI edit back', read('desktop', 'cordis.patch.yml').includes('read-only'))
  eq('follow: a run with nothing new is silent', describeSync(followProfile({ dshHome: home })), '')

  write('tui', CONFIG_FILE, '{ broken')
  let threw = false
  try { followProfile({ dshHome: home }) } catch (error) { threw = /tui-follow\.json/.test(error.message) }
  ok('follow: an unreadable config names the file', threw)
  rmSync(home, { recursive: true, force: true })
}

if (failed > 0) process.exit(1)
console.log('follow tests passed')
