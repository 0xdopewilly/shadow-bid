#!/usr/bin/env bash
# One-command dev launcher for ShadowBid.
#
# Starts:
#   1. arcium localnet  (Solana validator + Arcium MXE cluster on 127.0.0.1:8899)
#   2. yarn dev         (Next.js dApp on http://localhost:3000)
#
# Auto-airdrops 5 SOL to a target wallet once the validator is up.
#
# Usage:
#   ./scripts/dev.sh                          # airdrops: $1, or AIRDROP_TO, or .env.dev, or CLI keypair
#   ./scripts/dev.sh <WALLET_PUBKEY>          # airdrops to this address (overrides .env.dev)
#   AIRDROP_TO=<PUBKEY> ./scripts/dev.sh      # same, via env var
#
# Optional: repo-root .env.dev (gitignored) with one line:
#   AIRDROP_TO=YourPhantomPubkey
#
# Press Ctrl+C once to cleanly tear both processes down.
#
# ── If RPC / MXE “suddenly” die ───────────────────────────────────────────────
# arcium localnet runs Solana plus Docker MPC nodes. Logs like
# "Container artifacts-arx-node-* Stopping" then
# "Arcium nodes did not come online in time" mean the MPC layer restarted and
# timed out — not always a dead 8899 port. Fix: stop dev.sh, ensure Docker
# Desktop is running with enough RAM, inspect artifacts/arx_node_logs (when
# present), then ./scripts/dev.sh again.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="http://127.0.0.1:8899"

if [ -f "$REPO_ROOT/.env.dev" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env.dev"
  set +a
fi

AIRDROP_TO="${1:-${AIRDROP_TO:-}}"

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
amber() { printf "\033[33m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

# ── Sanity: required tooling ─────────────────────────────────────────────────
for tool in arcium solana yarn docker; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    red "Missing tool: $tool"
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  red "Docker is not reachable. Arcium localnet needs Docker running for MPC (arx) nodes."
  red "Start Docker Desktop, wait until it is ready, then re-run this script."
  exit 1
fi

# ── Sanity: macOS file-descriptor limit ──────────────────────────────────────
# solana-test-validator opens many files; a low ulimit causes mysterious panics.
if [ "$(ulimit -n)" -lt 8192 ]; then
  amber "Bumping ulimit -n to 65535 (was $(ulimit -n))"
  ulimit -n 65535 || true
fi

# ── Sanity: kill any orphan validator on 8899 ────────────────────────────────
if lsof -nP -i :8899 >/dev/null 2>&1; then
  amber "Port 8899 is busy — killing orphan solana-test-validator / arcium…"
  pkill -f solana-test-validator || true
  pkill -f 'arcium localnet' || true
  sleep 2
fi

# ── Track child PIDs so Ctrl+C tears everything down ─────────────────────────
PIDS=()
cleanup() {
  echo
  amber "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  pkill -f solana-test-validator || true
  pkill -f 'arcium localnet' || true
  exit 0
}
trap cleanup INT TERM

# ── 1. Spin up arcium localnet ───────────────────────────────────────────────
cyan "▸ Starting arcium localnet (logs streamed below)…"
cd "$REPO_ROOT"
arcium localnet 2>&1 | sed -u 's/^/[arcium] /' &
PIDS+=($!)

# ── 2. Wait until the RPC actually answers ───────────────────────────────────
cyan "▸ Waiting for RPC at $RPC_URL …"
for i in $(seq 1 120); do
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
    green "  ✔ RPC online (after ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" -eq 120 ]; then
    red "  ✘ RPC never came online. Inspect:"
    red "      tail -80 $REPO_ROOT/.anchor/test-ledger/validator.log"
    cleanup
  fi
done

# ── 3. Point the CLI at localnet (per-shell, doesn't change global config) ──
export SOLANA_URL="$RPC_URL"

# ── 4. Auto-airdrop ──────────────────────────────────────────────────────────
if [ -z "$AIRDROP_TO" ]; then
  if AIRDROP_TO=$(solana address 2>/dev/null); then
    cyan "▸ Airdropping to default CLI keypair: $AIRDROP_TO"
  else
    amber "▸ No CLI keypair found and no wallet pubkey passed; skipping airdrop."
    AIRDROP_TO=""
  fi
else
  cyan "▸ Airdropping to: $AIRDROP_TO"
fi

if [ -n "$AIRDROP_TO" ]; then
  if solana airdrop 5 "$AIRDROP_TO" --url "$RPC_URL" >/dev/null 2>&1; then
    BAL=$(solana balance "$AIRDROP_TO" --url "$RPC_URL" 2>/dev/null || echo "?")
    green "  ✔ $AIRDROP_TO → $BAL"
  else
    amber "  ⚠ Airdrop failed (validator may still be initializing). Retry manually:"
    amber "      solana airdrop 5 $AIRDROP_TO --url $RPC_URL"
  fi
fi

# ── 5. Copy regenerated artifacts into the web/ folder ───────────────────────
cyan "▸ Copying IDL + circuits into web/…"
( cd "$REPO_ROOT/web" && yarn copy:artifacts >/dev/null 2>&1 ) || \
  amber "  ⚠ copy:artifacts failed — run it manually if the dApp can't find the IDL."

# ── 5b. Init MXE comp defs (must use CLI keypair — Phantom gets InvalidAuthority)
if [ -f "$REPO_ROOT/yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  cyan "▸ Installing MXE circuits (signs with ~/.config/solana/id.json)…"
  if ( cd "$REPO_ROOT" && yarn init:mxe-circuits 2>&1 | sed -u 's/^/[init]  /' ); then
    green "  ✔ MXE circuits ready — use Phantom only for create / bid / reveal."
  else
    amber "  ⚠ Run once from repo root: yarn install && yarn init:mxe-circuits"
  fi
fi

# ── 6. Start the Next.js dApp ────────────────────────────────────────────────
cyan "▸ Starting Next.js dev server (http://localhost:3000)…"
# Drop stale .next so webpack chunk IDs (e.g. 231.js) cannot reference deleted files
# after an interrupted compile or rapid restarts.
( cd "$REPO_ROOT/web" || exit 1
  yarn clean >/dev/null 2>&1 || true
  yarn dev 2>&1 | sed -u 's/^/[web]    /' ) &
PIDS+=($!)

green "
─────────────────────────────────────────────────────────────
  Everything is up.

    RPC      : $RPC_URL
    dApp     : http://localhost:3000
    Wallet   : ${AIRDROP_TO:-(none airdropped)}

  Press Ctrl+C once to stop validator + dApp together.
─────────────────────────────────────────────────────────────
"

# ── 7. Wait so Ctrl+C reaches us ─────────────────────────────────────────────
wait
