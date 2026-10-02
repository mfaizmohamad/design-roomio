# Running the tests

One command runs the **full** automated test set (everything CI gates):

```bash
npm run test:all
```

That is two steps you can also run separately:

| Command | What it runs |
| --- | --- |
| `npm test` | Every JS/TS vitest suite via the root `vitest.workspace.ts`: root (`src/`, `shared/lib/`, `scripts/`), `camera-flythrough/`, `lighting/`, `multi-room/`, `persistence/`, `rendering/`, `texturing/` — 522 tests in one pass. |
| `npm run test:py` | The detection-pipeline Python suite (`detection-pipeline/tests`, 29 unittest tests, fully offline — no Ollama daemon, no fixtures). |

## Setup

- **JS/TS**: a single `npm install` at the repo root is enough — all workspace
  suites resolve their deps (three, zustand, react, …) from the root
  `node_modules`. You can still `npm test` inside any workspace directory to run
  just that suite.
- **Python**: `npm run test:py` uses `detection-pipeline/.venv` if present, else
  `python3` on PATH. Create the venv with:

  ```bash
  cd detection-pipeline && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
  ```

## Where the gates live

- **CI** (`.github/workflows/ci.yml`): the `test` job runs typecheck + `npm test`
  + production build; the `python` job runs `npm run test:py`. The workflow
  header documents the few things intentionally excluded (VLM smoke/eval need a
  live Ollama daemon; the puppeteer `scripts/*-check.mjs` smokes need local
  Chrome + dev servers + Postgres).
- **pre-push hook** (`.githooks/pre-push`): typecheck + `npm test` always; the
  Python suite when `detection-pipeline/.venv` exists (skipped with a warning
  otherwise — CI still gates it).

## Adding a new suite

Add the workspace's `vitest.config.ts` to the root `vitest.workspace.ts` —
otherwise it will NOT be gated by CI or the pre-push hook. (A `server/` suite
from WI-3 is expected to slot in there or as the commented `server` CI job.)
