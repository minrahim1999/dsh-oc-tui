import assert from 'node:assert/strict'
import { editComposer } from '../lib/composer-edit.js'
import { decodeKey } from '../lib/term.js'

assert.deepEqual(decodeKey(Buffer.from('\x1b\x7f')).key, { name: 'backspace', alt: true })
assert.equal(decodeKey(Buffer.from('\x1b[1;3F')).key.alt, true)
assert.equal(decodeKey(Buffer.from('\x1b[8;3~')).key.alt, true)

const edit = (text, cursor, name, modifiers = {}) => editComposer(text, cursor, { name, ...modifiers })
const ctrl = { ctrl: true }
const alt = { alt: true }
assert.deepEqual(edit('one\ntwo', 6, 'a', ctrl), { text: 'one\ntwo', cursor: 4 })
assert.deepEqual(edit('one\ntwo', 2, 'a', ctrl), { text: 'one\ntwo', cursor: 0 })
assert.deepEqual(edit('one\ntwo', 2, 'end', alt), { text: 'one\ntwo', cursor: 3 })
assert.deepEqual(edit('one\ntwo', 2, 'k', ctrl), { text: 'on\ntwo', cursor: 2 })
assert.deepEqual(edit('one\ntwo', 3, 'k', ctrl), { text: 'onetwo', cursor: 3 })
assert.deepEqual(edit('one\ntwo', 6, 'u', ctrl), { text: 'one\no', cursor: 4 })
assert.deepEqual(edit('héllo 世界  ', 10, 'w', ctrl), { text: 'héllo ', cursor: 6 })
assert.deepEqual(edit('héllo 世界', 8, 'backspace', alt), { text: 'héllo ', cursor: 6 })
assert.deepEqual(edit('one two', 7, 'left', alt), { text: 'one two', cursor: 4 })
assert.deepEqual(edit('one two', 1, 'right', ctrl), { text: 'one two', cursor: 3 })
assert.deepEqual(edit('A👩‍💻B', 6, 'left'), { text: 'A👩‍💻B', cursor: 1 })
assert.deepEqual(edit('A👩‍💻B', 1, 'right'), { text: 'A👩‍💻B', cursor: 6 })
assert.deepEqual(edit('áb', 2, 'backspace'), { text: 'b', cursor: 0 })
assert.deepEqual(edit('áb', 0, 'delete'), { text: 'b', cursor: 0 })
assert.deepEqual(edit('A👩‍💻B', 3, 'delete'), { text: 'AB', cursor: 1 })
assert.deepEqual(edit('A👩‍💻B', 3, 'backspace'), { text: 'AB', cursor: 1 })
assert.deepEqual(edit('one', 1, 'right', { shift: true }), { text: 'one', cursor: 2 })
assert.equal(edit('one', 1, 'e', ctrl), null, 'Ctrl+E stays reserved for reasoning')
assert.equal(edit('one', 1, 'p', ctrl), null, 'Ctrl+P stays reserved for settings')
console.log('composer editing tests passed')
