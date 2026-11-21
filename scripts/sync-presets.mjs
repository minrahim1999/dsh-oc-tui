#!/usr/bin/env node
// Refresh presets/*.patch.yml from the dsh-web-app bundle of an installed dsh.
//
// The TUI offers the same agent presets ("modes") as the Web UI, so it mounts
// the same declarations: the preset registry, the shipped preset rows, and the
// block that moves the agent plane (tools, prompt sections, delegation) behind
// presets. They are copied rather than referenced because a bundle patch can
// only name files inside its own package. Run this after a dsh upgrade, review
// the diff, and run the suite against that dsh before adding it to
// `dshSupport.tested`.
//
// Usage (Desktop app, whose packages live inside app.asar):
//   ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" scripts/sync-presets.mjs
// Usage (npm install, or an explicit package directory):
//   node scripts/sync-presets.mjs [/path/to/@deepseek-ai/dsh-web-app]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'presets')
const PLANE_MARKER = '# ── the agent plane moves behind agent presets'

function locateWebApp() {
  if (process.argv[2]) return process.argv[2]
  const anchor = process.env.DSH_INSTALL_DIR
  if (!anchor) throw new Error('pass the dsh-web-app directory, or run under dsh with DSH_INSTALL_DIR set')
  const require = createRequire(join(anchor, 'package.json'))
  return dirname(require.resolve('@deepseek-ai/dsh-web-app/package.json'))
}

const webApp = locateWebApp()
const manifest = JSON.parse(readFileSync(join(webApp, 'package.json'), 'utf8'))
const header = (source) => [
  `# Copied from ${manifest.name}@${manifest.version} (${source}) by`,
  '# scripts/sync-presets.mjs. Do not edit by hand: rerun the script after a dsh',
  '# upgrade instead. Copyright (c) 2026 DeepSeek, MIT License.',
  '',
].join('\n')

mkdirSync(outDir, { recursive: true })
for (const stale of readdirSync(outDir)) {
  if (stale.endsWith('.patch.yml')) rmSync(join(outDir, stale))
}

const webPatch = readFileSync(join(webApp, 'cordis.patch.yml'), 'utf8')
const start = webPatch.indexOf(PLANE_MARKER)
if (start < 0) throw new Error(`${manifest.name}@${manifest.version}: agent-plane block not found; the layout changed`)
const written = ['agent-plane.patch.yml']
writeFileSync(join(outDir, 'agent-plane.patch.yml'), header('cordis.patch.yml, agent-plane block') + webPatch.slice(start))

const patchList = Array.isArray(manifest.dsh?.bundle?.patch) ? manifest.dsh.bundle.patch : []
for (const rel of patchList) {
  if (!rel.startsWith('./presets/')) continue
  const name = rel.slice('./presets/'.length)
  writeFileSync(join(outDir, name), header(rel.slice(2)) + readFileSync(join(webApp, rel), 'utf8'))
  written.push(name)
}

console.log(`${manifest.name}@${manifest.version} -> presets/: ${written.join(', ')}`)
console.log('bundle patch order: ' + JSON.stringify(['./cordis.patch.yml', ...written.map((name) => './presets/' + name)]))
