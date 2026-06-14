Full-Spectrum Test Verification: Autonomous test execution covering unit tests, integration, combination matrix, performance, DFX, security, browser E2E, and best practices - with iterative fix loop.

## Context

You are a **full-spectrum test orchestrator**. You have access to:

- **Codebase**: Full read/write for fixing issues
- **Test Runners**: Jest (backend), Vitest (frontend) via Bash
- **Browser Automation**: Playwright MCP (primary), Chrome DevTools MCP (fallback)
- **API Testing**: curl/fetch for direct API calls
- **Static Analysis**: TypeScript compiler, ESLint, npm audit

## References

- **Master Test Plan**: `docs/guides/testing/test-cases/comprehensive-test-suite-2026-02-17.md`
- **Previous Baseline**: `docs/guides/testing/test-cases/comprehensive-combination-test-2026-01-25.md`
- **UI Patrol Config**: `.ui-patrol/config.yaml`
- **Page Specs**: `.ui-patrol/specs/*.yaml`
- **Journey Definitions**: `.ui-patrol/journeys/*.yaml`
- **Scenario Definitions**: `.ui-patrol/scenarios/*.yaml`
- **Test Output Directory**: `docs/guides/testing/test-results/`

## Test Environment

- **Local URL**: http://localhost:3000
- **Production URL**: https://genesis-ai.up.railway.app (frontend) / https://genesis-ai-backend.up.railway.app (backend API)
- **Backend Port**: 4000 (local)

> Default to **Production URL** for browser tests. Use local for unit/integration tests.

---

## Automated Iteration Loop

Execute **fully autonomously**. The human only starts the process and receives the final report. The loop covers **all 8 dimensions** from the master test plan.

### Timeout Controls

Apply strict timeouts to prevent infinite hangs:

| Scope                        | Timeout     | Action on Timeout                          |
| ---------------------------- | ----------- | ------------------------------------------ |
| **Total execution**          | 60 minutes  | Stop all phases, write partial report      |
| **Phase B** (Backend tests)  | 10 minutes  | Kill Jest, record partial results          |
| **Phase C** (Frontend tests) | 5 minutes   | Kill Vitest, record partial results        |
| **Phase D** (API tests)      | 5 minutes   | Skip remaining endpoints                   |
| **Phase E** (Browser E2E)    | 20 minutes  | Skip remaining journeys                    |
| **Phase F** (Performance)    | 10 minutes  | Skip remaining benchmarks                  |
| **Phase G** (DFX quality)    | 5 minutes   | Skip remaining audits                      |
| **Single unit test**         | 30 seconds  | Mark as TIMEOUT                            |
| **Single API call**          | 60 seconds  | Mark as TIMEOUT                            |
| **Single E2E journey step**  | 120 seconds | Mark step as TIMEOUT, skip rest of journey |

### Circuit Breaker (Early Termination)

Stop wasting time when fundamental problems exist:

| Condition                                         | Action                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tsc --noEmit` errors > 10 (backend or frontend)  | **ABORT** Phases D/E/F/G. Only output static analysis report + Phase H fixes for type errors. |
| Backend unit test failure rate > 30%              | **SKIP** Phases D/E/F. Go directly to Phase H for unit test fixes, then retry B.              |
| Browser: homepage returns white screen / HTTP 5xx | **SKIP** all E2E (Phase E). Mark all browser tests as `BLOCKED(app-down)`.                    |
| Auth setup (Phase A1) fails completely            | **SKIP** all auth-required tests. Continue with non-auth tests only.                          |
| Phase H fix attempt causes new type errors        | **ROLLBACK** the fix immediately (`git checkout -- {file}`). Do not retry same fix.           |

When circuit breaker triggers, record the reason in the report header and jump to Phase J for partial report.

### Phase A0: Environment Auto-Detection

Before any testing, verify the environment:

1. **Port check**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health`
2. **Frontend route discovery**: List all route directories under `frontend/app/` to build the full page inventory
3. **API endpoint discovery**: Grep `@Controller` decorators from `backend/src/modules/` to discover all registered API prefixes
4. **Environment snapshot**: Record which services are up, route count, and endpoint count in the report header

If local services are not running, default to Production URL for all tests.

---

### Phase A1: Authentication Setup

Before any authenticated tests, establish a valid session:

1. **Environment variable check**: Look for `TEST_AUTH_TOKEN` in `.env.test` or environment
2. **API login attempt**: If no token, try `POST {BASE_URL}/api/auth/login` with test credentials from `.env.test` (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`)
3. **Browser OAuth fallback**: If API login fails, use Playwright MCP to navigate to login page, complete OAuth flow, and extract token from cookies/localStorage
4. **Token validation**: Verify obtained token with `GET {BASE_URL}/api/auth/me` → expect 200 with user info
5. **Store token**: Save as `AUTH_TOKEN` for all subsequent Phase D/E/F authenticated requests
6. **Fallback**: If all methods fail, mark all auth-required tests as `SKIP(no-auth)` and record in report. **Do NOT block non-auth tests.**

**Auth-required test count**: ~80 tests in D2, E2 journeys, F2 API timing. Without auth, these are all SKIP.

---

### Phase A2: Test Data Setup

Prepare test data for E2E and integration tests:

```bash
# Seed test data if local environment is available
npm run db:seed:ui-patrol 2>&1 | tail -10
```

If seed command fails or not available, proceed without — tests should handle missing data gracefully.

> **Cleanup**: `npm run db:clean:ui-patrol` runs in Phase J (after all tests complete).

---

### Phase A: Initialize & Plan

1. Read the master test plan at `docs/guides/testing/test-cases/comprehensive-test-suite-2026-02-17.md`
2. Get the current git commit hash: `git rev-parse --short HEAD`
3. Create a **dated report** at `docs/guides/testing/test-results/ui-iteration-{YYYY-MM-DD}.md` with header:

   ```markdown
   # Full-Spectrum Test Report - {date}

   **Commit**: {hash} | **Branch**: {branch}
   **Test Plan Ref**: comprehensive-test-suite-2026-02-17.md (~735 cases)
   **Execution Start**: {timestamp}
   ```

4. Initialize the **coverage tracker** - a table mapping each test plan ID to PASS/FAIL/SKIP status

---

### Phase B: Backend Automated Tests

Run backend tests using Jest. These cover **Section 2.1 (AI Engine)**, **2.4 (Core)**, and parts of **2.2 (AI Apps)** from the test plan.

#### B1: Unit Tests

```bash
cd backend && npx jest --verbose --coverage 2>&1 | head -200
```

> **Note**: `ENG-*` and `FE-*` IDs are unit test IDs from the backend/frontend test suites. They are NOT in the new `comprehensive-test-suite-2026-02-17.md` (which focuses on functional/E2E cases), but are still executed and tracked.

**Map results to test plan IDs:**

- `ai-chat.service.spec.ts` → ENG-LLM-001~010
- `task-profile-mapper.service.spec.ts` → ENG-TPM-001~012
- `model-fallback.service.spec.ts` → ENG-MFB-001~004
- `circuit-breaker.service.spec.ts` → ENG-CB-001~007
- `long-term-memory.service.spec.ts` → ENG-MEM-003~005
- `function-calling-executor.spec.ts` → ENG-ORC-004
- `execution-state.manager.spec.ts` → ENG-ORC-005
- `cost-controller.spec.ts` → ENG-CST-001~002
- `rate-limiter.spec.ts` → ENG-CST-003~004
- `agent-orchestrator.spec.ts` → ENG-TL-001~002
- `ai-engine.facade.spec.ts` → ENG-FAC-001~003
- `short-term-memory.service.spec.ts` → ENG-MEM-001~002
- `conversation-memory.service.spec.ts` → ENG-MEM-006~007
- `long-term-memory.service.spec.ts` → ENG-MEM-003~005
- `in-memory-store.spec.ts` → ENG-MEM-008
- `sequential-executor.spec.ts` → ENG-ORC-001
- `parallel-executor.spec.ts` → ENG-ORC-002
- `dag-executor.spec.ts` → ENG-ORC-003
- `function-calling-executor.spec.ts` → ENG-ORC-004
- `execution-state.manager.spec.ts` → ENG-ORC-005
- `checkpoint-manager.spec.ts` → ENG-ORC-006
- `task-decomposer.spec.ts` → ENG-ORC-007
- `token-budget.spec.ts` → ENG-ORC-008
- `context-compression.spec.ts` → ENG-ORC-009, TMS-017
- `intent-detection.spec.ts` → ENG-ORC-010
- `guardrails-pipeline.spec.ts` → ENG-CST-005
- `skill-registry.spec.ts` → ENG-SK-001~002
- `evidence-manager.service.spec.ts` → RES-013
- `prompt-sanitizer.spec.ts` → RES-014
- `data-source-router.spec.ts` → RES-010
- `research-leader.spec.ts` → RES-011
- `research-reviewer.spec.ts` → RES-012
- `mission-execution.spec.ts` → RES-015
- `mission-health-check.spec.ts` → RES-016
- `mission-orchestrator.spec.ts` → TMS-016
- `context-router.spec.ts` → TMS-018
- `checkpoint.service.spec.ts` → WRT-007, OFC-004
- `chapter-dependency.spec.ts` → WRT-008
- `quality-gate.spec.ts` → WRT-009
- `style-template.spec.ts` → WRT-010
- `consistency-engine.spec.ts` → WRT-015
- `temporal-conflict-analyzer.spec.ts` → WRT-014
- `slides-leader.spec.ts` → OFC-002
- `slides-health-check.spec.ts` → OFC-006
- `prompt-enhancer.spec.ts` → IMG-002
- `auth.service.spec.ts`, `jwt.strategy.spec.ts` → AUTH-001~005
- `admin.service.spec.ts` → ADM-001~003
- `credit.service.spec.ts` → CRD-001~004
- `resource.service.spec.ts` → RES-R-001~004

Record: total tests, passed, failed, coverage percentages.

**Known Failures Registry**: Separate test failures into two categories:

- **Known failures**: Tests matching patterns in the known failures list below. Record as `KNOWN_FAIL` (not counted toward failure rate). These are pre-existing issues tracked separately.
- **New failures**: All other failures. These trigger Phase H triage.

Current known failures (update this list as issues are resolved):

- `mcp-server.*.spec.ts` — 21 tests with timeout issues (MCP server integration)

If any **new test failure** (not in known failures list), proceed to Phase H (Triage & Fix) immediately for that test before continuing.

#### B2: Quick Test (Skipping Slow Tests)

```bash
cd backend && npm run test:quick 2>&1 | tail -30
```

This validates the fast-path tests excluded from full suite. Record results.

#### B3: Static Analysis

Run in parallel:

```bash
# Type check - backend
cd backend && npx tsc --noEmit 2>&1 | tail -20

# Type check - frontend
cd frontend && npx tsc --noEmit 2>&1 | tail -20

# Lint check
npm run lint 2>&1 | tail -20
```

**Map to test plan IDs:**

- Type check pass → DFX-M-002
- Lint pass → DFX-M-003
- Build success → DFX-M-004

Record results. Any failure → Phase H.

#### B4: Database Schema Validation

```bash
# Validate Prisma schema syntax
cd backend && npx prisma validate 2>&1

# Check for pending migrations (schema drift)
cd backend && npx prisma migrate status 2>&1 | tail -10
```

Record: schema valid (yes/no), pending migrations count. Schema validation failure is P1 severity.

---

### Phase C: Frontend Automated Tests

Run frontend tests using Vitest. These cover **Section 2.5 (Frontend Components/Hooks)**.

> **Note**: `FE-*` IDs are frontend unit test IDs. They are NOT in the new `comprehensive-test-suite-2026-02-17.md` (which focuses on functional/E2E cases), but are still executed and tracked.

```bash
cd frontend && npx vitest run --reporter=verbose 2>&1 | head -200
```

**Map results to test plan IDs:**

- `useApi.test.ts` → FE-HK-001~003
- `useStream.test.ts` → FE-HK-004~005
- `useAsyncOperation.test.ts` → FE-HK-006
- `useAISocial.test.ts` → FE-DM-001
- `useSocialSWR.test.ts` → FE-DM-002
- `aiTeamsStore.test.ts` → FE-ST-001~002
- `HierarchicalSummaryTab.test.tsx` → FE-CP-006
- `StoryAnalysisDashboard.test.tsx` → FE-CP-007
- `TimelineConflictPanel.test.tsx` → FE-CP-008
- `lru-cache.test.ts` → ENG-MEM-008

**Check for missing P0 tests** (from test plan):

- FE-CP-001~003 (ResearchTimeline) - if missing, flag as SKIP with note "test file needed"
- FE-CP-004~005 (TopicContentPanel) - if missing, flag as SKIP with note "test file needed"

Record results. Any failure → Phase H.

#### C2: Frontend Coverage Gap Analysis

Identify untested critical components:

1. List all directories under `frontend/components/` and `frontend/app/`
2. Cross-reference with existing `*.test.{ts,tsx}` files
3. Calculate component test coverage ratio: `{tested_components} / {total_components}`
4. Flag **P0 components without tests** (components in pages that handle core user flows):
   - `frontend/components/ai-ask/` — main Ask page components
   - `frontend/components/ai-research/` — research topic components
   - `frontend/components/ai-teams/` — teams collaboration components
   - `frontend/components/library/` — knowledge base components
5. Record gap list in report section "Gaps & Recommendations"

This is **analysis only** — do not create test files during this phase.

---

### Phase D: API Integration Tests

Test API endpoints directly. Covers **Section 2.2~2.4** integration tests and **Section 3.2 (Auth chain)**.

#### D0: API Route Discovery

Before testing API endpoints, verify actual routes:

1. Grep `@Controller` + `@Get/@Post/@Put/@Delete` decorators from `backend/src/modules/` to discover registered routes
2. Validate that D1/D2 test URLs match actual registered controller paths
3. If paths have changed (e.g., controller renamed), adjust test URLs dynamically
4. Record discovered vs expected route mismatches in the report

#### D1: Health & Auth Chain

```bash
# Health check → DFX-O-005
curl -s -o /dev/null -w "%{http_code}" {BASE_URL}/api/health

# Unauthenticated access → AUT-TKN-001
curl -s -o /dev/null -w "%{http_code}" {BASE_URL}/api/ai-ask/conversations

# Invalid token → AUT-TKN-002
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer invalid-token" {BASE_URL}/api/ai-ask/conversations
```

Expected: Health=200, Unauth=401, Invalid=401.

#### D2: Core AI APIs (with valid auth)

If authenticated session available, test:

```
GET  /api/ai-ask/conversations     → ASK-SES-002 (history list)
GET  /api/ai-research/topics       → RES-PRJ-001 (topic list)
GET  /api/ai-teams/topics          → TMS-TOP-001 (teams list)
GET  /api/ai-writing/projects      → WRT-PRJ-001 (writing list)
GET  /api/resources/libraries       → LIB-RES-001 (knowledge base list)
GET  /api/credits/balance           → ADM-CRD-001 (credits check)
```

Verify: HTTP 200, valid JSON response, no error fields.

#### D3: Security Probes

```bash
# XSS probe → DFX-SEC-001
# Send <script>alert(1)</script> as message and verify it's escaped in response

# SQL injection probe → DFX-SEC-002
# Send ' OR 1=1 -- as search query and verify no data leak

# Path traversal → DFX-SEC-015
# Request /api/resources/../../etc/passwd and verify 400/404

# SSRF probe → DFX-SEC-014
# Submit http://localhost:6379 as URL fetch target, verify rejection

# File upload security → DFX-SEC-007
# Check if .exe upload is rejected
```

Record each result. Any security failure is **P0 severity**.

---

### Phase E: Browser E2E Tests

Use **Playwright MCP** for all browser automation. Fall back to Chrome DevTools MCP only if Playwright is unavailable. Covers **Section 2.2 (AI Apps UI)**, **Section 3.1 (combinations)**, **Section 3.3 (E2E scenarios)**, and **Section 5.6 (responsive)**.

#### E0: UI Patrol Runner (Preferred Path)

**Before manual Playwright steps**, attempt to use the existing UI Patrol runner infrastructure:

```bash
# Try critical route patrol first (uses existing specs + runner)
npm run ui-patrol:critical 2>&1 | tail -50

# If critical patrol succeeds, run journey tests
npm run ui-patrol:journeys 2>&1 | tail -50
```

**If UI Patrol runners succeed**: Parse their JSON output from `.ui-patrol/reports/`, map results to test plan IDs, and **skip manual E1/E2 steps** for routes already covered by the runner.

**If UI Patrol runners fail or are unavailable**: Fall back to manual Playwright MCP steps below (E1~E4).

**Hybrid approach**: For routes covered by UI Patrol runner, use runner results. For routes NOT covered or needing deeper verification, use manual Playwright MCP.

#### E1: Page Loading Patrol (All Routes)

For each route group in `.ui-patrol/config.yaml`:

1. Navigate to the route
2. Take accessibility snapshot
3. Check for:
   - No blank/white screen
   - No console errors
   - No forbidden patterns (`[object Object]`, `undefined`, `NaN`, `Error`)
   - Expected structure from `.ui-patrol/specs/*.yaml`
4. Record PASS/FAIL

**Map to test plan IDs:**

- `/ai-ask` → ASK-SES-001 (page loads)
- `/ai-research` → RES-PRJ-001 (page loads)
- `/ai-teams` → TMS-TOP-001 (page loads)
- `/ai-writing` → WRT-PRJ-001 (page loads)
- `/ai-image` → IMG-GEN-001 (page loads)
- `/ai-office` → OFC-SLD-001 (page loads)
- `/ai-social` → SOC-CON-001 (page loads)
- `/library` → LIB-RES-001 (page loads)
- `/library/rag` → RAG-KB-001 (RAG management)
- `/explore` → EXP-UNI-001 (page loads; Note: EXP- prefix changed from Explore to Export in new suite. Explore page load verified manually.)
- `/credits` → ADM-CRD-003 (credits page)
- `/admin/*` → ADM-USR-001~003 (admin pages)

**Use parallel Task agents** for independent page groups (core, teams, content, admin).

#### E2: Functional Journey Tests

Execute each journey in `.ui-patrol/journeys/*.yaml`:

| Journey File                              | Test Plan Coverage                                |
| ----------------------------------------- | ------------------------------------------------- |
| `ai-ask-conversation.journey.yaml`        | ASK-SES-001~005, ASK-MSG-001~010, CMB-ASK-001~010 |
| `ai-ask-combination-matrix.journey.yaml`  | CMB-ASK-001~010                                   |
| `ai-ask-mixture.journey.yaml`             | ASK-MIX-001, CMB-ASK-007, CMB-ASK-010             |
| `create-research-topic.journey.yaml`      | RES-PRJ-001~006, E2E-001                          |
| `ai-teams-collaboration.journey.yaml`     | TMS-TOP-001~005, TMS-MBR-001~005, E2E-003         |
| `ai-writing-workflow.journey.yaml`        | WRT-PRJ-001~005, WRT-VOL-001~005, E2E-004         |
| `ai-office-slides.journey.yaml`           | OFC-SLD-001~005, OFC-THM-001~002, E2E-005         |
| `ai-image-generation.journey.yaml`        | IMG-GEN-001~006, IMG-STR-001~002, IMG-HIS-001~004 |
| `knowledge-base-to-ask.journey.yaml`      | INT-LIB-ASK-001~003, INT-RAG-ASK-001~002, E2E-002 |
| `explore-to-library-to-ask.journey.yaml`  | INT-EXP-LIB-001~003, E2E-006                      |
| `cross-module-data-flow.journey.yaml`     | INT-RES-LIB-001~003, INT-TMS-RES-001~002          |
| `ai-social-content.journey.yaml`          | SOC-CON-001~005, SOC-CNT-001~006                  |
| `ai-rag-knowledge.journey.yaml`           | RAG-KB-001~005, RAG-DOC-001~004, RAG-QRY-001~004  |
| `e2e-new-user-onboarding.journey.yaml`    | E2E-007                                           |
| `e2e-image-writing-workflow.journey.yaml` | E2E-008                                           |
| `search-library.journey.yaml`             | LIB-RES-002~006                                   |
| `research-topic-all-tabs.journey.yaml`    | RES-TAB-001~005                                   |
| `admin-monitoring-check.journey.yaml`     | ADM-USR-001~003                                   |

For each journey:

1. Execute steps sequentially
2. Verify assertions at each step
3. Record PASS/FAIL per step and overall

#### E3: Boundary & Edge Case Tests

Execute boundary scenarios from `.ui-patrol/scenarios/boundary-conditions.scenarios.yaml`:

| Scenario           | Test Plan ID | Input                       | Expected                    |
| ------------------ | ------------ | --------------------------- | --------------------------- |
| Empty message      | BND-INP-001  | `""`                        | Prompt to enter content     |
| Ultra-long message | BND-INP-002  | 10000 chars                 | Process or truncate warning |
| XSS in input       | BND-INP-003  | `<script>alert(1)</script>` | Escaped, not executed       |
| Unicode/emoji      | BND-INP-004  | Mixed languages + emoji     | Display correctly           |
| Whitespace only    | BND-INP-005  | `"   "`                     | Prompt to enter content     |
| Markdown injection | BND-INP-006  | `# **bold** \`code\``       | Render correctly            |
| Empty file         | BND-FIL-001  | 0-byte file                 | Friendly error              |
| Oversized file     | BND-FIL-002  | >10MB                       | Size limit warning          |
| Unsupported format | BND-FIL-003  | .exe file                   | Format rejection            |

#### E4: Responsive Design Tests

Test 4 key pages (`/ai-ask`, `/ai-research`, `/ai-teams`, `/ai-writing`) at 5 viewports using Playwright MCP viewport commands:

```javascript
// For each page x viewport combination:
await mcp__playwright__browser_resize({ width, height });
await mcp__playwright__browser_navigate({ url: `{BASE_URL}{route}` });
await mcp__playwright__browser_snapshot();
// Verify: no horizontal overflow, no overlapping elements, navigation accessible
```

| Viewport         | Test Plan ID | Width | Height | Pass Criteria                                          |
| ---------------- | ------------ | ----- | ------ | ------------------------------------------------------ |
| Desktop 1080p    | DFX-RES-001  | 1920  | 1080   | Full layout, sidebar visible, no overflow              |
| Desktop 768p     | DFX-RES-002  | 1366  | 768    | Layout adapts, all content accessible                  |
| Tablet Landscape | DFX-RES-003  | 1024  | 768    | Sidebar may collapse, content readable                 |
| Tablet Portrait  | DFX-RES-004  | 768   | 1024   | Single column or collapsible nav, no horizontal scroll |
| Mobile SE        | DFX-RES-005  | 375   | 667    | Mobile layout, hamburger menu, touch-friendly targets  |

**Total**: 4 pages x 5 viewports = 20 test cases. Each PASS/FAIL individually.

**Fail criteria**: Horizontal scrollbar appears, text truncated without ellipsis, overlapping UI elements, navigation inaccessible, touch targets <44px.

#### E5: i18n Verification

The project supports bilingual (zh-CN / en-US). Verify translation completeness:

1. **English mode check**: Navigate to 5 key pages (`/ai-ask`, `/ai-research`, `/ai-teams`, `/ai-writing`, `/library`) with `?lng=en` or locale switch
   - Scan accessibility snapshot for **untranslated Chinese characters** (regex: `[\u4e00-\u9fff]` in UI text, excluding user-generated content)
   - Scan for **raw translation keys** leaked to UI (patterns: `t('`, `i18n.`, `.key_name`)
2. **Chinese mode check**: Navigate to same 5 pages with `?lng=zh`
   - Verify no English-only placeholder text in form fields
   - Verify dates/numbers use locale-appropriate formatting
3. Record findings per page. Any untranslated string in a P0 page is P2 severity.

**Map to**: i18n coverage (not in numbered test plan, but tracked in `.ui-patrol/journeys/full-site-i18n-check.journey.yaml`)

---

### Phase F: Performance Tests

Covers **Section 4 (Performance)** from the test plan.

#### F1: Page Load Performance

For each critical page, measure via browser automation:

```javascript
// Collect performance metrics
const perf = performance.getEntriesByType("navigation")[0];
const fcp = performance.getEntriesByName("first-contentful-paint")[0];
```

| Page         | Test Plan ID    | FCP Target | TTI Target |
| ------------ | --------------- | ---------- | ---------- |
| /ai-ask      | PERF-RT-013~014 | <2s        | <3s        |
| /ai-research | PERF-RT-013~014 | <2s        | <3s        |
| /ai-teams    | PERF-RT-013~014 | <2s        | <3s        |
| /ai-writing  | PERF-RT-013~014 | <2s        | <3s        |
| /library     | PERF-RT-013~014 | <2s        | <3s        |

#### F2: API Response Time

Time key API calls using curl or browser timing:

```bash
# Measure TTFB for each endpoint
curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s Total: %{time_total}s" {BASE_URL}/{endpoint} -H "Auth..."
```

| API                             | Test Plan ID | P50 Target | P90 Target |
| ------------------------------- | ------------ | ---------- | ---------- |
| Ask TTFB (short question)       | PERF-RT-001  | <2s        | <3s        |
| Ask stream complete (200 words) | PERF-RT-002  | <10s       | <15s       |
| Mixture TTFB (4 models)         | PERF-RT-003  | <3s        | <5s        |
| Web search + AI response        | PERF-RT-004  | <5s        | <8s        |
| RAG search (10 docs)            | PERF-RT-005  | <3s        | <5s        |
| RAG search (100 docs)           | PERF-RT-006  | <5s        | <8s        |
| File upload 1MB                 | PERF-RT-007  | <5s        | <10s       |
| File upload 10MB                | PERF-RT-008  | <15s       | <25s       |
| Teams task start (4 Agent)      | PERF-RT-009  | <3s        | <5s        |
| Research plan generation        | PERF-RT-010  | <8s        | <12s       |
| Research single dimension       | PERF-RT-011  | <30s       | <45s       |
| Conversation list (100+)        | PERF-RT-012  | <1s        | <2s        |
| PPT generation (10 pages)       | PERF-RT-015  | <60s       | <90s       |
| Embedding 1000-word doc         | PERF-RT-016  | <3s        | <5s        |

Note: PERF-RT-013/014 (FCP/TTI) are measured in F1.

For API tests that require AI calls (PERF-RT-001~004, 009~011, 015), measure by timing the actual API call when possible. If auth not available, estimate from browser observation during E2 journey tests.

#### F3: Concurrent Request Test

```bash
# PERF-CC-001: 3 simultaneous Ask requests
for i in 1 2 3; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" {URL}/api/ai-ask/conversations &
done
wait

# PERF-CC-002: Mixed module concurrent (Ask + Teams + Research)
curl -s {URL}/api/ai-ask/conversations &
curl -s {URL}/api/ai-teams/topics &
curl -s {URL}/api/ai-research/topics &
wait

# PERF-CC-003: Multi-tab simulation (browser test)
# Open 3 tabs with same user, verify independent operation

# PERF-CC-004: Mixture 4-model concurrent (tested during ASK-007 journey)
```

All should return 200 with no timeouts and no data corruption.

#### F4: Throughput & Stress Tests

Covers PERF-TP-001~004, PERF-CC-005~007. Execute from `.ui-patrol/scenarios/throughput-resource.scenarios.yaml`:

| Test                          | Plan ID     | Target                  |
| ----------------------------- | ----------- | ----------------------- |
| Ask API sustained 1min        | PERF-TP-001 | >20 req/min             |
| Research API sustained 1min   | PERF-TP-002 | >5 tasks/min            |
| RAG search sustained 1min     | PERF-TP-003 | >30 queries/min         |
| File upload queue (10 files)  | PERF-TP-004 | All succeed             |
| Multi-user Ask (10 users)     | PERF-CC-005 | No QPS degradation      |
| Research + Writing concurrent | PERF-CC-006 | No resource competition |
| 20 WebSocket connections      | PERF-CC-007 | All connected           |

Note: TP/CC-005+ tests require load testing tools (k6/Artillery). If unavailable, verify via sequential rapid requests and record as PARTIAL.

#### F5: Resource Monitoring

> **Note**: PERF-RS resource monitoring tests are not in the new test suite (which focuses on functional tests). These are tracked via infrastructure monitoring.

Covers PERF-RS-001~006. Execute from `.ui-patrol/scenarios/throughput-resource.scenarios.yaml`:

| Test                  | Plan ID     | Threshold     |
| --------------------- | ----------- | ------------- |
| Idle backend memory   | PERF-RS-001 | <512MB        |
| Peak backend memory   | PERF-RS-002 | <1GB          |
| Memory leak (1h)      | PERF-RS-003 | Growth <10%   |
| Peak CPU utilization  | PERF-RS-004 | <80%          |
| DB connection pool    | PERF-RS-005 | Not exhausted |
| WebSocket memory/conn | PERF-RS-006 | <5MB each     |

Measurement methods:

- Memory: `process.memoryUsage()` via health endpoint or admin API
- CPU: Railway metrics dashboard or `os.cpuUsage()` endpoint
- DB connections: Prisma client pool metrics
- If metrics endpoints unavailable, flag as SKIP with note "needs monitoring endpoint"

#### F6: Large Data Volume Tests

Covers PERF-BD-001~008. Execute from `.ui-patrol/scenarios/throughput-resource.scenarios.yaml` and `.ui-patrol/scenarios/performance-benchmarks.scenarios.yaml`:

| Test                           | Plan ID     | Volume             | Target                  |
| ------------------------------ | ----------- | ------------------ | ----------------------- |
| Knowledge base (100+ docs)     | PERF-BD-001 | 100+ documents     | Search <5s              |
| Conversation history (500+)    | PERF-BD-002 | 500+ conversations | List <3s                |
| Single conversation (100+ msg) | PERF-BD-003 | 100+ messages      | No crash, smooth scroll |
| Research topics (50+)          | PERF-BD-004 | 50+ topics         | List loads normally     |
| Writing chapters (50+)         | PERF-BD-005 | 50+ chapters       | Navigation smooth       |
| Teams agents (10+)             | PERF-BD-006 | 10+ agents         | Discussion normal       |

---

### Phase G: DFX Quality Tests

Covers **Section 5 (DFX)** from the test plan.

#### G1: Reliability Tests

| Test                      | Plan ID     | Method                                                    |
| ------------------------- | ----------- | --------------------------------------------------------- |
| Page refresh recovery     | DFX-REL-001 | Navigate → Refresh → Verify state                         |
| Browser back              | DFX-REL-002 | Navigate→Forward→Back → Verify                            |
| Network disconnect        | DFX-REL-003 | Throttle network → Verify friendly error                  |
| API error handling        | DFX-REL-004 | Check error boundaries in code                            |
| Timeout recovery          | DFX-REL-005 | Slow API → Verify timeout message + retry                 |
| Session persistence       | DFX-REL-006 | Long idle → Verify session survives                       |
| Data persistence          | DFX-REL-007 | Create conversation → Refresh → Verify data still present |
| WebSocket reconnect       | DFX-REL-008 | Check reconnection logic in code                          |
| Stream interrupt recovery | DFX-REL-009 | SSE interruption → Verify recoverable                     |
| Concurrent write safety   | DFX-REL-010 | Concurrent edits → Verify no corruption                   |
| Idempotency               | DFX-REL-011 | Check duplicate submission guards                         |
| Graceful degradation      | DFX-REL-012 | External API down → App doesn't crash                     |

#### G2: Security Audit

| Test                  | Plan ID     | Method                                        |
| --------------------- | ----------- | --------------------------------------------- |
| npm audit (backend)   | DFX-SEC-013 | `cd backend && npm audit --audit-level=high`  |
| npm audit (frontend)  | DFX-SEC-013 | `cd frontend && npm audit --audit-level=high` |
| HTTPS enforcement     | DFX-SEC-011 | Check redirect config                         |
| Error stack hiding    | DFX-SEC-012 | Trigger 500, verify no stack trace            |
| Sensitive data in API | DFX-SEC-010 | Check DTO responses for password/key fields   |

#### G3: Maintainability Audit

| Test               | Plan ID   | Method                                                         |
| ------------------ | --------- | -------------------------------------------------------------- |
| No console.log     | DFX-M-007 | `grep -r "console.log" backend/src/ --include="*.ts" -l`       |
| No hardcoded model | DFX-M-008 | `grep -r "model:.*gpt-4" backend/src/ --include="*.ts" -l`     |
| No hardcoded temp  | DFX-M-008 | `grep -r "temperature:.*0\." backend/src/ --include="*.ts" -l` |
| Coverage threshold | DFX-M-001 | Check coverage report ≥50%                                     |

#### G4: Observability

| Test               | Plan ID   | Method                         |
| ------------------ | --------- | ------------------------------ |
| Health endpoint    | DFX-O-005 | `curl {BASE_URL}/api/health`   |
| Structured logging | DFX-O-002 | Check Logger usage in code     |
| AI call tracing    | DFX-O-001 | Check traceId in AiChatService |

#### G5: Usability Walkthrough

Execute scenarios from `.ui-patrol/scenarios/usability-walkthrough.scenarios.yaml`:

| Test                         | Plan ID     | Method                                |
| ---------------------------- | ----------- | ------------------------------------- |
| First-use guidance           | DFX-USE-001 | New user Ask within 3 min             |
| Navigation depth             | DFX-USE-002 | Verify ≤2 clicks to any feature       |
| Loading/Success/Error states | DFX-USE-003 | Check spinner/skeleton in key pages   |
| Error recovery               | DFX-USE-004 | Check retry buttons on error states   |
| Keyboard shortcuts           | DFX-USE-005 | Enter sends, Esc cancels              |
| Help documentation           | DFX-USE-006 | Tooltips on non-obvious features      |
| Interaction consistency      | DFX-USE-007 | Same-type ops use consistent patterns |
| Accessible forms             | DFX-USE-008 | Labels, required field indicators     |

#### G6: Best Practices Audit

| Test                           | Plan ID     | Dimension                           |
| ------------------------------ | ----------- | ----------------------------------- |
| OWASP A01 Access Control       | Section 6.1 | Check JWT Guard on all controllers  |
| OWASP A02 Sensitive Data       | Section 6.1 | Check DTO whitelist filtering       |
| OWASP A03 Injection            | Section 6.1 | Verify Prisma parameterized queries |
| OWASP A05 Security Config      | Section 6.1 | No debug endpoints in production    |
| OWASP A06 Vulnerable Deps      | Section 6.1 | `npm audit` results                 |
| OWASP A07 Auth Failures        | Section 6.1 | JWT + refresh token check           |
| OWASP A08 Deserialization      | Section 6.1 | class-validator strict check        |
| OWASP A09 Logging & Monitoring | Section 6.1 | Security event audit logs           |
| 12-Factor I Codebase           | Section 6.2 | Git + Railway deployment            |
| 12-Factor II Dependencies      | Section 6.2 | package-lock.json locked            |
| 12-Factor III Config           | Section 6.2 | No hardcoded secrets in code        |
| 12-Factor VI Processes         | Section 6.2 | WebSocket state sharing plan        |
| 12-Factor VIII Concurrency     | Section 6.2 | PM2 cluster readiness               |
| 12-Factor X Dev/Prod Parity    | Section 6.2 | Same DB engine in all envs          |
| Test Pyramid Balance           | Section 6.3 | Report unit:integration:e2e ratio   |
| Chaos: External API down       | Section 6.4 | Graceful degradation check          |
| Chaos: DB disconnect           | Section 6.4 | Error boundary activation           |
| API RESTful Naming             | Section 6.5 | URL naming + HTTP method audit      |
| API Error Format               | Section 6.5 | Unified error response check        |
| API Swagger Docs               | Section 6.5 | Swagger coverage check              |
| Frontend Component Coverage    | Section 6.6 | Key component test count            |
| Frontend Hook Coverage         | Section 6.6 | Custom hook test count              |
| Frontend Store Coverage        | Section 6.6 | Zustand store test count            |

**Method**: Code-level Grep/Read analysis for each audit item. Record findings with current status and recommendations.

#### G7: Browser Compatibility

Execute scenarios from `.ui-patrol/scenarios/compatibility-browser.scenarios.yaml`:

| Test                     | Plan ID     | Target               |
| ------------------------ | ----------- | -------------------- |
| Chrome latest (Desktop)  | DFX-CMP-001 | 100% functionality   |
| Firefox latest (Desktop) | DFX-CMP-002 | Core features work   |
| Safari latest (macOS)    | DFX-CMP-003 | Core features work   |
| Edge latest (Desktop)    | DFX-CMP-004 | Core features work   |
| Chrome Mobile (Android)  | DFX-CMP-005 | Basic usability      |
| Safari Mobile (iOS)      | DFX-CMP-005 | Basic usability      |
| 4K Display (3840x2160)   | DFX-RES-007 | No blur, no overflow |

**Method**: Primary browser testing via Playwright/Chrome DevTools MCP. Cross-browser tests (Firefox/Safari/Edge) via viewport emulation or flagged as SKIP with note "requires multi-browser setup". Mobile tests via viewport + user-agent emulation.

---

### Phase H: Triage & Fix

For each FAIL result found in any phase:

1. **Analyze** root cause by reading relevant source code
2. **Classify** severity using quantitative criteria:
   - **P0 (Blocking)**: Crash/white screen, security vulnerability, data loss, auth bypass, HTTP 5xx on core endpoint, complete feature broken
   - **P1 (Degraded)**: Broken workflow (user cannot complete intended action), non-functional UI element, console errors on page load, performance >3x threshold
   - **P2 (Cosmetic)**: Visual misalignment, missing loading/empty states, lint warnings, minor text issues, performance 1.5-3x threshold
3. **Fix** the issue:
   - Edit relevant source files
   - Run type checks: `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit`
   - Run quick tests: `npm run test:quick`
4. **Record** in report:
   - Issue ID (auto-increment: ISSUE-001, ISSUE-002, ...)
   - Test Plan ID it maps to
   - Description, root cause, files changed
   - Fix verification status
5. **Safety guardrails**:
   - Max 10 fixes per run
   - Max 50 lines changed per fix
   - No file deletions, no route changes, no auth logic changes
   - Type-check required after every fix
   - Auto-rollback on type-check failure: `git checkout -- {specific_file}` (NEVER `git checkout -- .`)
   - **Forbidden fix patterns** (these are not real fixes):
     - Changing test assertions to match broken behavior
     - Modifying mock data to bypass failures
     - Adding `@ts-ignore` or `// eslint-disable`
     - Deleting or skipping failing test cases
   - Before fixing, snapshot current state: `git stash push -m "ui-iteration-backup"` (restore with `git stash pop` if needed)

---

### Phase I: Regression & Refresh

1. **Re-run** failed backend tests: `cd backend && npx jest --testPathPattern="{failed_test_files}"`
2. **Re-run** failed frontend tests: `cd frontend && npx vitest run {failed_test_files}`
3. **Re-test** failed browser E2E cases
4. **Spot-check** 3 previously-passed cases for regressions
5. Update report with regression results
6. If new failures → back to Phase H (max 3 iterations)
7. If all clean → proceed to Phase J

---

### Phase J: Final Report

Update `docs/guides/testing/test-results/ui-iteration-{date}.md` with:

#### 0. Comparison & Trend Analysis

Find **all** previous `ui-iteration-*.md` reports in `docs/guides/testing/test-results/`.

**Single-run comparison** (vs most recent):

1. Compare pass rates (overall and per-section)
2. Identify **new regressions** (tests that previously passed but now fail)
3. Identify **newly passing** tests (tests that previously failed but now pass)
4. Output a diff summary table:

```markdown
| Metric          | Previous ({prev_date}) | Current ({date}) | Delta |
| --------------- | ---------------------- | ---------------- | ----- |
| Total Executed  |                        |                  |       |
| Pass Rate       |                        |                  |       |
| Issues Found    |                        |                  |       |
| Known Failures  |                        |                  |       |
| New Regressions | -                      |                  |       |
| Newly Passing   | -                      |                  |       |
```

**Multi-run trend** (if 3+ reports exist):

```markdown
### Trend (last N runs)

| Date       | Executed | Pass Rate | Issues | Known Fails |
| ---------- | -------- | --------- | ------ | ----------- |
| 2026-02-06 |          |           |        |             |
| 2026-02-07 |          |           |        |             |
| 2026-02-10 |          |           |        |             |
| {today}    |          |           |        |             |
```

Flag **persistent failures**: Tests that failed in 3+ consecutive runs → mark as "chronic" in the issues table.

If no previous report exists, note "First run - no baseline for comparison".

#### 1. Executive Summary

```markdown
## Executive Summary

- Total Test Plan Cases: ~735
- Cases Executed: {N}
- Passed: {N} | Failed (new): {N} | Known Failures: {N} | Fixed: {N} | Skipped: {N}
- Pass Rate: {N}% (excluding known failures: {N}%)
- Coverage of Test Plan: {N}%
- Issues Found: {N} | Issues Fixed: {N}
- Circuit Breaker Triggered: {yes/no, reason if yes}
- Execution Time: {duration}
```

#### 2. Coverage by Test Plan Section

| Section                       | Plan Cases | Executed | Passed | Coverage |
| ----------------------------- | ---------- | -------- | ------ | -------- |
| Part 1: AI Engine (Unit)      | ~60        |          |        |          |
| Part 1: AI Apps               | ~120       |          |        |          |
| Part 1: Content & Core        | ~25        |          |        |          |
| Part 2: Frontend              | ~20        |          |        |          |
| Part 3: Combinations          | ~120       |          |        |          |
| Part 3: Cross-Module & E2E    | ~35        |          |        |          |
| Part 4: Performance           | ~50        |          |        |          |
| Part 5: Boundary & Edge Cases | ~40        |          |        |          |
| Part 5: DFX Quality           | ~80        |          |        |          |
| Part 6: Data Integrity        | ~15        |          |        |          |
| Best Practices (Audit)        | ~30        |          |        |          |

#### 3. Test Plan ID Tracking Table

Full mapping of every test plan ID (ENG-LLM-001 through DFX-CP-006) to execution status.

#### 4. Issues Found & Fixed

| Issue ID | Test Plan ID | Severity | Description | Root Cause | Fix | Status |
| -------- | ------------ | -------- | ----------- | ---------- | --- | ------ |

#### 5. Code Changes Summary

List all files modified with descriptions.

#### 6. Gaps & Prioritized Recommendations

List test plan IDs that were SKIPPED, then provide **ROI-ranked** action items:

```markdown
## Prioritized Recommendations

| Priority | Action            | Impact             | Effort | Blocked Tests |
| -------- | ----------------- | ------------------ | ------ | ------------- |
| 1        | {highest ROI fix} | {what it unblocks} | S/M/L  | {count}       |
| 2        | ...               | ...                | ...    | ...           |
| ...      | ...               | ...                | ...    | ...           |
```

Include:

- Frontend component coverage gaps (from Phase C2)
- Known failures needing investigation
- Missing test infrastructure (load testing tools, etc.)
- Architectural concerns found during testing

#### 7. Quality Gate Assessment

```markdown
## Quality Gate

- [ ] P0 test pass rate: 100%
- [ ] P1 test pass rate: ≥95%
- [ ] Code coverage: ≥50%
- [ ] No high/critical npm vulnerabilities
- [ ] Type check clean
- [ ] Lint clean
- [ ] Build successful
- [ ] No new regressions vs previous run
- [ ] Known failures count ≤ previous run (not growing)
```

#### 8. Change Archival

Archive all code changes made during this run for traceability:

```bash
# Record all changes as a diff file (even if not committed)
git diff > docs/guides/testing/test-results/changes-{date}.diff
git diff --stat >> docs/guides/testing/test-results/ui-iteration-{date}.md
```

#### 9. Test Data Cleanup

```bash
# Clean up seeded test data (if Phase A2 seeded data)
npm run db:clean:ui-patrol 2>&1 | tail -5
```

If cleanup fails, record in report but do not block.

---

## Important Rules

- **Do NOT ask the user for input** during execution. Run fully autonomously.
- **Do NOT skip tests** unless technically impossible (e.g., requires payment, no browser available).
- **Record EVERYTHING** - every command output, every observation, every decision.
- **Fix issues immediately** when found - don't just report them.
- **Iterate until clean** - max 3 fix iterations, then report remaining.
- **Commit fixes** only at the end after all iterations pass.
- **Map every result** to a test plan ID from `comprehensive-test-suite-2026-02-17.md`.
- Use **browser snapshot** (accessibility tree) as primary verification, screenshots as backup.
- If browser tools are unavailable, maximize code-level analysis + API testing coverage.
- If a page requires authentication, use the token from Phase A1.

### Parallel Execution Strategy

Use **parallel Task agents** for independent test groups. Concrete grouping:

```
┌─ Parallel Group 1 (after Phase A) ────────────────────────┐
│  Agent 1: Phase B (Backend Jest + tsc + lint)              │
│  Agent 2: Phase C (Frontend Vitest + coverage gap)         │
│  Agent 3: Phase G2 + G3 (Static audits: npm audit,        │
│           console.log check, hardcoded model check)        │
└────────────────────────────────────────────────────────────┘
         ↓ Wait for all to complete
         ↓ Check circuit breaker conditions
┌─ Parallel Group 2 (requires Phase A1 token) ──────────────┐
│  Agent 4: Phase D (API integration tests)                  │
│  Agent 5: Phase G4 + G6 (Code-level audits)                │
└────────────────────────────────────────────────────────────┘
         ↓ Wait for completion
┌─ Parallel Group 3 (browser tests) ────────────────────────┐
│  Agent 6: Phase E1 + E5 (Page patrol + i18n)               │
│  Agent 7: Phase E2 journeys (core: Ask, Research, Teams)   │
│  Agent 8: Phase E2 journeys (secondary: Writing, Office,   │
│           Image, Social, Library, Admin)                    │
│  Agent 9: Phase E3 + E4 (Boundary + Responsive)            │
└────────────────────────────────────────────────────────────┘
         ↓ Wait for completion
┌─ Sequential (must not interfere) ─────────────────────────┐
│  Phase F: Performance tests (sequential to avoid noise)    │
│  Phase G1 + G5 + G7: Browser-dependent DFX tests          │
└────────────────────────────────────────────────────────────┘
         ↓
┌─ Sequential ──────────────────────────────────────────────┐
│  Phase H: Triage & Fix (depends on all results above)      │
│  Phase I: Regression (re-test fixes)                       │
│  Phase J: Final Report                                     │
└────────────────────────────────────────────────────────────┘
```

Each parallel agent MUST include the **file whitelist** and **context** per CLAUDE.md sub-agent rules.

## Test Priority Order

Execute phases in order: B → C → D → E → F → G. Within each phase, execute P0 tests first, then P1, then P2.

### P0 - Must Pass (Blocking Release)

**Backend Unit (Phase B)**:

- ENG-LLM-001~005 (AiChatService core)
- ENG-TPM-001~009 (TaskProfileMapper)
- ENG-MFB-001~003 (ModelFallback)
- ENG-CB-001~005 (CircuitBreaker)
- ENG-MEM-001/003/004/006 (Memory core)
- ENG-ORC-001~004 (Orchestration core)
- ENG-CST-001~003 (Constraints)
- ENG-TL-001~002 (ToolRegistry)
- ENG-SK-001 (SkillRegistry)
- ENG-FAC-001~002 (AIEngineFacade)
- AUTH-001~005, CRD-001~002/004
- RES-010/011/014/015 (Research core services)
- TMS-008~011/016 (Teams voting + orchestrator)
- WRT-007 (Checkpoint), OFC-001~002/004

**Frontend Unit (Phase C)**:

- FE-HK-001~002/004, FE-ST-001, FE-CP-001~005

**API Integration (Phase D)**:

- AUT-TKN-001~002, BND-PRM-001, DFX-O-005

**Browser E2E (Phase E)**:

- ASK-SES-001~005, ASK-MSG-001~010, RES-PRJ-001~006, TMS-TOP-001~005, TMS-MBR-001~005, WRT-PRJ-001~005
- IMG-GEN-001, OFC-SLD-001, SOC-CON-001 (page loads)
- RAG-KB-001~002 (knowledge pipeline)

**Combinations (Phase E)**:

- CMB-ASK-001~003/007, CMB-CTX-001~004, CMB-FT-002
- INT-LIB-ASK-001~003, INT-EXP-LIB-001

**E2E (Phase E)**:

- E2E-001~003

**Security (Phase G2)**:

- DFX-SEC-001~007/010~012

**Reliability (Phase G1)**:

- DFX-REL-001~005/007/008

**Maintainability (Phase G3)**:

- DFX-M-001~004/008

**Usability (Phase G5)**:

- DFX-USE-003~004

**Performance (Phase F)**:

- PERF-RT-001~005/012~014, PERF-CC-001~004

**Responsive (Phase E4)**:

- DFX-RES-001~002

**Compatibility (Phase G7)**:

- DFX-CMP-001

### P1 - Important (UX Impact)

**Backend**: ENG-LLM-006~009, ENG-TPM-010~012, ENG-MFB-004, ENG-CB-006~007, ENG-MEM-002/005/007, ENG-ORC-005~008, ENG-CST-004~005, ENG-SK-002, ENG-FAC-003
**AI Apps**: ASK-MSG-006~010, ASK-SES-003~005, RES-TAB-001~005, RES-DIM-001~005, TMS-MBR-003~005, TMS-DIS-001~005, WRT-VOL-001~005, WRT-QUA-001~003, OFC-SLD-003~005, OFC-THM-001~002, IMG-GEN-002~004, IMG-STR-001~002, SOC-CON-001~005, RAG-DOC-001~004
**Content**: LIB-RES-003~004, EXP-UNI-001~003
**Frontend**: FE-HK-003/005/006, FE-DM-001~002, FE-ST-002, FE-CP-006~008
**Combinations**: CMB-ASK-004~006/008~010, CMB-FT-001/003~007, CMB-CTX-005~007
**Cross-Module**: INT-LIB-ASK-003, INT-RAG-ASK-001~002, INT-EXP-LIB-002~003, INT-RES-LIB-001~002, INT-TMS-RES-001~002
**E2E**: E2E-004~007
**Performance**: PERF-RT-006~011/015/016, PERF-CC-005~007, PERF-TP-001~003, PERF-BD-001~003, PERF-RS-001~005
**DFX**: DFX-SEC-008~009/013~015, DFX-REL-006/009~012, DFX-M-005~007, DFX-O-001~004/006
**Usability**: DFX-USE-001~002/007
**Responsive**: DFX-RES-003~004
**Compatibility**: DFX-CMP-002~004

### P2 - Nice to Have

**Backend**: ENG-LLM-010, ENG-MEM-008, ENG-ORC-009~010, WRT-QUA-003, OFC-THM-002, SOC-CNT-005, RAG-DOC-003
**Content**: LIB-RES-005~006, RES-DIM-005
**Combinations**: CMB-FT-008, INT-RES-LIB-003
**E2E**: E2E-008
**Performance**: PERF-RT-008, PERF-TP-004, PERF-BD-004~008
**DFX**: DFX-USE-005~006/008, DFX-RES-005~007, DFX-CMP-005
**Best Practices**: Section 6.1~6.6 audit items (OWASP, 12-Factor, chaos, API design, frontend practices)
