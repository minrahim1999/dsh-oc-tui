// The Creator preset's `tool-cordis` row injects `cordisInspect`. Our row
// provides it without the Web host runner so Creator mode activates in the TUI.
// Loading this module must never break the TUI: the runner is imported lazily,
// and a host without the package simply leaves Creator unavailable, as before.
//
// The real registration is verified by booting the TUI (the runner resolves
// through the dsh installation, which plain Node cannot reach).
import assert from 'node:assert/strict'

const hostModule = await import('../lib/cordis-inspect.js')

assert.equal(hostModule.name, 'dsh-oc-tui/cordis-inspect')
assert.deepEqual(hostModule.inject, ['tools'], 'it registers inspect providers into the tool registry')

{
  const existing = { kind: 'host registry' }
  const asked = []
  const ctx = { get: (name) => { asked.push(name); return name === 'cordisInspect' ? existing : undefined } }
  assert.equal(hostModule.apply(ctx), undefined)
  assert.deepEqual(asked, ['cordisInspect'], 'a host that already provides the registry is left alone')
  assert.equal(ctx.cordisInspect, undefined, 'and nothing is registered twice')
}

{
  // No dsh host runner reachable from here: the lazy import fails, and that
  // failure must be swallowed rather than becoming an unhandled rejection.
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  const ctx = { get: () => undefined }
  assert.equal(hostModule.apply(ctx), undefined, 'apply never throws for a missing package')
  await new Promise(resolve => setTimeout(resolve, 100))
  process.off('unhandledRejection', onUnhandled)
  assert.deepEqual(unhandled, [], 'the failed import is handled inside the row')
}

console.log('cordis inspect tests passed')
