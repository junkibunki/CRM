#!/usr/bin/env bash
# Prepares an isolated dev environment in a git worktree, so parallel agents don't share
# ports or database (the main checkout keeps PocketBase :8090 and Vite :5173).
# Usage (worktree root): scripts/agent-env.sh <n>   (n = 1..9)
# Afterwards it prints the commands to start PocketBase, seed and Vite on the agent's ports.
set -euo pipefail

N="${1:?usage: scripts/agent-env.sh <n> (1..9)}"
case "$N" in [1-9]) ;; *) echo "n must be 1..9 (got '$N')" >&2; exit 1 ;; esac
PB_PORT="810${N}"   # 8101..8109, never the main :8090
WEB_PORT="518${N}"  # 5181..5189, never the main :5173 (or Vite's fallback 5174+)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$(git -C "$ROOT" worktree list --porcelain | sed -n '1s/^worktree //p')"

# PocketBase binary is gitignored: copy it from the main checkout
for bin in pocketbase.exe pocketbase; do
  if [ -f "$MAIN/pocketbase/$bin" ] && [ ! -f "$ROOT/pocketbase/$bin" ]; then
    cp "$MAIN/pocketbase/$bin" "$ROOT/pocketbase/$bin"
  fi
done
BIN="$ROOT/pocketbase/pocketbase"; [ -f "$BIN.exe" ] && BIN="$BIN.exe"
[ -f "$BIN" ] || { echo "no PocketBase binary; run scripts/get-pocketbase.sh" >&2; exit 1; }

# own database for this worktree (pocketbase/pb_data is gitignored)
(cd "$ROOT/pocketbase" && "$BIN" migrate up >/dev/null)

if [ ! -d "$ROOT/web/node_modules" ]; then
  (cd "$ROOT/web" && npm ci --no-audit --no-fund >/dev/null)
fi

cat <<EOF
Environment ready (agent $N): PocketBase :$PB_PORT, Vite :$WEB_PORT

Do NOT use .claude/launch.json or the Browser pane in a worktree: they start Vite on :5173 and
proxy to the main PocketBase :8090. Start each in the background instead (Bash tool
run_in_background, no pipe, see docs/pitfalls/testen.md):
  cd "$ROOT/pocketbase" && "$BIN" serve --http 127.0.0.1:$PB_PORT > pb-agent.log 2>&1
  cd "$ROOT/web" && PB_URL=http://127.0.0.1:$PB_PORT npx vite dev --port $WEB_PORT --strictPort > vite-agent.log 2>&1
Then seed once:
  PB_URL=http://127.0.0.1:$PB_PORT node "$ROOT/scripts/seed-dev.mjs"
App: http://localhost:$WEB_PORT  (login from scripts/seed-dev.mjs)
EOF
