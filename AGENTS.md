# Agent instructions

**[`CLAUDE.md`](./CLAUDE.md) is the authoritative rulebook for this repo.** Read it
before writing code. It is the source of truth wherever anything below, or any
tool-generated guidance, disagrees with it.

Orientation — where things live: [`docs/agent-orientation.md`](./docs/agent-orientation.md).

## Green bar

```bash
npm run typecheck            # tsc -b --noEmit
npm test                     # full vitest workspace (root + 6 islands)
npm run build                # tsc -b && vite build
npm test --prefix server     # server suite (needs local Postgres)
```

## Issue tracking — beads (`bd`)

This project tracks work in **bd (beads)**, not in markdown TODO lists.

```bash
bd ready                 # unblocked work
bd show <id>             # detail
bd update <id> --claim   # claim
bd close <id>            # complete
bd create "title" -t bug -p 1
```

File a bead for follow-up work you find but don't do.

## Git

- `main` is protected: branch, then open a PR. `.githooks/pre-commit` enforces it.
- Hooks live in `.githooks/` (committed, canonical). If `bd init` repoints them,
  restore with `git config core.hooksPath .githooks`.
- **Commit and push only when the human asks.** Do not auto-push work.

## Shell

Use non-interactive flags (`cp -f`, `mv -f`, `rm -f`) — `-i` aliases hang an agent
waiting on a prompt that never gets answered.
