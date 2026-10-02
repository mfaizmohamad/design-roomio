/**
 * Chrome/Chromium executable resolution for the puppeteer-based verification
 * scripts. Fixes PIPE-3: browser-check/auth-check/lock-check/detect-check used
 * to hardcode `/Applications/Google Chrome.app/...`, which dies on any machine
 * without that exact install and offers no override.
 *
 * Resolution order:
 *   1. env CHROME or CHROME_PATH (explicit override) — must exist, else throw
 *   2. first existing path in CHROME_CANDIDATES (mac/linux/windows)
 *   3. throw an error that LISTS every path it tried, so the fix is obvious
 */
import { existsSync } from 'node:fs'

/** Verified SwiftShader-headless launch flags (see shared/LEARNINGS.md). */
export const CHROME_FLAGS = [
  '--no-sandbox',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
]

/** Common install locations, most-preferred first. */
export const CHROME_CANDIDATES = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

/**
 * Resolve a Chrome executable path. `env`, `exists`, and `candidates` are
 * injectable so this is unit-testable without touching the real filesystem.
 * @throws a clear error listing what it tried when nothing is found.
 */
export function resolveChrome({ env = process.env, exists = existsSync, candidates = CHROME_CANDIDATES } = {}) {
  const override = env.CHROME || env.CHROME_PATH
  if (override) {
    if (exists(override)) return override
    throw new Error(
      `Chrome not found at CHROME/CHROME_PATH="${override}" — the file does not exist. ` +
        `Fix the path or unset the variable to fall back to auto-detection.`,
    )
  }
  const found = candidates.find((p) => exists(p))
  if (found) return found
  throw new Error(
    'Could not find a Chrome/Chromium executable. Set CHROME=/path/to/chrome (or CHROME_PATH).\nTried:\n' +
      candidates.map((p) => '  - ' + p).join('\n'),
  )
}
