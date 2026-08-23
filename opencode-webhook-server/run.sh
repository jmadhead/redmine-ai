#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

export OPENCODE_BIN="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
export OPENCODE_WORKSPACE="${OPENCODE_WORKSPACE:?OPENCODE_WORKSPACE must be set via environment variable or $SCRIPT_DIR/.env}"
export WEBHOOK_PORT="${WEBHOOK_PORT:-8080}"
export DEFAULT_MODEL_ID="${DEFAULT_MODEL_ID:-Qwen3_6-35B-A3B-MTP}"
export DEFAULT_MODEL_PROVIDER="${DEFAULT_MODEL_PROVIDER:-llama.cpp}"
export AGENTS_DIR="${AGENTS_DIR:-$SCRIPT_DIR/agents}"

exec node "$SCRIPT_DIR/src/server.js"
