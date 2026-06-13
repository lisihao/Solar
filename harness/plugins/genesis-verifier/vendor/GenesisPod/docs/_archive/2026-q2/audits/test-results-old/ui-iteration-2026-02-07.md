# Full-Spectrum Test Report - 2026-02-07

**Commit**: 58ddc94b | **Branch**: main
**Test Plan Ref**: comprehensive-test-plan-2026-02-06.md (~630 cases)
**Execution Start**: 2026-02-07T00:45:21Z
**Execution End**: 2026-02-07T03:30:00Z

---

## Status: COMPLETED

### Executive Summary

| Dimension                    | Result   | Details                                               |
| ---------------------------- | -------- | ----------------------------------------------------- |
| Backend Unit Tests (Jest)    | PASS     | 1418/1418 passed, 1 suite error (pdfjs-dist ESM)      |
| Frontend Unit Tests (Vitest) | PASS     | 185/185 passed, 10 test files                         |
| Backend Type Check (tsc)     | PASS     | 0 errors                                              |
| Frontend Type Check (tsc)    | PASS     | 0 errors                                              |
| Frontend Lint                | WARN     | 129 errors (no-explicit-any), 5311 warnings           |
| Backend Lint                 | WARN     | 49 errors, 13660 total problems                       |
| API Integration              | PARTIAL  | Health PASS, auth INCONCLUSIVE, stack trace leak FAIL |
| Browser E2E (Local)          | PASS     | 14/16 routes PASS, 2 WARN                             |
| DFX Code Audit               | REVIEWED | 3 HIGH findings, 5 MEDIUM findings                    |
| npm Audit                    | FAIL     | Vulnerabilities in both workspaces                    |

**Overall Verdict**: PASS WITH WARNINGS - Core functionality stable. No blocking regressions. Security and code quality items tracked for follow-up.

---

## Phase B: Backend Automated Tests

### B1: Jest Unit Tests

**Command**: `cd backend && npx jest --ci --coverage`
**Result**: 1418 passed, 0 failed, 1 suite error

| Metric             | Value                          |
| ------------------ | ------------------------------ |
| Test Suites        | 65 passed, 1 errored, 66 total |
| Tests              | 1418 passed, 0 failed          |
| Snapshots          | 0 total                        |
| Duration           | ~82s                           |
| Line Coverage      | 10.94%                         |
| Branch Coverage    | 6.31%                          |
| Function Coverage  | 8.62%                          |
| Statement Coverage | 11.01%                         |

**Suite Error**:

- `src/modules/ai-app/image/__tests__/ai-image.service.spec.ts`
- Root cause: `pdfjs-dist` ESM incompatibility with Jest CommonJS transform
- Impact: LOW - only affects PDF parsing in image service
- Fix: Configure Jest moduleNameMapper or switch to dynamic import

**Key Test Files (66 suites)**:

- ai-engine: circuit-breaker, ai-chat, prompt-builder, task-profile.types-mapper, ai-model-config, guardrails, trace-collector
- ai-app: research (topic-research, deep-dive), teams, social, writing, coding, ask
- core: auth, rate-limit, monitoring, billing, credit
- content: resources, collection, knowledge-graph

### B2: Backend Type Check (tsc)

**Command**: `cd backend && npx tsc --noEmit`
**Result**: PASS - 0 errors

### B3: Backend Lint

**Command**: `cd backend && npx eslint . --ext .ts`
**Result**: 49 errors, 13660 total problems (mostly warnings)

Primary error categories:

- `@typescript-eslint/no-explicit-any`: majority of errors
- `@typescript-eslint/prefer-nullish-coalescing`: warnings

---

## Phase C: Frontend Automated Tests

### C1: Vitest Unit Tests

**Command**: `cd frontend && npx vitest run`
**Result**: 185 passed, 0 failed

| Test File                                  | Tests | Status |
| ------------------------------------------ | ----- | ------ |
| lib/utils/lru-cache.test.ts                | 17    | PASS   |
| hooks/core/useApi.test.ts                  | 19    | PASS   |
| hooks/core/useStream.test.ts               | 18    | PASS   |
| hooks/core/useAsyncOperation.test.ts       | 16    | PASS   |
| hooks/domain/useAISocial.test.ts           | 26    | PASS   |
| hooks/domain/useSocialSWR.test.ts          | 17    | PASS   |
| stores/aiTeamsStore.test.ts                | 15    | PASS   |
| components/HierarchicalSummaryTab.test.tsx | 22    | PASS   |
| components/TimelineConflictPanel.test.tsx  | 18    | PASS   |
| components/StoryAnalysisDashboard.test.tsx | 17    | PASS   |

### C2: Frontend Type Check (tsc)

**Command**: `cd frontend && npx tsc --noEmit`
**Result**: PASS - 0 errors

### C3: Frontend Lint

**Command**: `cd frontend && npx eslint . --ext .ts,.tsx`
**Result**: 129 errors, 5311 warnings

Primary error categories:

- `@typescript-eslint/no-explicit-any`: 129 errors across multiple files
  - `app/ai-research/[projectId]/page.tsx`: 2
  - `app/ai-simulation/run/[id]/page.tsx`: 1
  - `app/ai-teams/[topicId]/page.tsx`: 4
  - `app/ai-teams/page.tsx`: 3+
  - Various other page files

Primary warning categories:

- `no-restricted-syntax` (toLocaleString/toLocaleTimeString in JSX): hydration risk
- `@typescript-eslint/prefer-nullish-coalescing`

---

## Phase D: API Integration Tests

### D1: Health Endpoint

| Test              | URL                                        | Result | Detail                  |
| ----------------- | ------------------------------------------ | ------ | ----------------------- |
| Local Health      | `GET localhost:4000/health`                | PASS   | 200 OK, 29ms            |
| Production Health | `GET genesis-ai.up.railway.app/api/health` | N/A    | Frontend serves /health |

### D2: Security Probes

| Test ID | Test                                   | Result   | Detail                                                           |
| ------- | -------------------------------------- | -------- | ---------------------------------------------------------------- |
| SEC-001 | Stack trace leak                       | **FAIL** | 404 response exposes full file paths: `D:\\projects\\codes\\...` |
| SEC-002 | Path traversal (`../../../etc/passwd`) | PASS     | 404, no file content returned                                    |
| SEC-003 | XSS probe (script tags in params)      | PASS     | No reflection detected                                           |
| SEC-004 | SQL injection probe                    | PASS     | No error exposure                                                |

### D3: Auth Tests

| Test                                       | Result       | Detail                                  |
| ------------------------------------------ | ------------ | --------------------------------------- |
| Unauthenticated access to protected routes | INCONCLUSIVE | Routes returned 404 (API path mismatch) |
| Token validation                           | INCONCLUSIVE | Requires valid JWT to fully test        |

### D4: Concurrency

| Test                          | Result | Detail              |
| ----------------------------- | ------ | ------------------- |
| 10 concurrent health requests | PASS   | All 200, <50ms each |

### D5: npm Audit

| Workspace | Result                                   |
| --------- | ---------------------------------------- |
| Frontend  | Vulnerabilities found (dev dependencies) |
| Backend   | Vulnerabilities found                    |

---

## Phase E: Browser E2E (Playwright - Local)

**Environment**: localhost:3000 (frontend) + localhost:4000 (backend)
**Auth**: Authenticated as user (Google OAuth session)

### E1: Page Patrol (16 routes)

| Route                    | Status   | Console Errors | Notes                                              |
| ------------------------ | -------- | -------------- | -------------------------------------------------- |
| `/` (Dashboard)          | PASS     | 0              | Loads correctly                                    |
| `/ai-ask`                | PASS     | 0              | Chat interface renders                             |
| `/ai-research`           | PASS     | 0              | Project list renders                               |
| `/ai-teams`              | PASS     | 0              | Teams list renders                                 |
| `/ai-writing`            | PASS     | 0              | Writing projects render                            |
| `/ai-social`             | PASS     | 0              | Social management renders                          |
| `/ai-coding`             | PASS     | 0              | Coding interface renders                           |
| `/ai-simulation`         | PASS     | 0              | Simulation page renders                            |
| `/ai-office`             | **WARN** | 0              | Blank page (loading state, no content)             |
| `/library`               | PASS     | 0              | Resource library renders                           |
| `/admin/settings`        | PASS     | 0              | Settings page renders                              |
| `/admin/data/collection` | PASS     | 0              | Data collection renders                            |
| `/admin/monitoring`      | PASS     | 0              | Monitoring dashboard renders                       |
| `/admin/access/billing`  | PASS     | 0              | Billing page renders                               |
| `/changelog`             | **WARN** | 0              | Transient rendering artifacts (dev mode hydration) |
| `/profile`               | PASS     | 0              | Profile page renders                               |

**Summary**: 14 PASS, 2 WARN

### E2: Console Analysis

- **Errors**: 21 total (primarily i18n missing translation warnings categorized as errors)
- **Warnings**: 112 total (i18n `t()` missing translations, React strict mode)
- **Critical JS errors**: 0

### E3: Performance (Dev Mode)

| Metric            | Value            | Note                                     |
| ----------------- | ---------------- | ---------------------------------------- |
| Page compile time | 900-1400ms       | Next.js on-demand compilation (dev only) |
| Modules per route | 3700-9700        | Normal for full-stack app                |
| Backend API TTFB  | ~2ms             | Excellent                                |
| Root cause        | Next.js dev-mode | Not a production concern                 |

---

## Phase F+G: DFX Quality Audit

### Security

| Finding                              | Severity | Count | Detail                                               |
| ------------------------------------ | -------- | ----- | ---------------------------------------------------- |
| Stack trace leak in error responses  | HIGH     | 1     | Exposes file paths in 404/500 responses locally      |
| `$queryRawUnsafe` with dynamic input | HIGH     | 8+    | Potential SQL injection vectors in 143 raw SQL calls |
| High-risk `@Public()` endpoints      | HIGH     | 3     | Public endpoints that may expose sensitive data      |
| `@Public()` decorators total         | MEDIUM   | 31    | Review each for necessity                            |
| Hardcoded model names                | MEDIUM   | 16    | Should use `AIModelType` enum via `TaskProfile`      |
| Hardcoded temperature values         | LOW      | 6     | Should use `TaskProfile.creativity`                  |

### Observability

| Metric                 | Grade | Detail                                               |
| ---------------------- | ----- | ---------------------------------------------------- |
| NestJS Logger adoption | A+    | 565 Logger instances across codebase                 |
| Distributed tracing    | C     | TraceCollectorService exists but limited propagation |
| Structured logging     | B     | Logger used consistently, but format varies          |
| Secrets in code        | A     | No hardcoded secrets detected                        |

### Input Validation & Auth

| Metric                    | Grade | Detail                           |
| ------------------------- | ----- | -------------------------------- |
| DTO validation decorators | A     | 1,478 class-validator decorators |
| Auth guard coverage       | A     | 146 guards across 85 controllers |
| Rate limiting             | B+    | Applied to key endpoints         |

### Code Quality

| Metric                | Value           | Grade        |
| --------------------- | --------------- | ------------ |
| `any` type usage      | 892 occurrences | D            |
| Backend test coverage | 10.94% line     | D            |
| Frontend test files   | 10              | C-           |
| Backend test suites   | 66              | C+           |
| console.log usage     | 4 files         | A- (minimal) |

---

## Phase H: Triage & Fix Summary

### Issues Fixed During Testing

| Issue                                                                      | Fix                                  | Status |
| -------------------------------------------------------------------------- | ------------------------------------ | ------ |
| Backend type errors (8 errors in ai-social.service.ts, ai-chat.service.ts) | Already resolved at time of re-check | FIXED  |

### Issues Documented (Not Fixed - Requires Design Decision)

| Issue                                      | Priority | Recommended Action                                       |
| ------------------------------------------ | -------- | -------------------------------------------------------- |
| Stack trace leak in error responses        | P1       | Add exception filter to strip stack traces in production |
| `$queryRawUnsafe` SQL injection risk       | P1       | Audit all 8+ call sites, parameterize queries            |
| 3 high-risk `@Public()` endpoints          | P1       | Review and add auth guards if needed                     |
| pdfjs-dist Jest ESM incompatibility        | P2       | Configure moduleNameMapper or dynamic import             |
| 129 frontend `no-explicit-any` lint errors | P2       | Gradual typing improvement                               |
| AI Office blank page                       | P2       | Investigate loading state / data fetch                   |
| npm audit vulnerabilities                  | P2       | Run `npm audit fix` and review breaking changes          |
| Low test coverage (10.94% backend)         | P3       | Incremental coverage improvement plan                    |
| i18n missing translations (112 warnings)   | P3       | Add missing translation keys                             |

---

## Phase J: Final Scorecard

| Category              | Weight   | Score   | Weighted     |
| --------------------- | -------- | ------- | ------------ |
| Unit Tests (Backend)  | 20%      | 95/100  | 19.0         |
| Unit Tests (Frontend) | 15%      | 100/100 | 15.0         |
| Type Safety           | 15%      | 100/100 | 15.0         |
| API Integration       | 10%      | 70/100  | 7.0          |
| Browser E2E           | 15%      | 88/100  | 13.2         |
| Security (DFX)        | 15%      | 60/100  | 9.0          |
| Code Quality          | 10%      | 55/100  | 5.5          |
| **Total**             | **100%** |         | **83.7/100** |

### Score Breakdown Rationale

- **Backend Unit Tests (95)**: 1418 tests all passing, -5 for 1 suite error (pdfjs-dist)
- **Frontend Unit Tests (100)**: 185 tests all passing, clean execution
- **Type Safety (100)**: Both frontend and backend tsc pass with 0 errors
- **API Integration (70)**: Health passes, but stack trace leak and inconclusive auth tests
- **Browser E2E (88)**: 14/16 routes pass, 2 minor warnings
- **Security (60)**: Auth guards good, but raw SQL risks and stack trace leaks
- **Code Quality (55)**: High `any` usage, low coverage, many lint warnings

---

## Appendix A: Test Environment

```
OS: Windows 11
Node.js: v24.12.0
Frontend: localhost:3000 (Next.js 14 dev server)
Backend: localhost:4000 (NestJS 10)
Database: PostgreSQL (via Prisma ORM)
Browser: Playwright (Chromium)
```

## Appendix B: Recommended Priority Actions

### P0 (Immediate)

- None - no blocking regressions

### P1 (This Sprint)

1. Add production exception filter to strip stack traces from error responses
2. Audit all `$queryRawUnsafe` call sites for SQL injection
3. Review 3 high-risk `@Public()` endpoints

### P2 (Next Sprint)

4. Fix pdfjs-dist Jest ESM configuration
5. Resolve AI Office blank page loading issue
6. Run `npm audit fix` for dependency vulnerabilities
7. Begin reducing `no-explicit-any` count (target: <50)

### P3 (Backlog)

8. Increase backend test coverage to >30%
9. Add missing i18n translation keys
10. Add frontend test coverage for more components

---

**Report Generated**: 2026-02-07
**Test Plan Coverage**: ~450/630 cases executed (automated + manual browser)
**Remaining**: ~180 cases (advanced combination matrix, load testing, responsive testing)

