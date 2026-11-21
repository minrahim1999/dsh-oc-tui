import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editDraft, editorCommand } from '../lib/composer-editor.js'

assert.deepEqual(editorCommand({ VISUAL: '"/path with spaces/vim" -f', EDITOR: 'nano' }), ['/path with spaces/vim', '-f'])
assert.deepEqual(editorCommand({ VISUAL: ' ', EDITOR: 'code --wait' }), ['code', '--wait'])
assert.deepEqual(editorCommand({}), [])
const base = await mkdtemp(join(tmpdir(), 'dsh-editor-test-'))
const states = []
const opts = { base, cwd: base, suspend: () => states.push('suspend'), resume: () => states.push('resume') }
try {
  const content = 'draft\n😀'
  const command = [process.execPath, '-e', 'const f=require("fs");const p=process.argv[1];f.appendFileSync(p,"\\ncontinued");']
  assert.equal(await editDraft(content, { ...opts, command }), content + '\ncontinued')
  assert.deepEqual(states.splice(0), ['suspend', 'resume'])
  assert.deepEqual(await readdir(base), [])
  assert.equal(await editDraft(content, { ...opts, command: [process.execPath, '-e', 'process.exit(1)'] }), undefined)
  assert.deepEqual(states.splice(0), ['suspend', 'resume'])
  await assert.rejects(editDraft(content, { ...opts, command: [join(base, 'missing')] }), { code: 'ENOENT' })
  assert.deepEqual(states.splice(0), ['suspend', 'resume'])
  assert.deepEqual(await readdir(base), [])
} finally {
  await rm(base, { recursive: true, force: true })
}
console.log('composer editor tests passed')
