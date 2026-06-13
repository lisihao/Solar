# GenesisPod - Frontend Architecture Evaluation

**Evaluation Date**: 2026-01-23
**Evaluator**: Architect Agent
**Scope**: frontend/ directory complete architecture review

---

## Executive Summary

| Category               | Score     | Status                        |
| ---------------------- | --------- | ----------------------------- |
| Directory Structure    | 3.5/5     | Needs Improvement             |
| Component Architecture | 3/5       | Needs Improvement             |
| State Management       | 4/5       | Good                          |
| Routing Structure      | 4/5       | Good                          |
| Performance            | 2.5/5     | Needs Significant Improvement |
| **Overall**            | **3.4/5** | Moderate                      |

---

## 1. Directory Structure Analysis

### 1.1 Current Structure

```
frontend/
├── app/                      # Next.js App Router (pages & API routes)
│   ├── admin/               # Admin pages (20+ sub-routes)
│   ├── ai-ask/              # AI Chat module
│   ├── ai-coding/           # AI Coding module
│   ├── ai-image/            # AI Image generation
│   ├── ai-office/           # AI Office (slides)
│   ├── ai-research/         # AI Research module
│   ├── ai-simulation/       # AI Simulation
│   ├── ai-social/           # AI Social content
│   ├── ai-store/            # AI Store
│   ├── ai-studio/           # AI Studio
│   ├── ai-teams/            # AI Teams collaboration
│   ├── ai-writing/          # AI Writing
│   ├── api/                 # Next.js API routes (proxy to backend)
│   ├── explore/             # Content exploration
│   ├── library/             # Resource library
│   └── share/               # Public sharing pages
├── components/              # Reusable components (379 files)
│   ├── admin/               # Admin-specific components
│   ├── ai-ask/              # AI Ask components
│   ├── ai-coding/           # AI Coding components
│   ├── ai-image/            # AI Image components
│   ├── ai-office/           # AI Office components (slides, chat)
│   ├── ai-research/         # AI Research components
│   ├── ai-simulation/       # AI Simulation components
│   ├── ai-social/           # AI Social components
│   ├── ai-store/            # AI Store components
│   ├── ai-teams/            # AI Teams components
│   ├── ai-writing/          # AI Writing components
│   ├── common/              # Common shared components
│   ├── layout/              # Layout components (AppShell, Sidebar)
│   ├── shared/              # Shared utility components
│   └── ui/                  # Base UI components (24 files)
├── hooks/                   # Custom React hooks
│   ├── core/                # Core hooks (useApi, useStream)
│   ├── domain/              # Domain-specific hooks
│   ├── features/            # Feature hooks (slides, collections)
│   └── utils/               # Utility hooks
├── stores/                  # Zustand stores (16 files)
├── contexts/                # React Context providers
├── lib/                     # Utility libraries
│   ├── api/                 # API client & endpoints
│   ├── cache/               # LRU cache implementation
│   ├── i18n/                # Internationalization
│   └── utils/               # Common utilities
├── types/                   # TypeScript type definitions
└── public/                  # Static assets
```

### 1.2 Issues Identified

#### CRITICAL: Components in app/ directory

```
app/ai-simulation/components/   # Components should NOT be in app/
├── AgentCard.tsx
├── CompanyCard.tsx
├── EditorModal.tsx
├── ScenarioCardItem.tsx
└── TemplateCard.tsx
```

**Problem**: Violates Next.js App Router conventions. Components in `app/` can cause routing issues.

**Recommendation**: Move to `components/ai-simulation/`

#### HIGH: Inconsistent component organization

| Pattern        | Examples                                           | Issue            |
| -------------- | -------------------------------------------------- | ---------------- |
| Feature-based  | `components/ai-office/`, `components/ai-research/` | Good             |
| Flat structure | `components/admin/*.tsx` (50+ files)               | Hard to navigate |
| Mixed nesting  | Some have sub-folders, some don't                  | Inconsistent     |

#### MEDIUM: Duplicate/backup files

```
components/ai-image/ImageGenerator.old.tsx          # 3182 lines
components/ai-image/ImageGenerator.original.backup.tsx  # 3182 lines
```

**Recommendation**: Remove backup files from codebase; use git history instead.

---

## 2. Component Architecture

### 2.1 Server vs Client Components

**Finding**: Almost all components are Client Components (`'use client'`)

| Location    | Client Components | Total Files |
| ----------- | ----------------- | ----------- |
| app/        | 70                | 70+         |
| components/ | 300+              | 379         |

**Impact**:

- Increased JavaScript bundle size
- No Server-Side Rendering benefits
- All data fetching happens on client

**Root Cause**: The project uses a traditional SPA pattern despite using Next.js App Router.

### 2.2 Component Size Analysis (Top 10 Largest)

| File                       | Lines | Status                     |
| -------------------------- | ----- | -------------------------- |
| TopicContentPanel.tsx      | 5,573 | CRITICAL - needs splitting |
| ExploreContent.tsx         | 3,551 | CRITICAL - needs splitting |
| ExternalAPISettings.tsx    | 3,477 | CRITICAL - needs splitting |
| TeamCanvasModal.tsx        | 3,224 | HIGH - needs splitting     |
| ImageGenerator.tsx         | 2,516 | HIGH - needs splitting     |
| AIModelSettings.tsx        | 2,670 | HIGH - needs splitting     |
| AICapabilitiesSettings.tsx | 2,405 | HIGH - needs splitting     |
| SandboxView.tsx            | 2,182 | HIGH - needs splitting     |

**Additional Large Files in app/ (Pages)**:

| File                 | Lines | Status                             |
| -------------------- | ----- | ---------------------------------- |
| app/ai-ask/page.tsx  | 2,629 | CRITICAL - should be in components |
| app/library/page.tsx | 2,582 | CRITICAL - should be in components |

### 2.3 Props Drilling Analysis

**Pattern Observed**: Heavy props passing in research/teams modules

```typescript
// TopicContentPanel.tsx - 30+ props
interface TopicContentPanelProps {
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence: TopicEvidence[];
  isLoadingReport: boolean;
  isLoadingEvidence: boolean;
  onExportReport?: (format: "pdf" | "docx") => void;
  researchEvents?: ResearchEvent[];
  agentThinkings?: AgentThinking[];
  revisions?: ReportRevision[];
  onRollbackVersion?: (revisionId: string) => void;
  onSendLeaderInstruction?: (instruction: string) => void;
  isRefreshing?: boolean;
  wsEvents?: WsEvent[];
  wsConnected?: boolean;
  onClearWsEvents?: () => void;
  missionStatus?: MissionStatus | null;
  topicId?: string;
  onDeleteReport?: (reportId: string) => Promise<void>;
  initialView?: string | null;
  canEdit?: boolean;
}
```

**Recommendation**: Use Zustand stores or React Context for shared state.

### 2.4 Component Reusability

**Good Patterns**:

- `components/ui/` - Base UI components (24 files)
- `components/shared/` - Shared utility components
- `components/layout/` - AppShell, Sidebar, MobileNav

**Issues**:

- Many components are highly coupled to specific features
- Limited composition patterns
- Inline SVG icons instead of icon library

---

## 3. State Management Evaluation

### 3.1 Zustand Stores (16 stores)

| Store                 | Lines | Persistence | Purpose                 |
| --------------------- | ----- | ----------- | ----------------------- |
| slidesStore.ts        | 556   | Yes         | Slides generation state |
| aiStudioStore.ts      | 549   | Partial     | Research plan, trends   |
| topicResearchStore.ts | ~400  | Yes         | Topic research state    |
| aiTeamsStore.ts       | ~350  | Yes         | Teams collaboration     |
| aiWritingStore.ts     | ~300  | Yes         | Writing sessions        |
| socialCreateStore.ts  | ~250  | No          | Social content creation |
| aiOfficeStore.ts      | ~200  | No          | AI Office state         |
| agentStore.ts         | ~150  | No          | Agent execution state   |
| creditsStore.ts       | ~100  | No          | User credits            |
| settingsStore.ts      | ~100  | Yes         | User settings           |
| themeStore.ts         | ~80   | Yes         | Theme preferences       |
| toastStore.ts         | ~50   | No          | Toast notifications     |

**Strengths**:

- Well-organized per-feature stores
- Appropriate use of persistence middleware
- Clean selector patterns
- devtools integration in slidesStore

**Issues**:

- Some stores are too large (slidesStore, aiStudioStore)
- Inconsistent persistence strategy
- Missing action types/constants

### 3.2 TanStack Query Usage

**Finding**: Minimal usage (only 4 files)

```
frontend/components/admin/data-management/DataManagementDashboard.tsx
frontend/components/admin/data-management/ProfessionalDataManagementPage.tsx
frontend/components/admin/data-management/CollectionConfigurationPanel.tsx
frontend/hooks/core/useApi.ts
```

**Pattern Used**: Custom `useApi` hooks instead

```typescript
// hooks/core/useApi.ts
export function useApiGet<T>(path: string, options?: UseApiOptions<T>);
export function useApiPost<T, P>(path: string, options?: UseApiOptions<T>);
```

**Assessment**:

- Custom implementation provides caching via LRU cache
- Missing: Automatic refetch, background updates, optimistic updates
- TanStack Query is installed but underutilized

### 3.3 Context Usage

| Context      | Purpose              | Scope  |
| ------------ | -------------------- | ------ |
| AuthContext  | User authentication  | Global |
| I18nProvider | Internationalization | Global |

**Issues**:

- Only 2 contexts for a large app
- Auth validation on every mount (performance concern)

---

## 4. Routing Structure Analysis

### 4.1 App Router Usage

**Structure**:

```
app/
├── layout.tsx          # Root layout (Server Component)
├── providers.tsx       # Client providers wrapper
├── page.tsx            # Home page
├── [module]/
│   ├── layout.tsx      # Module layout (optional)
│   └── page.tsx        # Module page
│   └── [id]/
│       └── page.tsx    # Dynamic route
```

**Strengths**:

- Good use of nested layouts (admin, ai-research)
- Proper dynamic routes for IDs
- Redirects configured for legacy routes

### 4.2 Layout Component Analysis

```typescript
// app/layout.tsx - Root (Server Component)
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>  // Client boundary
      </body>
    </html>
  );
}

// app/admin/layout.tsx - Admin (Client Component)
export default function AdminLayout({ children }) {
  return (
    <AppShell>
      <main>{children}</main>
    </AppShell>
  );
}
```

**Issue**: All nested layouts are Client Components, losing SSR benefits.

### 4.3 API Routes

```
app/api/
├── agents/              # Agent management
├── ai-office/           # AI Office operations
├── ai-service/          # AI service proxy
├── ai/grok/             # Grok API
└── feedback/            # User feedback
```

**Pattern**: Most routes proxy to backend via next.config.js rewrites

```javascript
// next.config.js
rewrites: [
  { source: "/api/v1/:path*", destination: `${apiUrl}/api/v1/:path*` },
];
```

---

## 5. Performance Analysis

### 5.1 Code Splitting

**Dynamic Imports Found** (8 files):

```typescript
// app/ai-teams/[topicId]/page.tsx
const SomeComponent = dynamic(() => import('...'), { ssr: false });

// components/ai-coding/DevWorkspace/CodeEditor.tsx
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <LoadingSpinner />
});
```

**Issues**:

- Most components are NOT dynamically imported
- Large dependencies loaded synchronously:
  - mermaid (11+ MB)
  - pdfjs-dist
  - monaco-editor
  - recharts

### 5.2 Bundle Size Concerns

**Heavy Dependencies**:

| Package              | Approx. Size | Usage          |
| -------------------- | ------------ | -------------- |
| mermaid              | ~2.5 MB      | Diagrams       |
| pdfjs-dist           | ~1.5 MB      | PDF viewing    |
| @monaco-editor/react | ~2 MB        | Code editing   |
| recharts             | ~500 KB      | Charts         |
| d3                   | ~300 KB      | Visualizations |
| framer-motion        | ~150 KB      | Animations     |

**Recommendation**: Dynamic import all heavy dependencies

### 5.3 Component Rendering

**Large Component Issues**:

```typescript
// TopicContentPanel.tsx - 5573 lines
// Contains:
// - 30+ props
// - 15+ useState hooks
// - Multiple heavy dependencies
// - Complex conditional rendering
```

**Impact**:

- Slow initial render
- Re-renders entire tree on state changes
- No memoization patterns observed

---

## 6. Dependency Analysis

### 6.1 Core Dependencies

```json
{
  "next": "^14.2.35",
  "react": "^18.3.0",
  "zustand": "^4.5.0",
  "@tanstack/react-query": "^5.28.0", // Underutilized
  "tailwindcss": "^3.4.0"
}
```

### 6.2 UI Libraries (Multiple)

| Library          | Purpose    | Overlap         |
| ---------------- | ---------- | --------------- |
| lucide-react     | Icons      | Primary         |
| @heroicons/react | Icons      | Redundant       |
| @radix-ui/\*     | Primitives | Good            |
| @mantine/core    | Components | Partial overlap |
| framer-motion    | Animation  | Good            |

**Recommendation**: Consolidate on one icon library (lucide-react)

### 6.3 Editor Libraries (Multiple)

| Library              | Purpose           |
| -------------------- | ----------------- |
| @tiptap/\*           | Rich text editing |
| @blocknote/\*        | Block editor      |
| @monaco-editor/react | Code editing      |

**Assessment**: All serve different purposes, acceptable

---

## 7. Issues Summary

### 7.1 Critical Issues

| Issue                            | Location                                  | Impact                   | Effort |
| -------------------------------- | ----------------------------------------- | ------------------------ | ------ |
| Components in app/ai-simulation/ | app/ai-simulation/components/             | Routing issues           | Low    |
| Giant page files (2500+ lines)   | app/ai-ask/page.tsx, app/library/page.tsx | Unmaintainable           | High   |
| Giant components (5000+ lines)   | TopicContentPanel.tsx, ExploreContent.tsx | Performance, maintenance | High   |
| No Server Components             | All pages use 'use client'                | Bundle size, SEO         | Medium |

### 7.2 High Priority Issues

| Issue                      | Impact           | Recommendation  |
| -------------------------- | ---------------- | --------------- |
| Backup files in codebase   | Confusion        | Delete, use git |
| Heavy deps loaded sync     | Performance      | Dynamic imports |
| Props drilling (30+ props) | Maintenance      | Use stores      |
| TanStack Query underused   | Missing features | Adopt or remove |
| Duplicate icon libraries   | Bundle size      | Consolidate     |

### 7.3 Medium Priority Issues

| Issue                       | Impact      | Recommendation          |
| --------------------------- | ----------- | ----------------------- |
| Flat admin components       | Navigation  | Sub-folder structure    |
| Inconsistent store patterns | Maintenance | Standardize             |
| Missing memoization         | Performance | Add React.memo, useMemo |
| Auth validation on mount    | Performance | Use middleware          |

---

## 8. Recommendations

### 8.1 Immediate Actions (Week 1-2)

1. **Move components out of app/**

   ```bash
   mv app/ai-simulation/components/* components/ai-simulation/
   ```

2. **Remove backup files**

   ```bash
   rm components/ai-image/ImageGenerator.old.tsx
   rm components/ai-image/ImageGenerator.original.backup.tsx
   ```

3. **Add dynamic imports for heavy dependencies**
   ```typescript
   const Mermaid = dynamic(() => import("mermaid"), { ssr: false });
   const PDF = dynamic(() => import("react-pdf"), { ssr: false });
   ```

### 8.2 Short-term Improvements (Month 1)

1. **Split giant components**

   ```
   TopicContentPanel.tsx (5573 lines) ->
   ├── TopicReportView.tsx
   ├── TopicCollaborationPanel.tsx
   ├── TopicReferencesPanel.tsx
   ├── TopicCredibilityPanel.tsx
   └── TopicHistoryPanel.tsx
   ```

2. **Extract page logic to components**

   ```
   app/ai-ask/page.tsx (2629 lines) ->
   app/ai-ask/page.tsx (50 lines)
   components/ai-ask/AIAskPage.tsx (2600 lines)
   ```

3. **Adopt TanStack Query or remove it**
   - Option A: Replace useApi hooks with TanStack Query
   - Option B: Remove @tanstack/react-query dependency

### 8.3 Long-term Architecture (Quarter 1)

1. **Server Components Strategy**
   - Identify data-fetching pages
   - Convert to Server Components where possible
   - Keep interactivity in Client Components

2. **State Management Refactor**
   - Split large stores by concern
   - Add proper TypeScript action types
   - Document store patterns

3. **Component Library**
   - Extract common patterns to ui/
   - Create design system documentation
   - Add Storybook for component catalog

---

## 9. Architecture Recommendations

### 9.1 Recommended Component Structure

```
components/
├── ui/                      # Base UI (Button, Input, Modal)
│   └── index.ts             # Barrel exports
├── layout/                  # Layout components
│   ├── AppShell.tsx
│   ├── Sidebar.tsx
│   └── MobileNav.tsx
├── shared/                  # Shared feature components
│   ├── dialogs/
│   ├── selectors/
│   └── views/
└── features/                # Feature-specific components
    ├── ai-ask/
    │   ├── components/      # Feature components
    │   ├── hooks/           # Feature hooks (co-located)
    │   └── index.ts
    ├── ai-research/
    │   ├── components/
    │   ├── hooks/
    │   └── index.ts
    └── ...
```

### 9.2 Recommended Page Pattern

```typescript
// app/ai-ask/page.tsx (thin)
import { AIAskPage } from '@/components/features/ai-ask';

export default function Page() {
  return <AIAskPage />;
}

// components/features/ai-ask/AIAskPage.tsx (implementation)
'use client';

export function AIAskPage() {
  // All logic here
}
```

### 9.3 Recommended State Pattern

```typescript
// stores/ai-ask/index.ts
export { useAIAskStore } from "./store";
export { useAIAskActions } from "./actions";
export { selectCurrentSession } from "./selectors";
export type { AIAskState } from "./types";
```

---

## 10. Metrics & Monitoring

### 10.1 Current Metrics

| Metric                 | Value       | Target     |
| ---------------------- | ----------- | ---------- |
| Total Components       | 379         | -          |
| Average Component Size | ~300 lines  | <200 lines |
| Max Component Size     | 5,573 lines | <500 lines |
| Client Components      | 98%+        | <60%       |
| Code Coverage          | Unknown     | >70%       |

### 10.2 Recommended Tracking

- Bundle size per route (next/bundle-analyzer)
- Largest component files (lint rule)
- Server vs Client component ratio
- Test coverage per module

---

## Conclusion

The GenesisPod frontend demonstrates solid foundational choices (Next.js 14, Zustand, TypeScript) but suffers from:

1. **Oversized components** that need splitting
2. **Underutilization** of Next.js App Router capabilities
3. **Performance concerns** from synchronous heavy imports
4. **Inconsistent patterns** across modules

Priority should be given to splitting large components and implementing dynamic imports, as these provide the highest impact with moderate effort.

---

**Document Version**: 1.0
**Last Updated**: 2026-01-23
**Maintainer**: Architect Agent
