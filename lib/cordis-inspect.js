// Creator mode (`cordis` preset) needs the `cordisInspect` service, which only
// the Web host's `cordis-host-runner` row mounts. The TUI mounts the registry
// alone — no dynamic plugin runner, no Web server, no Client transport — so the
// preset's `tool-cordis` row activates against the Host-side inspect providers.
//
// The import is dynamic on purpose: this row must never break the TUI on a host
// that does not ship the package, and a preset row waiting for a service stays
// pending until it appears, so registering it a moment later still composes.
export const name = 'dsh-oc-tui/cordis-inspect'
export const inject = ['tools']

const CLIENT_QUERY_TIMEOUT_MS = 10_000

export function apply(ctx) {
  // A host that already runs the Web composition keeps its own registry.
  if (ctx.get('cordisInspect') !== undefined) return
  void import('@deepseek-ai/dsh-cordis-host-runner')
    .then(({ CordisInspectRegistryService }) => {
      if (ctx.get('cordisInspect') !== undefined) return
      // Client-platform providers live in a browser this profile does not have;
      // their queries time out and the tool reports that failure.
      new CordisInspectRegistryService(ctx, CLIENT_QUERY_TIMEOUT_MS)
    })
    .catch(() => { /* no host runner in this dsh: Creator mode stays unavailable */ })
}
