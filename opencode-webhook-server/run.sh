#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export OPENCODE_BIN="${OPENCODE_BIN:-/Users/jmadhead/.opencode/bin/opencode}"
export OPENCODE_WORKSPACE="${OPENCODE_WORKSPACE:-/Users/jmadhead/IdeaProjects}"
export OPENCODE_TIMEOUT="${OPENCODE_TIMEOUT:-6000000}"
export WEBHOOK_PORT="${WEBHOOK_PORT:-8080}"
export DEFAULT_MODEL_ID="${DEFAULT_MODEL_ID:-Qwen3_6-35B-A3B-MTP}"
export DEFAULT_MODEL_PROVIDER="${DEFAULT_MODEL_PROVIDER:-llama.cpp}"
export AGENTS_DIR="${AGENTS_DIR:-$SCRIPT_DIR/agents}"

exec node "$SCRIPT_DIR/src/server.js"
