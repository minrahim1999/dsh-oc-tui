import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './mcp.js'

export function editorCommand(env = process.env) {
  return parseArgs(env.VISUAL?.trim() || env.EDITOR?.trim() || '')
}

// Only the user's explicitly configured editor can execute. The draft and
// temporary path are never interpolated into shell source.
export async function editDraft(text, { command, cwd, suspend, resume, signal, base = tmpdir() }) {
  signal?.throwIfAborted()
  const dir = await mkdtemp(join(base, 'dsh-prompt-'))
  const file = join(dir, 'prompt.md')
  try {
    await writeFile(file, text, { mode: 0o600, flag: 'wx' })
    signal?.throwIfAborted()
    suspend()
    try {
      const saved = await new Promise((resolve, reject) => {
        const [editor, ...args] = command
        const child = spawn(editor, [...args, file], { cwd, stdio: 'inherit', signal, shell: false })
        child.once('error', reject)
        child.once('close', (code) => resolve(code === 0))
      })
      if (!saved) return undefined
      if ((await stat(file)).size > Math.max(4 * 1024 * 1024, Buffer.byteLength(text))) {
        throw new Error('Edited draft exceeds the size limit')
      }
      return await readFile(file, 'utf8')
    } finally {
      resume()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
