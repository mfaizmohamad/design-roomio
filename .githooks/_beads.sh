#!/bin/sh
# Shared beads (bd) git-hook bridge — sourced by the hooks in this directory.
#
# Why a helper instead of `bd init`'s inlined block: bd appends its integration
# AFTER the existing script body, and both .githooks/pre-commit and pre-push end
# in an unconditional `exit 0`. Appended there the block is dead code and bd's
# auto-export never runs. Sourcing this first, before the gate logic, is what
# actually wires beads up.
#
# Contract: run_beads_hook <hook-name> [args...]. Returns bd's exit code, except
# it maps "timed out" (124) and "db not initialized" (3) to 0 so a missing or
# slow Dolt server degrades to a no-op instead of blocking every commit.
run_beads_hook() {
  _bd_hook="$1"
  shift

  command -v bd >/dev/null 2>&1 || return 0

  BD_GIT_HOOK=1
  export BD_GIT_HOOK
  _bd_timeout="${BEADS_HOOK_TIMEOUT:-300}"

  if command -v timeout >/dev/null 2>&1; then
    timeout "$_bd_timeout" bd hooks run "$_bd_hook" "$@"
    _bd_exit=$?
    if [ "$_bd_exit" -eq 124 ]; then
      echo >&2 "beads: hook '$_bd_hook' timed out after ${_bd_timeout}s — continuing without beads"
      _bd_exit=0
    fi
  else
    bd hooks run "$_bd_hook" "$@"
    _bd_exit=$?
  fi

  if [ "$_bd_exit" -eq 3 ]; then
    echo >&2 "beads: database not initialized — skipping hook '$_bd_hook'"
    _bd_exit=0
  fi

  return "$_bd_exit"
}
