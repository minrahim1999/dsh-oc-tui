import assert from 'node:assert/strict'
import { loadSelectableModels, filterSelectableModels, ModelHistory } from '../lib/model-picker.js'

const requests = []
const llm = {
  listProviders: () => ['configured', 'builtin', 'offline'].map(id => ({ id })),
  listModels: async (id) => {
    requests.push(id)
    if (id === 'offline') throw Error('unavailable')
    return [{ id: 'shared', name: 'Built-in model' }, { id: 'other' }, { id: 'shared' }]
  },
  listConfigurableProviders: () => [{ provider: 'configured', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'configured'] }],
}
const settings = { describe: (options) => {
  assert.deepEqual(options, { redactSecrets: true })
  return [{ ns: 'llm-pi-ai', value: { providers: { configured: { models: ['shared', { id: 'image', name: 'Vision' }] }, dormant: { models: ['ignored'] } } } }]
} }
const ctx = { get: (service) => ({ llm, settings })[service] }
const { models, unavailable } = await loadSelectableModels(ctx)
assert.deepEqual(unavailable, ['offline'])
assert.deepEqual(requests.sort(), ['builtin', 'offline'])
assert.deepEqual(models.map(({ provider, model }) => [provider, model]), [['configured', 'shared'], ['configured', 'image'], ['builtin', 'shared'], ['builtin', 'other']])
assert.deepEqual(filterSelectableModels(models, 'CONFIG vision').map(route => route.model), ['image'])
assert.equal(filterSelectableModels(models, 'shared').length, 2)
const history = new ModelHistory()
const [a, b, c] = models
history.visit(a)
history.visit(b)
history.visit(c)
history.visit(b)
assert.equal(history.cycle(b), c)
assert.equal(history.cycle(c), a)
assert.equal(history.cycle(c, -1), b)
assert.equal(history.cycle(b, 1, [b]), undefined)
assert.equal(history.toggleFavorite(a), true)
assert.equal(history.isFavorite(a), true)
assert.equal(history.isFavorite(c), false, 'favorite identity includes provider')
assert.equal(history.toggleFavorite(a), false)
const slow = { get: (key) => key === 'llm' ? {
  listProviders: () => [{ id: 'slow' }, { id: 'fast' }],
  listModels: (provider) => provider === 'slow' ? new Promise(() => {}) : Promise.resolve([{ id: 'ready' }]),
} : undefined }
const bounded = await loadSelectableModels(slow, { timeoutMs: 25 })
assert.deepEqual(bounded.models.map(row => row.model), ['ready'])
assert.deepEqual(bounded.unavailable, ['slow'])
console.log('model picker tests passed')
