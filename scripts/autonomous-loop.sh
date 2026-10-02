#!/usr/bin/env bash

set -uo pipefail

PROJECT="/home/tomas/repositories/spantrail"
RUNTIME="$PROJECT/.autonomous/runtime"
export HOME="/home/tomas"
export PATH="/home/tomas/.local/bin:/home/tomas/.bun/bin:/home/tomas/.opencode/bin:/home/tomas/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"

OPENCODE_BIN="/home/tomas/.opencode/bin/opencode"

if [[ -z "$OPENCODE_BIN" ]]; then
    for candidate in         /home/tomas/.opencode/bin/opencode         /home/tomas/.local/bin/opencode         /home/tomas/.bun/bin/opencode         /usr/local/bin/opencode         /usr/bin/opencode
    do
        if [[ -x "$candidate" ]]; then
            OPENCODE_BIN="$candidate"
            break
        fi
    done
fi

mkdir -p "$RUNTIME"
cd "$PROJECT" || exit 1

log() {
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

if [[ -z "$OPENCODE_BIN" ]]; then
    log "ERROR: opencode not found"
    exit 10
fi

log "OpenCode: $("$OPENCODE_BIN" --version)"

# Only one autonomous supervisor may run for this repository.
exec 9>"$RUNTIME/runner.lock"
if ! flock -n 9; then
    log "Another SpanTrail autonomous runner is already active."
    exit 0
fi

# Validate project control files.
required_files=(
    "AGENTS.md"
    ".autonomous/CHARTER.md"
    ".autonomous/PRODUCT.md"
    ".autonomous/FLOW.md"
    ".autonomous/STATE.md"
    ".autonomous/LEARNINGS.md"
    ".autonomous/GUARDRAILS.md"
    ".autonomous/CYCLE_PROMPT.md"
)

for file in "${required_files[@]}"; do
    if [[ ! -f "$file" ]]; then
        log "ERROR: required file missing: $file"
        exit 11
    fi
done

# Validate features required for unattended operation.
if ! "$OPENCODE_BIN" run --help 2>&1 | grep -q -- '--auto'; then
    log "ERROR: opencode run does not support --auto"
    exit 12
fi

if ! "$OPENCODE_BIN" agent list 2>&1 | grep -q '^orchestrator (primary)'; then
    log "ERROR: primary agent 'orchestrator' not found"
    exit 13
fi

log "Autonomous runner initialized successfully."

cycle=0
backoff=10

while true; do
    cycle=$((cycle + 1))

    log "============================================================"
    log "Starting autonomous cycle $cycle"
    log "============================================================"

    PROMPT="$(cat .autonomous/CYCLE_PROMPT.md)"

    set +e

    timeout \
        --signal=TERM \
        --kill-after=60s \
        4h \
        "$OPENCODE_BIN" run \
            --auto \
            --agent orchestrator \
            --title "SpanTrail autonomous cycle $cycle" \
            "$PROMPT"

    rc=$?

    set -e

    case "$rc" in
        0)
            log "Cycle $cycle completed successfully."
            backoff=10
            ;;
        124)
            log "WARNING: cycle $cycle exceeded four hours and was terminated."
            backoff=60
            ;;
        *)
            log "WARNING: cycle $cycle exited with code $rc."
            backoff=$((backoff * 2))

            if (( backoff > 900 )); then
                backoff=900
            fi
            ;;
    esac

    log "Next cycle in ${backoff}s."
    sleep "$backoff"
done
