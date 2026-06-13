# AI Teams 集成测试

## 测试文件

### 1. `ai-teams-tool-integration.spec.ts`

**端到端工具集成测试**

测试工具调用的完整流程，包括：

- 工具解析和分配
- 工具调用流程
- WebSocket 事件推送
- 错误处理

#### 测试覆盖

##### 工具解析测试 (7/7 通过 ✅)

- ✅ 应该为 researcher 角色成员启用工具
- ✅ 应该为普通成员使用基础工具
- ✅ 应该根据 capabilities 分配工具
- ✅ Leader 角色应该获得协作工具
- ✅ Developer 角色应该获得代码工具
- ✅ Analyst 角色应该获得数据工具
- ✅ 成员不存在应该抛出错误

##### 工具调用流程测试 (0/2 ⏳)

- ⏳ 应该检测并使用工具模式
- ⏳ 应该在工具模式失败时降级到标准模式

##### WebSocket 事件推送测试 (0/4 ⏳)

- ⏳ 应该在工具调用时推送 tool:calling 事件
- ⏳ 应该在工具完成时推送 tool:result 事件
- ⏳ 应该在完成时推送 tool:complete 事件
- ⏳ 应该在错误时推送 tool:error 事件

##### 错误处理测试 (0/2 ⏳)

- ⏳ 工具调用失败应该降级到文本模式
- ⏳ LLM 调用失败应该返回错误消息

#### 当前测试结果

```
Tests:       8 failed, 7 passed, 15 total
Snapshots:   0 total
Time:        ~12-14s
```

#### 待解决问题

失败的 8 个测试都与 `AiResponseService.generateAIResponse` 的完整流程有关，需要：

1. **完善 SearchService Mock**
   - `search()` 方法需要返回正确格式
   - `formatResultsForContext()` 需要正确格式化结果

2. **完善 FunctionCallingExecutor Mock**
   - 确保异步生成器正确工作
   - 确保事件流正确触发

3. **简化测试场景**
   - 可以绕过搜索服务直接测试工具调用
   - 可以分离工具调用和消息生成逻辑

### 2. `team-member.agent.spec.ts`

**TeamMemberAgent 单元测试** ✅ 全部通过

测试 AI 成员的工具解析、工具执行和 Function Calling Schema 生成。

### 3. `team-collaboration.service.spec.ts`

**团队协作服务测试** ✅ 全部通过

测试任务委派、投票决策、共识机制。

## 运行测试

### 运行所有 AI Teams 测试

```bash
cd backend
npm test -- ai-teams
```

### 运行特定测试文件

```bash
# 工具集成测试
npm test -- ai-teams-tool-integration.spec.ts

# 成员 Agent 测试
npm test -- team-member.agent.spec.ts

# 协作服务测试
npm test -- team-collaboration.service.spec.ts
```

### 运行单个测试

```bash
npm test -- ai-teams-tool-integration.spec.ts --testNamePattern="应该为 researcher 角色成员启用工具"
```

## Mock 策略

### PrismaService

Mock 所有数据库查询，返回预设的 Topic 和 AIMember 数据。

### AiChatService

Mock LLM 调用，返回预设的响应数据。

### SearchService

Mock 搜索服务，返回空结果或预设结果。

### FunctionCallingExecutor

Mock 工具执行器，通过异步生成器返回预设的 AgentEvent 流。

### AiTeamsGateway

Mock WebSocket 网关，验证事件推送格式。

## 测试数据

### Mock AI Member (Researcher)

```typescript
{
  id: 'member-researcher',
  aiModel: 'gemini-pro',
  displayName: 'Researcher AI',
  roleDescription: 'Research and information gathering',
  systemPrompt: 'You are a researcher AI.',
  capabilities: [AICapability.WEB_SEARCH],
}
```

### Mock AI Member (General)

```typescript
{
  id: 'member-general',
  aiModel: 'gemini-pro',
  displayName: 'General AI',
  roleDescription: 'General assistant',
  systemPrompt: 'You are a general assistant.',
  capabilities: [],
}
```

## 下一步

### 短期 (修复失败测试)

1. 修复 SearchService mock 返回值格式
2. 修复 FunctionCallingExecutor 事件流
3. 确保所有 15 个测试通过

### 中期 (扩展测试覆盖)

1. 添加 AI-to-AI 通信测试
2. 添加多成员协作场景测试
3. 添加工具链式调用测试
4. 添加 LLM 切换测试 (Gemini/GPT/Claude)

### 长期 (性能和压力测试)

1. 工具调用性能基准测试
2. 并发成员响应测试
3. 大规模消息处理测试
4. WebSocket 连接稳定性测试

## 贡献指南

编写新测试时，请遵循以下原则：

1. **AAA 模式**: Arrange, Act, Assert
2. **单一职责**: 每个测试只验证一个行为
3. **独立性**: 测试之间不应相互依赖
4. **可读性**: 使用清晰的测试描述
5. **Mock 隔离**: 只 mock 外部依赖，不 mock 被测试的服务

## 参考

- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Jest Mock Functions](https://jestjs.io/docs/mock-functions)
- [AI Agents Core Tests](../../ai-agents/core/__tests__/)
