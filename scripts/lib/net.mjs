/**
 * Tiny network helpers for the verification harness. Fixes PIPE-5: scripts used
 * to hardcode dev-server ports (5180/5191/5306/5313/5314…) which collide when
 * several runs / a live dev server share the machine. `getFreePort()` lets a
 * script grab a guaranteed-open port instead.
 */
import net from 'node:net'

/** True for an integer in the valid TCP port range. */
export function isValidPort(p) {
  return Number.isInteger(p) && p >= 1 && p <= 65535
}

/**
 * Ask the OS for a free port (bind :0, read the assigned port, release it).
 * There is an unavoidable tiny TOCTOU window between release and re-bind; we
 * pair this with vite's `--strictPort` so a lost race fails loudly instead of
 * silently serving on a different port.
 */
export function getFreePort({ host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, host, () => {
      const { port } = srv.address()
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

/**
 * Poll `url` until it answers (any HTTP response = the port is up), or until
 * `timeoutMs` elapses. Returns true when reachable, false on timeout. A
 * resolved fetch — regardless of status code — means the server is listening,
 * which is the readiness signal we want for a dev server.
 */
export async function waitForServer(url, { timeoutMs = 60000, intervalMs = 300, signal } = {}) {
  const start = Date.now()
  for (;;) {
    try {
      await fetch(url, { signal })
      return true
    } catch {
      // connection refused / reset — not up yet
    }
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
