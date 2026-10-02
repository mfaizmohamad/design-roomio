// Prettier config — every value here is transcribed from the code that already
// exists, NOT from Prettier's defaults.
//
// The failure this prevents: adopting Prettier's defaults (semicolons, double
// quotes, printWidth 80) would rewrite essentially all ~28k lines of src/,
// shared/, scripts/ and server/ on the first run and destroy `git blame` for
// the whole tree. Verified against src/store.ts and server/app.js, which
// CLAUDE.md §3 names as the style reference: no semicolons, single quotes,
// 2-space indent, `(c) => …` arrow parens, double-quoted JSX attributes.
//
// printWidth 100 was measured, not guessed: of 27,672 lines only 927 exceed
// 100 columns (and most of those are prose comments, which Prettier never
// reflows). 80 would rewrap ~3,000 lines of working code for no reason.
//
// NOTE: the repo is NOT yet Prettier-clean. Adopting the config and running the
// formatter are deliberately separate commits (roomio-zhs.1) so the mass
// reformat is one reviewable, blame-ignorable commit. `format:check` therefore
// reports differences today; it is not wired into CI or the pre-push hook yet.
/** @type {import('prettier').Config} */
export default {
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  trailingComma: 'all',
  arrowParens: 'always',
  endOfLine: 'lf',
}
