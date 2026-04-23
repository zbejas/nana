#!/bin/bash

set -euo pipefail

# ── ANSI colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

log()      { echo -e "${CYAN}${BOLD}[Test]${RESET} $1"; }
log_ok()   { echo -e "${CYAN}${BOLD}[Test]${RESET} ${GREEN}$1${RESET}"; }
log_err()  { echo -e "${CYAN}${BOLD}[Test]${RESET} ${RED}$1${RESET}"; }
log_phase() { echo -e "${CYAN}${BOLD}[Test]${RESET} ${YELLOW}${BOLD}$1${RESET}"; }

cleanup() {
    echo -e "${DIM}[Test] Shutting down...${RESET}"
    kill "$PB_PID" "$BUN_PID" 2>/dev/null || true
    wait "$PB_PID" "$BUN_PID" 2>/dev/null || true
    exit "${TEST_EXIT:-1}"
}
trap cleanup EXIT INT TERM

PB_DATA_DIR="/app/pocketbase/pb_data"
PB_ARGS="--dir /app/pocketbase/pb_data --hooksDir /app/pocketbase/pb_hooks --migrationsDir /app/pocketbase/pb_migrations"

log "Resetting PocketBase test data..."
rm -rf "$PB_DATA_DIR"
mkdir -p "$PB_DATA_DIR/zvec"

log "Running PocketBase migrations..."
PB_MIGRATING=1 pocketbase migrate up $PB_ARGS >/dev/null

log "Starting PocketBase on :8090..."
pocketbase serve --http=0.0.0.0:8090 $PB_ARGS >/dev/null 2>&1 &
PB_PID=$!

log "Starting Bun server on :3000..."
bun src/index.ts >/dev/null 2>&1 &
BUN_PID=$!

log "Waiting for PocketBase..."
for i in $(seq 1 30); do
    if bash -c "echo > /dev/tcp/127.0.0.1/8090" 2>/dev/null; then
        log_ok "PocketBase is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        log_err "PocketBase failed to start within 30s"
        exit 1
    fi
    sleep 1
done

log "Waiting for Bun server..."
for i in $(seq 1 30); do
    if bash -c "echo > /dev/tcp/127.0.0.1/3000" 2>/dev/null; then
        log_ok "Bun server is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        log_err "Bun server failed to start within 30s"
        exit 1
    fi
    sleep 1
done

# Phase 1: Bootstrap + all guard tests (bootstrap and 00-user-guards run first on fresh DB)
log_phase "Phase 1: Pocketbase bootstrap + guard tests..."
TEST_EXIT=0
FORCE_COLOR=1 AGENT=1 bun test ./tests/pocketbase/bootstrap.test.ts ./tests/pocketbase/guards/ 2>&1 \
| sed -u $'s/.*expect() calls.*/\033[2m&\033[0m/' || TEST_EXIT=$?

# Phase 2: PocketBase hooks & routes (auto-discovered)
log_phase "Phase 2: PocketBase hooks & route tests..."
FORCE_COLOR=1 AGENT=1 bun test ./tests/pocketbase/hooks/ ./tests/pocketbase/routes/ 2>&1 \
| sed -u $'s/.*expect() calls.*/\033[2m&\033[0m/' || TEST_EXIT=$?

# Phase 3: Bun API tests (auto-discovered)
log_phase "Phase 3: Bun API tests..."
FORCE_COLOR=1 AGENT=1 bun test ./tests/api/ 2>&1 \
| sed -u $'s/.*expect() calls.*/\033[2m&\033[0m/' || TEST_EXIT=$?

if [ "$TEST_EXIT" -eq 0 ]; then
    log_ok "Tests finished with exit code $TEST_EXIT"
else
    log_err "Tests finished with exit code $TEST_EXIT"
fi
exit "$TEST_EXIT"
