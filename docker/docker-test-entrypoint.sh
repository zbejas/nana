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
log_phase() { echo -e "\n${CYAN}${BOLD}[Test]${RESET} ${YELLOW}${BOLD}$1${RESET}"; }

PB_DATA_DIR="/app/pocketbase/pb_data"
PB_ARGS="--dir ${PB_DATA_DIR} --hooksDir /app/pocketbase/pb_hooks --migrationsDir /app/pocketbase/pb_migrations"
PB_LOG="/tmp/nana-pocketbase.log"
BUN_LOG="/tmp/nana-bun.log"
STARTED_AT=$(date +%s)
FAILED_PHASES=0
TEST_EXIT=0
PB_PID=""
BUN_PID=""

cleanup() {
    local exit_code=$?
    if [ -n "$PB_PID" ]; then kill "$PB_PID" 2>/dev/null || true; fi
    if [ -n "$BUN_PID" ]; then kill "$BUN_PID" 2>/dev/null || true; fi
    wait "$PB_PID" 2>/dev/null || true
    wait "$BUN_PID" 2>/dev/null || true

    if [ "$TEST_EXIT" -ne 0 ]; then
        if [ -s "$PB_LOG" ]; then
            echo -e "\n${DIM}── PocketBase log (tail) ──${RESET}"
            tail -n 80 "$PB_LOG"
        fi
        if [ -s "$BUN_LOG" ]; then
            echo -e "\n${DIM}── Bun server log (tail) ──${RESET}"
            tail -n 80 "$BUN_LOG"
        fi
    fi

    echo -e "${DIM}[Test] Shutting down...${RESET}"
    exit "$exit_code"
}
trap cleanup EXIT
trap 'TEST_EXIT=130; exit 130' INT TERM

run_phase() {
    local label="$1"
    shift

    log_phase "$label"
    local started
    started=$(date +%s)
    local status=0

    FORCE_COLOR=1 AGENT=1 "$@" 2>&1 \
        | sed -u $'s/.*expect() calls.*/\033[2m&\033[0m/' \
        || status=$?

    local elapsed=$(( $(date +%s) - started ))
    if [ "$status" -eq 0 ]; then
        log_ok "$label passed in ${elapsed}s"
    else
        FAILED_PHASES=$((FAILED_PHASES + 1))
        TEST_EXIT=1
        log_err "$label failed (exit $status) in ${elapsed}s"
    fi
}

# ── Unit tests (no services required) ───────────────────────────────
run_phase "Phase 1/4: Unit tests" bun test ./tests/unit

# ── Fresh PocketBase database ───────────────────────────────────────
log "Resetting PocketBase test data..."
rm -rf "$PB_DATA_DIR"
mkdir -p "$PB_DATA_DIR"

log "Running PocketBase migrations..."
MIGRATE_LOG="/tmp/nana-migrate.log"
if ! PB_MIGRATING=1 pocketbase migrate up $PB_ARGS >"$MIGRATE_LOG" 2>&1; then
    log_err "PocketBase migrations failed"
    cat "$MIGRATE_LOG"
    TEST_EXIT=1
    exit "$TEST_EXIT"
fi

log "Starting PocketBase on :8090..."
pocketbase serve --http=0.0.0.0:8090 $PB_ARGS >"$PB_LOG" 2>&1 &
PB_PID=$!

log "Starting Bun server on :3000..."
bun src/index.ts >"$BUN_LOG" 2>&1 &
BUN_PID=$!

wait_for_port() {
    local name="$1"
    local port="$2"
    log "Waiting for ${name}..."
    for _ in $(seq 1 30); do
        if bash -c "echo > /dev/tcp/127.0.0.1/${port}" 2>/dev/null; then
            log_ok "${name} is ready"
            return 0
        fi
        sleep 1
    done
    log_err "${name} failed to start within 30s"
    TEST_EXIT=1
    return 1
}

wait_for_port "PocketBase" 8090 || exit "$TEST_EXIT"
wait_for_port "Bun server" 3000 || exit "$TEST_EXIT"

# ── Integration phases ──────────────────────────────────────────────
run_phase "Phase 2/4: PocketBase bootstrap + guard tests" \
    bun test --preload ./tests/preload.ts \
    ./tests/pocketbase/bootstrap.test.ts ./tests/pocketbase/guards/

run_phase "Phase 3/4: PocketBase hooks + route tests" \
    bun test --preload ./tests/preload.ts \
    ./tests/pocketbase/hooks/ ./tests/pocketbase/routes/

run_phase "Phase 4/4: Bun API tests" \
    bun test --preload ./tests/preload.ts ./tests/api/

ELAPSED=$(( $(date +%s) - STARTED_AT ))
if [ "$FAILED_PHASES" -eq 0 ]; then
    log_ok "All test phases passed in ${ELAPSED}s"
else
    log_err "${FAILED_PHASES} test phase(s) failed in ${ELAPSED}s"
    TEST_EXIT=1
fi

exit "$TEST_EXIT"
