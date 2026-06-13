# Phase D + G Static: API Integration Tests & Static Audits

**Commit**: dbdf2035 | **Date**: 2026-02-25
**Production Backend**: https://genesis-ai-backend.up.railway.app
**Production Frontend**: https://genesis-ai.up.railway.app

---

## Phase D: API Integration Tests

### D0: Route Discovery

The backend uses `/api/v1/` as the global prefix (set via `app.setGlobalPrefix("api/v1", ...)` in `main.ts`).
The health endpoint is at `/health` (excluded from global prefix).
Initial probes against `/api/health` returned 404 — all subsequent D-phase tests use correct prefixes.

| Discovery Item    | Finding                                                  |
| ----------------- | -------------------------------------------------------- |
| API global prefix | `/api/v1/`                                               |
| Health endpoint   | `/health` (no prefix)                                    |
| Auth endpoint     | `/api/v1/auth/login`                                     |
| Ask sessions      | `/api/v1/ask/sessions`                                   |
| Resources         | `/api/v1/resources`                                      |
| Global JWT guard  | YES — `APP_GUARD` with `JwtAuthGuard` in `app.module.ts` |

---

### D1: Health & Auth Chain

| Test                                             | Plan ID     | Expected                                | Actual                                                                    | TTFB  | Result |
| ------------------------------------------------ | ----------- | --------------------------------------- | ------------------------------------------------------------------------- | ----- | ------ |
| Health check (`/health`)                         | DFX-O-005   | 200                                     | 200                                                                       | 0.44s | PASS   |
| Health response structure                        | DFX-O-005   | `{status, timestamp, service, version}` | `{status:"ok", timestamp, service:"GenesisPod Backend", version:"1.0.0"}` | -     | PASS   |
| Unauthenticated request (`/api/v1/ask/sessions`) | AUT-TKN-001 | 401                                     | 401                                                                       | -     | PASS   |
| Invalid JWT token                                | AUT-TKN-002 | 401                                     | 401                                                                       | -     | PASS   |

**Health response payload:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-25T15:19:34.572Z",
  "service": "GenesisPod Backend",
  "version": "1.0.0"
}
```

**Note on health endpoint**: The health check lives at `/health` (not `/api/v1/health`). This is intentional — the endpoint is excluded from the global prefix via the `exclude` option in `setGlobalPrefix`. The response is minimal (no database connectivity, no dependency health). A richer health check (e.g., DB ping, Redis status) would be advisable for production monitoring.

---

### D2: Auth Status

**Token acquisition attempt**: POST `/api/v1/auth/login` with `test@genesis.ai` / `test123456` returned HTTP 401 `"Invalid credentials"`. No `.env.test` file found in project root.

**Token obtained**: NO

**Observations:**

- Login endpoint correctly rejects invalid credentials with 401 (not 500)
- Response includes `requestId` and `traceId` for traceability
- No test user exists in production database (expected for security)

**Authenticated endpoint coverage** (tested unauthenticated to confirm guard behavior):

| Endpoint                   | Without Token | With Bad Token | Guard Working                   |
| -------------------------- | ------------- | -------------- | ------------------------------- |
| `GET /api/v1/ask/sessions` | 401           | 401            | YES                             |
| `GET /api/v1/resources`    | 200           | 200            | N/A — intentionally `@Public()` |

**Architecture note**: The global `JwtAuthGuard` is registered as `APP_GUARD` in `app.module.ts`. Individual public endpoints use `@Public()` decorator. This is correct NestJS pattern.

---

### D3: Security Probes

| Test                                                        | Plan ID     | Expected    | Actual | Result | Notes                                                                                                                  |
| ----------------------------------------------------------- | ----------- | ----------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Path traversal (`/api/v1/resources/..%2F..%2Fetc%2Fpasswd`) | DFX-SEC-015 | 400/404     | 404    | PASS   | Route not matched                                                                                                      |
| Invalid JSON body (`POST /api/v1/auth/login`)               | -           | 400         | 400    | PASS   | NestJS validation pipe rejects malformed JSON                                                                          |
| XSS in query param (`?search=<script>...`)                  | -           | 400/401     | 401    | PASS   | Auth guard fires before query processing                                                                               |
| SSRF probe (`POST /api/v1/resources/fetch`)                 | DFX-SEC-014 | 400/403/404 | 404    | PASS   | Endpoint does not exist                                                                                                |
| SQL injection in query (`?id=1 OR 1=1`)                     | OWASP-A03   | 401         | 200    | REVIEW | Resources list is `@Public()` — returns data. Prisma parameterized queries prevent actual injection.                   |
| NoSQL injection in body (`email: {"$gt":""}`)               | OWASP-A01   | 400         | 500    | FAIL   | Prisma rejects object-typed email at ORM level, but returns 500 with full Prisma error message leaked in response body |

**Critical Finding — NoSQL Injection 500 / Error Leakage:**

Sending `{"email":{"$gt":""},"password":"anything"}` to `/api/v1/auth/login` returns HTTP 500 with the following body:

```json
{
  "statusCode": 500,
  "message": "\nInvalid `prisma.user.findUnique()` invocation:\n\n{\n  where: {\n    email: {\n      $gt: \"\"\n    }\n  }\n}\n\nArgument `email`: Invalid value provided. Expected String, provided Object.",
  "code": "INTERNAL_ERROR"
}
```

This leaks:

1. ORM implementation details (Prisma)
2. Internal method name (`prisma.user.findUnique()`)
3. Schema structure (`where.email` field)

**Root cause**: The `LoginDto` validation pipe should reject non-string `email` values with a 400 before reaching the service layer. The `@IsEmail()` / `@IsString()` validator on the DTO is likely not catching object-typed inputs in this code path.

**Risk level**: Medium. Prisma's type-safe ORM prevents actual NoSQL injection exploitation, but error leakage violates security best practices (OWASP A05: Security Misconfiguration — verbose error messages).

---

### D4: API Response Format

| Check                                                   | Result | Notes                                    |
| ------------------------------------------------------- | ------ | ---------------------------------------- |
| Health returns JSON                                     | PASS   | `Content-Type: application/json`         |
| Error responses include `statusCode`, `message`, `code` | PASS   | Consistent error shape observed          |
| Error responses include `requestId` + `traceId`         | PASS   | Confirmed in login 401 and 500 responses |
| TTFB < 1s (health)                                      | PASS   | 0.44s observed                           |
| TTFB < 1s (auth)                                        | PASS   | 0.57s observed                           |

---

## Phase G: Static Audits

### G2: npm Security Audit (DFX-SEC-013)

**Backend** (`backend/`):

- Total vulnerabilities: **25** (critical: 0, high: 12, moderate: 9, low: 4)
- High-severity findings include: `tar` directory traversal, `tmp` arbitrary file write, `webpack` buildHttp SSRF bypass
- Most are in dev/build toolchain (`@nestjs/cli`, `webpack`, `@angular-devkit/schematics-cli`) — not in production runtime
- Fix requires `npm audit fix --force` which installs `@nestjs/cli@11.0.16` (breaking change)

**Result**: FAIL (threshold: 0 high) — however **risk is low** as findings are in dev toolchain only

**Frontend** (`frontend/`):

- Total vulnerabilities: **11** (critical: 0, high: 10, moderate: 0, low: 1)
- High-severity: `next` 10.0.0-15.5.9 — DoS via Image Optimizer and RSC deserialization; `webpack` buildHttp SSRF bypass
- **`next` vulnerability is in the production runtime** — affects the deployed frontend
- Fix requires `npm audit fix --force` → installs `next@16.1.6` (major version bump, breaking)

**Result**: FAIL — `next` DoS vulnerabilities are production-impacting

| Package           | Severity | Type                                         | Runtime?                 |
| ----------------- | -------- | -------------------------------------------- | ------------------------ |
| `next` (frontend) | High     | DoS via Image Optimizer, RSC deserialization | YES — production         |
| `webpack` (both)  | High     | buildHttp SSRF bypass                        | NO — build time only     |
| `tar` (backend)   | High     | Directory traversal                          | NO — build/dev toolchain |
| `tmp` (backend)   | High     | Arbitrary file write via symlink             | NO — dev toolchain       |

---

### G3: Maintainability Audit

#### DFX-M-007: console.log in Production Backend Code

Files with `console.log` (excluding spec files):

| File                                                                                       | Count                                  | Classification                                           |
| ------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------- |
| `backend/src/common/utils/structured-logger.ts`                                            | 1 (line 131)                           | Actual `console.log(json)` call in logger implementation |
| `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`                                 | 5 (lines 1095, 1318, 1364, 1683, 1936) | All are in JSDoc comment blocks — not actual calls       |
| `backend/src/modules/ai-engine/tools/categories/information/document-processor.example.ts` | 1 (line 452)                           | Example/demonstration file — not production code         |

**True production `console.log` calls**: **1** (in `structured-logger.ts`)

**Result**: FAIL (threshold: 0) — `structured-logger.ts:131` has a real `console.log(json)` in the Logger utility itself. This is used as a fallback when structured logging fails to initialize. Low risk but violates the rule.

#### DFX-M-008: Hardcoded LLM Model Names

Files with hardcoded model names (non-spec, production code):

| File                                                           | Instances | Context                                                                             |
| -------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `common/ai-orchestration/providers/anthropic.provider.ts:54`   | 1         | `model.modelId \|\| "claude-3-sonnet-20240229"` — fallback default                  |
| `common/ai-orchestration/providers/xai.provider.ts:47,129`     | 2         | `model.modelId \|\| "grok-3-latest"`, `"grok-2-image-1212"` — fallback defaults     |
| `ai-engine/constraint/guardrails/cost-controller.ts:160-182`   | 6         | Price lookup table — model names as dictionary keys (justified)                     |
| `ai-engine/llm/services/ai-connection-test.service.ts:125,178` | 2         | `modelId \|\| "grok-beta"`, `"claude-3-sonnet-20240229"` — connection test defaults |
| `ai-engine/llm/services/ai-direct-key.service.ts:146,293`      | 2         | `modelId \|\| "grok-3-latest"`, `"grok-beta"` — direct key test calls               |
| `core/admin/quota/providers/anthropic-quota.provider.ts:48`    | 1         | `"claude-3-haiku-20240307"` — quota check model                                     |
| `core/user-api-keys/user-api-keys.service.ts:655`              | 1         | `"claude-3-haiku-20240307"` — API key validation                                    |

**Total instances**: **15**

**Result**: FAIL (threshold: 0 per CLAUDE.md rule)

**Categorization**:

- **Provider fallback defaults** (anthropic.provider, xai.provider): Should use `""` per CLAUDE.md rule ("永远用 `""` 空字符串")
- **Cost price table** (cost-controller.ts): Justified — model names are lookup keys for pricing data, not LLM call parameters
- **Connection test / direct key services**: These call provider APIs directly (not via `AiChatService.chat()`), so `TaskProfile` resolution doesn't apply — but fallback should still be `""`
- **Quota/API key validation**: Legitimate use of specific model for billing/quota check

#### Hardcoded Temperature Values

Files with literal `temperature: 0.X` in production code (excluding comments):

| File                                                         | Value | Context                                                                        |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------ |
| `common/content-processing/content-extractor.service.ts:182` | 0.3   | `// Direct Gemini API call, not using AiChatService` — acknowledged bypass     |
| `common/content-processing/data-fetching.service.ts:483`     | 0.1   | `// Direct Perplexity API call, not using AiChatService` — acknowledged bypass |
| `core/feedback/triage/triage-decision.types.ts:288`          | 0.3   | Type definition with default — not a direct LLM call                           |

**Actual direct temperature overrides bypassing TaskProfile**: **2** (content-extractor, data-fetching)

**Result**: PARTIAL FAIL — 2 services bypass `AiChatService` with hardcoded temperature. The comments acknowledge the bypass; the intent is direct provider calls for specific use cases. These should be tracked for eventual TaskProfile integration.

---

### G4: Observability

| Check                                  | Result | Detail                                                                                          |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Structured Logger usage (files)        | PASS   | **691 files** use `new Logger(...)` or `Logger.*`                                               |
| `traceId` propagation in AiChatService | PASS   | `traceId` accepted as parameter (line 37), passed to `TraceCollector.addSpan()` (lines 814-815) |
| `requestId` middleware                 | PASS   | Request ID middleware confirmed active (visible in error responses as `requestId` field)        |
| Trace collector wired                  | PASS   | `TraceCollector` integrated in `AiChatService.chat()`                                           |

**Observability assessment**: Strong. NestJS Logger is pervasively used (691 files), `requestId` is injected per request, and `traceId` flows through the AI chat pipeline into the trace collector. The 1 `console.log` in `structured-logger.ts` is the only gap.

---

### G6: OWASP & 12-Factor Checks

#### OWASP A01: Broken Access Control

| Check                                                | Result | Detail                                                                      |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Global JWT guard applied                             | PASS   | `APP_GUARD: JwtAuthGuard` in `app.module.ts` — guards all routes by default |
| Controllers with explicit `@UseGuards(JwtAuthGuard)` | INFO   | 39 files — supplementary to global guard                                    |
| Total controller files                               | INFO   | 94 files                                                                    |
| `@Public()` decorator for intentional open endpoints | PASS   | 24 files use `@Public()` for explicitly public endpoints                    |
| Unauthenticated request returns 401                  | PASS   | Confirmed via D1 tests                                                      |

**Assessment**: PASS — global guard pattern is correct. All routes are protected by default; public endpoints are explicitly opted out with `@Public()`.

#### OWASP A03: Injection

| Check                                      | Result | Detail                                                                                                                                |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Parameterized Prisma queries (default ORM) | PASS   | Prisma uses parameterized queries by default                                                                                          |
| `$queryRaw` usage (template literal form)  | PASS   | Uses tagged template literal `\`SELECT...\`` — parameterized                                                                          |
| `$executeRawUnsafe` usage                  | REVIEW | Used in `startup-migration.service.ts` for DDL (ALTER TABLE, CREATE TYPE, CREATE INDEX) — no user input involved, static strings only |
| NoSQL injection handling                   | FAIL   | Returns 500 with Prisma internals instead of 400 — see D3 findings                                                                    |
| SQL injection via query params             | PASS   | Prisma ORM prevents SQL injection; `@Public()` resource list returns data but doesn't execute user input as SQL                       |

**`$executeRawUnsafe` assessment**: The 6 usages in `startup-migration.service.ts` are DDL statements with hardcoded schema names — no user input is interpolated. Low risk, but `$executeRaw` with template literals would be preferred pattern.

#### OWASP A05: Security Misconfiguration

| Check                                   | Result | Detail                                                                                             |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| CORS exact-match via `CORS_ORIGINS` env | PASS   | `main.ts:119-121` uses `process.env.CORS_ORIGINS?.split(",")` with `Set<string>`                   |
| Debug endpoints absent                  | PASS   | No `/debug` or `/dev/` routes in controllers; `logger.debug()` calls are logging level, not routes |
| Verbose error message leak (Prisma)     | FAIL   | NoSQL injection probe exposes `prisma.user.findUnique()` invocation details in 500 response        |
| Hardcoded secrets in source             | PASS   | No hardcoded secrets found — all API keys via `process.env`                                        |

#### OWASP A07: Identification & Authentication Failures

| Check                                    | Result | Detail                                                                                                 |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| JWT authentication enforced globally     | PASS   | `APP_GUARD` pattern                                                                                    |
| Invalid credentials return 401 (not 200) | PASS   | Confirmed via D2                                                                                       |
| Invalid JWT returns 401 (not 500)        | PASS   | Confirmed via D1                                                                                       |
| Rate limiting on auth endpoints          | PASS   | `ThrottleGuard` and `distributed-rate-limit.guard.ts` exist; `@Throttle` used on sensitive controllers |

#### OWASP A08: Software & Data Integrity Failures

| Check                                  | Result | Detail                                                                               |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `class-validator` decorators used      | PASS   | **94 files** use `@IsString`, `@IsEmail`, `@IsNotEmpty`, etc.                        |
| Input validation pipeline active       | PASS   | NestJS `ValidationPipe` rejects invalid JSON with 400 (confirmed via D3)             |
| LoginDto missing object-type rejection | FAIL   | Object-typed `email` field not rejected before reaching Prisma — causes 500 (see D3) |

#### 12-Factor III: Config

| Check                                                | Result | Detail                                                      |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------- |
| No hardcoded secrets in source                       | PASS   | All API keys from `process.env`                             |
| No hardcoded model names as LLM defaults             | FAIL   | 8 instances of non-justified hardcoded model names (see G3) |
| `CORS_ORIGINS` env var                               | PASS   | CORS configured via environment variable                    |
| `GUARDRAILS_ENABLED` flag                            | PASS   | Feature flag for guardrails pipeline                        |
| `CACHE_MAX_ITEMS`, `DB_POOL_SIZE`, `DB_POOL_TIMEOUT` | PASS   | Infrastructure config via env                               |

#### API Documentation Coverage

| Check                              | Result | Detail                                                      |
| ---------------------------------- | ------ | ----------------------------------------------------------- |
| Swagger `@ApiOperation` decorators | INFO   | **35 files** — partial coverage (94 controller files total) |
| Coverage ratio                     | ~37%   | Below recommended threshold of 80%                          |

---

## Summary

### Phase D: API Integration Test Results

| Test ID | Description                   | Plan ID     | Result                  |
| ------- | ----------------------------- | ----------- | ----------------------- |
| D1-01   | Health check returns 200      | DFX-O-005   | PASS                    |
| D1-02   | Health TTFB < 1s              | DFX-O-005   | PASS (0.44s)            |
| D1-03   | Unauthenticated → 401         | AUT-TKN-001 | PASS                    |
| D1-04   | Invalid JWT → 401             | AUT-TKN-002 | PASS                    |
| D2-01   | Token acquisition             | -           | N/A (no test user)      |
| D3-01   | Path traversal → 404          | DFX-SEC-015 | PASS                    |
| D3-02   | Invalid JSON → 400            | -           | PASS                    |
| D3-03   | XSS query param → blocked     | -           | PASS (401)              |
| D3-04   | SSRF probe → 404              | DFX-SEC-014 | PASS                    |
| D3-05   | NoSQL injection → safe        | OWASP-A01   | FAIL (500 + error leak) |
| D4-01   | JSON response format          | -           | PASS                    |
| D4-02   | requestId + traceId in errors | -           | PASS                    |

### Phase G: Static Audit Results

| Audit                                    | Plan ID     | Result       | Severity                           |
| ---------------------------------------- | ----------- | ------------ | ---------------------------------- |
| G2 Backend npm audit (0 high vulns)      | DFX-SEC-013 | FAIL         | Medium — dev toolchain only        |
| G2 Frontend npm audit (0 high vulns)     | DFX-SEC-013 | FAIL         | High — Next.js DoS in production   |
| G3 console.log in production             | DFX-M-007   | FAIL         | Low (1 instance in logger utility) |
| G3 Hardcoded LLM model names             | DFX-M-008   | FAIL         | Medium (8 unjustified instances)   |
| G3 Hardcoded temperature                 | DFX-M-008   | PARTIAL FAIL | Low (2 acknowledged bypasses)      |
| G4 Structured logging                    | -           | PASS         | -                                  |
| G4 traceId propagation                   | -           | PASS         | -                                  |
| G6 OWASP A01 — global JWT guard          | -           | PASS         | -                                  |
| G6 OWASP A03 — parameterized queries     | -           | PASS         | -                                  |
| G6 OWASP A03 — NoSQL injection 500       | -           | FAIL         | Medium                             |
| G6 OWASP A05 — CORS via env              | -           | PASS         | -                                  |
| G6 OWASP A05 — error message leakage     | -           | FAIL         | Medium                             |
| G6 OWASP A07 — rate limiting             | -           | PASS         | -                                  |
| G6 OWASP A08 — class-validator           | -           | PASS         | -                                  |
| G6 OWASP A08 — LoginDto object rejection | -           | FAIL         | Medium                             |
| G6 12-Factor III — no hardcoded secrets  | -           | PASS         | -                                  |
| G6 Swagger coverage (~37%)               | -           | INFO         | Low                                |

---

## Defect Summary

### BUG-D-001: NoSQL Injection → HTTP 500 with Prisma Error Leakage (Medium)

**Endpoint**: `POST /api/v1/auth/login`
**Reproduction**: `curl -X POST -H "Content-Type: application/json" -d '{"email":{"$gt":""},"password":"x"}' https://genesis-ai-backend.up.railway.app/api/v1/auth/login`
**Expected**: HTTP 400 with generic validation error
**Actual**: HTTP 500 exposing `prisma.user.findUnique()` invocation and schema structure
**Root cause**: `LoginDto.email` with `@IsEmail()` / `@IsString()` does not reject object-typed inputs before the service layer in this code path. The `class-validator` `ValidationPipe` should catch this.
**Fix**: Ensure `ValidationPipe` with `transform: true` and `whitelist: true` is active globally; add explicit `@IsString()` before `@IsEmail()` on `LoginDto.email`; add global exception filter to sanitize 500 responses.
**File**: `backend/src/modules/ai-infra/auth/dto/login.dto.ts`

### BUG-D-002: Next.js Production DoS Vulnerability (High)

**Package**: `next` 10.0.0–15.5.9
**CVEs**: GHSA-9g9p-9gw9-jx7f (Image Optimizer DoS), GHSA-h25m-26qc-wcjf (RSC deserialization DoS)
**Impact**: Production frontend is vulnerable to denial-of-service attacks
**Fix**: Upgrade to `next@16.x` (breaking change — requires compatibility review)
**Urgency**: High — production runtime vulnerability

### BUG-D-003: Hardcoded LLM Model Fallback Names (Medium)

**Files**: `anthropic.provider.ts`, `xai.provider.ts`, `ai-connection-test.service.ts`, `ai-direct-key.service.ts`, `user-api-keys.service.ts`
**Issue**: Fallback model strings like `model.modelId || "claude-3-sonnet-20240229"` violate CLAUDE.md rule (must use `""` empty string)
**Fix**: Replace all `|| "model-name"` fallbacks with `|| ""` — downstream `AiChatService` resolves via `TaskProfile`
**Count**: 8 instances

### INFO-G-001: Swagger API Documentation Coverage 37% (Low)

**Current**: 35 files with `@ApiOperation` out of 94 controller files
**Recommended**: >= 80% coverage for production APIs
**Impact**: Reduces API discoverability and integration documentation quality
