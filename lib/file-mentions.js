// Follow the host's @path / @"quoted path" prompt grammar. Completion inserts
// path text only: discovery never reads a file or attaches its contents.
export function activeFileMention(text, cursor) {
  if (text.startsWith('/') || text.startsWith('!')) return undefined
  const startOfLine = cursor === 0 ? 0 : text.lastIndexOf('\n', cursor - 1) + 1
  // The bounded window keeps a long pasted line off the autocomplete hot path.
  const begin = Math.max(startOfLine, cursor - 1024)
  const prefix = (begin > startOfLine ? 'x' : '') + text.slice(begin, cursor)
  const quoted = /(?:^|\s)(@"([^"\r]*))$/u.exec(prefix)
  const plain = quoted ? undefined : /(?:^|\s)(@([^\s"]*))$/u.exec(prefix)
  const match = quoted ?? plain
  if (!match || /[\u0000-\u001f\u007f-\u009f]/u.test(match[2])) return undefined
  return {
    start: cursor - match[1].length,
    query: quoted ? match[2] : match[2].replace(/#\d+(?:-\d*)?$/, ''),
    quoted: Boolean(quoted),
  }
}

export function applyFileMention(text, cursor, { path, kind }) {
  const token = activeFileMention(text, cursor)
  if (!token || typeof path !== 'string' || !path || /[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const after = text.slice(cursor)
  const suffix = (token.quoted ? /^[^"\r\n]*"?/u : /^[^\s"]*/u).exec(after)[0]
  const end = cursor + suffix.length
  const directory = kind === 'directory'
  const quoted = token.quoted || /\s/u.test(path)
  let result = '@' + (quoted ? '"' : '') + path + (directory ? '/' : quoted ? '"' : '')
  if (!directory) {
    const range = !token.quoted && /#([1-9]\d*)(?:-([1-9]\d*))?$/.exec(text.slice(token.start, end))
    if (range) result += range[2] ? ` (lines ${range[1]}–${range[2]})` : ` (line ${range[1]})`
    if (!/^\s/u.test(text.slice(end))) result += ' '
  }
  return { start: token.start, end, text: result }
}

export function workspaceMentionPath(path) {
  return typeof path === 'string' && !/^(?:[\\/]|[a-z]:)/i.test(path)
    && !path.split(/[\\/]/u).includes('..') && !/[\u0000-\u001f\u007f-\u009f"]/u.test(path)
}

// One cancellable query at a time. Some providers cannot stop an already
// running index build; an obsolete result still never changes the UI.
export class FileMentionSearch {
  #request

  constructor(show, { delay = 30 } = {}) {
    this.show = show
    this.delay = delay
  }

  update(owner, query, list) {
    if (this.#request?.owner === owner && this.#request.query === query) return
    this.clear()
    const control = new AbortController()
    const request = { owner, query, control }
    this.#request = request
    request.timer = setTimeout(async () => {
      try {
        const rows = workspaceMentionPath(query) ? await list(query, control.signal) : []
        if (this.#request !== request) return
        this.show(rows.filter(row => row?.path && workspaceMentionPath(row.path) && ['file', 'directory'].includes(row.kind)).slice(0, 20))
      } catch {
        if (this.#request === request) this.show([])
      }
    }, this.delay)
  }

  clear() {
    if (!this.#request) return
    const { control, timer } = this.#request
    this.#request = undefined
    control.abort()
    clearTimeout(timer)
    this.show([])
  }
}

// Before the first prompt, there is no Agent for the Host service to query.
// Reuse DSH's bounded workspace index for that local draft; this reads paths
// only and must not create a Session just because its user types @.
export function draftFileLookup(cwd) {
  let opening
  let disposed = false
  return {
    async list(query, signal) {
      signal.throwIfAborted()
      if (disposed) return []
      opening ??= import('@deepseek-ai/dsh-file-reference-local').then((host) => {
        const search = new host.WorkspaceFileSearch(cwd, {
          maxResults: host.DEFAULT_FILE_SEARCH_MAX_RESULTS,
          maxEntries: host.DEFAULT_FILE_SEARCH_MAX_ENTRIES,
          excludedDirectories: host.DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
        })
        if (disposed) search.dispose()
        return search
      })
      return (await opening).list(query, signal)
    },
    dispose() {
      disposed = true
      void opening?.then(search => search.dispose(), () => {})
    },
  }
}
