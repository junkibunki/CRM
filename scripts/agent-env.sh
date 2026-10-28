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

# shared secret of PocketBase and the MCP server (F15), one per worktree, kept in pb_data
SECRET_FILE="$ROOT/pocketbase/pb_data/mcp-secret"
if [ ! -s "$SECRET_FILE" ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))" > "$SECRET_FILE"
fi
MCP_SECRET="$(cat "$SECRET_FILE")"
MCP_PORT="820${N}" # 8201..8209

cat <<EOF
Environment ready (agent $N): PocketBase :$PB_PORT, Vite :$WEB_PORT, MCP :$MCP_PORT

Do NOT use .claude/launch.json or the Browser pane in a worktree: they start Vite on :5173 and
proxy to the main PocketBase :8090. Start each in the background instead (Bash tool
run_in_background, no pipe, see docs/pitfalls/testen.md):
  cd "$ROOT/pocketbase" && CRM_MCP_SECRET=$MCP_SECRET "$BIN" serve --http 127.0.0.1:$PB_PORT > pb-agent.log 2>&1
  cd "$ROOT/web" && PB_URL=http://127.0.0.1:$PB_PORT npx vite dev --port $WEB_PORT --strictPort > vite-agent.log 2>&1
MCP server (only for F15 work; needs npm ci in mcp/ once):
  cd "$ROOT/mcp" && CRM_MCP_SECRET=$MCP_SECRET PB_URL=http://127.0.0.1:$PB_PORT MCP_PORT=$MCP_PORT node src/server.js > mcp-agent.log 2>&1
Then seed once:
  PB_URL=http://127.0.0.1:$PB_PORT node "$ROOT/scripts/seed-dev.mjs"
App: http://localhost:$WEB_PORT  (login from scripts/seed-dev.mjs)
EOF
