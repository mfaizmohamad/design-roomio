#!/usr/bin/env node
/**
 * Run the detection-pipeline Python test suite (detection-pipeline/tests).
 *
 * The suite is fully offline (synthetic images, no Ollama daemon, no fixtures,
 * headless OpenCV) so it runs anywhere its pip deps are installed:
 *
 *   cd detection-pipeline && python3 -m venv .venv \
 *     && ./.venv/bin/pip install -r requirements.txt
 *
 * Interpreter resolution: detection-pipeline/.venv (repo convention) if it
 * exists, else `python3` on PATH (what CI uses after pip-installing
 * requirements.txt).
 *
 * Usage:
 *   node scripts/test-python.mjs                    # fail if Python deps missing
 *   node scripts/test-python.mjs --skip-if-missing  # warn + exit 0 instead
 *                                                   # (pre-push hook: CI still gates)
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pipelineDir = path.join(repoRoot, 'detection-pipeline')
const skipIfMissing = process.argv.includes('--skip-if-missing')

const venvPython =
  process.platform === 'win32'
    ? path.join(pipelineDir, '.venv', 'Scripts', 'python.exe')
    : path.join(pipelineDir, '.venv', 'bin', 'python')
const python = existsSync(venvPython) ? venvPython : 'python3'

function bail(message) {
  if (skipIfMissing) {
    console.warn(`⚠ Skipping detection-pipeline Python tests: ${message}`)
    console.warn('  (CI still gates them; to run locally: cd detection-pipeline && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt)')
    process.exit(0)
  }
  console.error(`✖ Cannot run detection-pipeline Python tests: ${message}`)
  console.error('  Set up the interpreter with:')
  console.error('    cd detection-pipeline && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt')
  process.exit(1)
}

// Preflight: interpreter present and test deps importable (clear message beats
// a unittest ImportError wall).
const probe = spawnSync(python, ['-c', 'import numpy, cv2, sklearn, PIL, jsonschema'], {
  cwd: pipelineDir,
  encoding: 'utf8',
})
if (probe.error?.code === 'ENOENT') bail(`no Python interpreter found (tried ${python})`)
if (probe.status !== 0) bail(`Python deps missing for ${python} (pip install -r detection-pipeline/requirements.txt)`)

console.log(`▶ detection-pipeline tests (${python === venvPython ? '.venv' : 'python3'})`)
const run = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], {
  cwd: pipelineDir, // tests resolve sibling modules + relative paths from here
  stdio: 'inherit',
})
process.exit(run.status ?? 1)
