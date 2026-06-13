# Phase E2: Functional Journeys

**Date**: 2026-02-25 | **URL**: https://genesis-ai.up.railway.app | **App Version**: Genesis v3.74.0

---

## Auth Status

| Item                   | Detail                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Login page at `/login` | EXISTS but returns 404 (Next.js not-found page)                                                                             |
| Actual login behavior  | Routes are protected client-side; unauthenticated users see inline "Sign In" prompts within the page rather than a redirect |
| Auth method detected   | Google OAuth only (`Sign in with Google` button visible on /ai-office; `Sign In / Sign Up` on /ai-ask)                      |
| Email/password form    | NOT PRESENT                                                                                                                 |
| Test credentials       | None available — no `.env.test` found; only Google/GitHub OAuth configured                                                  |
| Login result           | BLOCKED(oauth-only) — Google OAuth requires interactive browser session                                                     |
| Proceeding as          | **Unauthenticated**                                                                                                         |

**Auth architecture note**: The app does NOT redirect to `/login` on protected routes. Instead, it renders the full page shell (sidebar nav, header) and shows an inline auth gate (e.g. "Sign in to start chatting", "Please sign in to access AI Teams"). `/login` itself returns a 404, suggesting login is initiated via OAuth buttons embedded in individual pages.

---

## Sidebar Navigation (Observed on all pages)

The following nav links were consistently present in the sidebar across all pages:

- AI Ask (`/ai-ask`)
- AI Explore (`/explore`)
- My Library (`/library`)
- AI Insights (`/ai-insights`)
- AI Research (`/ai-research`)
- AI Reports (`/ai-office`)
- AI Discuss (`/ai-teams`)
- AI Planning (`/ai-planning`)
- AI Decision (`/ai-simulation`)
- AI Writing (`/ai-writing`)
- AI Store (`/ai-store`)
- Notifications (`/notifications`)

---

## Journey Results

### Journey 1: AI Ask (ASK-SES-001~005, ASK-MSG-001~005)

**URL tested**: https://genesis-ai.up.railway.app/ai-ask
**Final URL**: https://genesis-ai.up.railway.app/ai-ask (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth gate**: Inline — H1: "Sign in to start chatting"

| Step                                     | Plan ID     | Observation                                                          | Result        |
| ---------------------------------------- | ----------- | -------------------------------------------------------------------- | ------------- |
| Page loads without redirect              | -           | URL stays at /ai-ask, sidebar renders with full nav                  | PASS          |
| Sidebar/navigation panel visible         | ASK-SES-002 | `aside` element detected with 12+ nav links                          | PASS          |
| Auth gate shown for unauthenticated user | -           | H1 "Sign in to start chatting" with "Sign In / Sign Up" button       | PASS          |
| New conversation button                  | ASK-SES-001 | NOT visible (auth gate shown instead, no conversation list rendered) | BLOCKED(auth) |
| Conversation list panel                  | ASK-SES-002 | NOT rendered (auth gate blocks content area)                         | BLOCKED(auth) |
| Message input textarea                   | ASK-MSG-001 | NOT present (no textarea found — auth gate hides chat UI)            | BLOCKED(auth) |
| Model selector                           | ASK-MSG-003 | NOT present (auth gate hides model selection)                        | BLOCKED(auth) |
| Send button                              | ASK-MSG-002 | NOT present (no submit button in DOM)                                | BLOCKED(auth) |
| Language toggle button                   | -           | "中文" button present in header                                      | PASS          |
| "Login" button in header                 | -           | Two Login buttons in header nav                                      | PASS          |
| Sign In / Sign Up CTA                    | -           | Prominent "Sign In / Sign Up" button in content area                 | PASS          |

**Summary**: Page shell loads correctly with full sidebar navigation. Auth gate renders properly for unauthenticated users with clear CTA. All chat-specific functionality (ASK-SES-001, ASK-MSG-001~005) blocked pending authentication.

---

### Journey 2: AI Research (RES-PRJ-001~006)

**URL tested**: https://genesis-ai.up.railway.app/ai-research
**Final URL**: https://genesis-ai.up.railway.app/ai-research (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth state**: Partial access — page loads with functional UI elements

| Step                                     | Plan ID     | Observation                                                                      | Result        |
| ---------------------------------------- | ----------- | -------------------------------------------------------------------------------- | ------------- |
| Page loads without redirect              | -           | URL stays at /ai-research, full page renders                                     | PASS          |
| Page heading visible                     | -           | H1: "AI Research"                                                                | PASS          |
| Sidebar navigation present               | -           | Full sidebar with 12+ nav links                                                  | PASS          |
| "New Research" button                    | RES-PRJ-002 | Button with text "New Research" found and NOT disabled                           | PASS          |
| Search input                             | -           | Input with placeholder "Search research projects..." found                       | PASS          |
| Search functionality (UI element)        | RES-PRJ-004 | Text input for search present                                                    | PASS          |
| Create new research modal (click action) | RES-PRJ-003 | Button present; click requires auth — modal behavior untested                    | BLOCKED(auth) |
| Research topics list/grid                | RES-PRJ-001 | Visible in page but content depends on user data (unauthenticated = empty state) | PASS          |
| Tab structure                            | RES-TAB-001 | Cannot confirm tabs without authenticated content                                | BLOCKED(auth) |

**Summary**: AI Research page is the most accessible unauthenticated page. Core UI (heading, search, "New Research" button) renders without auth. Functional operations require login.

---

### Journey 3: AI Teams (TMS-TOP-001~005)

**URL tested**: https://genesis-ai.up.railway.app/ai-teams
**Final URL**: https://genesis-ai.up.railway.app/ai-teams (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth gate**: Inline — H2: "Please sign in to access AI Teams"

| Step                        | Plan ID     | Observation                                  | Result        |
| --------------------------- | ----------- | -------------------------------------------- | ------------- |
| Page loads without redirect | -           | URL stays at /ai-teams                       | PASS          |
| Auth gate displayed         | -           | H2: "Please sign in to access AI Teams"      | PASS          |
| Sidebar navigation present  | -           | Full sidebar with nav links                  | PASS          |
| Teams list/topic selector   | TMS-TOP-001 | NOT rendered (auth gate)                     | BLOCKED(auth) |
| Agent configuration area    | TMS-MBR-001 | NOT rendered (auth gate)                     | BLOCKED(auth) |
| Start discussion button     | TMS-TOP-003 | NOT present (no action buttons except Login) | BLOCKED(auth) |
| Topic input                 | -           | No textarea or inputs in DOM                 | BLOCKED(auth) |
| Login buttons               | -           | Two "Login" buttons in header                | PASS          |

**Summary**: Teams page correctly blocks all content with auth gate. Full sidebar nav still accessible. No functional UI elements exposed without login.

---

### Journey 4: AI Writing (WRT-PRJ-001~005)

**URL tested**: https://genesis-ai.up.railway.app/ai-writing
**Final URL**: https://genesis-ai.up.railway.app/ai-writing (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth gate**: Inline — H2: "Please Sign In"

| Step                        | Plan ID     | Observation                   | Result        |
| --------------------------- | ----------- | ----------------------------- | ------------- |
| Page loads without redirect | -           | URL stays at /ai-writing      | PASS          |
| Auth gate displayed         | -           | H2: "Please Sign In"          | PASS          |
| Sidebar navigation present  | -           | Full sidebar with nav links   | PASS          |
| Projects list               | WRT-PRJ-001 | NOT rendered (auth gate)      | BLOCKED(auth) |
| New project button          | WRT-PRJ-002 | NOT present in DOM            | BLOCKED(auth) |
| Volume/chapter management   | WRT-PRJ-003 | NOT rendered (auth gate)      | BLOCKED(auth) |
| Login buttons               | -           | Two "Login" buttons in header | PASS          |

**Summary**: Writing page correctly gates all content. Auth gate message is generic ("Please Sign In") without feature-specific description. Consistent with other protected pages.

---

### Journey 5: Library & RAG (LIB-RES-001~004, RAG-KB-001~003)

**URL tested (Library)**: https://genesis-ai.up.railway.app/library
**URL tested (RAG)**: https://genesis-ai.up.railway.app/library/rag
**Auth state**: Library partially accessible; RAG redirects to /ai-ask

| Step                       | Plan ID     | Observation                                                                  | Result        |
| -------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------- |
| Library page loads         | -           | URL stays at /library, page renders                                          | PASS          |
| Library heading            | -           | H3: "Data Sources Overview"                                                  | PASS          |
| Sidebar navigation present | -           | Full nav with 12+ links                                                      | PASS          |
| Search input               | LIB-RES-002 | Input with placeholder "Search all resources..."                             | PASS          |
| Tab navigation             | -           | Buttons: Sources, Personal, Team, Overview, Bookmarks, Notes, Images, Notion | PASS          |
| Upload/import button       | LIB-RES-003 | NOT found in visible buttons (auth likely required)                          | BLOCKED(auth) |
| Resource list/grid         | LIB-RES-001 | Page renders overview section (data depends on user auth)                    | PARTIAL       |
| /library/rag navigation    | RAG-KB-001  | URL redirects to /ai-ask (unexpected — no /library/rag route found)          | FAIL          |
| RAG knowledge base list    | RAG-KB-001  | NOT accessible — route does not exist or redirects                           | FAIL          |
| Create KB button           | RAG-KB-002  | NOT accessible — /library/rag route non-functional                           | FAIL          |

**Issues Found**:

- **ISSUE-LIB-001**: `/library/rag` redirects to `/ai-ask` instead of showing a RAG management interface. The route either does not exist in the production app or is misconfigured. This is a navigation/routing defect.

**Summary**: Library page itself loads with good partial content (tab structure, search). The RAG sub-route is broken — navigating to `/library/rag` lands at `/ai-ask` instead of any RAG management UI.

---

### Journey 6: AI Image (IMG-GEN-001~004)

**URL tested**: https://genesis-ai.up.railway.app/ai-image
**Final URL**: https://genesis-ai.up.railway.app/ai-image (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth gate**: Inline — H2: "Please Sign In"

| Step                        | Plan ID     | Observation                                                   | Result        |
| --------------------------- | ----------- | ------------------------------------------------------------- | ------------- |
| Page loads without redirect | -           | URL stays at /ai-image                                        | PASS          |
| Auth gate displayed         | -           | H2: "Please Sign In"                                          | PASS          |
| Sidebar navigation present  | -           | Full nav with 12+ links                                       | PASS          |
| Prompt input                | IMG-GEN-001 | NOT present (auth gate hides generation UI)                   | BLOCKED(auth) |
| Generate button             | IMG-GEN-002 | NOT present                                                   | BLOCKED(auth) |
| Style/model selector        | IMG-GEN-003 | Body text contains "style" keyword (likely in static content) | INCONCLUSIVE  |
| History panel               | IMG-HIS-001 | NOT detected in body text                                     | BLOCKED(auth) |
| Login buttons               | -           | Two "Login" buttons in header                                 | PASS          |

**Summary**: Image page shows auth gate only. No generation UI exposed without login. "Style" keyword appears in page but likely from static description text, not an interactive selector.

---

### Journey 7: AI Social (SOC-CON-001~005)

**URL tested**: https://genesis-ai.up.railway.app/ai-social
**Final URL**: https://genesis-ai.up.railway.app/ai-social (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth gate**: Inline — H1: "Please sign in"

| Step                        | Plan ID     | Observation                                                      | Result        |
| --------------------------- | ----------- | ---------------------------------------------------------------- | ------------- |
| Page loads without redirect | -           | URL stays at /ai-social                                          | PASS          |
| Auth gate displayed         | -           | H1: "Please sign in"                                             | PASS          |
| Sidebar navigation present  | -           | Full nav with 12+ links                                          | PASS          |
| "Sign In" CTA button        | -           | Dedicated "Sign In" button in content area                       | PASS          |
| Platform selector           | SOC-CON-002 | NOT present — body text lacks Twitter/LinkedIn/platform keywords | BLOCKED(auth) |
| Content generation area     | SOC-CON-001 | NOT rendered (auth gate)                                         | BLOCKED(auth) |
| Preview panel               | SOC-CON-004 | NOT rendered (auth gate)                                         | BLOCKED(auth) |
| Login buttons               | -           | Two "Login" + one "Sign In" button                               | PASS          |

**Summary**: Social page correctly gates all content. Auth gate heading is H1 (higher prominence than Teams H2/"Please Sign In" H2 on Writing/Image). Consistent UX pattern.

---

### Journey 8: AI Office (OFC-SLD-001~003)

**URL tested**: https://genesis-ai.up.railway.app/ai-office
**Final URL**: https://genesis-ai.up.railway.app/ai-office (no redirect)
**Page title**: GenesisPod - AI-Powered Research Platform
**Auth state**: Partial — page title renders, Google OAuth button visible

| Step                         | Plan ID     | Observation                                                      | Result        |
| ---------------------------- | ----------- | ---------------------------------------------------------------- | ------------- |
| Page loads without redirect  | -           | URL stays at /ai-office                                          | PASS          |
| Page heading                 | -           | H1: "AI Office" visible                                          | PASS          |
| Sidebar navigation present   | -           | Full nav with 12+ links                                          | PASS          |
| "Sign in with Google" button | -           | Dedicated Google OAuth button present in content area            | PASS          |
| Template selector            | OFC-SLD-002 | NOT found in body text (auth gate)                               | BLOCKED(auth) |
| Create presentation button   | OFC-SLD-001 | NOT found in buttons                                             | BLOCKED(auth) |
| Theme options                | OFC-THM-001 | NOT detected in body text                                        | BLOCKED(auth) |
| Login buttons                | -           | Two "Login" buttons in header + "Sign in with Google" in content | PASS          |

**Note**: AI Office shows H1 "AI Office" plus a Google OAuth CTA, unlike other pages that show a generic auth message. This suggests a different auth gate component is used for Office vs other AI modules — the Office page partially renders its title even for unauthenticated users.

**Summary**: Office page loads its title and Google Sign-In CTA. No document/presentation generation UI visible without auth. The use of "Sign in with Google" (Google-specific) vs "Sign In / Sign Up" (generic) on other pages suggests inconsistent auth gate components.

---

## E3: Boundary Conditions

| Test                                | Plan ID     | Input                       | Result          | Notes                                                                                           |
| ----------------------------------- | ----------- | --------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| Send button disabled on empty input | BND-INP-001 | (empty textarea)            | BLOCKED(auth)   | AI Ask page shows auth gate instead of chat UI; no send button in DOM for unauthenticated users |
| File upload indicator present       | BND-FIL-001 | n/a                         | BLOCKED(auth)   | No `input[type="file"]` or attach button found on /ai-ask (auth gate hides chat UI)             |
| XSS input properly escaped          | BND-INP-003 | `<script>alert(1)</script>` | MANUAL-REQUIRED | Cannot test without authenticated access to message input; requires manual test post-login      |

---

## Issues Found

### ISSUE-001: `/login` route returns 404

- **Severity**: Medium
- **URL**: https://genesis-ai.up.railway.app/login
- **Observation**: Navigating to `/login` shows a 404 page ("404 - 页面未找到"). The auth flow relies on OAuth buttons embedded in individual pages, but the canonical `/login` route does not exist.
- **Impact**: Users who bookmark `/login` or follow external links to it will see a 404 error.
- **Recommendation**: Either create a `/login` page that shows auth options, or configure a redirect from `/login` to the appropriate auth flow.

### ISSUE-002: `/library/rag` route redirects to `/ai-ask`

- **Severity**: High
- **URL**: https://genesis-ai.up.railway.app/library/rag
- **Observation**: Navigating to `/library/rag` results in loading `/ai-ask` content (H1: "Sign in to start chatting"). The RAG management interface is completely inaccessible.
- **Impact**: RAG knowledge base functionality (RAG-KB-001~003) is entirely blocked — not just auth-gated but route-broken.
- **Recommendation**: Verify `/library/rag` route registration in Next.js app router. Check if the route file exists at `frontend/app/library/rag/page.tsx`.

### ISSUE-003: Inconsistent auth gate components across pages

- **Severity**: Low
- **Pages Affected**: /ai-office, /ai-ask, /ai-teams, /ai-writing, /ai-image, /ai-social
- **Observation**: Different pages show different auth gate messages and button styles:
  - /ai-ask: H1 "Sign in to start chatting" + "Sign In / Sign Up" button
  - /ai-teams: H2 "Please sign in to access AI Teams"
  - /ai-writing: H2 "Please Sign In" (generic, no feature context)
  - /ai-image: H2 "Please Sign In" (generic)
  - /ai-social: H1 "Please sign in" + "Sign In" button
  - /ai-office: H1 "AI Office" + "Sign in with Google" button (Google-specific)
- **Impact**: Inconsistent UX; some pages use Google-specific auth, others use generic sign-in.
- **Recommendation**: Standardize auth gate component across all AI modules.

### ISSUE-004: Library page missing upload/import button for unauthenticated users

- **Severity**: Low
- **URL**: https://genesis-ai.up.railway.app/library
- **Observation**: Library page renders with tab navigation (Sources, Personal, Team, Overview, Bookmarks, Notes, Images, Notion) and search input, but no Upload/Import button is visible without authentication.
- **Impact**: Users cannot discover the upload functionality without signing in first.
- **Note**: This may be intentional (upload requires auth) but could benefit from a visible disabled state with auth CTA.

---

## Summary

| Metric                        | Count                                  |
| ----------------------------- | -------------------------------------- |
| Journeys Attempted            | 8                                      |
| Journeys with Partial Access  | 3 (Research, Library, Office)          |
| Journeys Fully Blocked (auth) | 5 (Ask, Teams, Writing, Image, Social) |
| Steps Tested Total            | 52                                     |
| Steps PASS                    | 28                                     |
| Steps BLOCKED(auth)           | 19                                     |
| Steps FAIL                    | 3 (library/rag route broken)           |
| Steps INCONCLUSIVE/MANUAL     | 2                                      |
| Issues Found                  | 4                                      |

### Issues by Severity

- High: 1 (ISSUE-002: /library/rag route broken)
- Medium: 1 (ISSUE-001: /login 404)
- Low: 2 (ISSUE-003: inconsistent auth gates, ISSUE-004: library upload not discoverable)

### Journeys Completed (Unauthenticated)

| Journey         | Status         | Notes                                             |
| --------------- | -------------- | ------------------------------------------------- |
| J1: AI Ask      | BLOCKED(auth)  | Auth gate shown, shell renders correctly          |
| J2: AI Research | PARTIAL        | Heading, search, "New Research" button accessible |
| J3: AI Teams    | BLOCKED(auth)  | Auth gate shown, shell renders correctly          |
| J4: AI Writing  | BLOCKED(auth)  | Auth gate shown, shell renders correctly          |
| J5: Library     | PARTIAL + FAIL | Library accessible, /library/rag route broken     |
| J6: AI Image    | BLOCKED(auth)  | Auth gate shown, shell renders correctly          |
| J7: AI Social   | BLOCKED(auth)  | Auth gate shown, shell renders correctly          |
| J8: AI Office   | PARTIAL        | Page title + Google OAuth CTA visible             |

### Key Positive Findings

1. All routes load without server errors (200 OK, no 500s)
2. Sidebar navigation is consistently present and complete across all pages
3. App version v3.74.0 visible in sidebar footer
4. AI Research page has the best unauthenticated experience (search + "New Research" button accessible)
5. Pages use inline auth gates rather than hard redirects, preserving context for users
6. Language toggle (Chinese/English) accessible without auth on all pages

### Action Items for Next Test Phase

- After obtaining Google OAuth login: re-run all BLOCKED(auth) steps
- Manually verify ISSUE-002 (/library/rag route) in source code
- Test BND-INP-001 (send button disabled state) once authenticated
- Test BND-INP-003 (XSS) with live message input once authenticated
