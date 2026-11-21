// Bundle-order check
//
// `dsh plugin --profile tui add` appends the bundle to `dsh.profile.bundles`, so
// re-adding it after the mirrored Desktop bundles puts its preset declarations
// after rows that insert into them: the TUI then boots dsh-base with no modes
// and none of its own rows. `dsh-tui` reorders on its next launch; plain
// `dsh tui` does not. This row turns that silent failure into one sentence.
export const name = 'dsh-oc-tui/bundle-order'
export const inject = ['profileContext']

const OWN = ['@deepseek-ai/dsh-base', 'dsh-oc-tui']

// `startedBundles` is the order this process booted with, before any persisted
// edit — exactly the list that broke.
export function orderWarning(startedBundles) {
  const bundles = Array.isArray(startedBundles) ? startedBundles : []
  const rowIndex = bundles.indexOf('dsh-oc-tui')
  if (rowIndex < 0) return undefined
  const misplaced = bundles.slice(0, rowIndex)
    .filter((name) => typeof name === 'string' && !OWN.includes(name))
  if (misplaced.length === 0) return undefined
  const shown = misplaced.slice(0, 3).join(', ') + (misplaced.length > 3 ? ', …' : '')
  return `dsh-oc-tui is listed after ${misplaced.length} other bundle`
    + `${misplaced.length === 1 ? '' : 's'} (${shown}), so its own rows and preset layers load last. `
    + 'Run `dsh-tui` once (or move dsh-oc-tui to the front of dsh.profile.bundles) '
    + 'so modes and the TUI layers load first.'
}

export function apply(ctx) {
  const warning = orderWarning(ctx.profileContext?.startedBundles)
  if (warning) ctx.logger?.warn?.(warning)
}
