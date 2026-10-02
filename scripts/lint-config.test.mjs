// Guards the lint gate itself.
//
// CLAUDE.md §4: "Every behaviour a security control provides gets a test,
// because nothing in the product visibly depends on it and it will otherwise be
// refactored away." That applies doubly to a lint rule: a rule quietly demoted
// to 'warn' still prints output, so the gate LOOKS alive while nothing is
// actually blocked, and a `files` pattern that stops matching a directory fails
// even more silently. The four rules below are the reason roomio-zhs.1 exists —
// react/no-danger in particular is the automated half of CLAUDE.md §2's ban on
// dangerouslySetInnerHTML, which had already been reintroduced once.
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: [
    {
      languageOptions: {
        parserOptions: {
          // In CI, typescript-eslint's single-run program reads the on-disk
          // probe files instead of the synthetic source passed to lintText.
          // Keep this instance in editor mode so security probes analyze that
          // synthetic source consistently in CI and locally.
          disallowAutomaticSingleRunInference: true,
        },
      },
    },
  ],
})

/** ESLint severity 2 = error. 1 = 'warn', and a warning does not fail the gate. */
const ERROR = 2

const SECURITY_RULES = [
  'no-eval',
  'no-implied-eval',
  'react/no-danger',
  '@typescript-eslint/no-floating-promises',
]

// One real file per language flavour the config has to cover. These paths must
// exist AND be inside tsconfig.eslint.json, because the probe below borrows them
// (see the comment there).
const PROBE_FILES = ['src/App.tsx', 'server/app.js', 'scripts/verify.mjs']

const severityOf = (config, rule) => {
  const entry = config.rules[rule]
  // Flat config normalises every entry to an array whose head is the severity.
  return Array.isArray(entry) ? entry[0] : entry
}

describe('eslint.config.js — security rules are configured as errors', () => {
  for (const file of [...PROBE_FILES, 'src/store.ts', 'shared/lib/math.ts']) {
    it(file, async () => {
      const config = await eslint.calculateConfigForFile(path.join(repoRoot, file))
      for (const rule of SECURITY_RULES) {
        expect(severityOf(config, rule), `${rule} in ${file}`).toBe(ERROR)
      }
    })
  }
})

describe('eslint.config.js — security rules actually fire', () => {
  // Severity alone is necessary but not sufficient: a plugin that stops being
  // registered, or a tsconfig.eslint.json that stops covering .js/.mjs, leaves
  // the configured severity untouched while the rule silently never runs. So
  // lint real offending source text instead of trusting the config object.
  //
  // The probe borrows an EXISTING file's path rather than inventing one:
  // @typescript-eslint/no-floating-promises needs type information, and
  // tsconfig.eslint.json's `include` is expanded against the disk, so a made-up
  // path is "not included in any project" and every rule dies on a parse error.
  for (const file of PROBE_FILES) {
    it(file, async () => {
      const [result] = await eslint.lintText(
        'export const drop = async () => { Promise.resolve(1) }\n' +
          'export const bad = () => { eval("1"); setTimeout("x()", 0) }\n',
        { filePath: path.join(repoRoot, file) },
      )
      const reported = result.messages.map((m) => m.ruleId)
      expect(reported).toContain('@typescript-eslint/no-floating-promises')
      expect(reported).toContain('no-eval')
      expect(reported).toContain('no-implied-eval')
    })
  }

  it('react/no-danger flags dangerouslySetInnerHTML', async () => {
    const [result] = await eslint.lintText(
      'export const X = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />\n',
      { filePath: path.join(repoRoot, 'src/App.tsx') },
    )
    expect(result.messages.map((m) => m.ruleId)).toContain('react/no-danger')
  })
})
