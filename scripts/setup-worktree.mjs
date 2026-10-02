/**
 * Bootstrap a git worktree in SECONDS instead of a multi-minute `npm install`.
 *
 * A fresh `git worktree` has no node_modules, so every agent used to run
 * `npm install` at the root AND in server/ (+ any island). But the deps already
 * exist in the MAIN checkout — so we symlink them in instead of reinstalling.
 * (shared/LEARNINGS.md already says "symlink each island's node_modules"; this
 * makes that a one command: `npm run bootstrap:worktree`.)
 *
 * Idempotent: existing node_modules are left alone. Falls back to `npm install`
 * for an island only if the main checkout is missing that island's node_modules.
 *
 *   npm run bootstrap:worktree
 */
import { existsSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Root + every build island that ships its own package.json / node_modules. */
export const ISLANDS = ['.', 'server', 'camera-flythrough', 'lighting', 'multi-room', 'persistence', 'rendering', 'texturing']

/**
 * Pure planner (unit-tested): decide what to do for each island without
 * touching the filesystem beyond the injected `exists` predicate.
 * Returns [{ island, action: 'link'|'skip'|'install', source?, target, reason? }].
 */
export function planWorktreeLinks({ main, root, islands = ISLANDS, exists }) {
  const plan = []
  for (const island of islands) {
    const rootIsland = join(root, island)
    // Skip islands that don't exist in this worktree (or aren't a package).
    if (!exists(rootIsland) || !exists(join(rootIsland, 'package.json'))) continue
    const target = join(rootIsland, 'node_modules')
    const source = join(main, island, 'node_modules')
    if (exists(target)) plan.push({ island, action: 'skip', target, reason: 'node_modules already present' })
    else if (exists(source)) plan.push({ island, action: 'link', source, target })
    else plan.push({ island, action: 'install', target, reason: 'main checkout has no node_modules to link' })
  }
  return plan
}

/** Absolute path of the MAIN working tree (the first `git worktree list` entry). */
function mainCheckout(cwd) {
  const out = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' })
  if (out.status !== 0) throw new Error('`git worktree list` failed: ' + (out.stderr || '').trim())
  const first = out.stdout.split('\n').find((l) => l.startsWith('worktree '))
  if (!first) throw new Error('could not determine the main checkout from `git worktree list`')
  return first.slice('worktree '.length).trim()
}

function main() {
  const t0 = Date.now()
  const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
  const MAIN = resolve(mainCheckout(ROOT))

  if (MAIN === ROOT) {
    console.log(`✓ this IS the main checkout (${ROOT}) — node_modules should already be installed here; nothing to link.`)
    return 0
  }
  console.log(`▶ bootstrapping worktree\n    worktree: ${ROOT}\n    main:     ${MAIN}\n`)

  const plan = planWorktreeLinks({ main: MAIN, root: ROOT, exists: existsSync })
  let linked = 0
  let installed = 0
  for (const step of plan) {
    const label = step.island === '.' ? '(root)' : step.island
    if (step.action === 'skip') {
      console.log(`  = ${label}: skip (${step.reason})`)
    } else if (step.action === 'link') {
      try {
        symlinkSync(step.source, step.target, process.platform === 'win32' ? 'junction' : 'dir')
        linked++
        console.log(`  → ${label}: linked node_modules → ${step.source}`)
      } catch (e) {
        if (e.code === 'EEXIST') console.log(`  = ${label}: skip (created concurrently)`)
        else throw e
      }
    } else {
      console.log(`  ⚙ ${label}: ${step.reason} → npm install`)
      const r = spawnSync('npm', ['install'], { cwd: join(ROOT, step.island), stdio: 'inherit' })
      if (r.status !== 0) throw new Error(`npm install failed in ${label}`)
      installed++
    }
  }

  console.log(`\n✓ worktree ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${linked} linked, ${installed} installed, ${plan.length - linked - installed} already present.`)
  return 0
}

// Run only when invoked directly (so the test can import the pure planner).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.exit(main())
  } catch (e) {
    console.error('✗ ' + (e?.message || e))
    process.exit(1)
  }
}
