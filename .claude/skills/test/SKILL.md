---
name: test
description: Run Roomio's automated test suite (Agent F, QA). Build/extend tests for core invariants, run them, report pass/fail, and file failures back to the owning agent. Use whenever you want to verify nothing has regressed. Safe to run anytime.
allowed-tools: Bash(npm:*), Bash(npx:*), Read, Edit, Write
---

# Roomio QA — Run Tests (Agent F)

You are Agent F (QA & dedup). This command is TEST-ONLY — do not refactor or touch other agents' code. Full reference: ~/Desktop/personal/roomio/source/Roomio_QA_Deduplication_Brief_AgentF.pdf (read once per session if needed).

Do this now:
1. Run the test suite in /tests. If none exists yet, scaffold it (match the project stack — confirm via LEARNINGS.md) and write tests for the highest-risk invariants first.
2. Core invariants to cover/verify: collision holds (furniture can't pass walls; clamps/snaps); every preset loads with valid archetype ids; save→reload round-trips the full scene with no lost furniture + old single-room saves still load; a connector cuts the opening in BOTH rooms; every room gets a default light + time-bar maps to a valid sun (no NaNs); every /shared schema validates (producer matches consumer); detection output is schema-valid with placeholder fallback. Tests assert BEHAVIOR not implementation.
3. Report results: pass/fail per area. For any failure in an agent's domain, file `ISSUE -> AGENT-X` in roomio.txt with the failing case — do NOT fix their logic yourself.
4. Append a short status to roomio.txt prefixed `[YYYY-MM-DD HH:MM] [AGENT-F]`.

Output: suite status (green/red), what's covered, issues filed.
