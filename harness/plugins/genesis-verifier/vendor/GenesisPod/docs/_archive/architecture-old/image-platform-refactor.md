# Image Platform Refactor Blueprint

## Scope

- Consolidate AI Image Generator requirements into a reusable platform capability.
- Separate platform-level services/components from business-specific modules.
- Provide a path toward shared AI orchestration, content processing, and UI design system.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Presentation                         │
│  Platform UI Kit (Design System)                             │
│    ├─ Layout shells (3-column, responsive)                   │
│    ├─ Gallery rails / asset cards                            │
│    ├─ Insights cards / timeline widgets                      │
│    ├─ Prompt input suite (textarea + mentions + source pool) │
│    ├─ Status + toast components                              │
│                                                             │
│  Business UI bundles                                         │
│    ├─ Image Generator workspace                              │
│    ├─ YouTube Deep Dive module                               │
│    ├─ Knowledge Library                                      │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                       Experience Services                    │
│  Platform Services                                           │
│    ├─ Content pipeline (URL/file ingestion, parsing)         │
│    ├─ Knowledge service (notes, tags, graph)                 │
│    ├─ AI orchestration (model registry, prompt templates)    │
│    ├─ Prompt insight generator (structured JSON outputs)     │
│    ├─ Generation task service (status, history, bookmarking) │
│    ├─ Audit/logging                                          │
│                                                             │
│  Business Services                                           │
│    ├─ Image creation workflows                               │
│    ├─ Video Q&A + summarisation                              │
│    ├─ Report/infographic assembly                           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                       Data & Integration                     │
│  External Connectors (YouTube, ArXiv, news feeds, etc.)      │
│  Model Providers (Gemini, OpenAI, Imagen, custom)            │
│  Data stores (Postgres/Prisma, Object storage, Search)       │
└─────────────────────────────────────────────────────────────┘

## Platform vs Business Breakdown

| Layer              | Platform Components                                                | Business Assemblies                                       |
|--------------------|--------------------------------------------------------------------|-----------------------------------------------------------|
| Frontend UI        | Layout shells, Gallery rail, Insights panels, Prompt input suite,  | Image generator workspace, YouTube insights UI,           |
|                    | Timeline widgets, Status/Toast system, Theming tokens              | Research/consulting templates                             |
| Backend Services   | Content pipeline, Knowledge API, AI orchestration, Prompt insight  | Domain workflows (image refine flow, video deep dive),    |
|                    | generator, Task tracking, Audit/monitoring                         | Domain-specific routing (e.g. report builder)             |
| AI Services        | Model catalog, Prompt templates, Structured output parser,         | Scenario prompts (consulting infographic, marketing copy) |
|                    | Invocation router, Logging                                         |                                                           |

## Current Pain Points
- AI Image Generator component ~2000 LOC mixing layout, insights rendering, input modes, and business logic.
- Prompt insights parsing only used by image module but needed platform-wide (reports, creative tools).
- Repeated UI patterns (thumbnail rails, insight cards, processing timeline) reimplemented per page.
- AI service selection / prompt enhancement logic tightly coupled with image feature.
- Lack of centralized content ingestion fallback (YouTube dynamic import hacks, subtitle parsing).
- Mojibake characters introduced by inconsistent encoding.

## Refactor Goals
1. **Modular Frontend**
   - Extract shared UI primitives: `GalleryRail`, `CanvasPane`, `InsightsPanel`, `ProcessingTimeline`, `PromptInputSuite`.
   - Establish design tokens for dark theme (colors, typography, spacing).
   - Provide responsive variants (desktop three-column, mobile top-rail).

2. **Platform Services**
   - unify YouTube transcript logic under `content-ingestion` service with fallback hierarchy.
   - generalize prompt enhancement + negative keyword injection into `prompt-insight` service returning structured JSON.
   - standardize history/bookmark APIs across image/text generators.
   - integrate AI orchestration: model registry, default selection, invocation router, structured output validation.

3. **Business Modules**
   - Image Generator workspace composes platform components: gallery shell + prompt insights + input suite.
   - YouTube Deep Dive uses shared note editor, AI chat, content pipeline.
   - Reporting/consulting builder leverages prompt insights cards, layout plan templates, quality checklist.

4. **Operationalization**
   - Logging + telemetry pipeline for content ingestion, AI calls, fallback usage.
   - Type-safe contracts: `PromptInsights`, `GenerationTask`, `ContentSource`.
   - Tests: component snapshots, integration tests for prompt insight rendering, API contract tests.

## Component Extraction Plan

### Frontend

| New Component / Module               | Responsibilities                                    | Source(s)                                                      |
|-------------------------------------|------------------------------------------------------|----------------------------------------------------------------|
| `GalleryRail`                       | Vertical/Horizontal thumbnail rail with wheel nav   | `ImageGenerator.tsx` (left rail logic, gallery scroll handler) |
| `CanvasPane`                        | Main image display + action buttons + overlays      | `ImageGenerator.tsx` (central canvas)                          |
| `InsightsPanel`                     | Render prompt insights JSON into cards              | `ImageGenerator.tsx` (insights rendering block)                |
| `ProcessingTimeline`                | Timeline of processing steps/status                 | `ImageGenerator.tsx` (renderProcessingSteps)                   |
| `PromptInputSuite`                  | Input modes, textarea with mentions, source pool    | `ImageGenerator.tsx`, `SourcePool`, mention logic              |
| `ModelControls`                     | Image model dropdown, aspect ratio, toggles         | `ImageGenerator.tsx` (top bar)                                 |
| `Lightbox` / `ContextMenu`          | Reusable overlay + action menu                      | `ImageGenerator.tsx`                                           |
| `StatusIndicator`                   | AI running status, error banner                      | `ImageGenerator.tsx`, global notifications                     |

### Backend

| Service / Module                    | Responsibilities                                    | Notes                                                          |
|-------------------------------------|------------------------------------------------------|----------------------------------------------------------------|
| `content-ingestion` service         | URL parsing, fallback strategies, caching           | Wrap YouTube transcript workflow, extend to papers/articles    |
| `prompt-insight` service            | Structured prompt generation (journal/layout/QA)    | Already partially in `ai-image.service` -> extract + reuse     |
| `generation-task` service           | Track status, history, bookmarks across generators  | Shared by image + text + report modules                        |
| `ai-orchestration` module           | Model registry, default selection, invocation router| Consolidate model fetching, error handling, metrics            |
| `knowledge-service`                 | Notes, tags, graph linking, highlights              | Already used in multiple pages -> formalize API                |
| `audit-log` middleware              | Request/response audit for AI + ingestion           | Supports compliance + debugging                                |

### AI Layer
- Model catalog + metadata: provider, modalities, quotas, response schema.
- Prompt template registry: text + image + report patterns, with versioning.
- Structured output validator: JSON schema enforcement, fallback prompts.
- Prompt insight tracer: record reasoning, layout decisions, quality checks for reuse in UI.

## Migration Steps
1. **Inventory & Schema**
   - Document current prompt insight JSON schema.
   - Define shared TypeScript interfaces (`PromptInsights`, `GenerationTask`).
2. **Build UI Kit**
   - Create `ui/ai` component folder; migrate gallery/insights/timeline into isolated components with stories.
   - Replace usage in `ImageGenerator.tsx` to reduce inline JSX.
3. **Service Extraction**
   - Move prompt enhancement logic from `ai-image.service.ts` into `prompt-insight.service.ts`.
   - Wrap youtube transcript logic into `content-ingestion.service.ts` with fallback strategy.
4. **API Harmonization**
   - Introduce `/api/v1/generation/tasks` for history/bookmarks status.
   - Ensure `promptInsights` returned by other generators reuse same schema.
5. **Testing & Hardening**
   - Run `npm run type-check`, component tests, end-to-end flows.
   - Add monitoring for structured JSON parse errors, fallback usage rates.
6. **Business Module Reassembly**
   - Rebuild Image Generator page using new components/services.
   - Document assembly guidelines for future modules (YouTube, consulting reports).

## Risks & Mitigations
- **Large refactor surface** → Incremental migration with feature flags; maintain compatibility layers.
- **Structured JSON changes** → Version prompt schema, provide backward compatibility translator.
- **Cross-team adoption** → Document components/services, provide samples, run internal workshops.
- **Model drift / API rate limits** → Centralize orchestration to monitor usage and swap models.

## Next Actions
1. Approve architecture blueprint and component extraction scope.
2. Spin up platform squad tasked with design system + AI orchestration + ingestion.
3. Schedule Image Generator refactor sprint leveraging new components.
4. Extend documentation with API contracts and component usage guidelines.

```
