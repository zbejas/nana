#!/bin/bash

set -eu

cleanup() {
    echo "Shutting down..."
    kill "$PB_PID" "$BUN_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PB_ARGS="--dir /app/pocketbase/pb_data --hooksDir /app/pocketbase/pb_hooks --migrationsDir /app/pocketbase/pb_migrations"

if [ "${NODE_ENV:-}" != "production" ]; then
    echo "Starting in DEVELOPMENT mode..."
    
    echo "Running PocketBase migrations..."
    PB_MIGRATING=1 pocketbase migrate up $PB_ARGS
    
    # Loopback only: the public edge is Bun/Elysia on :3000. Never publish
    # :8090 or bind PocketBase to 0.0.0.0 — that would bypass the app.
    # Process substitution keeps correct PIDs (piping through awk/sed loses them).
    pocketbase serve --http=127.0.0.1:8090 $PB_ARGS > >(sed -u 's/^/[PocketBase] /') 2>&1 &
    PB_PID=$!
    
    bun run dev > >(sed -u 's/^/[Bun] /') 2>&1 &
    BUN_PID=$!
    
    # Wait for either process to exit, then propagate its exit code
    EXIT_CODE=0
    wait -n "$PB_PID" "$BUN_PID" || EXIT_CODE=$?
    exit "$EXIT_CODE"
else
    echo "Starting in PRODUCTION mode..."
    
    echo "Running PocketBase migrations..."
    PB_MIGRATING=1 pocketbase migrate up $PB_ARGS
    
    echo "Starting PocketBase on 127.0.0.1:8090 (internal only)..."
    # Loopback only: Bun/Elysia is the public edge on :3000.
    pocketbase serve --http=127.0.0.1:8090 $PB_ARGS > >(sed -u 's/^/[PocketBase] /') 2>&1 &
    PB_PID=$!
    
    echo "Starting Bun server on port 3000..."
    bun src/index.ts > >(sed -u 's/^/[Bun] /') 2>&1 &
    BUN_PID=$!
    
    EXIT_CODE=0
    wait -n "$PB_PID" "$BUN_PID" || EXIT_CODE=$?
    exit "$EXIT_CODE"
fi
