import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { planWorktreeLinks, ISLANDS } from './setup-worktree.mjs'

const MAIN = '/repo/main'
const ROOT = '/repo/.worktrees/wt1'
// Build an `exists` predicate from an explicit allow-set of paths.
const existsFrom = (paths) => {
  const set = new Set(paths)
  return (p) => set.has(p)
}

describe('planWorktreeLinks — pure worktree bootstrap planner', () => {
  it('links an island when the source node_modules exists and the target does not', () => {
    const exists = existsFrom([
      ROOT, join(ROOT, 'package.json'),
      join(MAIN, 'node_modules'),
    ])
    const plan = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['.'], exists })
    expect(plan).toEqual([{ island: '.', action: 'link', source: join(MAIN, 'node_modules'), target: join(ROOT, 'node_modules') }])
  })

  it('skips (idempotent) when the target node_modules already exists', () => {
    const exists = existsFrom([
      ROOT, join(ROOT, 'package.json'),
      join(ROOT, 'node_modules'), join(MAIN, 'node_modules'),
    ])
    const [step] = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['.'], exists })
    expect(step.action).toBe('skip')
  })

  it('falls back to install when the main checkout has no node_modules to link', () => {
    const exists = existsFrom([ROOT, join(ROOT, 'package.json')]) // no source node_modules
    const [step] = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['.'], exists })
    expect(step.action).toBe('install')
    expect(step.target).toBe(join(ROOT, 'node_modules'))
  })

  it('ignores islands that are not present in this worktree', () => {
    const exists = existsFrom([ROOT, join(ROOT, 'package.json'), join(MAIN, 'node_modules')])
    // "server" dir absent → dropped entirely
    const plan = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['.', 'server'], exists })
    expect(plan.map((p) => p.island)).toEqual(['.'])
  })

  it('ignores a directory that exists but has no package.json', () => {
    const exists = existsFrom([ROOT, join(ROOT, 'server'), join(MAIN, 'server', 'node_modules')]) // server/ but no package.json
    const plan = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['server'], exists })
    expect(plan).toEqual([])
  })

  it('plans each island independently (link / skip / install mixed)', () => {
    const exists = existsFrom([
      // root: linkable
      ROOT, join(ROOT, 'package.json'), join(MAIN, 'node_modules'),
      // server: already present → skip
      join(ROOT, 'server'), join(ROOT, 'server', 'package.json'), join(ROOT, 'server', 'node_modules'), join(MAIN, 'server', 'node_modules'),
      // lighting: source missing → install
      join(ROOT, 'lighting'), join(ROOT, 'lighting', 'package.json'),
    ])
    const plan = planWorktreeLinks({ main: MAIN, root: ROOT, islands: ['.', 'server', 'lighting'], exists })
    expect(plan.map((p) => [p.island, p.action])).toEqual([
      ['.', 'link'],
      ['server', 'skip'],
      ['lighting', 'install'],
    ])
  })

  it('the default island list covers root + every build island', () => {
    expect(ISLANDS).toContain('.')
    expect(ISLANDS).toEqual(expect.arrayContaining(['server', 'camera-flythrough', 'lighting', 'multi-room', 'persistence', 'rendering', 'texturing']))
  })
})
