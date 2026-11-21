import assert from 'node:assert/strict'
import { App } from '../lib/ui.js'
import { editComposer } from '../lib/composer-edit.js'

const app = new App({ cols: 100, rows: 30 })
const body = Array.from({ length: 12 }, (_, i) => `payload-${i}`).join('\n')
app.replaceInput(0, 0, 'prefix ')
app.replaceInput(7, 7, body, { paste: true })
assert.equal(app.inputText, 'prefix ' + body)
let view = app.composerInputView()
assert.equal(view.text, 'prefix [Paste: 12 lines]')
assert.equal(view.cursor, view.text.length)
assert.equal(view.sourceOffset(view.cursor), app.inputText.length)
assert.equal(app._layout().visual.rows.length, 1)

app.replaceInput(app.inputCursor, app.inputCursor, ' suffix')
assert.equal(app.composerInputView().text, 'prefix [Paste: 12 lines] suffix')
app.replaceInput(0, 7, 'new ')
assert.equal(app.composerInputView().text, 'new [Paste: 12 lines] suffix')
app.inputCursor = 6
assert.equal(app.composerInputView().text, app.inputText, 'moving into a paste reveals it for editing')
app.replaceInput(6, 7, 'X')
assert.equal(app.composerInputView().text, app.inputText, 'modifying a paste unfolds it permanently')

app.inputText = ''
app.replaceInput(0, 0, body, { paste: true })
const deletion = editComposer(app.inputText, app.inputCursor, { name: 'u', ctrl: true })
app.replaceInput(deletion.cursor, deletion.cursor + app.inputText.length - deletion.text.length, '')
assert.equal(app.inputText, deletion.text)
assert.equal(app.composerInputView().text, deletion.text)

app.inputText = 'short'
app.replaceInput(5, 5, '\nshort paste', { paste: true })
assert.equal(app.composerInputView().text, 'short\nshort paste')
console.log('composer paste tests passed')
