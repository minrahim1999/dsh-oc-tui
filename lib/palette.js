// The command palette. One list of the actions the current view can run, so a
// shortcut does not have to be remembered to be discovered — and so a feature
// added later has one place to appear in. Ctrl+K opens it; Ctrl+P stays the
// settings page it has always been.
export const PALETTE_ACTIONS = Object.freeze([
  { id: 'settings', key: 'command.settings', shortcut: 'Ctrl+P', needs: 'any' },
  { id: 'new', key: 'command.new', shortcut: 'Ctrl+N', needs: 'any' },
  { id: 'models', key: 'modelPicker.title', shortcut: '/models', needs: 'any' },
  { id: 'mode', key: 'mode.pickerTitle', shortcut: '/mode', needs: 'any' },
  { id: 'thinking', key: 'palette.thinking', shortcut: 'Ctrl+T', needs: 'any' },
  { id: 'resume', key: 'command.resume', shortcut: '/resume', needs: 'any' },
  { id: 'rewind', key: 'command.rewind', shortcut: 'Esc Esc', needs: 'session' },
  { id: 'undo', key: 'palette.undo', shortcut: '/undo', needs: 'session' },
  { id: 'redo', key: 'palette.redo', shortcut: '/redo', needs: 'undo' },
  { id: 'editor', key: 'hint.editor', shortcut: 'Ctrl+O', needs: 'any' },
  { id: 'stats', key: 'command.stats', shortcut: '/stats', needs: 'session' },
  { id: 'help', key: 'command.help', shortcut: '/help', needs: 'any' },
  { id: 'quit', key: 'command.quit', shortcut: '/quit', needs: 'any' },
])

// `state.hasSession` gates the actions that need one; `state.canRedo` the one
// that needs something to redo.
export function paletteActions(state = {}) {
  return PALETTE_ACTIONS.filter((action) => {
    if (action.needs === 'session') return Boolean(state.hasSession)
    if (action.needs === 'undo') return Boolean(state.canRedo)
    return true
  })
}

export function filterPalette(actions, query, labelOf = (action) => action.id) {
  const terms = String(query ?? '').toLowerCase().trim().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return actions
  return actions.filter((action) => {
    const haystack = `${labelOf(action)} ${action.id} ${action.shortcut}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
