# GenesisPod - Platform Evolution Roadmap v1.0

**Created**: 2026-02-05
**Last Updated**: 2026-02-05
**Version**: v1.0
**Author**: Claude Code
**Status**: Draft

---

## Executive Summary

GenesisPod already possesses a mature platform with comprehensive Admin management (MCP servers, Skills, Tools, Teams, Monitoring). This roadmap focuses on **filling the real gaps** that prevent Genesis from fully participating in the emerging AI Agent ecosystem.

---

## Current Capabilities Assessment

### What We Already Have (DO NOT DUPLICATE)

| Capability               | Implementation                                                               | Location                                                        |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| MCP Server Management UI | MCPMarketplaceTab (41.9KB), 15+ preset servers, env vars, connect/disconnect | `frontend/components/admin/tools/MCPMarketplaceTab.tsx`         |
| MCP Admin API            | Full CRUD + diagnose at `/admin/ai/mcp-servers`                              | `backend/src/modules/ai-infra/admin/ai-admin.controller.ts`     |
| MCP Client (stdio)       | StdioMCPClient + MCPManager + MCPToolAdapter                                 | `backend/src/modules/ai-engine/mcp/`                            |
| Skills Management UI     | LocalSkillsTab + SkillsMarketplaceTab + upload (JSON/YAML)                   | `frontend/components/admin/SkillsManagement.tsx`                |
| Skills Admin API         | Batch, upload, list, update at `/admin/ai/skills`                            | `ai-admin.controller.ts`                                        |
| Skills Public API        | Stats, search, popular, featured, categories, sync                           | `backend/src/modules/ai-engine/skills/api/skills.controller.ts` |
| Skills Registry          | BaseSkill + SkillRegistry (layer/domain/tag indexing)                        | `backend/src/modules/ai-engine/skills/`                         |
| Tools Management UI      | ToolsManagement (31.3KB) + CapabilitiesTab + ConfigureModal                  | `frontend/components/admin/ToolsManagement.tsx`                 |
| Tools Admin API          | Full CRUD + test + diagnose at `/admin/ai/tools`                             | `ai-admin.controller.ts`                                        |
| Tool Registry            | 200+ tools, 8 categories, compact/full mode                                  | `backend/src/modules/ai-engine/tools/`                          |
| Teams Management         | AITeamsSettings + TeamBuilder + ITeamMember + Workflows                      | `frontend/components/admin/ai-config/AITeamsSettings.tsx`       |
| Agent Orchestration      | AgentOrchestrator + AgentRegistry + SSE streaming                            | `backend/src/modules/ai-engine/agents/`                         |
| Monitoring               | Error tracking, AI metrics, APM, database health, security checks            | `monitoring-admin.controller.ts`                                |
| Secrets Manager          | Enterprise-grade with versioning, audit, rotation                            | `frontend/components/admin/SecretsManager.tsx`                  |

### Actual Gaps

| Gap                     | Current State                                                       | Target State                                            |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| MCP HTTP Transport      | `createMCPClient()` throws "not yet implemented" for http/websocket | Streamable HTTP + SSE transport working                 |
| Genesis as MCP Server   | Not implemented                                                     | Genesis exposes research/write/teams as MCP tools       |
| A2A Agent Interop       | Teams only support internal `ITeamMember`                           | External A2A agents can join as team members (optional) |
| Research Planning       | Black-box execution                                                 | Visible plan + user approval + dynamic adjustment       |
| Agent Trace             | Monitoring is error/metrics focused                                 | Full execution trace with span visualization            |
| Guardrails              | None                                                                | Input/output/cost guardrails pipeline                   |
| Skill Manifest Standard | Skills have basic metadata only                                     | Rich manifest with triggers, schemas, examples          |

---

## Phase 1: MCP Full Stack + Deep Research 2.0 (Week 1-4)

### 1.1 MCP HTTP/SSE Transport Implementation

**Priority**: P0 | **Effort**: 1 week | **ADR**: [001](../../decisions/001-mcp-transport-extension.md)

Fill the gap in `createMCPClient()` where http/websocket transports throw "not yet implemented".

**Scope:**

- Implement `StreamableHttpMCPClient` extending existing `BaseMCPClient`
  - HTTP POST for client->server, SSE for server->client
  - Session management with `Mcp-Session-Id` header
  - Auto-fallback: Streamable HTTP -> SSE -> stdio
- Implement `SSEMCPClient` for legacy server compatibility
- Update `createMCPClient()` factory to route correctly
- Add reconnect logic for remote servers
- **No UI changes needed** - existing MCPMarketplaceTab already has transport type selection

**Files to modify/create:**

```
backend/src/modules/ai-engine/mcp/
  client/
    streamable-http-mcp-client.ts    # NEW - extends BaseMCPClient
    sse-mcp-client.ts                # NEW - extends BaseMCPClient
    mcp-client.ts                    # MODIFY - update createMCPClient factory
  abstractions/
    mcp.interface.ts                 # MODIFY - add 'sse' to MCPTransportType
```

**Acceptance Criteria:**

- [ ] MCPMarketplaceTab preset servers with `http`/`sse` transport connect successfully
- [ ] Existing stdio servers continue to work
- [ ] Auto-fallback works when preferred transport unavailable
- [ ] Connection pooling for HTTP transport
- [ ] Unit tests for both transport modes

### 1.2 Genesis as MCP Server

**Priority**: P0 | **Effort**: 1.5 weeks | **ADR**: [002](../../decisions/002-raven-as-mcp-server.md)

Expose Genesis's core capabilities as an MCP Server so Claude Code, Cursor, ChatGPT Desktop etc. can call Genesis.

**Scope:**

- New NestJS module: `backend/src/modules/mcp-server/`
- Implements MCP protocol (JSON-RPC 2.0 over HTTP+SSE)
- Exposes tools:

| Tool                    | Wraps                | Description                |
| ----------------------- | -------------------- | -------------------------- |
| `genesis/research`      | TopicResearchService | Deep research on any topic |
| `genesis/write`         | AI Writing services  | Content generation         |
| `genesis/teams/debate`  | Teams debate flow    | Multi-agent debate         |
| `genesis/teams/analyze` | Teams analysis flow  | Multi-perspective analysis |
| `genesis/slides`        | AI Slides services   | Presentation generation    |

- Auth: API key guard (reuse existing Secrets Manager, category `MCP`)
- Rate limiting per key
- Streaming responses for long-running research

**Files to create:**

```
backend/src/modules/mcp-server/
  mcp-server.module.ts
  mcp-server.controller.ts          # MCP protocol endpoints
  mcp-server.service.ts             # Request routing
  tools/
    research-tool-handler.ts        # Wraps TopicResearchService
    writing-tool-handler.ts         # Wraps AI Writing
    teams-tool-handler.ts           # Wraps Teams
    slides-tool-handler.ts          # Wraps Slides
  guards/
    mcp-api-key.guard.ts            # API key auth
```

- **Admin UI**: Add "MCP Server" section in existing `/admin/ai/tools` page (new tab or section in ToolsManagement)
  - Show exposed tools, API key management, usage stats

### 1.3 Deep Research 2.0: Plan Transparency

**Priority**: P0 | **Effort**: 1.5 weeks

**Scope:**

- New service: `research-planner.service.ts`
  - Analyze topic, generate structured research plan
  - Plan includes: search queries, analysis dimensions, output structure, estimated steps
  - Uses `AiChatService.chat()` with `taskProfile: { creativity: 'low' }`
- Modify research flow:
  - Topic submission -> generate plan -> emit plan via WebSocket -> wait for approval -> execute
  - Plan approval/modification by user before execution starts
- Frontend:
  - `ResearchPlanViewer.tsx` - display plan with step list
  - `ResearchPlanEditor.tsx` - allow user to modify plan
  - Integrate into existing research UI (TopicResearch page)

**Files to create/modify:**

```
backend/src/modules/ai-app/research/
  services/
    research-planner.service.ts      # NEW
  dto/
    research-plan.dto.ts             # NEW

frontend/components/research/
  ResearchPlanViewer.tsx             # NEW
  ResearchPlanEditor.tsx             # NEW
```

### 1.4 Deep Research 2.0: Adaptive Planning

**Priority**: P1 | **Effort**: 1 week | **Depends on**: 1.3

**Scope:**

- New service: `adaptive-planning.service.ts`
  - After each research step: evaluate findings vs plan expectations
  - Detect gaps, contradictions, new angles
  - Generate plan adjustments (add/remove/reorder steps)
- Modify `ResearchLeaderService`:
  - After each step, invoke adaptive planner
  - Emit plan-change events to frontend via WebSocket
- Frontend: show plan changes in real-time (visual diff of steps)

### 1.5 Research Memory

**Priority**: P2 | **Effort**: 1 week

- New service: `research-memory.service.ts`
  - Store key findings from completed research (entities, relationships, sources)
  - When new research starts, query for relevant prior findings
  - Include prior context in planning phase
- Database: extend research results with memory index
- Frontend: "Related prior research" in research interface

---

## Phase 2: A2A Protocol (Teams-Compatible) + Observability (Week 5-8)

### 2.1 A2A Protocol: Agent Cards

**Priority**: P1 | **Effort**: 1 week | **ADR**: [003](../../decisions/003-a2a-protocol-adoption.md)

**Key principle**: A2A integrates INTO the existing Teams system, not beside it.

**Scope:**

- Define A2A Agent Card interface (JSON, per A2A spec v0.3)
- Generate cards for Genesis agents: Research Leader, Report Synthesizer, Debate Moderator, etc.
- Discovery endpoint: `GET /.well-known/agent.json`
- Agent Card registry for external agents

**Files to create:**

```
backend/src/modules/ai-engine/a2a/
  interfaces/
    agent-card.interface.ts
    a2a-task.interface.ts
  services/
    agent-card-registry.service.ts
  controllers/
    agent-card.controller.ts         # /.well-known/agent.json
```

### 2.2 A2A Protocol: Teams Adapter (External Agents as ITeamMember)

**Priority**: P1 | **Effort**: 2 weeks | **Depends on**: 2.1

**Key design**: External A2A agents implement `ITeamMember` via adapter pattern, fitting seamlessly into `TeamBuilder.addMember()`.

**Scope:**

- `A2ATeamMemberAdapter` implements `ITeamMember`:
  - Wraps an external A2A agent
  - `getSystemPrompt()` returns the agent's description from its Agent Card
  - `status` maps from A2A task lifecycle (`submitted -> thinking`, `working -> executing`, etc.)
  - `skills` and `tools` derived from Agent Card capabilities
  - Execution routes through A2A client (HTTP)

- `A2AClient` service:
  - Send tasks to external A2A agents
  - Receive results (polling or push)
  - Map A2A artifacts to `MemberOutput`

- Integration with existing Admin UI:
  - In `AITeamsSettings.tsx`, add "External Agent" option when adding team member
  - User provides A2A agent URL, system fetches Agent Card, validates capabilities
  - External member appears alongside internal members in team editor

- **This is an OPTION, not a replacement**: Teams work exactly as before. Adding external A2A agents is optional per-team configuration.

**Files to create:**

```
backend/src/modules/ai-engine/a2a/
  adapters/
    a2a-team-member-adapter.ts       # implements ITeamMember
  services/
    a2a-client.service.ts            # outbound A2A communication
    a2a-server.service.ts            # inbound A2A task handling
  a2a.module.ts

frontend/components/admin/ai-config/
  A2AAgentPicker.tsx                 # NEW - pick external agent for team
```

### 2.3 Agent Trace Visualization

**Priority**: P1 | **Effort**: 1.5 weeks

Current monitoring (`monitoring-admin.controller.ts`) focuses on error tracking and aggregate AI metrics. We need execution-level trace visualization.

**Scope:**

- Trace collector service:
  - Capture full agent execution traces (LLM calls, tool invocations, decisions)
  - Parent-child span relationships for nested agent/team calls
  - Token consumption and latency per span
- Extend existing monitoring dashboard with trace view:
  - Timeline of agent execution spans
  - Expandable spans showing input/output
  - Token usage breakdown per step
  - Filter by user, team, agent, time range

**Files to create/modify:**

```
backend/src/common/observability/
  services/
    trace-collector.service.ts       # NEW
  interfaces/
    trace.interface.ts               # NEW

frontend/components/admin/monitoring/
  AgentTraceViewer.tsx               # NEW
  TraceTimeline.tsx                  # NEW
  TraceSpanDetail.tsx                # NEW
```

- Integrate into existing `/admin/system/monitoring` page (new tab)

### 2.4 Guardrails Framework

**Priority**: P1 | **Effort**: 1.5 weeks

**Scope:**

- Input guardrails:
  - Prompt injection detection
  - Content safety filtering
  - Input length/complexity limits
- Output guardrails:
  - JSON schema validation for structured output
  - Content compliance checking
- Cost guardrails:
  - Per-user/team token budgets
  - Per-request cost limits
  - Automatic model downgrade on budget threshold
- Integrate into `ai-orchestration.service.ts` as pipeline middleware
- Admin configuration in existing settings (`/admin/system/site` or new section)

**Files to create:**

```
backend/src/modules/ai-engine/guardrails/
  guardrails.module.ts
  services/
    input-guardrail.service.ts
    output-guardrail.service.ts
    cost-guardrail.service.ts
    guardrails-pipeline.service.ts   # orchestrates all guardrails
  rules/
    prompt-injection-detector.ts
    content-safety-filter.ts
    schema-validator.ts
```

---

## Phase 3: Skill Manifest Standard + SDK (Week 9-14)

### 3.1 Skill Manifest Standard Enhancement

**Priority**: P2 | **Effort**: 2 weeks

Enhance existing `ISkill` interface and `SkillRegistry` with richer metadata.

**Scope:**

- Extend `skill.interface.ts` with manifest fields:
  - `triggers`: when to auto-activate (keyword patterns)
  - `inputSchema` / `outputSchema`: JSON Schema for I/O validation
  - `examples`: usage examples for documentation
  - `author`, `version`, `license`: packaging metadata
  - `permissions`: required capabilities
- Update `SkillsMarketplaceTab` to show enhanced manifest info
- Update `LocalSkillsTab` to validate manifest on upload
- Skill versioning and compatibility checking

**Files to modify:**

```
backend/src/modules/ai-engine/skills/
  abstractions/skill.interface.ts    # EXTEND ISkill
  registry/skill.registry.ts         # EXTEND with version/compat checking
  base/base-skill.ts                 # EXTEND with manifest support

frontend/components/admin/skills/
  SkillsMarketplaceTab.tsx           # ENHANCE with manifest display
  LocalSkillsTab.tsx                 # ENHANCE with manifest validation
```

### 3.2 TypeScript Agent SDK Extraction

**Priority**: P2 | **Effort**: 4 weeks

Extract Genesis's agent core into independent TypeScript SDK packages.

**Scope:**

- `@genesis/agent-core`: BaseAgent, Executor (DAG/Sequential), Registry
- `@genesis/agent-teams`: Team, TeamBuilder, Workflow, Constraints, ITeamMember
- `@genesis/agent-tools`: ITool, ToolRegistry, built-in tool interfaces
- `@genesis/agent-mcp`: MCP Client (all transports), MCP Server framework
- `@genesis/agent-a2a`: A2A Client, Agent Cards, Team Member Adapter

Internal modules remain as-is; SDK wraps internal interfaces. Feature flags control SDK vs internal paths.

---

## Phase 4: Ecosystem Operations (Week 15+, Ongoing)

### 4.1 AGENTS.md Support

- AI Coding module understands AGENTS.md project instructions
- Auto-generate AGENTS.md for Genesis-managed projects

### 4.2 Community Contributions

- Public skill repository
- Skill review workflow
- Contribution guidelines

### 4.3 Developer Documentation

- SDK getting-started guide
- API reference
- Tutorial series

---

## Risk Assessment

| Risk                                         | Probability | Impact | Mitigation                                           |
| -------------------------------------------- | ----------- | ------ | ---------------------------------------------------- |
| HTTP transport breaks existing stdio servers | Low         | High   | Factory pattern isolates transports, extensive tests |
| A2A adapter doesn't fit ITeamMember cleanly  | Medium      | Medium | Adapter pattern with interface compliance tests      |
| MCP Server exposes too much capability       | Low         | High   | Whitelist exposed tools, API key scoping             |
| Research plan adds latency to research flow  | Medium      | Low    | Make planning optional, add "quick research" mode    |

---

## Success Metrics

| Metric                              | Phase 1    | Phase 2 | Phase 3 |
| ----------------------------------- | ---------- | ------- | ------- |
| MCP HTTP connections working        | 5+ servers | 10+     | 15+     |
| External MCP tool calls/day         | 100        | 500     | 2000    |
| Genesis MCP Server external clients | 3+         | 10+     | 30+     |
| Research plan approval rate         | 70%        | 85%     | 90%     |
| A2A external agents in teams        | -          | 3+      | 10+     |
| Agent trace coverage                | -          | 80%     | 100%    |

---

## Related Documents

- [Architecture Design](../../architecture/platform-evolution/architecture-design.md)
- [ADR-001: MCP Transport Extension](../../decisions/001-mcp-transport-extension.md)
- [ADR-002: Genesis as MCP Server](../../decisions/002-raven-as-mcp-server.md)
- [ADR-003: A2A Protocol Adoption](../../decisions/003-a2a-protocol-adoption.md)
- [AI Engine Target Architecture](../../architecture/ai-engine/ai-engine-target-architecture.md)

---

**Next Review**: 2026-02-19
**Owner**: Genesis Team

