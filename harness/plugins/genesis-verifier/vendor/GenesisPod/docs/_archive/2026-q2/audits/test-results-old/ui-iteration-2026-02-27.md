# Full-Spectrum Test Report - 2026-02-27

**Commit**: 80535315 | **Branch**: main
**Focus**: CDN bypass fix verification + full test suite
**Execution Start**: 2026-02-27T00:00Z

## Executive Summary

- **Total Test Plan Cases**: ~735
- **Cases Executed**: 17,261 (unit) + 11 (CDN verification) + 6 (API) + 3 (static analysis)
- **Passed**: 17,261 | **Failed (new)**: 0 | **Known Failures**: 0 | **Skipped**: 0
- **Pass Rate**: 100%
- **Issues Found**: 0 new (CDN 503 incident already resolved in commits ccb268a9, cf2a7fd8, 60186dfc, 80535315)
- **Circuit Breaker Triggered**: No
- **Execution Time**: ~85s (backend) + ~5s (frontend) + CDN verification

## CDN Bypass Fix Verification (Priority)

| #   | Test                           | Status   | Details                                                          |
| --- | ------------------------------ | -------- | ---------------------------------------------------------------- |
| 1   | Frontend Homepage (CDN)        | **PASS** | HTTP 200, 0.25s                                                  |
| 2   | Backend Direct Health          | **PASS** | HTTP 200, 0.88s                                                  |
| 3   | CORS Preflight (OPTIONS)       | **PASS** | HTTP 204                                                         |
| 4   | CORS Headers Correct           | **PASS** | `Access-Control-Allow-Origin: https://genesis-ai.up.railway.app` |
| 5   | OAuth Redirect                 | **PASS** | HTTP 302 → Google OAuth                                          |
| 6   | Auth Callback Page             | **PASS** | HTTP 200, 0.11s                                                  |
| 7   | CDN Proxy Status               | **503**  | Expected - CDN still rate-limited, but no longer used            |
| 8   | Direct /credits/balance        | **PASS** | HTTP 401 (auth required, not 503)                                |
| 9   | Direct /collections            | **PASS** | HTTP 401 (auth required, not 503)                                |
| 10  | Direct /resources/user/upvotes | **PASS** | HTTP 401 (auth required, not 503)                                |
| 11  | Deployed Commit Hash           | **PASS** | 80535315 confirmed                                               |

**Conclusion**: CDN bypass fix is working. All browser API calls now route directly to backend, completely bypassing the rate-limited CDN. Authentication endpoints respond correctly (401 for unauthenticated, not 503).

## Phase B: Backend Tests

### B1: Unit Tests

- **Suites**: 572 passed / 572 total
- **Tests**: 16,890 passed / 16,890 total
- **Time**: 79.6s

### B1: Coverage

| Metric     | Coverage               |
| ---------- | ---------------------- |
| Statements | 67.29% (64,730/96,195) |
| Branches   | 57.14% (30,789/53,878) |
| Functions  | 66.77% (10,151/15,202) |
| Lines      | 67.28% (61,647/91,618) |

### B3: Static Analysis

- **Backend Type Check**: PASS
- **Frontend Type Check**: PASS

### B4: Schema Validation

- Prisma schema: Valid (prisma validate requires --schema flag due to multi-file schema setup)

## Phase C: Frontend Tests

- **Suites**: 15 passed / 15 total
- **Tests**: 371 passed / 371 total
- **Time**: 4.42s

## Phase D: API Integration Tests

| Endpoint                       | Method  | Expected      | Actual | Status |
| ------------------------------ | ------- | ------------- | ------ | ------ |
| /api/v1/health                 | GET     | 200           | 200    | PASS   |
| /api/v1/credits/balance        | GET     | 401 (no auth) | 401    | PASS   |
| /api/v1/collections            | GET     | 401 (no auth) | 401    | PASS   |
| /api/v1/resources/user/upvotes | GET     | 401 (no auth) | 401    | PASS   |
| /api/v1/auth/google            | GET     | 302           | 302    | PASS   |
| CORS Preflight                 | OPTIONS | 204           | 204    | PASS   |

## Phase G: Security & Audit

### G2: npm audit

- **Backend**: 47 vulnerabilities (26 low, 9 moderate, 12 high)
  - High: webpack SSRF (dev dependency only, not production risk)
  - Fix available via `npm audit fix --force` (breaking change to @nestjs/cli@11)

## Incident Summary: CDN 503 Cascade Failure

### Root Cause Chain

```
commit 47bdb0cb: RequestLoggerInterceptor added globally
  → setHeader() after OAuth 302 redirect (headers already flushed)
    → ERR_HTTP_HEADERS_SENT → Node.js process crash
      → Backend restart loop → Fastly CDN rate limit triggered
        → ALL proxied requests return 503
          → SWR retry storms amplify CDN pressure
            → AuthContext treats 503 as token invalid → users logged out
```

### Fixes Applied (4 commits)

| Commit   | Fix                                   | Impact                           |
| -------- | ------------------------------------- | -------------------------------- |
| ccb268a9 | `headersSent` guard in interceptor    | Prevents backend crash           |
| cf2a7fd8 | Auth callback uses direct backend URL | Login works during CDN outage    |
| 60186dfc | AuthContext: only clear tokens on 401 | CDN 503 no longer logs out users |
| 80535315 | **All browser API calls bypass CDN**  | Permanent CDN independence       |

### Architecture Change

- **Before**: Browser → CDN → Next.js proxy → Backend (vulnerable to CDN rate limits)
- **After**: Browser → Backend directly (CORS configured, CDN bypassed for API calls)
- **Files changed**: `frontend/lib/utils/config.ts`, `frontend/lib/api/client.ts`

## Quality Gate

- [x] P0 test pass rate: 100%
- [x] P1 test pass rate: 100%
- [x] Code coverage: 67.29% (>50% threshold)
- [ ] No high npm vulnerabilities (12 high - webpack dev dependency)
- [x] Type check clean
- [x] Build successful (pre-push hook passed)
- [x] No new regressions
- [x] CDN bypass fix verified on production

## Comparison with Previous Run

| Metric           | Previous (2026-02-07) | Current (2026-02-27) | Delta |
| ---------------- | --------------------- | -------------------- | ----- |
| Backend Tests    | 16,890                | 16,890               | 0     |
| Frontend Tests   | 371                   | 371                  | 0     |
| Pass Rate        | 100%                  | 100%                 | 0%    |
| New Issues       | 0                     | 0                    | 0     |
| Coverage (Stmts) | ~67%                  | 67.29%               | ~0%   |
