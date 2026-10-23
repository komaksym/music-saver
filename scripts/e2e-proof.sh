#!/usr/bin/env bash
# Prove the agent-browser E2E harness on the real artifact. Writes fresh
# snapshot and screenshot under e2e-artifacts/ and fails loudly otherwise.
set -euo pipefail
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
E2E_ARTIFACTS="$ROOT/e2e-artifacts" bash "$ROOT/scripts/e2e-agent-browser.sh" smoke
test -f "$ROOT/e2e-artifacts/smoke.png"
test -f "$ROOT/e2e-artifacts/smoke-snapshot.txt"
E2E_ARTIFACTS="$ROOT/e2e-artifacts" bash "$ROOT/scripts/e2e-agent-browser.sh" player
test -f "$ROOT/e2e-artifacts/player.png"
test -f "$ROOT/e2e-artifacts/player-snapshot.txt"
echo "E2E proof artifacts:"
ls -lh "$ROOT/e2e-artifacts/smoke.png" "$ROOT/e2e-artifacts/smoke-snapshot.txt" "$ROOT/e2e-artifacts/player.png" "$ROOT/e2e-artifacts/player-snapshot.txt"
