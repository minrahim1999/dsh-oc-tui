// Undo/redo for the last exchange. A DSH session log is append-only, so "undo"
// is the same move `/rewind` makes: fork a new session before the prompt, which
// leaves the original untouched — and that untouched parent is what "redo"
// reopens. One level each way is all the composer needs, and anything else
// (sending a new prompt, switching sessions) drops the redo.
export class UndoStack {
  #lastUndo
  #lastRedo

  get canUndo() { return this.#lastUndo !== undefined }
  get canRedo() { return this.#lastRedo !== undefined }
  get undoEntry() { return this.#lastUndo }
  get redoEntry() { return this.#lastRedo }

  // `entry` is what the caller needs to reopen the work it replaced.
  pushUndo(entry) {
    if (entry === undefined) return false
    this.#lastUndo = entry
    this.#lastRedo = undefined
    return true
  }

  // Undo produced the forked session; redo reopens `entry.sessionId`.
  pushRedo(entry) {
    if (entry === undefined) return false
    this.#lastRedo = entry
    this.#lastUndo = undefined
    return true
  }

  clear() {
    this.#lastUndo = undefined
    this.#lastRedo = undefined
  }
}

// The prompt an `/undo` is about to cut away: the last user prompt with
// something after it. `points` come from rewind.js (`listRewindPoints`), whose
// entries carry the prompt text and sequence.
export function undoPoint(points) {
  if (!Array.isArray(points)) return undefined
  const last = points[points.length - 1]
  if (!last || last.current) return undefined
  return last
}
