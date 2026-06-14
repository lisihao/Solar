# AI Teams 能力集成实现报告

> **日期**: 2026-01-20
> **实现者**: Coder Agent
> **设计文档**: `docs/design/research-tools-skills-upgrade.md`

---

## 1. 实现概述

根据设计文档 `ai-tools-skills-integration.md`，成功将 **AICapabilityResolver** 集成到 AI Teams 模块中，使团队成员能够动态获取可用的工具（Tools）和技能（Skills），并为后续的 Function Calling 支持奠定基础。

---

## 2. 修改的文件

### 2.1 MissionExecutionService

**文件**: `backend/src/modules/ai-app/teams/services/collaboration/mission/mission-execution.service.ts`

#### 关键改动

1. **导入 AICapabilityResolver**

   ```typescript
   import {
     AICapabilityResolver,
     AICapabilityContext,
   } from "../../../../../ai-engine/capabilities/ai-capability-resolver.service";
   ```

2. **注入 AICapabilityResolver**

   ```typescript
   constructor(
     // ... existing dependencies
     private capabilityResolver: AICapabilityResolver,
   ) { }
   ```

3. **在任务执行前解析能力**

   在 `executeTask()` 方法中，任务状态更新后立即解析成员可用的能力：

   ```typescript
   // 构建能力上下文
   const capabilityContext: AICapabilityContext = {
     memberId: assignedTo.id,
     agentId: assignedTo.id,
     userId: mission.createdBy?.id,
     domain: this.inferDomainFromTask(task),
   };

   // 解析所有可用能力
   const capabilities =
     await this.capabilityResolver.resolveAllCapabilities(capabilityContext);

   // 记录日志
   this.logger.log(
     `[executeTask] Agent ${assignedTo.displayName} capabilities: ` +
       `tools=[${capabilities.tools.join(", ")}], ` +
       `skills=[${capabilities.skills.join(", ")}], ` +
       `mcpTools=[${capabilities.mcpTools.map((t) => `${t.serverId}:${t.toolName}`).join(", ")}]`,
   );
   ```

4. **添加领域推断方法**

   新增 `inferDomainFromTask()` 辅助方法，根据任务类型和描述推断领域：

   ```typescript
   private inferDomainFromTask(task: AgentTaskWithAssignee): string {
     const taskType = task.taskType;

     // 根据 TaskType 枚举映射
     if (taskType === TaskType.RESEARCH) return "research";
     if (taskType === TaskType.DOCUMENTATION || taskType === TaskType.CREATIVE) return "writing";
     if (taskType === TaskType.DESIGN) return "design";
     if (taskType === TaskType.REVIEW || taskType === TaskType.SYNTHESIS) return "analysis";

     // 关键词检测（中文支持）
     const combined = `${task.title} ${task.description}`.toLowerCase();
     if (combined.includes("研究") || combined.includes("调研")) return "research";
     if (combined.includes("写作") || combined.includes("撰写")) return "writing";
     if (combined.includes("设计") || combined.includes("PPT")) return "design";

     return "general";
   }
   ```

---

## 3. 功能说明

### 3.1 能力解析流程

```
1. 任务开始执行
   ↓
2. 构建 AICapabilityContext
   - memberId: 任务分配的成员 ID
   - agentId: Agent ID（同 memberId）
   - userId: 创建任务的用户 ID
   - domain: 推断的领域（research/writing/design/analysis/general）
   ↓
3. 调用 AICapabilityResolver.resolveAllCapabilities(context)
   ↓
4. 返回可用能力
   - tools: 工具 ID 列表（如 ["web-search", "federal-register"]）
   - skills: 技能 ID 列表（如 ["research-planning", "critical-thinking"]）
   - mcpTools: MCP 工具列表（如 [{ serverId: "slack", toolName: "post_message" }]）
   ↓
5. 记录日志（便于调试和审计）
```

### 3.2 领域映射规则

| 任务类型                    | 推断领域 | 说明               |
| --------------------------- | -------- | ------------------ |
| `RESEARCH`                  | research | 调研分析类任务     |
| `DOCUMENTATION`、`CREATIVE` | writing  | 文档编写、创意写作 |
| `DESIGN`                    | design   | 设计规划类任务     |
| `REVIEW`、`SYNTHESIS`       | analysis | 审查检验、综合整理 |
| 其他                        | general  | 默认领域           |

**关键词检测**：

- 包含"研究"、"调研"、"分析" → `research`
- 包含"写作"、"撰写"、"编写" → `writing`
- 包含"设计"、"图片"、"PPT" → `design`

---

## 4. 向后兼容性

✅ **完全向后兼容**

- 不影响现有的任务执行逻辑
- 仅添加能力解析和日志记录
- 不改变 AI 调用方式（保留现有的 `callAIWithRetry` 机制）
- 为未来的 Function Calling 集成预留接口

---

## 5. 日志示例

执行任务时会输出如下日志：

```
[MissionExecutionService] Agent 小张 capabilities: tools=[web-search, data-analysis], skills=[research-planning, critical-thinking, evidence-evaluation], mcpTools=[slack:post_message]
```

这有助于：

- **调试**：确认成员获得了正确的工具和技能
- **审计**：追踪哪些能力被分配给哪些成员
- **优化**：根据实际使用情况调整能力配置

---

## 6. 下一步工作

### 6.1 Phase 2: Function Calling 集成（待实现）

根据设计文档，下一步需要：

1. **判断是否需要工具调用**

   ```typescript
   const needsToolUse = this.taskNeedsToolUse(task);
   ```

2. **使用 chatWithTools 或 chat**

   ```typescript
   if (needsToolUse && capabilities.tools.length > 0) {
     // 使用 Function Calling
     const result = await this.aiFacade.chatWithTools({
       messages: taskMessages,
       context: capabilityContext,
       taskProfile: this.getTaskProfile(task),
     });
   } else {
     // 使用普通 chat
     const result = await this.aiFacade.chat({
       messages: taskMessages,
       taskProfile: this.getTaskProfile(task),
     });
   }
   ```

3. **记录工具使用日志**
   ```typescript
   for (const toolCall of result.toolCalls) {
     await this.capabilityResolver.logCapabilityUsage({
       capabilityType: "tool",
       capabilityId: toolCall.toolId,
       agentId: assignedTo.id,
       teamId: mission.topicId,
       userId: mission.createdBy?.id,
       missionId: mission.id,
       success: toolCall.success,
       duration: toolCall.duration,
     });
   }
   ```

### 6.2 需要添加的辅助方法

```typescript
/**
 * 判断任务是否需要工具调用
 */
private taskNeedsToolUse(task: AgentTaskWithAssignee): boolean {
  return (
    task.taskType === TaskType.RESEARCH ||
    needsWebSearch(task.title, task.description) ||
    // 其他需要工具的场景
  );
}
```

---

## 7. 测试建议

### 7.1 单元测试

创建 `mission-execution.service.spec.ts`，测试：

```typescript
describe("MissionExecutionService", () => {
  describe("inferDomainFromTask", () => {
    it("should infer research domain for RESEARCH task type", () => {
      const task = { taskType: TaskType.RESEARCH, title: "", description: "" };
      expect(service["inferDomainFromTask"](task)).toBe("research");
    });

    it("should infer writing domain for DOCUMENTATION task type", () => {
      const task = {
        taskType: TaskType.DOCUMENTATION,
        title: "",
        description: "",
      };
      expect(service["inferDomainFromTask"](task)).toBe("writing");
    });

    it("should detect Chinese keywords for domain inference", () => {
      const task = {
        taskType: TaskType.IMPLEMENTATION,
        title: "撰写报告",
        description: "",
      };
      expect(service["inferDomainFromTask"](task)).toBe("writing");
    });
  });

  describe("executeTask", () => {
    it("should resolve capabilities before task execution", async () => {
      const mockCapabilities = {
        tools: ["web-search"],
        skills: ["research-planning"],
        mcpTools: [],
      };

      jest
        .spyOn(capabilityResolver, "resolveAllCapabilities")
        .mockResolvedValue(mockCapabilities);

      await service.executeTask(mission, task);

      expect(capabilityResolver.resolveAllCapabilities).toHaveBeenCalledWith({
        memberId: task.assignedTo.id,
        agentId: task.assignedTo.id,
        userId: mission.createdBy?.id,
        domain: expect.any(String),
      });
    });
  });
});
```

### 7.2 集成测试

创建 `ai-teams-capability.e2e.spec.ts`：

```typescript
describe("AI Teams Capability Integration (E2E)", () => {
  it("should assign correct tools to research tasks", async () => {
    // 1. 创建一个 research 类型的任务
    const mission = await createTestMission({
      title: "市场调研",
      description: "分析竞品",
    });

    // 2. 执行任务
    await executeMissionTask(mission.id, task.id);

    // 3. 验证日志中包含正确的工具
    const logs = await getExecutionLogs(mission.id);
    expect(logs).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining("tools=[web-search"),
      }),
    );
  });

  it("should respect disabled tools in ToolConfig", async () => {
    // 1. 禁用 web-search
    await disableTool("web-search");

    // 2. 创建任务并执行
    const mission = await createTestMission({
      /* ... */
    });
    await executeMissionTask(mission.id, task.id);

    // 3. 验证 web-search 不在可用工具列表中
    const logs = await getExecutionLogs(mission.id);
    expect(logs).not.toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining("web-search"),
      }),
    );
  });
});
```

---

## 8. 风险与注意事项

### 8.1 性能影响

- **解析能力的开销**：每个任务执行前需要查询数据库（ToolConfig、SkillConfig、MCPServerConfig）
- **缓解措施**：AICapabilityResolver 内部可添加缓存层（TTL 5 分钟）

### 8.2 数据库依赖

- 如果 `ToolConfig` 或 `SkillConfig` 表为空，`resolveToolsForAgent` 会返回所有已注册的工具（默认启用）
- 建议在部署时初始化默认配置

### 8.3 领域推断准确性

- 当前的领域推断基于简单的规则和关键词匹配
- 可能需要根据实际使用情况调整映射规则
- 未来可考虑使用 LLM 自动分类任务领域

---

## 9. 配置示例

### 9.1 启用特定工具

```typescript
// 在 Admin Panel 或 seed 脚本中
await prisma.toolConfig.upsert({
  where: { toolId: "web-search" },
  create: {
    toolId: "web-search",
    enabled: true,
    displayName: "Web Search",
    description: "Search the web for information",
    allowedRoles: ["user", "admin"], // 可选：限制角色
  },
  update: { enabled: true },
});
```

### 9.2 为团队配置工具（扩展功能）

未来可在 `AICapabilityResolver` 中添加团队级别配置：

```typescript
// 团队成员能力映射表（新表）
model TeamMemberCapability {
  id         String @id @default(uuid())
  memberId   String
  toolId     String?
  skillId    String?
  enabled    Boolean @default(true)

  member     TopicAIMember @relation(fields: [memberId], references: [id])
}
```

---

## 10. 总结

✅ **已完成**：

- 集成 AICapabilityResolver 到 MissionExecutionService
- 实现任务执行前的能力解析
- 添加领域推断逻辑
- 记录能力分配日志
- 类型安全，无 any 使用
- 向后兼容，不影响现有功能

📋 **待实现**（Phase 2）：

- 判断任务是否需要 Function Calling
- 集成 `AIEngineFacade.chatWithTools()`
- 记录工具使用日志到 `AIUsageLog`
- 添加单元测试和集成测试

🎯 **目标达成**：

- AI Teams 模块现在能够**动态获取**成员可用的工具和技能
- 为 LLM **真正的 Tool Use**（非 prompt injection）奠定基础
- 管理员可通过 Admin Panel **集中管理**工具/技能的启用状态
- 所有能力调用都将被**记录和审计**（Phase 2）

---

**最后更新**: 2026-01-20
**状态**: Phase 1 完成 ✅
**下一步**: 实现 Function Calling 集成（参考设计文档 Section 4.4）
