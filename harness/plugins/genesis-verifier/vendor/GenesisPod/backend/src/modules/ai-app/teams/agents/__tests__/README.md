# AI Teams Agent 测试文档

## 测试文件

### 1. TeamMemberAgent 测试

**文件**: `team-member.agent.spec.ts`

**测试覆盖**: 42 个测试用例

#### 测试模块

##### resolveTools (11 测试)

- ✅ 为 researcher 角色分配搜索和知识工具
- ✅ 为 analyst 角色分配数据分析工具
- ✅ 为 developer 角色分配代码工具
- ✅ 为 writer 角色分配文档工具
- ✅ 为 leader 角色分配协作工具
- ✅ 根据 capabilities 分配额外工具
- ✅ 根据 expertiseAreas 推断工具
- ✅ 为 Leader 添加额外的协作工具
- ✅ 添加自定义工具
- ✅ 为所有成员添加 SHORT_TERM_MEMORY
- ✅ 去重工具列表（不重复添加）

##### inferRoleFromDescription (9 测试)

- ✅ 从描述中推断 leader 角色
- ✅ 从描述中推断 researcher 角色
- ✅ 从描述中推断 analyst 角色
- ✅ 从描述中推断 developer 角色
- ✅ 从描述中推断 designer 角色
- ✅ 从描述中推断 writer 角色
- ✅ 从描述中推断 moderator 角色
- ✅ 无法识别时返回 general
- ✅ 大小写不敏感

##### getToolInstances (3 测试)

- ✅ 返回已注册的工具实例列表
- ✅ 跳过未注册的工具并记录警告
- ✅ 空列表返回空数组

##### executeTool (4 测试)

- ✅ 成功执行工具
- ✅ 处理工具未找到的情况
- ✅ 处理工具执行失败的情况
- ✅ 返回执行时长

##### executeToolsParallel (2 测试)

- ✅ 并行执行多个工具
- ✅ 处理部分工具失败的情况

##### executeToolsSequential (2 测试)

- ✅ 按顺序执行多个工具
- ✅ 失败后继续执行剩余工具

##### generateFunctionCallingSchema (2 测试)

- ✅ 生成正确的 Function Calling Schema
- ✅ 跳过未注册的工具

##### buildToolsSystemPrompt (3 测试)

- ✅ 生成包含工具描述的提示词
- ✅ 空工具列表返回空字符串
- ✅ 跳过未注册的工具

##### getExecutionStrategy (6 测试)

- ✅ AUTONOMOUS 工作风格返回并行、高并发策略
- ✅ COLLABORATIVE 工作风格返回中等并发策略
- ✅ ANALYTICAL 工作风格返回顺序执行策略
- ✅ CREATIVE 工作风格返回并行、不重试策略
- ✅ SUPPORTIVE 工作风格返回低并发策略
- ✅ null 工作风格返回默认策略

---

## 运行测试

### 运行所有 Agent 测试

```bash
cd backend
npm test -- team-member.agent.spec.ts
```

### 运行特定测试

```bash
# 只运行 resolveTools 测试
npm test -- team-member.agent.spec.ts -t "resolveTools"

# 只运行角色推断测试
npm test -- team-member.agent.spec.ts -t "inferRoleFromDescription"
```

### 查看覆盖率

```bash
npm run test:coverage -- team-member.agent.spec.ts
```

---

## Mock 工具

测试使用以下 Mock 工具：

1. **MockWebSearchTool** - 模拟 WEB_SEARCH
2. **MockCodeGenerationTool** - 模拟 CODE_GENERATION
3. **MockDataAnalysisTool** - 模拟 DATA_ANALYSIS

---

## 关键测试场景

### 角色-工具映射

测试验证了每个角色都能获得正确的工具集：

- Researcher → 搜索工具（WEB_SEARCH, RAG_SEARCH, KNOWLEDGE_GRAPH）
- Analyst → 数据工具（DATA_ANALYSIS, PYTHON_EXECUTOR）
- Developer → 代码工具（CODE_GENERATION, GITHUB_INTEGRATION）
- Writer → 文档工具（TEXT_GENERATION, EXPORT_DOCX）
- Leader → 协作工具（TASK_DELEGATION, CONSENSUS_MECHANISM）

### 能力推断

测试验证了基于多种输入源推断工具：

1. 角色（Role）
2. AI 能力（AICapability）
3. 专业领域（expertiseAreas）
4. 是否为 Leader（isLeader）
5. 自定义工具（customTools）

### 工具执行

测试验证了工具执行的各种场景：

- 成功执行
- 工具未找到
- 执行失败
- 并行执行
- 顺序执行
- 超时处理

---

## 测试最佳实践

1. **隔离性**: 每个测试独立运行，使用 `beforeEach` 重置状态
2. **Mock 策略**: 使用 NestJS 测试工具和 Jest Mock
3. **命名规范**: 使用中文描述性名称，清晰表达测试意图
4. **AAA 模式**: Arrange（准备）、Act（执行）、Assert（断言）
5. **边界测试**: 测试空输入、null、undefined 等边界情况

---

## 已知问题

无

---

## 未来改进

1. 添加更多边界情况测试
2. 添加性能基准测试
3. 添加集成测试（与真实 ToolRegistry 集成）
4. 添加并发执行的压力测试
