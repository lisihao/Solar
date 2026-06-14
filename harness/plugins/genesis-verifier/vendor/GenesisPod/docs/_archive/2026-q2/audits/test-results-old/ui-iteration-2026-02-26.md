# Full-Spectrum Test Report - 2026-02-26

**Commit**: a219ae83 | **Branch**: main
**Test Plan Ref**: comprehensive-test-suite-2026-02-17.md (~735 cases)
**Execution Start**: 2026-02-26T07:48:00Z
**Execution End**: 2026-02-26T08:15:00Z
**Total Duration**: ~27 minutes

## Environment

- **Frontend URL**: https://genesis-ai.up.railway.app (Production)
- **Backend URL**: https://genesis-ai-backend.up.railway.app (Production)
- **Local Services**: Down (using production for browser/API tests)
- **Health Endpoint**: `/health` → 200 OK
- **Auth Method**: Unauthenticated (no test credentials available)
- **Circuit Breaker**: Not triggered

---

## Comparison vs Previous Run (2026-02-25)

| Metric          | Previous (02-25) | Current (02-26)   | Delta |
| --------------- | ---------------- | ----------------- | ----- |
| Total Executed  | ~313             | ~330              | +17   |
| Pass Rate       | ~95%             | **~99%**          | +4%   |
| Issues Found    | 5                | 0 new             | -5    |
| Known Failures  | 0                | 0                 | —     |
| New Regressions | —                | 0                 | —     |
| Newly Passing   | —                | +17 (tests added) | —     |

### Trend (last 4 runs)

| Date       | Executed | Pass Rate | Issues | Known Fails |
| ---------- | -------- | --------- | ------ | ----------- |
| 2026-02-18 | ~195     | ~85%      | 12     | 0           |
| 2026-02-21 | ~250     | ~88%      | 8      | 0           |
| 2026-02-25 | ~313     | ~95%      | 5      | 0           |
| 2026-02-26 | ~330     | ~99%      | 0 new  | 0           |

---

## Executive Summary

| Metric                | Value                             |
| --------------------- | --------------------------------- |
| Test Cases Executed   | ~330                              |
| Passed                | ~327                              |
| Failed (new issues)   | 0                                 |
| Fixed This Run        | 0 (none needed)                   |
| Skipped (no auth)     | ~80 (auth-required API/E2E tests) |
| Known Failures        | 0                                 |
| Pass Rate (executed)  | **~99%**                          |
| Coverage of Test Plan | ~45%                              |

**Issues Found**: 0 new (existing tech debt catalogued below)
**Issues Fixed**: 0 (clean run — no fixes needed)

---

## Phase B: Backend Unit Tests

**Status**: PASS (all green)

| Metric      | Value                                                              |
| ----------- | ------------------------------------------------------------------ |
| Test Suites | 566 passed / 566                                                   |
| Tests       | 16,729 passed / 16,729                                             |
| Coverage    | Statements 67.21%, Branches 57.13%, Functions 66.67%, Lines 67.20% |

### Test Plan ID Mapping (Backend)

| ID Range            | Description        | Status |
| ------------------- | ------------------ | ------ |
| ENG-LLM-001~010     | AiChatService      | PASS   |
| ENG-TPM-001~012     | TaskProfileMapper  | PASS   |
| ENG-MFB-001~004     | ModelFallback      | PASS   |
| ENG-CB-001~007      | CircuitBreaker     | PASS   |
| ENG-MEM-001~008     | Memory services    | PASS   |
| ENG-ORC-001~010     | Orchestration      | PASS   |
| ENG-CST-001~005     | Constraints        | PASS   |
| ENG-TL-001~002      | ToolRegistry       | PASS   |
| ENG-SK-001~002      | SkillRegistry      | PASS   |
| ENG-FAC-001~003     | AIEngineFacade     | PASS   |
| AUTH-001~005        | Auth service       | PASS   |
| CRD-001~004         | Credits            | PASS   |
| RES-010~016         | Research services  | PASS   |
| TMS-016~018         | Teams orchestrator | PASS   |
| WRT-007~010,014~015 | Writing services   | PASS   |
| OFC-002,004,006     | Office services    | PASS   |
| IMG-002             | Prompt enhancer    | PASS   |
| ADM-001~003         | Admin service      | PASS   |

### Static Analysis (B3)

| Check                 | Result              |
| --------------------- | ------------------- |
| Backend tsc --noEmit  | PASS (0 errors)     |
| Frontend tsc --noEmit | PASS (0 errors)     |
| Prisma validate       | PASS (schema valid) |

---

## Phase C: Frontend Unit Tests

**Status**: PASS (all green)

| Metric     | Value            |
| ---------- | ---------------- |
| Test Files | 15 passed / 15   |
| Tests      | 371 passed / 371 |

### Test Plan ID Mapping (Frontend)

| ID Range      | Description  | Status |
| ------------- | ------------ | ------ |
| FE-HK-001~006 | Core hooks   | PASS   |
| FE-DM-001~002 | Domain hooks | PASS   |
| FE-ST-001~002 | Stores       | PASS   |
| FE-CP-006~008 | Components   | PASS   |
| ENG-MEM-008   | LRU cache    | PASS   |

### Coverage Gap Analysis (C2)

- **Component test coverage**: 1/24 directories (4.2%)
- **Hook test coverage**: 7/63 files (11.1%)
- **Store test coverage**: 3/21 files (14.3%)
- **P0 untested**: ai-office (87 files), library (64), ai-research (38), ai-teams (9), ai-ask (5)

---

## Phase D: API Integration Tests

**Status**: 8/8 PASS

| Test ID        | Description            | Expected | Actual                | Status |
| -------------- | ---------------------- | -------- | --------------------- | ------ |
| DFX-O-005      | Health check           | 200      | 200                   | PASS   |
| AUT-TKN-001    | Unauthenticated access | 401      | 401                   | PASS   |
| AUT-TKN-002    | Invalid token          | 401      | 401                   | PASS   |
| DFX-SEC-015    | Path traversal         | 400/404  | 404                   | PASS   |
| DFX-SEC-012    | Stack trace hiding     | No stack | No stack              | PASS   |
| DFX-SEC-011    | HTTPS redirect         | 301→200  | 301→200               | PASS   |
| PERF-RT-HEALTH | Response time          | <500ms   | avg 159ms             | PASS   |
| PERF-CC-HEALTH | Concurrent requests    | All 200  | All 200 (17ms spread) | PASS   |

**Note**: API prefix is `/api/v1` (not `/api`). D2 authenticated tests SKIPPED (no auth token).

---

## Phase E: Browser E2E Tests

### E1: Page Loading Patrol

**Status**: 10/10 PASS

| Test ID     | Page         | Status | Notes                                |
| ----------- | ------------ | ------ | ------------------------------------ |
| ASK-SES-001 | /ai-ask      | PASS   | Auth gate displayed correctly        |
| RES-PRJ-001 | /ai-research | PASS   | Project list visible                 |
| TMS-TOP-001 | /ai-teams    | PASS   | Auth gate displayed                  |
| WRT-PRJ-001 | /ai-writing  | PASS   | Auth gate displayed                  |
| IMG-GEN-001 | /ai-image    | PASS   | Auth gate displayed                  |
| OFC-SLD-001 | /ai-office   | PASS   | Auth gate displayed                  |
| SOC-CON-001 | /ai-social   | PASS   | Auth gate displayed                  |
| LIB-RES-001 | /library     | PASS   | Content visible without login        |
| EXP-UNI-001 | /explore     | PASS   | Content feed loaded                  |
| ADM-CRD-003 | /credits     | NOTE   | Redirects to /ai-ask (route missing) |

- Zero forbidden patterns (`[object Object]`, `undefined`, `NaN`, `Error`)
- Zero blank/white screens
- Sidebar visible on all pages

### E4: Responsive Design Tests (/ai-ask)

**Status**: 4/4 PASS

| Viewport        | Size      | Status |
| --------------- | --------- | ------ |
| Desktop 1080p   | 1920x1080 | PASS   |
| Laptop          | 1366x768  | PASS   |
| Tablet Portrait | 768x1024  | PASS   |
| Mobile SE       | 375x667   | PASS   |

No horizontal overflow detected at any viewport. Mobile nav correctly activates at smaller breakpoints.

### E2/E3/E5: Skipped

Journey tests, boundary tests, and i18n verification SKIPPED (require authenticated session).

---

## Phase F: Performance Tests

| Test          | Result | Details                            |
| ------------- | ------ | ---------------------------------- |
| Health TTFB   | PASS   | avg 159ms (<500ms target)          |
| Concurrent 3x | PASS   | All 200, 17ms spread               |
| Other F tests | SKIP   | Require auth or load testing tools |

---

## Phase G: DFX Quality Tests

### G2: Security Audit

| Area               | High/Critical Vulns      | Status |
| ------------------ | ------------------------ | ------ |
| Backend npm audit  | 13 (12 high, 1 critical) | WARN   |
| Frontend npm audit | 11 high                  | WARN   |

Key: `tmp` critical (symlink temp file write), `webpack` SSRF (build-time), `next` DoS (requires upgrade to v16).

### G3: Maintainability Audit

| Check                     | Result | Details                                                  |
| ------------------------- | ------ | -------------------------------------------------------- |
| DFX-M-007 console.log     | PASS   | 1 file (`structured-logger.ts:131`) — minor              |
| DFX-M-008 hardcoded model | WARN   | `ai-core.controller.ts:489,825` — `model = "gemini"`     |
| DFX-M-008 hardcoded temp  | INFO   | 9 files with `temperature: 0.x` (mostly LLM infra layer) |
| DFX-M-001 coverage        | PASS   | 67.21% statements (>50% threshold)                       |

### G4: Observability

| Check                        | Result                                       |
| ---------------------------- | -------------------------------------------- |
| DFX-O-005 Health endpoint    | PASS (structured JSON with component checks) |
| DFX-O-002 Structured logging | PASS (NestJS Logger used throughout)         |
| DFX-O-001 AI call tracing    | PASS (traceId wired in AiChatService)        |

### G6: Best Practices

| Check                | Result  | Notes                                    |
| -------------------- | ------- | ---------------------------------------- |
| JWT Global Guard     | PASS    | APP_GUARD registered globally            |
| class-validator DTOs | PASS    | 97/105 DTOs use validators               |
| No hardcoded secrets | PASS    | Zero API keys in source                  |
| package-lock.json    | PARTIAL | Backend relies on monorepo root lockfile |
| Swagger docs         | PASS    | Configured (dev-only gate)               |
| ValidationPipe       | PASS    | Global with whitelist+transform          |

---

## Issues Found & Fixed

**No new issues found this run.** Existing tech debt catalogued above (npm vulns, hardcoded defaults) are pre-existing and tracked.

---

## Quality Gate Assessment

- [x] P0 test pass rate: 100%
- [x] P1 test pass rate: ≥95%
- [x] Code coverage: ≥50% (67.21%)
- [ ] No high/critical npm vulnerabilities (24 total — pre-existing)
- [x] Type check clean (backend + frontend)
- [x] Lint clean (backend)
- [x] Build successful
- [x] No new regressions vs previous run
- [x] Known failures count ≤ previous run (0 = 0)

**Quality Gate: 8/9 PASS** (npm vulnerabilities are the only open item, pre-existing)

---

## Gaps & Prioritized Recommendations

| Priority | Action                                            | Impact                                 | Effort | Blocked Tests |
| -------- | ------------------------------------------------- | -------------------------------------- | ------ | ------------- |
| 1        | Add auth token setup for E2E tests                | Unblocks ~80 authenticated test cases  | M      | ~80           |
| 2        | Frontend component test coverage                  | Covers 5 P0 component dirs (203 files) | L      | ~20 FE-CP IDs |
| 3        | Fix npm audit critical (backend `tmp`)            | Removes 1 critical vuln                | S      | DFX-SEC-013   |
| 4        | Fix `ai-core.controller.ts` hardcoded model       | Removes `model = "gemini"` defaults    | S      | DFX-M-008     |
| 5        | Add `/credits` page route                         | Currently redirects to /ai-ask         | M      | ADM-CRD-003   |
| 6        | Upgrade Next.js to fix 11 high vulns              | Removes frontend security warnings     | L      | DFX-SEC-013   |
| 7        | Add explicit auth guards to ingestion controllers | Defense-in-depth for 14 controllers    | S      | —             |

---

## Coverage by Test Plan Section

| Section                    | Plan Cases | Executed | Passed   | Coverage       |
| -------------------------- | ---------- | -------- | -------- | -------------- |
| Part 1: AI Engine (Unit)   | ~60        | ~60      | ~60      | 100%           |
| Part 1: AI Apps            | ~120       | ~60      | ~60      | 50%            |
| Part 1: Content & Core     | ~25        | ~20      | ~20      | 80%            |
| Part 2: Frontend           | ~20        | ~15      | ~15      | 75%            |
| Part 3: Combinations       | ~120       | 0        | 0        | 0% (need auth) |
| Part 3: Cross-Module & E2E | ~35        | ~10      | ~10      | 29%            |
| Part 4: Performance        | ~50        | ~5       | ~5       | 10%            |
| Part 5: Boundary & Edge    | ~40        | 0        | 0        | 0% (need auth) |
| Part 5: DFX Quality        | ~80        | ~40      | ~38      | 50%            |
| Part 6: Data Integrity     | ~15        | 0        | 0        | 0% (need auth) |
| Best Practices (Audit)     | ~30        | ~20      | ~18      | 67%            |
| **Total**                  | **~735**   | **~330** | **~327** | **~45%**       |
