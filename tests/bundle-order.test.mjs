import assert from 'node:assert/strict'
import { orderWarning } from '../lib/bundle-order.js'

const base = '@deepseek-ai/dsh-base'
const mirrored = '@deepseek-ai/dsh-subagent-codex'

assert.equal(orderWarning([base, 'dsh-oc-tui', mirrored]), undefined, 'the shipped order is quiet')
assert.equal(orderWarning([base, 'dsh-oc-tui']), undefined)
assert.equal(orderWarning(undefined), undefined, 'a host without the service reports nothing')
assert.equal(orderWarning([]), undefined)
assert.equal(orderWarning([mirrored]), undefined, 'a profile without the TUI is not our business')

const warned = orderWarning([base, mirrored, '@local/x', '@local/y', '@local/z', 'dsh-oc-tui'])
assert.ok(warned, 'the TUI listed after mirrored bundles is reported')
assert.match(warned, /after 4 other bundles/)
assert.match(warned, /@deepseek-ai\/dsh-subagent-codex, @local\/x, @local\/y, …/)
assert.match(warned, /dsh-tui/)
assert.match(orderWarning([base, mirrored, 'dsh-oc-tui']), /after 1 other bundle \(/)
console.log('bundle order tests passed')
