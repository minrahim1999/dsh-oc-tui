// `!command`: a command the person types runs as the person, the way DSH's
// user terminals do (dsh-api-terminal-controller: user terminals keep the
// person's permissions and are not gated by the Session's sandbox mode). The
// agent's permission presets are untouched — they govern agent tools only —
// and nothing reaches the model until the person sends their next message,
// which then carries the command and its bounded output as visible context.
import { spawn } from 'node:child_process'

export function parseShellInput(text) {
  if (typeof text !== 'string' || !text.startsWith('!')) return undefined
  return text.slice(1).trim()
}

function shellInvocation(command) {
  if (process.platform === 'win32') return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]]
  return [process.env.SHELL || '/bin/sh', ['-c', command]]
}

export function runShellCommand(command, { cwd, signal, timeoutMs = 120_000, maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve) => {
    const [shell, args] = shellInvocation(command)
    let output = Buffer.alloc(0)
    let truncated = false
    let cancelled = false
    let timedOut = false
    let settled = false
    const child = spawn(shell, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so cancelling stops background children too.
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
        else process.kill(-child.pid, 'SIGKILL')
      } catch { /* already gone */ }
    }
    const collect = (chunk) => {
      if (truncated) return
      const room = maxBytes - output.length
      if (chunk.length > room) {
        // Keep the head; a long tail is what scrolled past anyway.
        output = Buffer.concat([output, chunk.subarray(0, Math.max(0, room))])
        truncated = true
        return
      }
      output = Buffer.concat([output, chunk])
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const onAbort = () => { cancelled = true; stop() }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (exitCode, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      // Drop a split UTF-8 sequence left by truncation.
      let text = output.toString('utf8')
      if (truncated) text = text.replace(/\uFFFD+$/u, '')
      while (Buffer.byteLength(text) > maxBytes) text = text.slice(0, -1)
      resolve({ exitCode, output: text, truncated, cancelled, timedOut, ...(error ? { error: error.message } : {}) })
    }
    child.once('error', (error) => finish(null, error))
    child.once('close', (code) => finish(code))
  })
}

// The text the next prompt carries. Bounded and labelled so the model reads
// it as what the person ran, not as an instruction.
export function shellContext(command, result, { maxChars = 8000 } = {}) {
  const status = result.cancelled ? 'cancelled'
    : result.timedOut ? 'timed out'
      : result.error ? `failed to start: ${result.error}`
        : `exit code ${result.exitCode}`
  let body = String(result.output ?? '')
  let cut = result.truncated
  if (body.length > maxChars) { body = body.slice(0, maxChars); cut = true }
  return [
    `<user-shell-command status="${status}">`,
    `$ ${command}`,
    body.replace(/<\/user-shell-command>/g, '</ user-shell-command>'),
    ...(cut ? ['[output truncated]'] : []),
    '</user-shell-command>',
  ].join('\n')
}
