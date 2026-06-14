# Phase E - Browser / E2E Test Results

**Test Date**: 2026-02-25
**Tester**: Browser Automation (Playwright v1.58.2, Chromium headless)
**Target**: https://genesis-ai.up.railway.app
**App Version**: v3.74.0
**Viewport (default)**: 1280x800

---

## Executive Summary

| Category                                   | Result                              |
| ------------------------------------------ | ----------------------------------- |
| App is online and reachable                | PASS                                |
| Homepage loads correctly                   | PASS                                |
| Login mechanism                            | Google OAuth only (cannot automate) |
| Authenticated login in test run            | NOT ACHIEVED (OAuth-only)           |
| Pages tested                               | 13                                  |
| Pages that load (HTTP 200)                 | 13 / 13                             |
| Pages with server errors                   | 0                                   |
| Pages with routing issues                  | 3 (redirect to wrong destination)   |
| Responsive design (no horizontal overflow) | PASS all 3 viewports                |
| Functional tests (logged-in)               | BLOCKED (not logged in)             |

---

## Step 1: Homepage & App Discovery

**Initial navigation**: `GET https://genesis-ai.up.railway.app`

The app immediately redirects to `/ai-ask` (the default authenticated landing route). The page loads fully as an SPA with a sidebar navigation visible.

### Observed UI at homepage/ai-ask (unauthenticated)

**Sidebar navigation links present**:

- AI Ask
- AI Explore
- My Library
- AI Insights
- AI Research
- AI Reports
- AI Discuss
- AI Planning
- AI Decision
- AI Writing
- AI Store
- Notifications

**Version banner**: "v3.74.0 released - 55 changes" (changelog banner visible at top)

**Main content area (unauthenticated state)**:

- Heading: "Sign in to start chatting"
- Subtext: "Sign in to access AI chat with multi-model support, knowledge base search, and more powerful features"
- Feature bullets: Multi-model support, Knowledge base search, Web search, Chat history
- Primary CTA button: "Sign In / Sign Up"
- Language toggle: "中文" (Chinese locale support)

**Buttons observed**: `["", "Login", "中文", "", "", "Login", "中文", "", "Sign In / Sign Up"]`

---

## Step 2: Login Flow Analysis

### Authentication Method Detected

**Google OAuth Only** - The app uses Google OAuth 2.0 exclusively. No email/password form is present on the initial page.

### OAuth Flow Traced

1. User clicks "Sign In / Sign Up" button
2. App redirects to Google OAuth endpoint:
   - `https://accounts.google.com/v3/signin/identifier`
   - Client ID: `726493701291-6f3qnirkr0et3tigul78qo0vi6d632b3.apps.googleusercontent.com`
   - Redirect URI: `https://genesis-ai-backend.up.railway.app/api/v1/auth/google/callback`
   - Scope: `email profile`
   - Flow: `GeneralOAuthFlow`
3. Google shows email input (standard Google sign-in form)
4. After Google authentication, redirects back to the app via backend callback

### Login Test Result

**Status: BLOCKED - OAuth requires real Google credentials**

The Google OAuth flow cannot be automated in headless mode without:

- A real Google account's email + password (2FA may block automation)
- Or a test OAuth token injected via cookie/localStorage

The backend OAuth callback URL confirms the auth architecture is correct. No alternative login path (local email/password, demo mode, test bypass) was detected.

---

## Step 3: Page-by-Page Test Results

All 13 pages returned HTTP 200. The app is a Next.js SPA - routing is client-side. Pages that require auth show an inline auth gate instead of redirecting.

### Page Test Matrix

| #   | Page        | Path           | HTTP | Final URL              | Auth Gate                                          | Key UI Elements      | Status |
| --- | ----------- | -------------- | ---- | ---------------------- | -------------------------------------------------- | -------------------- | ------ |
| 1   | Homepage    | `/`            | 200  | `/ai-ask`              | "Sign in to start chatting"                        | Sidebar, 9 buttons   | PASS   |
| 2   | AI Ask      | `/ai-ask`      | 200  | `/ai-ask`              | "Sign in to start chatting"                        | Sidebar, 9 buttons   | PASS   |
| 3   | AI Research | `/ai-research` | 200  | `/ai-research`         | Partial (New Research visible)                     | 8 buttons, 1 input   | PASS   |
| 4   | AI Teams    | `/ai-teams`    | 200  | `/ai-teams`            | "Please sign in to access AI Teams"                | 7 buttons            | PASS   |
| 5   | AI Writing  | `/ai-writing`  | 200  | `/ai-writing`          | "Please Sign In - Sign in to start AI Writing"     | 7 buttons            | PASS   |
| 6   | AI Image    | `/ai-image`    | 200  | `/ai-image`            | "Please Sign In - Sign in to use AI Image"         | 7 buttons            | PASS   |
| 7   | AI Office   | `/ai-office`   | 200  | `/ai-office`           | "Sign in with Google" button visible               | 8 buttons            | PASS   |
| 8   | AI Social   | `/ai-social`   | 200  | `/ai-social`           | "Please sign in - AI Social requires admin access" | 8 buttons            | PASS   |
| 9   | Library     | `/library`     | 200  | `/library`             | **Accessible unauthenticated**                     | 23 buttons, 1 input  | PASS   |
| 10  | Library RAG | `/library/rag` | 200  | `/ai-ask` (redirected) | "Sign in to start chatting"                        | -                    | ISSUE  |
| 11  | Explore     | `/explore`     | 200  | `/explore`             | **Accessible unauthenticated**                     | 76 buttons, 2 inputs | PASS   |
| 12  | Credits     | `/credits`     | 200  | `/ai-ask` (redirected) | "Sign in to start chatting"                        | -                    | ISSUE  |
| 13  | Admin       | `/admin`       | 200  | `/admin`               | **Accessible unauthenticated**                     | 7 buttons            | PASS   |

### Detailed Page Observations

#### AI Ask (`/ai-ask`) - PASS with Auth Gate

- Shows "Sign in to start chatting" with feature list
- Four feature bullets: Multi-model support, Knowledge base search, Web search, Chat history
- Single CTA: "Sign In / Sign Up" button
- Sidebar navigation fully rendered and accessible

#### AI Research (`/ai-research`) - PASS (Partial Access)

- Heading: "AI Research - Deep research projects with AI-powered analysis"
- **"New Research" button is visible** even without auth (interesting - UI renders but backend will require auth)
- 1 input field visible (search or filter)
- Research list area present but likely empty without auth

#### AI Teams (`/ai-teams`) - PASS with Auth Gate

- Shows: "Please sign in to access AI Teams"
- Subtext: "Create and join collaborative teams with AI assistants"
- No content visible without auth

#### AI Writing (`/ai-writing`) - PASS with Auth Gate

- Shows: "Please Sign In - Sign in to start AI Writing"
- Hard auth gate, no content preview

#### AI Image (`/ai-image`) - PASS with Auth Gate

- Shows: "Please Sign In - Sign in to use AI Image"
- Hard auth gate, no content preview

#### AI Office (`/ai-office`) - PASS with Auth Gate

- Heading: "AI Office"
- Subtext: "Sign in to use smart document generation, including PPT, Word, Excel, and more"
- **"Sign in with Google" button** is rendered directly on the page (not a modal)
- Different UX pattern from other pages - inline Google sign-in button

#### AI Social (`/ai-social`) - PASS with Admin Auth Gate

- Shows: "Please sign in - AI Social requires sign in with admin access."
- Note: Requires **admin access** specifically, stricter than other pages
- "Sign In" button rendered

#### Library (`/library`) - PASS (Content Accessible Without Auth)

- 23 buttons and 1 input - significant content is accessible
- Navigation tabs: Sources, Personal, Team, Overview, Bookmarks, Notes, Images, Notion, Google Drive
- "Data Sources Overview" section visible
- **Error detected**: "Service Error / Refresh Status" message visible for external data sources
- Google Drive integration shows "Not Connected / Connect" button
- Library content is partially accessible without login

#### Library RAG (`/library/rag`) - ISSUE: Redirect to /ai-ask

- Navigating to `/library/rag` redirects to `/ai-ask` with the standard auth gate
- The RAG management route either does not exist, requires auth (and redirects differently), or is misconfigured
- Expected: Should show auth gate at `/library/rag` or redirect to `/library`
- Actual: Redirects to completely different route `/ai-ask`

#### Explore (`/explore`) - PASS (Fully Accessible Without Auth)

- **76 buttons** and **2 inputs** - richest unauthenticated experience
- Content tabs: YouTube, Papers, Blogs, Reports, Policy, News
- Live content loading - sample headlines from Feb 2026:
  - "The AI Coding Prediction Everyone Got Wrong - Dario Amodei" (Dwarkesh Patel, youtube.com, Feb 21)
  - "Welcome to Cold War Two: historian Niall Ferguson on geopolitics in 2026" (WEF, Feb 19)
  - "Be your own role model - a female rocket scientist..."
- Bookmark buttons (count: 0) visible per article
- Content feed is active and populated

#### Credits (`/credits`) - ISSUE: Redirect to /ai-ask

- Navigating to `/credits` redirects to `/ai-ask`
- The credits page route does not exist or auth-redirects to wrong destination
- Expected: Credits/billing page
- Actual: Lands on AI Ask auth gate

#### Admin (`/admin`) - PASS (Accessible Without Auth - Observation)

- **Admin panel is accessible without authentication**
- Heading: "System Architecture - Click on configurable cards to manage settings"
- Stats visible: 5 Layers, 34 Modules, 19 Configurable
- Architecture layers visible:
  - L5: Agent OS (Intelligent orchestration - 3 modules, 1 configurable: AI Ask, Agents, Intent Router)
  - L4: Open API (External interfaces)
- This is a significant security observation - admin UI renders without login gate

---

## Step 4: Responsive Design Tests (`/ai-ask`)

All viewport tests navigated to `/ai-ask`. App uses a responsive sidebar layout.

| Viewport | Size      | Hamburger Menu | Horizontal Overflow | Result |
| -------- | --------- | -------------- | ------------------- | ------ |
| Mobile   | 375x667   | Yes (detected) | No                  | PASS   |
| Tablet   | 768x1024  | Yes (detected) | No                  | PASS   |
| Desktop  | 1920x1080 | Yes (detected) | No                  | PASS   |

**Notes**:

- No horizontal overflow at any viewport size - good responsive design
- Hamburger menu selector detected at all sizes (the selector matched `button[aria-label*="enu"]`)
- Note: At desktop 1920x1080, the "hamburger" detection may be a false positive if the sidebar is fully expanded and the toggle button is still in DOM. This should be verified visually from the screenshots.
- All three viewports show the auth gate correctly

---

## Step 5: Functional Tests

**Status: BLOCKED - Not logged in**

Functional tests require authentication. Since only Google OAuth is available and cannot be automated in headless mode, all functional tests were skipped.

Planned tests that would need verification with a logged-in session:

- `/ai-ask`: Type message, verify send button activates, submit, observe streaming response
- `/ai-research`: Click "New Research", fill form, submit
- `/library`: Verify document list loads, upload a document
- `/library/rag`: Verify KB management UI (currently redirecting - needs investigation)

---

## Issues Found

### Issue E-001: `/library/rag` Route Redirects to `/ai-ask`

- **Severity**: Medium
- **Observed**: Navigating to `/library/rag` lands on `/ai-ask` with the standard "Sign in to start chatting" gate
- **Expected**: Either show RAG management (if accessible) or show an auth gate staying on `/library/rag`
- **Possible causes**: (1) RAG route only exists when authenticated and redirect target is misconfigured, (2) The route is not defined in Next.js routing, (3) Auth middleware redirects to wrong fallback
- **Impact**: Users bookmarking or linking to `/library/rag` will land on a confusing page

### Issue E-002: `/credits` Route Redirects to `/ai-ask`

- **Severity**: Medium
- **Observed**: Navigating to `/credits` lands on `/ai-ask`
- **Expected**: Credits/billing page (or auth gate on `/credits`)
- **Possible causes**: Route not implemented, or auth middleware redirect is overly broad
- **Impact**: Credits page is inaccessible - users cannot view their credit balance or purchase credits

### Issue E-003: Admin Panel Accessible Without Authentication

- **Severity**: High (Security)
- **Observed**: `/admin` loads "System Architecture" with module details (5 layers, 34 modules, 19 configurable) without any auth check
- **Expected**: Admin panel should require authentication, and ideally admin-level authorization
- **Impact**: Any user can view the system architecture and module configuration map
- **Note**: It is unknown whether admin actions (write operations) are also unprotected - visual display only was tested
- **Recommendation**: Add auth guard to `/admin` route at Next.js middleware level

### Issue E-004: Library "Service Error" on Data Sources

- **Severity**: Low-Medium
- **Observed**: `/library` shows "Service Error / Refresh Status" message in the data sources overview section
- **Impact**: External data source connections (Google Drive, etc.) show an error state to unauthenticated users
- **Possible cause**: The data sources API call fails for unauthenticated users but the error is shown instead of being suppressed

### Issue E-005: Inconsistent Auth Gate Redirect Behavior

- **Severity**: Low
- **Observed**: Different pages use different auth gate patterns:
  - Some pages show inline auth gate and stay on the route (ai-ask, ai-research, ai-teams, ai-writing, ai-image, ai-social, explore, library, admin)
  - Some pages redirect to `/ai-ask` (/library/rag, /credits)
- **Expected**: Consistent behavior - either always redirect to a `/login` page, or always show inline gate
- **Impact**: Inconsistent UX, broken deep links for redirecting pages

### Issue E-006: "New Research" Button Visible Without Login

- **Severity**: Low
- **Observed**: On `/ai-research`, the "New Research" button is rendered even without authentication
- **Expected**: Button should either be hidden or disabled with a tooltip
- **Impact**: Minor UX issue - clicking the button will presumably show an auth gate or fail silently

---

## Navigation Sidebar Discovery

The sidebar reveals all available routes in the app. Routes observed at runtime:

| Category            | Route Name    | In Sidebar |
| ------------------- | ------------- | ---------- |
| KNOWLEDGE           | AI Explore    | Yes        |
| KNOWLEDGE           | My Library    | Yes        |
| RESEARCH & ANALYSIS | AI Insights   | Yes        |
| RESEARCH & ANALYSIS | AI Research   | Yes        |
| RESEARCH & ANALYSIS | AI Reports    | Yes        |
| PLANNING & DECISION | AI Discuss    | Yes        |
| PLANNING & DECISION | AI Planning   | Yes        |
| PLANNING & DECISION | AI Decision   | Yes        |
| CREATIVE WRITING    | AI Writing    | Yes        |
| TOOL STORE          | AI Store      | Yes        |
| -                   | Notifications | Yes        |

Routes NOT in sidebar (tested directly):

- `/ai-ask` (default/home)
- `/ai-teams`
- `/ai-image`
- `/ai-office`
- `/ai-social`
- `/admin`
- `/credits`
- `/library/rag`

---

## App Infrastructure Notes

- **Backend URL**: `https://genesis-ai-backend.up.railway.app` (separate Railway service)
- **OAuth Client**: Google OAuth app ID `726493701291-...`
- **Backend auth callback**: `/api/v1/auth/google/callback`
- **App version**: v3.74.0 with changelog banner
- **Locale support**: English + 中文 (Chinese) toggle visible in header

---

## Screenshots Reference

All screenshots saved to: `docs/guides/testing/test-results/partials/screenshots/`

| Screenshot                    | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `01_homepage_initial.png`     | App homepage at initial load (unauthenticated)          |
| `02_after_signin_click.png`   | Google OAuth page after clicking Sign In                |
| `03_post_login_state.png`     | State after login attempt (still on Google OAuth)       |
| `homepage.png`                | `/` - auth gate on ai-ask                               |
| `ai_ask.png`                  | `/ai-ask` - sign in to start chatting                   |
| `ai_research.png`             | `/ai-research` - research list with New Research button |
| `ai_teams.png`                | `/ai-teams` - auth gate                                 |
| `ai_writing.png`              | `/ai-writing` - auth gate                               |
| `ai_image.png`                | `/ai-image` - auth gate                                 |
| `ai_office.png`               | `/ai-office` - sign in with Google inline               |
| `ai_social.png`               | `/ai-social` - admin auth gate                          |
| `library.png`                 | `/library` - data sources overview with error           |
| `library_rag.png`             | `/library/rag` - redirected to ai-ask                   |
| `explore.png`                 | `/explore` - content feed accessible                    |
| `credits.png`                 | `/credits` - redirected to ai-ask                       |
| `admin.png`                   | `/admin` - system architecture (no auth gate)           |
| `responsive_mobile_375.png`   | ai-ask at 375x667                                       |
| `responsive_tablet_768.png`   | ai-ask at 768x1024                                      |
| `responsive_desktop_1920.png` | ai-ask at 1920x1080                                     |

---

## Summary Verdicts

| Test Area               | Verdict | Notes                                    |
| ----------------------- | ------- | ---------------------------------------- |
| App Availability        | PASS    | Online, no 500 errors                    |
| Login UX                | PASS    | Google OAuth flow is clean               |
| Login Automation        | BLOCKED | OAuth cannot be automated headlessly     |
| Page Loading (13 pages) | PASS    | All HTTP 200                             |
| Routing Correctness     | PARTIAL | 2 routes redirect to wrong destination   |
| Auth Gate Consistency   | PARTIAL | Mixed patterns (inline vs redirect)      |
| Admin Security          | FAIL    | Admin accessible without auth            |
| Unauthenticated Content | PASS    | Explore and Library partially accessible |
| Responsive Design       | PASS    | No overflow at any viewport              |
| Functional Features     | BLOCKED | Requires authenticated session           |

---

**Overall Phase E Result**: PARTIAL PASS

The application is live, loads correctly, and has good unauthenticated UX for discovery pages. Key issues requiring attention are the admin page auth gap (security), two broken route redirects (/credits, /library/rag), and an inconsistent auth gate redirect pattern.
