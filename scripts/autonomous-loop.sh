#!/usr/bin/env bash

set -uo pipefail

PROJECT="/home/tomas/repositories/spantrail"
RUNTIME="$PROJECT/.autonomous/runtime"

export HOME="/home/tomas"
export PATH="/home/tomas/.local/bin:/home/tomas/.bun/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$RUNTIME"
cd "$PROJECT" || exit 1

log() {
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

OPENCODE_BIN="$(command -v opencode || true)"

if [[ -z "$OPENCODE_BIN" ]]; then
    log "ERROR: opencode not found in PATH"
    exit 10
fi

log "Using OpenCode: $OPENCODE_BIN"
"$OPENCODE_BIN" --version || exit 11

# Do not allow two autonomous loops for the same repository.
LOCKFILE="$RUNTIME/runner.lock"
exec 9>"$LOCKFILE"

if ! flock -n 9; then
    log "Another SpanTrail autonomous runner is already active."
    exit 0
fi

# Headless autonomy requires --auto unless all permissions have already
# been explicitly configured to allow/deny without interaction.
if ! "$OPENCODE_BIN" run --help 2>&1 | grep -q -- '--auto'; then
    log "ERROR: this OpenCode build does not expose 'run --auto'."
    log "Check OpenCode version/permissions before enabling autonomous mode."
    exit 12
fi

# Oh My OpenAgent Slim should expose Ra as the orchestrator.
if ! "$OPENCODE_BIN" agent list 2>&1 | grep -qiE '(^|[[:space:]])Ra([[:space:]]|$)'; then
    log "ERROR: Ra agent was not found."
    log "Check: opencode agent list"
    exit 13
fi

cycle=0
backoff=10

while true; do
    cycle=$((cycle + 1))

    log "============================================================"
    log "Starting autonomous cycle $cycle"
    log "============================================================"

    if [[ ! -f ".autonomous/CYCLE_PROMPT.md" ]]; then
        log "ERROR: .autonomous/CYCLE_PROMPT.md is missing"
        sleep 300
        continue
    fi

    PROMPT="$(cat .autonomous/CYCLE_PROMPT.md)"

    set +e

    timeout \
        --signal=TERM \
        --kill-after=60s \
        4h \
        "$OPENCODE_BIN" run \
            --standalone \
            --auto \
            --agent Ra \
            "$PROMPT"

    rc=$?

    set -e

    if [[ "$rc" -eq 0 ]]; then
        log "Cycle $cycle completed successfully."
        backoff=10
    elif [[ "$rc" -eq 124 ]]; then
        log "WARNING: cycle $cycle exceeded 4 hours and was terminated."
        backoff=60
    else
        log "WARNING: cycle $cycle exited with code $rc."

        backoff=$((backoff * 2))

        if (( backoff > 900 )); then
            backoff=900
        fi
    fi

    log "Next cycle in ${backoff}s."
    sleep "$backoff"
done
