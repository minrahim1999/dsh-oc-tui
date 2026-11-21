// Composer positions are UTF-16 offsets, but character editing must not split
// a grapheme (including emoji sequences and combining marks).
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const word = /[\p{L}\p{N}\p{M}_]/u

function nextBoundary(text, index) {
  const part = graphemes.segment(text).containing(index)
  return part ? part.index + part.segment.length : text.length
}

function previousBoundary(text, index) {
  return graphemes.segment(text).containing(index - 1)?.index ?? 0
}

function wordBoundary(text, cursor, direction) {
  const move = direction < 0 ? previousBoundary : nextBoundary
  const hasMore = () => direction < 0 ? cursor > 0 : cursor < text.length
  const isWord = () => word.test(direction < 0
    ? text.slice(move(text, cursor), cursor)
    : text.slice(cursor, move(text, cursor)))
  // Readline movement skips separators, then the adjacent word.
  while (hasMore() && !isWord()) cursor = move(text, cursor)
  while (hasMore() && isWord()) cursor = move(text, cursor)
  return cursor
}

export function editComposer(text, cursor, { name, ctrl, alt, meta, shift }) {
  if (meta) return null
  const to = (position) => ({ text, cursor: position })
  const remove = (start, end) => {
    if (start === end) return to(cursor)
    const segments = graphemes.segment(text)
    start = segments.containing(start)?.index ?? start
    const last = segments.containing(end - 1)
    end = last ? last.index + last.segment.length : end
    return { text: text.slice(0, start) + text.slice(end), cursor: start }
  }
  const lineStart = () => cursor === 0 ? 0 : text.lastIndexOf('\n', cursor - 1) + 1
  const lineEnd = () => {
    const newline = text.indexOf('\n', cursor)
    return newline < 0 ? text.length : newline
  }
  if (ctrl && !alt) {
    if (name === 'a') return to(lineStart())
    if (name === 'u') return remove(lineStart(), cursor)
    if (name === 'k') {
      const end = lineEnd()
      return remove(cursor, end === cursor && end < text.length ? end + 1 : end)
    }
    if (name === 'w') return remove(wordBoundary(text, cursor, -1), cursor)
  }
  if (alt && !ctrl) {
    if (name === 'home') return to(lineStart())
    if (name === 'end') return to(lineEnd())
    if (name === 'backspace') return remove(wordBoundary(text, cursor, -1), cursor)
    if (name === 'delete') return remove(cursor, wordBoundary(text, cursor, 1))
  }
  if (name === 'left' || name === 'right') {
    const direction = name === 'left' ? -1 : 1
    return to(ctrl || alt ? wordBoundary(text, cursor, direction)
      : direction < 0 ? previousBoundary(text, cursor) : nextBoundary(text, cursor))
  }
  if (!ctrl && !alt && name === 'backspace') return remove(previousBoundary(text, cursor), cursor)
  if (!ctrl && !alt && name === 'delete') return remove(cursor, nextBoundary(text, cursor))
  return null
}
