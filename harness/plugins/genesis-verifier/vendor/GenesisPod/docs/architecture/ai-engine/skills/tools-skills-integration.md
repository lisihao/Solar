# AI Tools & Skills Integration Design

> Version: 1.0
> Author: Architect Agent
> Date: 2025-01-20
> Status: Draft

---

## 1. Executive Summary

### 1.1 Background

GenesisPod's AI modules (Topic Research, AI Writing, AI Teams) currently have varying levels of integration with the AI Engine's Tools and Skills systems. This design document proposes a unified approach to ensure:

1. All AI modules use `AICapabilityResolver` as the single source of truth for available capabilities
2. `FunctionCallingExecutor` enables true LLM-driven tool invocation
3. Admin configurations (`ToolConfig.enabled = false`) are respected across all modules
4. Skills from `SkillRegistry` are accessible to AI agents
5. All tool/skill invocations are logged to `ai_usage_logs` for observability

### 1.2 Current State Analysis

| Module         | Tool Integration        | Skill Integration | Admin Config | Usage Logging |
| -------------- | ----------------------- | ----------------- | ------------ | ------------- |
| AI Engine Core | Partial                 | Partial           | Partial      | No            |
| Topic Research | Manual prompt injection | No                | No           | No            |
| AI Writing     | Manual prompt injection | No                | No           | No            |
| AI Teams       | Via AIEngineFacade      | No                | No           | No            |

### 1.3 Target State

```
+------------------+
|   Admin Panel    |  (ToolConfig, SkillConfig, MCPServerConfig)
+--------+---------+
         |
         v
+------------------+
| AICapabilityResolver |  <-- Single source of truth
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+-------+  +-------+
| Tools |  |Skills |
+---+---+  +---+---+
    |          |
    v          v
+----------------------------------+
|    FunctionCallingExecutor       |
| (ReAct loop with tool invocation)|
+--------+-------------------------+
         |
         v
+------------------+
|   AIUsageLog     |  (All invocations logged)
+------------------+
```

---

## 2. Architecture Design

### 2.1 Core Components

#### 2.1.1 AICapabilityResolver (Existing - Enhance)

**Location**: `backend/src/modules/ai-engine/capabilities/ai-capability-resolver.service.ts`

**Current Responsibilities**:

- Resolve available Tools for an Agent context
- Resolve available Skills for an Agent context
- Resolve available MCP Tools
- Check tool/skill availability
- Get tool/skill configurations

**Enhancements Needed**:

1. Add method to get `FunctionDefinition[]` for resolved tools
2. Add method to get skill prompts for resolved skills
3. Add caching layer for performance
4. Add usage logging hook

```typescript
// New methods to add
interface AICapabilityResolver {
  // Existing...

  // NEW: Get Function Definitions for LLM Function Calling
  async getToolFunctionDefinitions(context: AICapabilityContext): Promise<FunctionDefinition[]>;

  // NEW: Get Skill prompts for system message injection
  async getSkillPrompts(context: AICapabilityContext): Promise<SkillPromptBundle>;

  // NEW: Log capability usage
  async logCapabilityUsage(log: CapabilityUsageLog): Promise<void>;
}
```

#### 2.1.2 FunctionCallingExecutor (Existing - Enhance)

**Location**: `backend/src/modules/ai-engine/orchestration/executors/function-calling-executor.ts`

**Current Responsibilities**:

- Execute ReAct loop (Reasoning + Acting)
- Parse LLM tool calls
- Execute tools via ToolRegistry
- Handle retries

**Enhancements Needed**:

1. Integrate with `AICapabilityResolver` for tool availability
2. Add usage logging for each tool call
3. Support skill-enhanced prompts
4. Respect admin configuration (enabled/disabled)

```typescript
interface EnhancedFunctionCallingExecutor {
  // Enhanced execute method
  async *execute(
    llmAdapter: ILLMAdapter,
    systemPrompt: string,
    userPrompt: string,
    context: AICapabilityContext,  // NEW: Use context instead of tool IDs
    config?: ExecutionConfig,
  ): AsyncGenerator<AgentEvent>;
}
```

#### 2.1.3 AIEngineFacade (Existing - Enhance)

**Location**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`

**Enhancements Needed**:

1. Add `chatWithTools()` method for function calling
2. Expose `AICapabilityResolver` methods
3. Add skill-enhanced chat method

```typescript
interface AIEngineFacade {
  // Existing...

  // NEW: Chat with function calling
  async chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse>;

  // NEW: Get available capabilities for context
  async getAvailableCapabilities(context: AICapabilityContext): Promise<CapabilitySummary>;
}
```

### 2.2 Integration Points

#### 2.2.1 Topic Research Integration

**Files to Modify**:

1. `research-leader.service.ts`
2. `dimension-mission.service.ts`
3. `section-writer.service.ts`

**Integration Pattern**:

```
ResearchLeaderService
    |
    v
AIEngineFacade.chatWithSkills()  <-- Skills for research planning
    |
    v
DimensionMissionService
    |
    +---> LeaderToolService.generateEnhancedPlanningContext()
    |         |
    |         v
    |     AICapabilityResolver.resolveToolsForAgent()
    |         |
    |         v
    |     FunctionCallingExecutor.execute()  <-- web-search, federal-register, etc.
    |
    +---> SectionWriterService
              |
              v
          AIEngineFacade.chatWithSkills()  <-- Skills for section writing
```

#### 2.2.2 AI Writing Integration

**Files to Modify**:

1. `writing-mission.service.ts`
2. `chapter-writing.service.ts`

**Integration Pattern**:

```
WritingMissionService
    |
    v
StoryArchitectAgent.plan()
    |
    +---> AICapabilityResolver.resolveSkillsForAgent({ domain: "writing" })
    |
    v
WriterAgent.write()
    |
    +---> AIEngineFacade.chatWithSkills({ skills: ["narrative-craft", "dialogue"] })
    |
    v
ConsistencyCheckerAgent.check()
    |
    +---> AIEngineFacade.chatWithTools({ tools: ["rag-search"] })  <-- Search story bible
```

#### 2.2.3 AI Teams Integration

**Files to Modify**:

1. `team-mission.service.ts`
2. `mission-execution.service.ts`

**Integration Pattern**:

```
TeamMissionService
    |
    v
AICapabilityResolver.resolveAllCapabilities({ teamId, memberId })
    |
    +---> tools: ["web-search", "data-analysis"]
    +---> skills: ["research-planning", "critical-thinking"]
    +---> mcpTools: [{ serverId: "slack", toolName: "post_message" }]
    |
    v
MissionExecutionService.executeTask()
    |
    +---> FunctionCallingExecutor.execute(llmAdapter, prompt, context)
    |         |
    |         v
    |     Tool execution + Usage logging
    |
    v
AIUsageLog (persisted)
```

---

## 3. Data Model

### 3.1 Existing Models (No Changes)

```prisma
model ToolConfig {
  id          String   @id @default(uuid())
  toolId      String   @unique @map("tool_id")
  enabled     Boolean  @default(true)
  displayName String?  @map("display_name")
  description String?
  secretKey   String?  @map("secret_key")
  config      Json?
  requiresAuth Boolean @default(false)
  allowedRoles String[] @default([])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model SkillConfig {
  id           String   @id @default(uuid())
  skillId      String   @unique @map("skill_id")
  enabled      Boolean  @default(true)
  displayName  String?
  description  String?
  config       Json?
  allowedDomains String[] @default([])
  layer        String?
  domain       String?
  tags         String[] @default([])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model AIUsageLog {
  id             String   @id @default(uuid())
  capabilityType String   @map("capability_type")  // "tool" | "skill" | "mcp"
  capabilityId   String   @map("capability_id")
  userId         String?  @map("user_id")
  teamId         String?  @map("team_id")
  agentId        String?  @map("agent_id")
  success        Boolean
  duration       Int?
  tokensUsed     Int?     @map("tokens_used")
  errorCode      String?  @map("error_code")
  createdAt      DateTime @default(now())
}
```

### 3.2 New Types

```typescript
// backend/src/modules/ai-engine/capabilities/types.ts

export interface CapabilitySummary {
  tools: ToolSummary[];
  skills: SkillSummary[];
  mcpTools: MCPToolSummary[];
}

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  enabled: boolean;
  functionDefinition: FunctionDefinition;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain: string;
  layer: SkillLayer;
  enabled: boolean;
}

export interface MCPToolSummary {
  serverId: string;
  toolName: string;
  description?: string;
}

export interface CapabilityUsageLog {
  capabilityType: "tool" | "skill" | "mcp";
  capabilityId: string;
  userId?: string;
  teamId?: string;
  agentId?: string;
  missionId?: string;
  success: boolean;
  duration?: number;
  tokensUsed?: number;
  errorCode?: string;
  input?: unknown;
  output?: unknown;
}

export interface ChatWithToolsRequest {
  messages: ChatMessage[];
  context: AICapabilityContext;
  modelType?: AIModelType;
  model?: string;
  taskProfile?: TaskProfile;
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface ChatWithToolsResponse {
  content: string;
  model: string;
  tokensUsed: number;
  toolCalls: ToolCallRecord[];
  isError?: boolean;
}

export interface ToolCallRecord {
  toolId: string;
  input: unknown;
  output: unknown;
  success: boolean;
  duration: number;
}
```

---

## 4. Implementation Plan

### 4.1 Phase 1: Core Infrastructure (Week 1)

#### 4.1.1 Enhance AICapabilityResolver

**File**: `backend/src/modules/ai-engine/capabilities/ai-capability-resolver.service.ts`

**Changes**:

```typescript
// Add new methods

/**
 * Get Function Definitions for resolved tools
 */
async getToolFunctionDefinitions(
  context: AICapabilityContext
): Promise<FunctionDefinition[]> {
  const toolIds = await this.resolveToolsForAgent(context);
  return this.toolRegistry.getFunctionDefinitions(toolIds);
}

/**
 * Get Skill prompts bundle for resolved skills
 */
async getSkillPrompts(
  context: AICapabilityContext
): Promise<SkillPromptBundle> {
  const skillIds = await this.resolveSkillsForAgent(context);
  const skills = skillIds
    .map(id => this.skillRegistry.tryGet(id))
    .filter((s): s is ISkill => s !== undefined);

  return this.skillPromptBuilder.buildBundle(skills);
}

/**
 * Log capability usage to AIUsageLog
 */
async logCapabilityUsage(log: CapabilityUsageLog): Promise<void> {
  await this.prisma.aIUsageLog.create({
    data: {
      capabilityType: log.capabilityType,
      capabilityId: log.capabilityId,
      userId: log.userId,
      teamId: log.teamId,
      agentId: log.agentId,
      success: log.success,
      duration: log.duration,
      tokensUsed: log.tokensUsed,
      errorCode: log.errorCode,
    },
  });
}
```

#### 4.1.2 Enhance FunctionCallingExecutor

**File**: `backend/src/modules/ai-engine/orchestration/executors/function-calling-executor.ts`

**Changes**:

```typescript
// Add AICapabilityResolver dependency
constructor(
  private readonly toolRegistry: ToolRegistry,
  private readonly capabilityResolver: AICapabilityResolver,  // NEW
) {
  this.retryStrategy = new RetryStrategy();
}

// Add new execute method that uses AICapabilityContext
async *executeWithContext(
  llmAdapter: ILLMAdapter,
  systemPrompt: string,
  userPrompt: string,
  context: AICapabilityContext,
  config?: Partial<ExecutionConfig>,
): AsyncGenerator<AgentEvent> {
  // 1. Resolve available tools from context
  const toolIds = await this.capabilityResolver.resolveToolsForAgent(context);

  // 2. Get function definitions for available tools only
  const functionDefinitions = this.toolRegistry.getFunctionDefinitions(toolIds);

  // 3. Execute with logging
  for await (const event of this.execute(
    llmAdapter,
    systemPrompt,
    userPrompt,
    toolIds,
    { executionId: context.agentId || 'unknown', ...config?.toolContext },
    config,
  )) {
    // 4. Log tool calls
    if (event.type === 'tool_result') {
      await this.capabilityResolver.logCapabilityUsage({
        capabilityType: 'tool',
        capabilityId: event.tool,
        agentId: context.agentId,
        teamId: context.teamId,
        userId: context.userId,
        success: true,  // Adjust based on actual result
        duration: event.duration,
      });
    }

    yield event;
  }
}
```

#### 4.1.3 Add chatWithTools to AIEngineFacade

**File**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`

**Changes**:

```typescript
// Add new dependency
constructor(
  // ... existing
  @Optional() private readonly capabilityResolver?: AICapabilityResolver,
  @Optional() private readonly functionCallingExecutor?: FunctionCallingExecutor,
) { }

/**
 * Chat with function calling support
 */
async chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
  if (!this.capabilityResolver || !this.functionCallingExecutor) {
    throw new Error('Tool execution not available');
  }

  const toolCalls: ToolCallRecord[] = [];
  let finalContent = '';
  let totalTokens = 0;

  // Create LLM adapter
  const llmAdapter = this.createLLMAdapter(request.model || request.modelType);

  // Build system prompt with skill prompts if available
  let systemPrompt = request.systemPrompt || '';
  const skillPrompts = await this.capabilityResolver.getSkillPrompts(request.context);
  if (skillPrompts.content) {
    systemPrompt = `${skillPrompts.content}\n\n${systemPrompt}`;
  }

  // Execute with function calling
  for await (const event of this.functionCallingExecutor.executeWithContext(
    llmAdapter,
    systemPrompt,
    this.formatMessages(request.messages),
    request.context,
    {
      maxIterations: request.maxIterations || 10,
      maxToolCalls: request.maxToolCalls || 20,
    },
  )) {
    if (event.type === 'tool_result') {
      toolCalls.push({
        toolId: event.tool,
        input: event.input,
        output: event.output,
        success: true,
        duration: event.duration,
      });
    } else if (event.type === 'complete') {
      finalContent = event.result.summary;
      totalTokens = event.result.tokensUsed;
    } else if (event.type === 'error') {
      throw new Error(event.error);
    }
  }

  return {
    content: finalContent,
    model: request.model || 'default',
    tokensUsed: totalTokens,
    toolCalls,
  };
}

/**
 * Get available capabilities for a context
 */
async getAvailableCapabilities(
  context: AICapabilityContext
): Promise<CapabilitySummary> {
  if (!this.capabilityResolver) {
    return { tools: [], skills: [], mcpTools: [] };
  }

  const { tools, skills, mcpTools } = await this.capabilityResolver.resolveAllCapabilities(context);

  return {
    tools: tools.map(id => {
      const tool = this.toolRegistry?.tryGet(id);
      return {
        id,
        name: tool?.name || id,
        description: tool?.description || '',
        category: tool?.category || 'information',
        enabled: true,
        functionDefinition: tool?.toFunctionDefinition() || { name: id, description: '', parameters: {} },
      };
    }),
    skills: skills.map(id => {
      const skill = this.skillRegistry?.tryGet(id);
      return {
        id,
        name: skill?.name || id,
        description: skill?.description || '',
        domain: skill?.domain || 'common',
        layer: skill?.layer || 'domain',
        enabled: true,
      };
    }),
    mcpTools: mcpTools.map(t => ({
      serverId: t.serverId,
      toolName: t.toolName,
      description: t.description,
    })),
  };
}
```

### 4.2 Phase 2: Topic Research Integration (Week 2)

#### 4.2.1 Update LeaderToolService

**File**: `backend/src/modules/ai-app/research/topic-research/services/leader-tool.service.ts`

**Changes**:

```typescript
@Injectable()
export class LeaderToolService {
  constructor(
    private readonly aiFacade: AIEngineFacade,
    private readonly capabilityResolver: AICapabilityResolver, // NEW
  ) {}

  async generateEnhancedPlanningContext(params: {
    topicName: string;
    topicDescription?: string;
    dimensionName: string;
    searchTimeRange?: string;
  }): Promise<{ contextSummary: string }> {
    // 1. Define capability context for research
    const context: AICapabilityContext = {
      domain: "research",
      roleId: "research-leader",
    };

    // 2. Check which tools are available
    const availableTools =
      await this.capabilityResolver.resolveToolsForAgent(context);
    this.logger.log(
      `Available tools for research: ${availableTools.join(", ")}`,
    );

    // 3. If web-search is available, use function calling
    if (availableTools.includes("web-search")) {
      const result = await this.aiFacade.chatWithTools({
        messages: [
          {
            role: "user",
            content: `Research background for: ${params.topicName} - ${params.dimensionName}`,
          },
        ],
        context,
        taskProfile: { creativity: "low", outputLength: "medium" },
      });

      return { contextSummary: result.content };
    }

    // Fallback to direct chat
    return { contextSummary: "" };
  }
}
```

#### 4.2.2 Update SectionWriterService

**File**: `backend/src/modules/ai-app/research/topic-research/services/section-writer.service.ts`

**Changes**:

```typescript
@Injectable()
export class SectionWriterService {
  constructor(
    private readonly aiFacade: AIEngineFacade,
    // NEW: Remove direct tool calls, use chatWithSkills instead
  ) {}

  async writeSection(input: SectionWriteInput): Promise<SectionWriteResult> {
    const { section, evidenceData, modelId, temporalContext } = input;

    // 1. Use chatWithSkills for research writing
    const response = await this.aiFacade.chatWithSkills({
      messages: [
        { role: "system", content: SECTION_WRITING_SYSTEM_PROMPT },
        {
          role: "user",
          content: this.buildUserPrompt(section, evidenceData, temporalContext),
        },
      ],
      taskType: "research-writing",
      domain: "research",
      model: modelId,
      taskProfile: { creativity: "medium", outputLength: "long" },
    });

    return this.parseResult(section, response.content);
  }
}
```

### 4.3 Phase 3: AI Writing Integration (Week 3)

#### 4.3.1 Update WritingMissionService

**File**: `backend/src/modules/ai-app/writing/services/mission/writing-mission.service.ts`

**Changes**:

```typescript
@Injectable()
export class WritingMissionService {
  constructor(
    private readonly aiFacade: AIEngineFacade,
    private readonly capabilityResolver: AICapabilityResolver,  // NEW
    // ... existing
  ) {}

  private async executeChapterWriting(
    projectId: string,
    chapterId: string,
    outline: string,
  ): Promise<string> {
    // 1. Define capability context
    const context: AICapabilityContext = {
      domain: 'writing',
      roleId: 'writer-agent',
    };

    // 2. Get available skills for writing
    const skillPrompts = await this.capabilityResolver.getSkillPrompts(context);

    // 3. Build enhanced system prompt
    const systemPrompt = `${skillPrompts.content}\n\n${this.generateQualityConstraints(...)}`;

    // 4. Execute with skills
    const response = await this.aiFacade.chatWithSkills({
      messages: [
        { role: 'user', content: `Write chapter based on outline: ${outline}` },
      ],
      taskType: 'chapter-writing',
      domain: 'writing',
      additionalSkills: ['narrative-craft', 'dialogue-constraints'],
      taskProfile: { creativity: 'high', outputLength: 'extended' },
    });

    return response.content;
  }
}
```

### 4.4 Phase 4: AI Teams Integration (Week 4)

#### 4.4.1 Update TeamMissionService

**File**: `backend/src/modules/ai-app/teams/services/collaboration/mission/team-mission.service.ts`

**Changes**:

```typescript
@Injectable()
export class TeamMissionService {
  constructor(
    private readonly aiFacade: AIEngineFacade,
    private readonly capabilityResolver: AICapabilityResolver, // NEW
    // ... existing
  ) {}

  private async executeAgentTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
  ): Promise<void> {
    // 1. Build capability context from mission and task
    const context: AICapabilityContext = {
      teamId: mission.teamId,
      memberId: task.assignedTo?.id,
      userId: mission.createdById,
      domain: this.inferDomainFromTask(task),
    };

    // 2. Resolve all capabilities
    const capabilities =
      await this.capabilityResolver.resolveAllCapabilities(context);
    this.logger.log(
      `Agent ${task.assignedTo?.displayName} has access to:`,
      `tools=[${capabilities.tools.join(", ")}]`,
      `skills=[${capabilities.skills.join(", ")}]`,
    );

    // 3. Check if task needs function calling
    const needsToolUse = this.taskNeedsToolUse(task);

    if (needsToolUse && capabilities.tools.length > 0) {
      // Use function calling
      const result = await this.aiFacade.chatWithTools({
        messages: this.buildTaskMessages(task, mission),
        context,
        taskProfile: this.getTaskProfile(task),
      });

      await this.saveTaskResult(task, result);
    } else {
      // Use regular chat with skills
      const result = await this.aiFacade.chatWithSkills({
        messages: this.buildTaskMessages(task, mission),
        taskType: this.mapTaskTypeToSkillTask(task.type),
        domain: context.domain,
        taskProfile: this.getTaskProfile(task),
      });

      await this.saveTaskResult(task, result);
    }
  }

  private taskNeedsToolUse(task: AgentTask): boolean {
    return (
      task.type === TaskType.RESEARCH ||
      task.type === TaskType.DATA_ANALYSIS ||
      needsWebSearch(task.description || "")
    );
  }
}
```

---

## 5. File Modification Summary

### 5.1 AI Engine Core (Phase 1)

| File                                | Action | Description                                                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `ai-capability-resolver.service.ts` | Modify | Add `getToolFunctionDefinitions()`, `getSkillPrompts()`, `logCapabilityUsage()` |
| `function-calling-executor.ts`      | Modify | Add `executeWithContext()` that integrates with AICapabilityResolver            |
| `ai-engine.facade.ts`               | Modify | Add `chatWithTools()`, `getAvailableCapabilities()`                             |
| `capabilities/types.ts`             | Create | New type definitions                                                            |
| `capabilities/index.ts`             | Modify | Export new types                                                                |

### 5.2 Topic Research (Phase 2)

| File                           | Action | Description                                       |
| ------------------------------ | ------ | ------------------------------------------------- |
| `leader-tool.service.ts`       | Modify | Use `AICapabilityResolver` for tool resolution    |
| `section-writer.service.ts`    | Modify | Use `chatWithSkills()` instead of direct `chat()` |
| `dimension-mission.service.ts` | Modify | Pass capability context to services               |
| `research-leader.service.ts`   | Modify | Use skill-enhanced planning                       |

### 5.3 AI Writing (Phase 3)

| File                         | Action | Description                                             |
| ---------------------------- | ------ | ------------------------------------------------------- |
| `writing-mission.service.ts` | Modify | Integrate `AICapabilityResolver` for agent capabilities |
| `chapter-writing.service.ts` | Modify | Use `chatWithSkills()` for writing tasks                |
| `context-builder.service.ts` | Modify | Include skill prompts in context                        |

### 5.4 AI Teams (Phase 4)

| File                           | Action | Description                               |
| ------------------------------ | ------ | ----------------------------------------- |
| `team-mission.service.ts`      | Modify | Use `resolveAllCapabilities()` for agents |
| `mission-execution.service.ts` | Modify | Implement tool/skill dispatch logic       |
| `ai-response.service.ts`       | Modify | Support function calling responses        |

---

## 6. Implementation Details

### 6.1 Tool Availability Check Flow

```
1. Service calls AICapabilityResolver.resolveToolsForAgent(context)
   |
   v
2. AICapabilityResolver checks ToolConfig.enabled in database
   |
   +---> If no ToolConfig records exist -> Return all registered tools (default enabled)
   +---> If ToolConfig records exist -> Return only enabled tools
   |
   v
3. Apply team/role filters if applicable
   |
   v
4. Return final list of available tool IDs
```

### 6.2 Skill Loading Flow

```
1. Service calls AICapabilityResolver.resolveSkillsForAgent(context)
   |
   v
2. AICapabilityResolver checks SkillConfig.enabled in database
   |
   +---> If domain specified -> Filter by domain
   +---> Apply allowedDomains filter if configured
   |
   v
3. Load skill content via SkillLoaderService
   |
   v
4. Build skill prompts via SkillPromptBuilder
   |
   v
5. Return SkillPromptBundle with content and metadata
```

### 6.3 Usage Logging Flow

```
1. Tool/Skill execution completes
   |
   v
2. FunctionCallingExecutor emits 'tool_result' event
   |
   v
3. Caller captures event and calls AICapabilityResolver.logCapabilityUsage()
   |
   v
4. AICapabilityResolver creates AIUsageLog record
   |
   v
5. Admin can view usage in Admin Panel
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
// ai-capability-resolver.service.spec.ts

describe("AICapabilityResolver", () => {
  describe("resolveToolsForAgent", () => {
    it("should return all tools when no ToolConfig exists", async () => {
      // Mock empty ToolConfig table
      // Expect all registered tools
    });

    it("should respect ToolConfig.enabled = false", async () => {
      // Create ToolConfig with enabled: false
      // Expect tool to be excluded
    });

    it("should filter by team capabilities", async () => {
      // Create team with specific capabilities
      // Expect only mapped tools
    });
  });

  describe("logCapabilityUsage", () => {
    it("should create AIUsageLog record", async () => {
      // Call logCapabilityUsage
      // Verify record created
    });
  });
});
```

### 7.2 Integration Tests

```typescript
// function-calling-executor.integration.spec.ts

describe("FunctionCallingExecutor Integration", () => {
  it("should execute tools based on LLM decisions", async () => {
    // Setup LLM mock that returns tool_calls
    // Execute with context
    // Verify tool was called
    // Verify usage logged
  });

  it("should respect disabled tools", async () => {
    // Disable tool in ToolConfig
    // Execute with context
    // Verify tool NOT in function definitions
  });
});
```

### 7.3 E2E Tests

```typescript
// topic-research-tools.e2e.spec.ts

describe("Topic Research with Tools", () => {
  it("should use web-search when available", async () => {
    // Create research mission
    // Verify web-search tool called
    // Verify usage logged
  });

  it("should fallback gracefully when tools disabled", async () => {
    // Disable all tools
    // Create research mission
    // Verify mission completes without tools
  });
});
```

---

## 8. Migration Guide

### 8.1 For Existing Code

```typescript
// BEFORE: Direct tool call
const searchResults = await this.searchService.search(query);

// AFTER: Via capability resolver
const context: AICapabilityContext = { domain: "research" };
const availableTools =
  await this.capabilityResolver.resolveToolsForAgent(context);

if (availableTools.includes("web-search")) {
  const result = await this.aiFacade.chatWithTools({
    messages: [{ role: "user", content: `Search: ${query}` }],
    context,
  });
  // Handle result
} else {
  // Fallback logic
}
```

### 8.2 For New Features

Always use `AICapabilityResolver` as the single source of truth:

```typescript
@Injectable()
export class MyNewService {
  constructor(
    private readonly aiFacade: AIEngineFacade,
    private readonly capabilityResolver: AICapabilityResolver,
  ) {}

  async doSomething() {
    const context = { domain: "my-domain", userId: "..." };

    // Get available capabilities
    const caps = await this.capabilityResolver.resolveAllCapabilities(context);

    // Use chatWithTools or chatWithSkills based on needs
  }
}
```

---

## 9. Rollout Plan

### Week 1: Core Infrastructure

- [ ] Implement AICapabilityResolver enhancements
- [ ] Implement FunctionCallingExecutor enhancements
- [ ] Implement AIEngineFacade enhancements
- [ ] Write unit tests
- [ ] Deploy to dev environment

### Week 2: Topic Research

- [ ] Update LeaderToolService
- [ ] Update SectionWriterService
- [ ] Update DimensionMissionService
- [ ] Integration tests
- [ ] Deploy to staging

### Week 3: AI Writing

- [ ] Update WritingMissionService
- [ ] Update chapter writing services
- [ ] Integration tests
- [ ] Deploy to staging

### Week 4: AI Teams

- [ ] Update TeamMissionService
- [ ] Update mission execution
- [ ] Integration tests
- [ ] E2E tests
- [ ] Deploy to production

---

## 10. Observability

### 10.1 Metrics to Track

| Metric                           | Description                             | Alert Threshold |
| -------------------------------- | --------------------------------------- | --------------- |
| `ai_tool_calls_total`            | Total tool invocations                  | N/A             |
| `ai_tool_success_rate`           | Success rate by tool                    | < 90%           |
| `ai_tool_latency_p99`            | 99th percentile latency                 | > 30s           |
| `ai_skill_usage_total`           | Total skill usages                      | N/A             |
| `ai_capability_disabled_blocked` | Requests blocked by disabled capability | > 100/hour      |

### 10.2 Dashboard Queries

```sql
-- Most used tools in last 24h
SELECT capability_id, COUNT(*) as usage_count
FROM ai_usage_logs
WHERE capability_type = 'tool'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY capability_id
ORDER BY usage_count DESC
LIMIT 10;

-- Tool failure rate by team
SELECT team_id, capability_id,
       COUNT(*) FILTER (WHERE success = false) * 100.0 / COUNT(*) as failure_rate
FROM ai_usage_logs
WHERE capability_type = 'tool'
GROUP BY team_id, capability_id
HAVING COUNT(*) > 10
ORDER BY failure_rate DESC;
```

---

## 11. Security Considerations

### 11.1 Tool Access Control

- All tool access goes through `AICapabilityResolver`
- Role-based filtering via `ToolConfig.allowedRoles`
- Team-based filtering via team member capabilities
- User-level filtering for sensitive tools

### 11.2 Audit Trail

- All tool/skill invocations logged to `AIUsageLog`
- Input/output can be logged (configurable, disabled by default for privacy)
- Admin can view usage patterns and detect anomalies

### 11.3 Rate Limiting

- Per-user rate limits enforced at `AICapabilityResolver` level
- Per-tool rate limits configurable in `ToolConfig.config`
- Circuit breaker integration for external API tools

---

## 12. Appendix

### A. Capability to Tool Mapping

| AICapability Enum | Tool ID          | Description                                                                            |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------- |
| WEB_SEARCH        | web-search       | Web search via search engines                                                          |
| WEB_SCRAPER       | web-scraper      | Web page content extraction                                                            |
| DATA_FETCH        | data-fetch       | External API data fetching                                                             |
| RAG_SEARCH        | rag-search       | Full RAG pipeline: HyDE → hybrid vector+keyword RRF → Cohere rerank → parent retrieval |
| DATABASE_QUERY    | database-query   | SQL query execution                                                                    |
| KNOWLEDGE_GRAPH   | knowledge-graph  | Graph database queries                                                                 |
| TEXT_GENERATION   | text-generation  | LLM text generation                                                                    |
| IMAGE_GENERATION  | image-generation | Image generation                                                                       |
| CODE_GENERATION   | code-generation  | Code generation                                                                        |
| DATA_ANALYSIS     | data-analysis    | Data analysis tools                                                                    |
| FILE_PARSER       | file-parser      | Document parsing                                                                       |
| EXPORT_PPTX       | export-pptx      | PowerPoint export                                                                      |
| EXPORT_DOCX       | export-docx      | Word export                                                                            |
| EXPORT_PDF        | export-pdf       | PDF export                                                                             |

### B. Skill Domain Mapping

| Domain   | Skills                                                       | Use Case       |
| -------- | ------------------------------------------------------------ | -------------- |
| research | research-planning, evidence-evaluation, synthesis            | Topic Research |
| writing  | narrative-craft, dialogue-constraints, character-consistency | AI Writing     |
| slides   | outline-planning, content-generation, design-principles      | AI Slides      |
| common   | critical-thinking, summarization, formatting                 | All modules    |

---

**Document Status**: Draft
**Last Updated**: 2025-01-20
**Next Review**: 2025-01-27
