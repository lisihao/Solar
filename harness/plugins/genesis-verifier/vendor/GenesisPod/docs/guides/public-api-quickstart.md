# Public API Quickstart

External-developer guide for the GenesisPod Public API. Every path, header, and
field below is verified against the live controllers and DTOs (see
[Source references](#source-references) at the bottom).

- Base URL (local dev): `http://localhost:4000`
- Base URL (production): your Railway domain, e.g. `https://your-app.up.railway.app`
- Global API prefix: `/api/v1` (applied to all endpoints **except** `GET /.well-known/*`)

All examples below use `$BASE_URL` and `$API_KEY` placeholders. Set them once:

```bash
export BASE_URL="http://localhost:4000"
export API_KEY="your-mcp-api-key"
```

---

## 1. Get and configure an API key

The Public API and the A2A protocol are authenticated by an **MCP-category
secret**. Keys are minted by a platform admin through the admin Secrets API
(JWT + admin role required). As an external developer you receive the key value
from your GenesisPod administrator — you do not self-serve it.

How an admin creates a key (for reference; requires an admin JWT, not your API key):

```bash
curl -X POST "$BASE_URL/api/v1/admin/secrets" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "partner-acme-key",
    "displayName": "ACME Partner Key",
    "value": "sk-acme-...long-random-secret...",
    "category": "MCP"
  }'
```

- `name` must be lowercase alphanumeric with hyphens (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`).
- `category` must be `MCP` for it to authenticate Public API / A2A requests.
- The `value` you set is the API key you (the external developer) will send.

Once you hold the key value, send it on every authenticated request using
**either** header (both are accepted by the guard):

```http
Authorization: Bearer <API_KEY>
```

or

```http
X-API-Key: <API_KEY>
```

Unauthenticated public endpoints (no key needed): `GET /api/v1/public/status`
and `GET /.well-known/agent.json`.

---

## 2. Response envelope (success)

A global interceptor wraps every successful Public API and A2A response in this
shape:

```json
{
  "success": true,
  "data": { "...endpoint-specific payload..." },
  "metadata": {
    "requestId": "req_1717000000000_ab12cd3",
    "timestamp": "2026-05-30T10:00:00.000Z",
    "duration": 1234
  }
}
```

- The endpoint-specific payload (documented per endpoint below) is always under
  `data`.
- `metadata.requestId` is echoed in the `X-Request-Id` response header. Send your
  own `X-Request-Id` request header to correlate logs end to end.

> Note: the A2A JSON-RPC endpoint also passes through this wrapper, so its
> JSON-RPC envelope lands under `data` (see the A2A example).

---

## 3. Error handling

Errors are emitted by the global exception filter in this shape (no `success`
field — presence of `statusCode` tells you it is an error):

```json
{
  "statusCode": 400,
  "timestamp": "2026-05-30T10:00:00.000Z",
  "path": "/api/v1/public/research",
  "method": "POST",
  "message": "query should not be empty",
  "code": "Bad Request",
  "requestId": "req_...",
  "traceId": "..."
}
```

How to read it:

- `statusCode` — HTTP status (also reflected in the HTTP response status line).
- `code` — machine-readable code. For HTTP exceptions it mirrors the Nest error
  name (e.g. `Bad Request`, `Unauthorized`); for DB errors it is a domain code
  such as `DUPLICATE_ERROR`, `NOT_FOUND`, `FOREIGN_KEY_VIOLATION`.
- `message` — human-readable detail. Validation failures join multiple messages
  with `; `.
- `requestId` / `traceId` — present when a request context exists; quote these
  when contacting support so the matching server logs can be found.
- `details` — optional object with extra context (only on some errors).
- `stack` — only present when the server runs with `NODE_ENV=development`.

Common statuses:

| Status | When                                                           |
| ------ | -------------------------------------------------------------- |
| 400    | Validation failed (bad/missing field), bad webhook URL (A2A)   |
| 401    | Missing or invalid API key                                     |
| 404    | Resource/task not found                                        |
| 429    | Rate limit exceeded (per-endpoint throttle)                    |
| 501    | Endpoint not yet implemented (e.g. `GET /public/research/:id`) |

Per-endpoint rate limits (requests per 60s window): `chat` 20, `ask` 20,
`research` 5, `teams/debate` 5, `writing/assist` 10, `content/analyze` 10,
A2A `POST /a2a/v1` 60, A2A `POST /a2a/tasks` 30.

---

## 4. Example: Chat

Endpoint: `POST /api/v1/public/chat`

Request body (`ChatDto`):

- `messages` (required): array of `{ role, content }`. `role` is one of
  `user` | `assistant` | `system`; `content` max 50000 chars. 1–100 messages.
- `modelType` (optional string), `stream` (optional boolean — accepted but
  streaming is not yet emitted; the response is returned in one shot).

```bash
curl -X POST "$BASE_URL/api/v1/public/chat" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "system", "content": "You are a concise assistant." },
      { "role": "user", "content": "Explain vector databases in one sentence." }
    ]
  }'
```

Response (`data` payload):

```json
{
  "success": true,
  "data": {
    "content": "A vector database stores and indexes high-dimensional embeddings so you can retrieve items by semantic similarity rather than exact match.",
    "model": "resolved-model-id",
    "tokensUsed": 142
  },
  "metadata": { "requestId": "req_...", "timestamp": "...", "duration": 980 }
}
```

---

## 5. Example: Deep Research

Endpoint: `POST /api/v1/public/research` (synchronous — the request blocks until
the report is complete; can take a while for `deep`).

Request body (`StartResearchDto`):

- `query` (required string, max 10000 chars).
- `depth` (optional): `quick` | `standard` | `deep` (defaults to `standard`).
- `dimensions` (optional string array): specific angles to research.
- `language` (optional string, defaults to `en`).
- `maxIterations` (optional int 1–10) — accepted for forward-compat.

```bash
curl -X POST "$BASE_URL/api/v1/public/research" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "State of small language models for on-device inference in 2026",
    "depth": "standard",
    "language": "en",
    "dimensions": ["hardware constraints", "leading open models", "benchmarks"]
  }'
```

Response (`data` payload):

```json
{
  "success": true,
  "data": {
    "report": {
      "executiveSummary": "...",
      "sections": [{ "title": "...", "content": "..." }],
      "conclusion": "...",
      "references": [{ "title": "...", "url": "..." }],
      "metadata": { "...": "..." }
    },
    "searchRounds": 3,
    "totalSources": 24,
    "duration": 48211
  },
  "metadata": { "requestId": "req_...", "timestamp": "...", "duration": 48250 }
}
```

> `GET /api/v1/public/research/:id` currently returns **501 Not Implemented** —
> async status tracking is not wired up yet. Use the synchronous `POST` above.

---

## 6. Example: A2A `message/send` (Agent-to-Agent, JSON-RPC 2.0)

GenesisPod exposes an A2A v0.3 spec endpoint for agent-to-agent interop.

- Discovery (public, no key, **no** `/api/v1` prefix):
  `GET /.well-known/agent.json`
- JSON-RPC entry point (API key required): `POST /api/v1/a2a/v1`
- Supported methods: `message/send`, `tasks/get`, `tasks/cancel`
  (`message/stream` uses the SSE endpoint `POST /api/v1/a2a/v1/stream`).

`message/send` params (`MessageSendParams` → `message`):

- `message.role`: `user` | `agent`
- `message.parts`: array of parts; a text part is `{ "kind": "text", "text": "..." }`
  (the goal is taken from the first text part; max 100000 chars).
- `message.messageId`: your unique id (UUID recommended).
- `message.kind`: `"message"`.
- Skill routing: set `message.metadata.skillId` to pick a skill; otherwise the
  server infers one. The skill must exist in the agent card (`GET /.well-known/agent.json`
  lists available skills under `skills[].id`).

```bash
curl -X POST "$BASE_URL/api/v1/a2a/v1" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
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
```

Response — the JSON-RPC envelope is itself wrapped by the global interceptor, so
the RPC result lands under `data`:

```json
{
  "success": true,
  "data": {
    "jsonrpc": "2.0",
    "id": "1",
    "result": {
      "kind": "task",
      "id": "mission-id-returned-by-server",
      "contextId": "generated-or-echoed-context-id",
      "status": {
        "state": "submitted",
        "timestamp": "2026-05-30T10:00:00.000Z"
      }
    }
  },
  "metadata": { "requestId": "req_...", "timestamp": "...", "duration": 120 }
}
```

Poll the task with `tasks/get` (same endpoint, same headers):

```bash
curl -X POST "$BASE_URL/api/v1/a2a/v1" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tasks/get",
    "params": { "id": "mission-id-returned-by-server" }
  }'
```

When the task reaches `state: "completed"`, the result `Task` includes an
`artifacts` array whose text part carries the summary. JSON-RPC-level errors use
the standard codes (e.g. `-32601` method not found, `-32602` invalid params,
`-32001` task not found, `-32002` task not cancelable) inside an `error` object
under `data`.

> Legacy REST A2A shim (still available): `POST /api/v1/a2a/tasks` with body
> `{ "skillId": "...", "input": { "content": "..." } }` and
> `GET /api/v1/a2a/tasks/:taskId`. New integrations should prefer the JSON-RPC
> endpoint above.

---

## 7. BYOK (Bring Your Own Key) essentials

BYOK lets the model calls behind these endpoints run on keys owned by the
GenesisPod tenant/user rather than the platform's system keys.

- The MCP API key you send authenticates **you to the GenesisPod Public API**. It is
  not your LLM provider key.
- LLM provider keys (OpenAI, Anthropic, etc.) are configured inside GenesisPod as
  user-owned `UserApiKey` records (BYOK self-use mode). Model resolution and key
  selection happen server-side via the BYOK key resolver — you never pass a
  provider key on the wire to these endpoints.
- Default BYOK posture is **STRICT**: if a required user key is missing, the call
  fails rather than silently falling back to a system key. A tenant can opt into
  `FALLBACK` mode (use the system admin key when a user key is absent).
- Admins manage the BYOK pool, assignments, and pending key requests via the
  admin BYOK surfaces (`/api/v1/admin/byok-dashboard`, key-assignment and
  key-request admin endpoints). These are admin-only and out of scope for an
  external API consumer.

Practical takeaway for an external developer: configure your provider keys (or
have your admin assign them) in GenesisPod BYOK first; then call the Public API with
your MCP key. The platform routes each request to the correct provider key
according to the tenant's BYOK policy.

---

## Source references

Verified against (read during authoring):

- `backend/src/modules/open-api/public-api/public-api.controller.ts` — endpoint
  paths, return payloads, throttle limits.
- `backend/src/modules/open-api/public-api/dto/chat.dto.ts`,
  `dto/research.dto.ts`, `dto/ask.dto.ts`, `dto/debate.dto.ts`,
  `dto/writing.dto.ts`, `dto/analyze-content.dto.ts` — request field names,
  enums, length limits.
- `backend/src/modules/open-api/a2a-rpc.controller.ts` +
  `backend/src/modules/ai-harness/protocols/a2a/a2a-rpc.service.ts` +
  `a2a-spec.types.ts` — JSON-RPC shape, `message/send` params, Task result.
- `backend/src/modules/open-api/a2a-server.controller.ts` — legacy REST A2A shim
  and `.well-known/agent.json` discovery.
- `backend/src/modules/open-api/mcp-server/guards/mcp-api-key.guard.ts` and
  `backend/src/modules/ai-harness/protocols/a2a/guards/a2a-api-key.guard.ts` —
  accepted auth headers (`Authorization: Bearer`, `X-API-Key`) and MCP-category
  validation.
- `backend/src/common/interceptors/response-transform.interceptor.ts` — success
  envelope `{ success, data, metadata }`.
- `backend/src/common/filters/all-exceptions.filter.ts` — error envelope fields.
- `backend/src/main.ts` — global prefix `api/v1`, `.well-known/*` exclusion.
- `backend/src/modules/platform/credentials/secrets/secrets.controller.ts` +
  `dto/create-secret.dto.ts` + `prisma/schema/models.prisma` (`SecretCategory`
  enum, `MCP` value) — how an MCP API key is created.
  </content>
  </invoke>
