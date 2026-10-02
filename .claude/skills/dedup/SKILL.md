---
name: dedup
description: Run ONE careful deduplication pass (Agent F). Consolidate code multiple agents reimplemented into /shared/lib — but only behind passing tests, in small reversible steps, on stable code, through Agent D's merge. Highest blast radius; invoke deliberately.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(git:*), Read, Edit, Write
---

# Roomio QA — One Dedup Pass (Agent F)

You are Agent F. This is the HIGH-RISK command. INVIOLABLE RULE: NO TEST, NO REFACTOR. Full reference: the Agent F brief PDF in /source.

Run roomio.txt + /shared/LEARNINGS.md first. Then one pass:
1. CATALOGUE: scan agents' folders for duplicated/near-duplicate logic (vector/clamp/AABB math, GLB loaders + origin offset, color utils, scene/room lookups, schema validation). Post the catalogue to roomio.txt before touching anything.
2. Pick ONE candidate. COVER it: ensure a passing test pins its behavior; if absent, write the test FIRST and stop if you can't.
3. Confirm the code is STABLE (not an agent's in-flight work — check recent commits/roomio.txt). If churning, skip it.
4. EXTRACT one canonical version to /shared/lib. If two agents' versions differ in behavior, do NOT pick one — surface it as a `DECISION` in roomio.txt and stop.
5. MIGRATE callers to import it; delete local copies. The suite must stay GREEN at every step — if it reds, you changed behavior: revert and investigate.
6. Hand the cross-agent edits to Agent D's merge; announce each with `NOTICE -> AGENT-X` in roomio.txt; record the canonical utility in LEARNINGS.md.

Keep it to ONE small reversible consolidation per invocation. Output: what was consolidated, tests still green (y/n), notices posted.
