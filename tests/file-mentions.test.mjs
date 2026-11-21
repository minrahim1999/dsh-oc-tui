import assert from 'node:assert/strict'
import { activeFileMention, applyFileMention, FileMentionSearch } from '../lib/file-mentions.js'

assert.equal(activeFileMention('mail user@example.com', 21), undefined)
assert.equal(activeFileMention('/model @file', 12), undefined)
assert.equal(activeFileMention('!ls @file', 9), undefined)
assert.equal(activeFileMention('see @src/rou', 12)?.query, 'src/rou')
assert.equal(activeFileMention('see @"a b/', 10)?.query, 'a b/')
assert.equal(activeFileMention('see @"a b"', 10), undefined)
assert.equal(activeFileMention('see @src/main.js#10-20', 22)?.query, 'src/main.js')
assert.deepEqual(applyFileMention('see @src/rough now', 12, { path: 'src/router.js', kind: 'file' }), {
  start: 4, end: 14, text: '@src/router.js',
})
assert.deepEqual(applyFileMention('see @a', 6, { path: 'a b', kind: 'directory' }), {
  start: 4, end: 6, text: '@"a b/',
})
assert.equal(applyFileMention('see @src/main.js#10-20', 22, { path: 'src/main.js', kind: 'file' }).text, '@src/main.js (lines 10–20) ')
assert.equal(applyFileMention('@bad', 4, { path: 'bad\x1b[3D', kind: 'file' }), undefined)
let pending = []
let shown = []
const search = new FileMentionSearch(rows => { shown = rows }, { delay: 0 })
const list = (query, signal) => new Promise(resolve => { pending.push({ query, signal, resolve }) })
const workspace = {}
search.update(workspace, 'a', list)
await new Promise(resolve => setTimeout(resolve, 5))
search.update(workspace, 'ab', list)
await new Promise(resolve => setTimeout(resolve, 5))
assert.equal(pending[0].signal.aborted, true)
pending[1].resolve([{ path: 'ab', kind: 'file' }, { path: '../private', kind: 'file' }, { path: '/private', kind: 'file' }])
await Promise.resolve()
assert.deepEqual(shown, [{ path: 'ab', kind: 'file' }])
pending[0].resolve([{ path: 'stale', kind: 'file' }])
await Promise.resolve()
assert.deepEqual(shown, [{ path: 'ab', kind: 'file' }])
search.clear()
assert.deepEqual(shown, [])
assert.equal(pending[1].signal.aborted, true)
console.log('file mention tests passed')
