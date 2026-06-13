# Platform Evolution - Architecture Design

**Created**: 2026-02-05
**Last Updated**: 2026-02-05
**Version**: v1.0
**Author**: Claude Code
**Status**: Draft

---

## Design Principle: Extend, Don't Replace

All designs in this document build on existing implementations. No existing UI, API, or service is replaced or duplicated.

---

## Current Architecture (As-Is)

```
[Admin Console]
  |- /admin/ai/tools      -> ToolsManagement.tsx -> MCPMarketplaceTab (MCP servers)
  |                                               -> CapabilitiesTab (Tools)
  |- /admin/ai/skills     -> SkillsManagement.tsx -> LocalSkillsTab / SkillsMarketplaceTab
  |- /admin/ai/teams      -> AITeamsSettings.tsx  -> TeamBuilder + ITeamMember
  |- /admin/ai/models     -> AIModelSettings.tsx
  |- /admin/system/monitoring -> Error tracking, AI metrics, APM

[Backend Admin API]
  |- ai-admin.controller.ts  -> /admin/ai/tools, /skills, /mcp-servers (full CRUD)
  |- monitoring-admin.controller.ts -> /admin/monitoring/* (errors, metrics, health)

[AI Engine Core]
  |- MCP: BaseMCPClient -> StdioMCPClient (http/ws: NOT IMPLEMENTED)
  |       MCPManager -> register/connect/disconnect/callTool
  |       MCPToolAdapter -> wraps MCP tools as ITool
  |- Tools: ToolRegistry (200+ tools, 8 categories)
  |- Skills: SkillRegistry (layer/domain/tag indexing), BaseSkill
  |- Agents: AgentOrchestrator -> keyword-based routing -> execution
  |- Teams: Team + TeamBuilder + ITeamMember + ILeader + Workflow (DAG/Sequential)
  |         ConstraintEngine + ConstraintProfile

[AI Applications]
  |- Research: 40+ services, TopicResearchService, RAG-Fusion
  |- Writing, Office, Slides, Coding, Ask, Social
```

---

## Target Architecture (To-Be)

```
[Admin Console] (EXTEND existing pages)
  |- /admin/ai/tools      -> + "MCP Server Output" tab (Genesis-as-MCP-Server status)
  |- /admin/ai/teams      -> + "External Agent" option in member editor (A2A)
  |- /admin/system/monitoring -> + "Agent Traces" tab

[NEW: Protocol Gateway]
  |- MCP Server Module         -> Exposes Genesis capabilities to external AI tools
  |- A2A Gateway               -> /.well-known/agent.json + task lifecycle

[AI Engine Core] (EXTEND existing)
  |- MCP Client (EXTEND):
  |    BaseMCPClient
  |      |- StdioMCPClient     (existing)
  |      |- StreamableHttpMCPClient  (NEW - fills "not yet implemented")
  |      |- SSEMCPClient             (NEW - fills "not yet implemented")
  |    createMCPClient() factory updated
  |
  |- A2A (NEW module):
  |    |- AgentCardRegistry
  |    |- A2AClient / A2AServer
  |    |- A2ATeamMemberAdapter -> implements ITeamMember (!)
  |         fits into TeamBuilder.addMember() seamlessly
  |
  |- Guardrails (NEW module):
  |    |- InputGuardrail -> OutputGuardrail -> CostGuardrail
  |    |- Pipeline integrates into ai-orchestration.service.ts

[AI Applications] (EXTEND existing)
  |- Research 2.0:
  |    |- ResearchPlannerService       (NEW - plan before execute)
  |    |- AdaptivePlanningService      (NEW - adjust during execute)
  |    |- ResearchMemoryService        (NEW - cross-research knowledge)

[Observability] (EXTEND existing monitoring)
  |- TraceCollector               (NEW - execution-level spans)
  |- Extend monitoring dashboard  (NEW tab in existing page)
```

---

## Key Design: A2A as ITeamMember Adapter

The critical design decision: A2A agents become team members through the adapter pattern, not a parallel system.

```typescript
// Existing interface - NO CHANGES
interface ITeamMember {
  readonly id: TeamMemberId;
  readonly name: string;
  readonly role: IRole;
  readonly model: string;
  readonly skills: SkillId[];
  readonly tools: ToolId[];
  readonly persona: string;
  readonly workStyle: WorkStyle;
  status: MemberStatus;
  isLeader(): boolean;
  hasSkill(skillId): boolean;
  hasTool(toolId): boolean;
  getSystemPrompt(): string;
}

// NEW: A2A adapter implements the same interface
class A2ATeamMemberAdapter implements ITeamMember {
  constructor(
    private agentCard: A2AAgentCard,
    private a2aClient: A2AClientService,
  ) {}

  get name() {
    return this.agentCard.name;
  }
  get skills() {
    return this.mapCapabilitiesToSkills(this.agentCard.skills);
  }
  get tools() {
    return [];
  } // External agents manage their own tools

  // Status maps: A2A lifecycle -> MemberStatus
  // submitted -> thinking, working -> executing, completed -> completed

  getSystemPrompt() {
    return this.agentCard.description;
  }
  isLeader() {
    return false;
  } // External agents are always members, never leaders
}

// Usage in TeamBuilder - same API as internal members
const team = createTeamBuilder()
  .setName("Hybrid Research Team")
  .setLeader(leaderConfig, leaderRole) // internal leader
  .addMember(internalMember, researcherRole) // internal member
  .addMember(a2aAdapter, externalAnalystRole) // A2A external member (!)
  .setWorkflow(workflow)
  .build();
```

This means:

- Existing workflow execution works unchanged
- Leader can assign tasks to A2A members like any other member
- A2A is **opt-in per team** - zero impact on teams without external agents

---

## Key Design: MCP Transport Factory

Extend existing `createMCPClient()` without breaking stdio:

```typescript
// BEFORE (current):
export function createMCPClient(config: MCPServerConfig): IMCPClient {
  switch (config.transport) {
    case "stdio":
      return new StdioMCPClient(config);
    case "http":
    case "websocket":
      throw new Error(`Transport ${config.transport} not yet implemented`);
  }
}

// AFTER (extended):
export function createMCPClient(config: MCPServerConfig): IMCPClient {
  switch (config.transport) {
    case "stdio":
      return new StdioMCPClient(config);
    case "http":
      return new StreamableHttpMCPClient(config);
    case "sse":
      return new SSEMCPClient(config);
    default:
      throw new Error(`Unknown transport: ${config.transport}`);
  }
}
```

The MCPManager, MCPToolAdapter, and MCPToolRegistrar work unchanged - they only interact via `IMCPClient` interface.

---

## Key Design: Guardrails as Pipeline Middleware

Integrates into existing `ai-orchestration.service.ts`:

```
User Request
  -> [GuardrailsPipeline.processInput()]
  |    |- PromptInjectionDetector
  |    |- ContentSafetyFilter
  |    |- InputComplexityCheck
  -> [Existing AI Orchestration] (unchanged)
  |    |- CostGuardrail (inline check before each LLM call)
  -> [GuardrailsPipeline.processOutput()]
  |    |- SchemaValidator
  |    |- ContentComplianceCheck
  -> Response
```

Guardrails are **configurable via Admin settings** and can be enabled/disabled per use case.

---

## Related Documents

- [Platform Evolution Roadmap](../../prd/current/platform-evolution/platform-evolution-roadmap.md)
- [ADR-001: MCP Transport Extension](../../decisions/001-mcp-transport-extension.md)
- [ADR-002: Genesis as MCP Server](../../decisions/002-genesis-as-mcp-server.md)
- [ADR-003: A2A Protocol Adoption](../../decisions/003-a2a-protocol-adoption.md)
