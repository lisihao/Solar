#!/usr/bin/env bash
#
# GenesisPod Public API — runnable curl examples.
#
# Usage:
#   export GENESIS_BASE_URL="http://localhost:4000"   # or your Railway domain
#   export GENESIS_API_KEY="your-mcp-api-key"
#   ./examples/curl.sh                 # runs all examples
#   ./examples/curl.sh chat            # run a single example by name
#
# Auth: the MCP-category API key is sent as `Authorization: Bearer`.
# (`X-API-Key: <key>` is also accepted by the guard.)
#
# Paths/fields verified against:
#   public-api.controller.ts, a2a-rpc.controller.ts, main.ts (prefix "api/v1").

set -euo pipefail

BASE_URL="${GENESIS_BASE_URL:-http://localhost:4000}"
API_KEY="${GENESIS_API_KEY:-}"
AUTH=(-H "Authorization: Bearer ${API_KEY}")
JSON=(-H "Content-Type: application/json")

ex_status() {
  echo "== GET /api/v1/public/status (public) =="
  curl -sS "${BASE_URL}/api/v1/public/status"
  echo
}

ex_chat() {
  echo "== POST /api/v1/public/chat =="
  curl -sS -X POST "${BASE_URL}/api/v1/public/chat" "${AUTH[@]}" "${JSON[@]}" \
    -d '{
      "messages": [
        { "role": "system", "content": "You are a concise assistant." },
        { "role": "user", "content": "Explain vector databases in one sentence." }
      ]
    }'
  echo
}

ex_ask() {
  echo "== POST /api/v1/public/ask =="
  curl -sS -X POST "${BASE_URL}/api/v1/public/ask" "${AUTH[@]}" "${JSON[@]}" \
    -d '{ "question": "What is retrieval-augmented generation?" }'
  echo
}

ex_research() {
  echo "== POST /api/v1/public/research (synchronous) =="
  curl -sS -X POST "${BASE_URL}/api/v1/public/research" "${AUTH[@]}" "${JSON[@]}" \
    -d '{
      "query": "State of small language models for on-device inference in 2026",
      "depth": "standard",
      "language": "en",
      "dimensions": ["hardware constraints", "leading open models", "benchmarks"]
    }'
  echo
}

ex_a2a_send() {
  echo "== POST /api/v1/a2a/v1  (message/send) =="
  curl -sS -X POST "${BASE_URL}/api/v1/a2a/v1" "${AUTH[@]}" "${JSON[@]}" \
    -d '{
      "jsonrpc": "2.0",
      "id": "1",
      "method": "message/send",
      "params": {
        "message": {
          "kind": "message",
          "messageId": "11111111-1111-1111-1111-111111111111",
          "role": "user",
          "parts": [
            { "kind": "text", "text": "Research the impact of RISC-V on edge AI." }
          ],
          "metadata": { "skillId": "research" }
        }
      }
    }'
  echo
}

ex_agent_card() {
  echo "== GET /.well-known/agent.json (public, no prefix) =="
  curl -sS "${BASE_URL}/.well-known/agent.json"
  echo
}

run_all() {
  ex_status
  ex_agent_card
  [ -n "${API_KEY}" ] || { echo "Set GENESIS_API_KEY to run authenticated examples."; return; }
  ex_chat
  ex_ask
  ex_research
  ex_a2a_send
}

case "${1:-all}" in
  status)      ex_status ;;
  chat)        ex_chat ;;
  ask)         ex_ask ;;
  research)    ex_research ;;
  a2a)         ex_a2a_send ;;
  agent-card)  ex_agent_card ;;
  all)         run_all ;;
  *) echo "Unknown example: $1 (use: status|chat|ask|research|a2a|agent-card|all)"; exit 1 ;;
esac
</content>
