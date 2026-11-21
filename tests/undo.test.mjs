import assert from 'node:assert/strict'
import { UndoStack, undoPoint } from '../lib/undo.js'

const stack = new UndoStack()
assert.equal(stack.canUndo, false)
assert.equal(stack.canRedo, false)
assert.equal(stack.pushUndo(undefined), false, 'nothing to undo is not an entry')
assert.equal(stack.pushUndo({ sessionId: 's1', prompt: 'hi' }), true)
assert.equal(stack.canUndo, true)
assert.equal(stack.canRedo, false)
assert.equal(stack.pushRedo({ sessionId: 'fork-1' }), true)
assert.equal(stack.canUndo, false, 'redo replaces the undo slot')
assert.equal(stack.canRedo, true)
assert.equal(stack.pushUndo({ sessionId: 's2' }), true)
assert.equal(stack.canRedo, false, 'a fresh undo drops the redo')
stack.clear()
assert.equal(stack.canUndo || stack.canRedo, false)

assert.equal(undoPoint([]), undefined)
assert.equal(undoPoint(undefined), undefined)
const points = [{ n: 1, seq: 3, label: 'first' }, { n: 2, seq: 9, label: 'second' }]
assert.deepEqual(undoPoint(points), { n: 2, seq: 9, label: 'second' }, 'the latest prompt is the one undone')
assert.equal(undoPoint([{ n: 1, seq: 3, label: 'only', current: true }]), undefined, 'a point with no work after it is not an undo')
console.log('undo tests passed')
