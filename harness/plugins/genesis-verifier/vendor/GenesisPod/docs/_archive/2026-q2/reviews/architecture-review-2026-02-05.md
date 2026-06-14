# GenesisPod 架构评估报告

**评估日期**: 2026-02-05
**评估版本**: v3.11.0
**分析范围**: AI Engine + AI Apps + Frontend + Database + Deployment

---

## 一、执行总结

### 1.1 整体评分

| 维度               | 得分   | 权重     | 加权分      |
| ------------------ | ------ | -------- | ----------- |
| AI Engine 核心架构 | 8.0/10 | 25%      | 2.00        |
| AI Apps 应用层架构 | 7.5/10 | 25%      | 1.875       |
| 前端架构           | 7.5/10 | 15%      | 1.125       |
| 模块依赖和接口     | 7.6/10 | 20%      | 1.52        |
| 数据库和部署架构   | 7.5/10 | 15%      | 1.125       |
| **综合评分**       |        | **100%** | **7.65/10** |

### 1.2 成熟度评估

```
┌─────────────────────────────────────────────────────────────────┐
│                     架构成熟度模型                               │
├─────────────────────────────────────────────────────────────────┤
│  Level 5: 优化级    ░░░░░░░░░░                                  │
│  Level 4: 可管理级  ████████░░  ← 当前位置 (80%)                 │
│  Level 3: 已定义级  ██████████  (100%)                          │
│  Level 2: 可重复级  ██████████  (100%)                          │
│  Level 1: 初始级    ██████████  (100%)                          │
└─────────────────────────────────────────────────────────────────┘
```

**成熟度定位**: Level 4（可管理级）- 具备清晰的分层架构、统一的入口抽象、完善的模块化设计，但在可观测性、自动化运维、性能基准测试方面尚有提升空间。

### 1.3 核心优势

1. **Facade 模式设计精良**: `AIEngineFacade` 作为统一入口，完全隔离了底层 LLM、工具、技能等复杂性
2. **TaskProfile 语义化配置**: 应用层通过 `creativity`、`outputLength` 描述任务需求，AI Engine 自动映射到具体模型参数
3. **模块化子系统**: AI Engine 拆分为 15 个子模块（LLM、Tools、Skills、Memory、Orchestration 等）
4. **强大的工具生态**: 48 个内置工具，通过 `ToolRegistry` 统一管理，支持 MCP 协议扩展
5. **BYOK 支持完善**: 用户自带 API Key 的全链路支持

### 1.4 关键风险

| 风险                       | 严重程度 | 影响范围         | 缓解优先级 |
| -------------------------- | -------- | ---------------- | ---------- |
| 监控告警缺失               | 高       | 全系统           | P0         |
| AIEngineFacade 职责过宽    | 高       | 可维护性         | P0         |
| 记忆系统实现过于简陋       | 高       | 数据安全、智能度 | P0         |
| 错误分类和重试不完善       | 高       | 系统可靠性       | P0         |
| TaskProfile Phase 2 未实现 | 中       | 功能完整性       | P1         |
| 水平扩展能力不足           | 中       | 可扩展性         | P2         |

---

## 二、多视图架构分析

### 2.1 逻辑视图（功能分解）

#### 核心分层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI Apps Layer                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Research │ │ Writing │ │  Ask    │ │ Office  │ │ Social  │ │Simulation│   │
│  │94 services│90 services│         │ │         │ │         │ │         │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       └──────────┴──────────┴──────────┴──────────┴──────────┘              │
│                                    │                                         │
│                                    ▼                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                          AI Engine Layer                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        AIEngineFacade                                │    │
│  │  chat() | chatWithSkills() | search() | executeAgent() | executeTool()│   │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       ┌────────────┬───────────────┼───────────────┬────────────┐           │
│       ▼            ▼               ▼               ▼            ▼           │
│  ┌─────────┐ ┌─────────┐    ┌─────────┐    ┌─────────┐   ┌─────────┐       │
│  │   LLM   │ │  Tools  │    │ Skills  │    │ Memory  │   │Orchestr.│       │
│  │ Module  │ │ Module  │    │ Module  │    │ Module  │   │ Module  │       │
│  └─────────┘ └─────────┘    └─────────┘    └─────────┘   └─────────┘       │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Infrastructure Layer                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│  │ Prisma  │ │  Redis  │ │ Secrets │ │ Credits │ │ Export  │               │
│  │   ORM   │ │  Cache  │ │ Manager │ │ Service │ │ Module  │               │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### AI Engine 与 AI Apps 职责边界

| 层级               | 职责                                 | 典型服务                                          | 依赖方向   |
| ------------------ | ------------------------------------ | ------------------------------------------------- | ---------- |
| **AI Apps**        | 业务逻辑编排、领域特定规则、用户交互 | `TopicResearchService`, `WritingMissionService`   | 向下依赖   |
| **AI Engine**      | 通用 AI 能力、模型抽象、工具执行     | `AIEngineFacade`, `AiChatService`, `ToolRegistry` | 不依赖上层 |
| **Infrastructure** | 数据持久化、缓存、密钥管理           | `PrismaService`, `SecretsService`                 | 被上层依赖 |

### 2.2 开发视图（代码组织）

#### 模块划分

```
backend/src/modules/
├── ai-engine/                    # AI 引擎核心（15 子模块）
│   ├── ai-engine.module.ts       # 主模块（@Global）
│   ├── facade/                   # 统一入口（2288 行，需拆分）
│   ├── llm/                      # LLM 适配层
│   ├── tools/                    # 48 个工具
│   ├── skills/                   # 技能系统
│   ├── memory/                   # 记忆系统（需重构）
│   └── orchestration/            # 编排引擎
│
├── ai-app/                       # AI 应用层
│   ├── research/                 # 研究应用（94 服务）
│   ├── writing/                  # 写作应用（90+ 服务）
│   ├── ask/                      # 问答应用
│   ├── office/                   # 办公应用
│   ├── social/                   # 社交内容
│   └── teams/                    # 多 Agent 协作
│
├── content/                      # 内容管理
├── core/                         # 核心服务
└── credits/                      # 积分系统
```

#### 技术债务识别

| 债务项             | 位置                                    | 影响         | 建议                  |
| ------------------ | --------------------------------------- | ------------ | --------------------- |
| **Facade 过大**    | `ai-engine.facade.ts` (2288行)          | 可维护性下降 | 拆分为子 Facade       |
| **服务爆炸**       | `topic-research.module.ts` (94 exports) | 依赖复杂度   | 聚合为子 Facade       |
| **记忆系统简陋**   | `memory/stores/`                        | 数据丢失风险 | 迁移到 Redis/Postgres |
| **错误分类不完善** | `ai-chat.service.ts`                    | 可靠性问题   | 完善错误分类系统      |

### 2.3 部署视图（物理部署）

#### 当前部署拓扑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Railway Cloud                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐     │
│  │   Frontend      │      │    Backend      │      │   AI Service    │     │
│  │   (Next.js)     │─────▶│   (NestJS)      │─────▶│   (Optional)    │     │
│  │   Port: 3000    │      │   Port: 4000    │      │                 │     │
│  └─────────────────┘      └────────┬────────┘      └─────────────────┘     │
│                                    │                                        │
│                    ┌───────────────┴───────────────┐                       │
│                    ▼                               ▼                        │
│           ┌─────────────────┐            ┌─────────────────┐               │
│           │   PostgreSQL    │            │     Redis       │               │
│           │   (Primary DB)  │            │    (Cache)      │               │
│           │   Port: 5432    │            │   Port: 6379    │               │
│           └─────────────────┘            └─────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 扩展性评估

| 维度           | 当前能力        | 扩展方式             | 瓶颈             |
| -------------- | --------------- | -------------------- | ---------------- |
| **垂直扩展**   | 支持            | 增加容器资源         | 单节点上限       |
| **水平扩展**   | 有限            | 需要 LB + 无状态改造 | Mission 内存状态 |
| **数据库扩展** | PostgreSQL 主从 | 读写分离             | 未配置           |

### 2.4 运行视图（运行时行为）

#### 核心业务流程 - AI Research

```
┌──────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Frontend │───▶│TopicController│───▶│TopicResearchSvc │───▶│AIEngineFacade│
└──────────┘    └──────────────┘    └─────────────────┘    └──────┬───────┘
                                                                   │
    ┌──────────────────────────────────────────────────────────────┤
    │                                                               │
    ▼                                                               ▼
┌────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│LeaderAgent │───▶│ PlanService │───▶│MissionExecutor│───▶│ web-search Tool │
│(Planning)  │    │(Task Break) │    │(Parallel Exec)│    │(via ToolRegistry)│
└────────────┘    └─────────────┘    └──────────────┘    └─────────────────┘
```

#### 并发和状态管理

| 组件             | 状态类型   | 管理方式 | 问题           |
| ---------------- | ---------- | -------- | -------------- |
| **Mission 执行** | 运行时状态 | 内存 Map | 无法跨节点共享 |
| **熔断器**       | 运行时状态 | 内存     | 无法跨节点共享 |
| **短期记忆**     | 会话状态   | 内存     | 需迁移到 Redis |
| **长期记忆**     | 持久状态   | 内存     | 需迁移到数据库 |

### 2.5 架构看护（治理机制）

#### 现有约束和规范

| 约束类型        | 实现方式                                | 强制级别   |
| --------------- | --------------------------------------- | ---------- |
| **AI 调用规范** | `AiChatService.chat()` + `TaskProfile`  | 文档约束   |
| **依赖方向**    | AI Engine `@Global()`，AI Apps 单向依赖 | 架构约束   |
| **命名规范**    | CLAUDE.md 定义                          | 文档约束   |
| **类型安全**    | TypeScript strict mode                  | 编译器强制 |

#### 缺失的看护机制

| 缺失项            | 影响                 | 建议                   |
| ----------------- | -------------------- | ---------------------- |
| **ArchUnit 测试** | 无法自动检测依赖违规 | 引入架构测试           |
| **API 版本管理**  | 破坏性变更无法追踪   | 实现 API 版本策略      |
| **监控告警**      | 无法及时发现问题     | 引入 Sentry/Prometheus |
| **性能基准**      | 无法检测性能回退     | 建立 Benchmark 套件    |

---

## 三、AI Engine 深度诊断 - 必须有效提升的问题

### 3.1 问题 1：AIEngineFacade 职责过宽（P0 严重）

**位置**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts:131-2288`

**具体数据**:

- 文件行数: **2288 行**（超大）
- 公开方法: **40+ 个**
- 依赖注入: **12 个**

**当前 Facade 职责过于宽泛**:

```typescript
class AIEngineFacade {
  // 1. LLM 能力（4+ 方法）
  chat(), chatWithSkills(), chatStream(), selectModel()

  // 2. 搜索能力（2+ 方法）
  search(), formatSearchResultsForContext()

  // 3. 团队协作（4+ 方法）
  startTeamMission(), cancelMission(), getMissionStatus()

  // 4. 上下文管理（3+ 方法）
  buildContext(), estimateTokens(), compressContext()

  // 5. 记忆管理（3+ 方法）
  storeMemory(), retrieveMemory(), clearMemory()

  // 6. Agent 执行（2+ 方法）
  executeAgent(), isAgentAvailable()

  // 7. 工具执行（4+ 方法）
  executeTool(), getAvailableTools(), isToolAvailable()

  // 8. 模型管理（6+ 方法）
  getAvailableModels(), getModelById(), getDefaultModelByType()

  // 9. 实时推送（4+ 方法）
  emitToRoom(), emitProgress(), setWebSocketServer()
}
```

**影响**:

- 代码难以维护（2288 行单个文件）
- 职责不清晰（搜索、团队、Agent、工具混在一起）
- 测试困难（需要 mock 12 个依赖）
- 复用性差（想要用某个小功能需要引入整个 Facade）

**改进方案**:

```typescript
// 拆分为领域专用的 Sub-Facade
interface ILLMFacade {
  chat();
  chatStream();
  selectModel();
}
interface ISearchFacade {
  search();
}
interface ITeamFacade {
  startTeamMission();
  cancelMission();
}
interface IMemoryFacade {
  storeMemory();
  retrieveMemory();
}
interface IToolFacade {
  executeTool();
  getAvailableTools();
}
interface IAgentFacade {
  executeAgent();
}
interface IRealtimeFacade {
  emitToRoom();
  emitProgress();
}

// 精简后的 AIEngineFacade
class AIEngineFacade {
  constructor(
    private llm: ILLMFacade,
    private search: ISearchFacade,
    private team: ITeamFacade,
    private memory: IMemoryFacade,
    private tool: IToolFacade,
    private agent: IAgentFacade,
    private realtime: IRealtimeFacade,
  ) {}
}
```

---

### 3.2 问题 2：TaskProfile Phase 2 功能缺失（P1 中等）

**位置**: `backend/src/modules/ai-engine/llm/types/task-profile.types.ts:62-110`

**当前定义**:

```typescript
export interface TaskProfile {
  creativity?: CreativityLevel; // ✅ 已实现
  outputLength?: OutputLengthLevel; // ✅ 已实现
  taskType?: TaskType; // ⚠️ 定义但未映射
  outputFormat?: OutputFormat; // ⚠️ 部分实现
}
```

**问题**:

- `taskType` 参数被**完全忽略**
- 应用传来的 `taskType:"extraction"` 无效
- 无法根据任务类型自动选择合适的参数组合

**改进方案**:

```typescript
// 扩展映射常量
export const TASK_TYPE_ADJUSTMENTS: Record<TaskType, { tempDelta: number }> = {
  extraction: { tempDelta: -0.05 }, // 更低温度
  analysis: { tempDelta: 0 },
  conversation: { tempDelta: 0.1 }, // 稍高温度
  writing: { tempDelta: 0.15 }, // 创意写作
  reflection: { tempDelta: 0 },
};

// 在 mapToParameters 中应用
if (profile.taskType) {
  const taskAdj = TASK_TYPE_ADJUSTMENTS[profile.taskType];
  effectiveTemperature += taskAdj.tempDelta;
}
```

---

### 3.3 问题 3：错误分类和重试不完善（P0 严重）

**位置**: `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts:571-612`

**问题分析**:

```typescript
// 当前重试机制
private async withRetry<T>(operation, operationName, provider): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const aiError = this.errorClassifier.classify(error, provider);
      if (aiError.isRetryable() && attempt < MAX_RETRIES) {
        await this.sleep(delay);
        continue;
      }
      throw aiError;
    }
  }
}
```

**缺失的错误分类**:
| 错误类型 | 当前处理 | 应该处理 |
|----------|----------|----------|
| 无效 API Key | 重试 3 次 | 立即转 fallback |
| 模型已下线 | 重试 3 次 | 立即转 fallback |
| 上下文过长 | 重试 3 次 | 压缩后重试 |
| 推理模型无输出 | 重试 3 次 | 增加 maxTokens 后重试 |

**影响**:

- 无效 API Key 会重试 3 次（浪费时间）
- 上下文过长错误会重试 3 次（永远不会成功）
- 无法区分临时错误和永久错误

**改进方案**:

```typescript
enum ErrorCategory {
  // 临时错误 - 应该重试
  NETWORK_TIMEOUT,
  RATE_LIMIT,
  SERVICE_UNAVAILABLE,

  // 永久错误 - 应该转到 fallback
  INVALID_API_KEY,
  QUOTA_EXCEEDED,
  MODEL_NOT_FOUND,

  // 需要调整参数后重试
  CONTEXT_TOO_LONG,
  REASONING_EXHAUSTED,
}
```

---

### 3.4 问题 4：工具执行管道不完善（P1 中等）

**位置**: `backend/src/modules/ai-engine/tools/`

**问题**:

```typescript
// 当前 Facade.executeTool() 的实现
async executeTool<T>(request): Promise<ToolExecutionResult<T>> {
  const tool = this.tools?.registry.tryGet(request.toolId);
  // ❌ 直接执行，没有经过管道
  const result = await tool.execute(request.input, toolContext);
  return result;
}
```

**缺失的中间件应用**:

1. 没有超时检查（可能导致 Agent 卡死）
2. 没有输入验证（可能调用工具时参数错误）
3. 没有失败重试（临时错误导致任务失败）
4. 没有执行跟踪（无法追踪工具的执行状态）

**改进方案**:

```typescript
@Injectable()
export class ToolExecutionPipeline {
  async execute<T>(toolId, input, context): Promise<ToolResult<T>> {
    const chain = this.buildMiddlewareChain([
      this.validationMiddleware, // 1. 先验证输入
      this.metricsMiddleware, // 2. 性能追踪
      this.timeoutMiddleware, // 3. 应用超时
      this.retryMiddleware, // 4. 处理重试
    ]);
    return await chain.execute(tool, input, () => tool.execute(input, context));
  }
}
```

---

### 3.5 问题 5：记忆系统实现过于简陋（P0 严重）

**位置**: `backend/src/modules/ai-engine/memory/stores/`

**当前实现**:

```typescript
// ShortTermMemoryService (在内存中实现)
class ShortTermMemoryService {
  private readonly sessions = new Map<string, Map<string, MemoryItem>>();
  // 简单的内存存储，没有任何持久化
}

// LongTermMemoryService (在内存中实现)
class LongTermMemoryService {
  private readonly entries = new Map<string, LongTermMemoryEntry>();
  // TODO: 当前为内存实现，生产环境应使用数据库
  // TODO: 实际应使用向量数据库进行语义搜索
}
```

**具体缺陷**:

| 功能需求           | 当前状态 | 问题                         |
| ------------------ | -------- | ---------------------------- |
| **持久化存储**     | 无       | 服务重启会丢失所有记忆数据   |
| **向量化搜索**     | 无       | 使用关键词匹配，无法理解语义 |
| **自动过期机制**   | 半实现   | 有 TTL 但没有后台清理任务    |
| **并发访问控制**   | 无       | 多并发请求可能导致竞态条件   |
| **大规模查询性能** | 无       | O(n) 线性扫描                |

**影响**:

- **数据丢失风险**: 任何部署/重启都会丧失所有长期记忆
- **语义理解能力缺失**: 关键词匹配无法支持智能记忆检索
- **内存泄漏**: 过期记忆不自动清理

**改进方案**:

```typescript
// 多种存储实现
interface IMemoryStore {
  setWithSession(sessionId, key, value, ttl?): Promise<void>;
  getWithSession(sessionId, key): Promise<unknown>;
  search(query: string, options?): Promise<SearchResult[]>;
  cleanup(): Promise<number>;
}

// a) Redis 实现（跨进程、持久化）
class RedisMemoryStore implements IMemoryStore {}

// b) Postgres + pgvector 实现（语义搜索）
class PostgresMemoryStore implements IMemoryStore {
  async search(query, options) {
    const embedding = await this.embeddingService.embed(query);
    return await this.prisma.$queryRaw`
      SELECT *, 1 - (embedding <=> ${embedding}::vector) as similarity
      FROM memory_entries
      ORDER BY similarity DESC
      LIMIT ${options?.limit ?? 10}
    `;
  }
}
```

---

### 3.6 问题 6：模块导出策略混乱（P2 中等）

**位置**: `backend/src/modules/ai-engine/ai-engine.module.ts:137-172`

**问题**:

```typescript
@Global()
@Module({
  exports: [
    // ❌ 导出所有子模块
    AiEngineLLMModule,
    AiEngineToolsModule,
    AiEngineSkillsModule,
    // ... 其他模块 ...

    // 还导出了内部服务
    MCPManager,
    AICapabilityResolver,
    EmbeddingService,
    VectorService,
    DocumentChunker,
  ],
})
```

**影响**:

- 外部模块对 AI Engine 的内部细节有了强依赖
- 无法独立使用某个子模块
- 循环依赖风险

**改进方案**:

```typescript
@Global()
@Module({
  exports: [
    // ✅ 只导出 Facade 和必要的公开 API
    AIEngineFacade,
    AICapabilityResolver,
    // ❌ 不导出子模块、服务实现细节
  ],
})
export class AiEngineModule {}
```

---

## 四、问题优先级总结

| 问题                     | 类型 | 严重级别 | 影响范围             | 改进难度 | 优先级 |
| ------------------------ | ---- | -------- | -------------------- | -------- | ------ |
| AIEngineFacade 职责过宽  | 架构 | 严重     | 代码可维护性、测试   | 中等     | **P0** |
| 错误分类和重试不完善     | 功能 | 严重     | 系统可靠性、用户体验 | 中等     | **P0** |
| 记忆系统过于简陋         | 功能 | 严重     | 数据安全性、智能度   | 困难     | **P0** |
| 监控告警缺失             | 运维 | 严重     | 全系统               | 简单     | **P0** |
| TaskProfile Phase 2 缺失 | 功能 | 中等     | AI App 的参数优化    | 简单     | **P1** |
| 工具执行管道不完善       | 功能 | 中等     | Agent 稳定性         | 中等     | **P1** |
| 模块导出混乱             | 架构 | 中等     | 代码耦合度           | 简单     | **P2** |

---

## 五、立即行动清单

### 第一阶段（本周）

- [ ] **P0-1**: 引入 Sentry 错误追踪
- [ ] **P0-2**: 完整实现错误分类系统（ErrorCategory enum + 分类函数）
- [ ] **P0-3**: 选择记忆存储实现方案（Redis vs Postgres+pgvector）

### 第二阶段（下周）

- [ ] **P0-4**: 分析 AIEngineFacade 的方法调用图，设计拆分方案
- [ ] **P1-1**: 实现 TaskProfile Phase 2 映射
- [ ] **P1-2**: 集成 ToolExecutionPipeline 到 FunctionCallingExecutor

### 第三阶段（本月）

- [ ] **P0-5**: 执行 Facade 拆分重构
- [ ] **P0-6**: 迁移记忆系统到 Redis/Postgres
- [ ] **P2-1**: 清理 ai-engine.module.ts 导出

---

## 六、演进路线图

### 短期（0-3 个月）

```
Month 1:
├── Week 1-2: P0 监控告警 + 错误分类
│   ├── 引入 Sentry 错误追踪
│   ├── 完善错误分类系统
│   └── 完善健康检查端点
│
├── Week 3-4: P0 记忆系统重构
│   ├── 设计新的记忆存储接口
│   ├── 实现 Redis 存储后端
│   └── 迁移现有数据

Month 2:
├── Week 1-2: P0 Facade 拆分
│   ├── 拆分 AIEngineFacade 为 7 个子 Facade
│   ├── 保持向后兼容
│   └── 更新文档和测试
│
├── Week 3-4: P1 TaskProfile Phase 2
│   ├── 实现 outputFormat 参数
│   ├── 实现 taskType 参数
│   └── 更新所有调用点

Month 3:
├── Week 1-2: P1 工具执行管道
│   ├── 实现 ToolExecutionPipeline
│   ├── 集成中间件
│   └── 更新 FunctionCallingExecutor
│
├── Week 3-4: P2 模块导出优化
│   ├── 清理不必要的导出
│   └── 制定公开 API 边界
```

### 中期（3-6 个月）

- Mission 状态迁移到 Redis
- 熔断器状态共享
- 水平扩展测试验证
- 性能基准测试套件

### 长期（6-12 个月）

- Agent 实现统一化
- Mission 编排框架抽象
- 插件化工具系统
- MCP 协议深度集成

---

## 附录：关键文件参考

| 文件               | 路径                                                            | 说明                  |
| ------------------ | --------------------------------------------------------------- | --------------------- |
| AI Engine 主模块   | `backend/src/modules/ai-engine/ai-engine.module.ts`             | 264 行，15 子模块组织 |
| AI Engine Facade   | `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`      | 2288 行，需拆分       |
| TaskProfile 定义   | `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`       | 语义化配置核心        |
| AiChatService      | `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts` | LLM 调用核心          |
| ToolRegistry       | `backend/src/modules/ai-engine/tools/registry/tool.registry.ts` | 工具注册表            |
| 记忆服务           | `backend/src/modules/ai-engine/memory/stores/`                  | 需重构                |
| TopicResearch 模块 | `backend/src/modules/ai-app/research/topic-research/`           | 94 服务               |
| AI Writing 模块    | `backend/src/modules/ai-app/writing/`                           | 90+ 服务              |

---

**报告结束**

_本报告基于代码静态分析和架构文档审查，建议结合运行时指标进一步验证。_

