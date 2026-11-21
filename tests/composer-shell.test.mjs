import assert from 'node:assert/strict'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseShellInput, runShellCommand, shellContext } from '../lib/composer-shell.js'

assert.equal(parseShellInput('hello'), undefined)
assert.equal(parseShellInput('!'), '')
assert.equal(parseShellInput('!  git status  '), 'git status')
assert.equal(parseShellInput(' !ls'), undefined, 'only a leading ! enters shell mode')

const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-shell-test-')))
try {
  const ok = await runShellCommand('pwd; printf "a\\nb"; echo err >&2', { cwd })
  assert.equal(ok.exitCode, 0)
  assert.match(ok.output, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'runs in the session cwd')
  assert.match(ok.output, /a\nb/)
  assert.match(ok.output, /err/, 'stderr is captured')

  const failed = await runShellCommand('exit 3', { cwd })
  assert.equal(failed.exitCode, 3)

  const big = await runShellCommand('yes 0123456789 | head -c 50000', { cwd, maxBytes: 1000 })
  assert.equal(big.truncated, true)
  assert.ok(Buffer.byteLength(big.output) <= 1000)

  const nostdin = await runShellCommand('cat; echo done', { cwd, timeoutMs: 5000 })
  assert.match(nostdin.output, /done/, 'stdin is closed, so a reader cannot hang the TUI')

  const control = new AbortController()
  const started = Date.now()
  const pending = runShellCommand('sleep 30 & sleep 30; echo never', { cwd, signal: control.signal })
  setTimeout(() => control.abort(), 100)
  const aborted = await pending
  assert.equal(aborted.cancelled, true)
  assert.ok(Date.now() - started < 5000, 'cancel kills the whole process group')
  assert.doesNotMatch(aborted.output, /never/)

  const slow = await runShellCommand('sleep 30', { cwd, timeoutMs: 100 })
  assert.equal(slow.timedOut, true)

  const context = shellContext('git status', { exitCode: 1, output: 'x'.repeat(10), truncated: true })
  assert.match(context, /git status/)
  assert.match(context, /exit code 1/)
  assert.match(context, /truncated/)
} finally {
  await rm(cwd, { recursive: true, force: true })
}
console.log('composer shell tests passed')
