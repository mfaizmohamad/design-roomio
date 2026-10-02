/**
 * Ephemeral Vite dev server for verification scripts.
 *
 * Fixes PIPE-5 (hardcoded ports) by picking a FREE port when none is given, and
 * fixes the swallowed-stderr trap: the old scripts spawned vite with
 * `stdio:'ignore'`, so a failed boot (port clash, config error) looked like a
 * generic "did not start" timeout with no cause. Here we capture stdout/stderr
 * into a ring buffer and include the tail in the thrown error.
 *
 * A FRESH server per run is load-bearing, not convenience: a long-running HMR'd
 * server serves `?t=`-versioned modules, so a script's in-page
 * `import('/src/...')` loads DUPLICATE module instances (a second zustand store)
 * and silently drives the wrong app. See shared/LEARNINGS.md.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getFreePort } from './net.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Prefer the project-local vite binary; fall back to `npx vite`. */
function viteCommand(cwd) {
  const bin = join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  return existsSync(bin) ? { cmd: bin, pre: [] } : { cmd: 'npx', pre: ['vite'] }
}

/**
 * Start a Vite dev server.
 * @param {object} [opts]
 * @param {number} [opts.port]  fixed port; omit to auto-pick a free one
 * @param {string} [opts.cwd=process.cwd()]  project root (must hold vite.config)
 * @param {number} [opts.readyTimeoutMs=60000]
 * @returns {Promise<{url:string, port:number, stop:()=>Promise<void>, process:import('node:child_process').ChildProcess}>}
 */
export async function startDevServer({ port, cwd = process.cwd(), readyTimeoutMs = 60000, env = process.env, extraArgs = [] } = {}) {
  const p = port || (await getFreePort())
  const url = `http://localhost:${p}`
  const { cmd, pre } = viteCommand(cwd)
  const args = [...pre, '--port', String(p), '--strictPort', ...extraArgs]

  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const tail = []
  const capture = (chunk) => {
    tail.push(chunk.toString())
    while (tail.length > 60) tail.shift()
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  let exited = null
  child.once('exit', (code, signal) => { exited = { code, signal } })

  const stop = () =>
    new Promise((resolve) => {
      if (exited || child.exitCode != null) return resolve()
      const kill9 = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already exited between the timer firing and the kill — nothing to do */ } }, 4000)
      child.once('exit', () => { clearTimeout(kill9); resolve() })
      try { child.kill('SIGTERM') } catch { clearTimeout(kill9); resolve() }
    })

  // Race readiness against an early exit, without leaking a timer.
  const start = Date.now()
  let ready = false
  while (Date.now() - start <= readyTimeoutMs) {
    if (exited) break
    try {
      await fetch(url)
      ready = true
      break
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  if (!ready) {
    await stop()
    const why = exited
      ? `vite exited early (code ${exited.code}, signal ${exited.signal})`
      : `timed out after ${readyTimeoutMs}ms`
    const output = tail.join('').trim().slice(-2000) || '(no output captured)'
    throw new Error(`dev server failed to start on ${url}: ${why}\n--- vite output ---\n${output}`)
  }
  return { url, port: p, stop, process: child }
}

/** Run `fn(server)` with a dev server, guaranteeing teardown. */
export async function withDevServer(fn, opts) {
  const server = await startDevServer(opts)
  try {
    return await fn(server)
  } finally {
    await server.stop()
  }
}
