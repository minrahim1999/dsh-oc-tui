import assert from 'node:assert/strict'
import { paletteActions, filterPalette } from '../lib/palette.js'
import { setLocale, t } from '../lib/i18n.js'

setLocale('en')
const labels = { settings: 'Open settings', new: 'New session', mode: 'Agent mode', models: 'Choose a model' }
const all = paletteActions({ hasSession: true, canRedo: true })
assert.ok(all.some((action) => action.id === 'settings'))
assert.equal(paletteActions({}).some((action) => action.id === 'undo'), false, 'undo needs a session')
assert.equal(paletteActions({}).some((action) => action.id === 'redo'), false, 'redo needs something to redo')
assert.equal(paletteActions({ hasSession: true }).some((action) => action.id === 'redo'), false)
assert.ok(paletteActions({ canRedo: true }).some((action) => action.id === 'redo'))
assert.deepEqual(filterPalette(all, 'agent', (action) => labels[action.id] ?? '').map((action) => action.id), ['mode'])
assert.deepEqual(filterPalette(all, 'ctrl+t').map((action) => action.id), ['thinking'])
assert.deepEqual(filterPalette(all, 'CTRL+K'), [], 'an unbound shortcut is not advertised')
assert.equal(filterPalette(all, '').length, all.length)
assert.equal(filterPalette(all, '   ').length, all.length)
assert.deepEqual(filterPalette(all, 'open', (action) => labels[action.id]).map((action) => action.id), ['settings'])
for (const action of all) {
  assert.notEqual(t(action.key), action.key, `catalog has ${action.key}`)
}
console.log('palette tests passed')
