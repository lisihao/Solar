# AI Writing 系统改进计划

> 基于失败案例分析 + 架构审计的全面改进方案
>
> 版本: 1.0 | 日期: 2025-01-09

---

## 一、问题全景图

### 1.1 失败案例复盘

**案例**: 穿越剧小说（明朝党争背景，20万字目标）

| 问题             | 严重程度    | 表现                                     |
| ---------------- | ----------- | ---------------------------------------- |
| 章节大纲生成失败 | P0-Critical | 90章中只有7个有效标题，循环重复6次       |
| 内容生成中断     | P0-Critical | 只有4章有内容，其余86章为空              |
| 世界观未持久化   | P1-Major    | 世界观在AI对话中生成但未保存到数据库     |
| 历史人物错误     | P2-Medium   | 使用虚构人物"崔九贤"代替历史人物"魏忠贤" |
| 写作风格单调     | P2-Medium   | "心中一震"等表达重复出现8+次             |
| 字数统计错误     | P3-Minor    | 显示"当前字数: 0"但实际有6000字          |

### 1.2 根因分析

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           根因追溯图                                     │
└─────────────────────────────────────────────────────────────────────────┘

章节标题重复 ← LLM输出截断 ← maxTokens配置过小(4096) + 提示词过长
      ↑
      └── 系统缺少输出完整性验证机制

内容生成中断 ← 超时后无有效重试 ← 降级模型不在数据库配置中
      ↑
      └── 系统缺少模型配置验证 + 降级策略

世界观未保存 ← 只更新StoryBible主表 ← 未同步到Character/WorldSetting表
      ↑
      └── 数据模型设计与保存逻辑不一致

历史人物错误 ← 世界观构建无知识约束 ← 缺少历史知识库验证
      ↑
      └── HistoricalKnowledgeService未实际使用

写作风格单调 ← ExpressionMemoryService形同虚设 ← 缺少强制质量门控
      ↑
      └── 质量服务注入为Optional，失败时静默跳过
```

---

## 二、架构级问题清单

### 2.1 P0 - 系统性致命问题

| ID  | 问题                  | 影响范围        | 当前状态           |
| --- | --------------------- | --------------- | ------------------ |
| A01 | **输出完整性无验证**  | 大纲/章节生成   | 无任何校验         |
| A02 | **降级策略不可靠**    | 全部LLM调用     | 硬编码fallback模型 |
| A03 | **质量服务非强制**    | 章节质量控制    | @Optional注入      |
| A04 | **数据同步不完整**    | 世界观/角色保存 | 只更新主表         |
| A05 | **Mission中断无恢复** | 长时写作任务    | 无checkpoint机制   |

### 2.2 P1 - 重大设计缺陷

| ID  | 问题                          | 影响范围          | 当前状态         |
| --- | ----------------------------- | ----------------- | ---------------- |
| B01 | Agent接口与全局Registry不兼容 | Agent发现/替换    | 独立接口体系     |
| B02 | StoryBible变更无审计日志      | 版本追溯/冲突解决 | 只有version字段  |
| B03 | 并行执行依赖分析过简          | 章节并行效率      | 基础依赖检测     |
| B04 | 一致性检查记录不完整          | 检查覆盖率统计    | 只记录发现的问题 |
| B05 | 表达式记忆范围有限            | 长篇小说多样性    | 只看最近N章      |

### 2.3 P2 - 功能缺失

| ID  | 问题               | 影响范围       | 当前状态            |
| --- | ------------------ | -------------- | ------------------- |
| C01 | 缺少历史知识库集成 | 历史题材准确性 | Service存在但未调用 |
| C02 | 角色性格约束未实现 | 角色对话一致性 | TODO注释            |
| C03 | 缺少大纲结构验证   | 大纲质量       | 无校验逻辑          |
| C04 | 缺少自动事实提取   | 跨章节一致性   | 手动录入            |
| C05 | 缺少写作进度可视化 | 用户体验       | 只有任务状态        |

### 2.4 P3 - 技术债务

| ID  | 问题                  | 影响范围     | 当前状态                         |
| --- | --------------------- | ------------ | -------------------------------- |
| D01 | MissionType命名不一致 | API清晰度    | consistency vs consistency_check |
| D02 | 项目统计全量加载      | 大项目性能   | N+1查询                          |
| D03 | 错误处理静默失败      | 问题诊断     | try-catch + warn                 |
| D04 | 重复DTO命名冲突       | Swagger文档  | 已修复                           |
| D05 | 前端状态同步不及时    | 数据显示延迟 | 轮询方式                         |

---

## 三、流程级问题清单

### 3.1 世界观构建流程

```
当前流程 (有缺陷):
┌──────────────────────────────────────────────────────────────────┐
│ [用户创建项目]                                                    │
│      ↓                                                           │
│ [启动Mission: world-building]                                    │
│      ↓                                                           │
│ [AI生成世界观JSON] ← 无schema验证，无历史知识约束                  │
│      ↓                                                           │
│ [保存到StoryBible主表] ← 只保存summary字段，不解析子表             │
│      ↓                                                           │
│ [前端显示] ← 世界观TAB查询子表，但子表为空                         │
└──────────────────────────────────────────────────────────────────┘

问题:
1. AI输出无schema约束，可能生成格式错误的JSON
2. 不验证历史人物名称是否符合历史设定
3. 只保存到主表，子表（Character/WorldSetting）未同步
4. 前端查询子表为空，导致世界观TAB不显示内容
```

### 3.2 大纲生成流程

```
当前流程 (有缺陷):
┌──────────────────────────────────────────────────────────────────┐
│ [StoryArchitect规划大纲]                                         │
│      ↓                                                           │
│ [LLM生成章节列表JSON] ← 无maxTokens验证，可能被截断               │
│      ↓                                                           │
│ [解析JSON] ← 截断的JSON可能解析失败或只有部分章节                  │
│      ↓                                                           │
│ [保存到数据库] ← 不验证章节数量和标题唯一性                        │
└──────────────────────────────────────────────────────────────────┘

问题:
1. 不预估输出token需求，maxTokens配置可能不足
2. 无JSON完整性验证（缺少闭合括号检测）
3. 无章节标题重复性检测
4. 无章节数量与目标字数的匹配验证
5. 截断后无重试机制
```

### 3.3 章节写作流程

```
当前流程 (有缺陷):
┌──────────────────────────────────────────────────────────────────┐
│ [WriterAgent开始写作]                                            │
│      ↓                                                           │
│ [获取质量约束] ← @Optional服务可能未注入                          │
│      ↓                                                           │
│ [构建提示词] ← 无长度验证，可能超过上下文窗口                      │
│      ↓                                                           │
│ [LLM生成内容] ← 超时无重试，降级模型可能不存在                     │
│      ↓                                                           │
│ [保存章节] ← 即使内容为空也会保存                                  │
│      ↓                                                           │
│ [一致性检查] ← 检查失败不阻塞流程                                  │
└──────────────────────────────────────────────────────────────────┘

问题:
1. 质量服务注入失败时静默跳过
2. 提示词可能超过上下文窗口限制
3. LLM调用超时后无有效重试策略
4. 降级模型硬编码，可能不在数据库配置中
5. 空内容也会保存到数据库
6. 一致性检查失败不会触发重写
```

### 3.4 Mission执行流程

```
当前流程 (有缺陷):
┌──────────────────────────────────────────────────────────────────┐
│ [创建Mission]                                                    │
│      ↓                                                           │
│ [执行任务序列] ← 无checkpoint保存                                 │
│      ↓                                                           │
│ [单个任务失败] → [整体Mission失败] ← 无部分恢复机制                │
│      ↓                                                           │
│ [用户必须重新开始] ← 之前完成的工作丢失                           │
└──────────────────────────────────────────────────────────────────┘

问题:
1. 长时任务无checkpoint机制
2. 单点失败导致全部回滚
3. 无断点续传能力
4. 无任务优先级调度
```

---

## 四、协同机制问题清单

### 4.1 Agent间协同

| 问题         | 描述                                      | 影响                 |
| ------------ | ----------------------------------------- | -------------------- |
| 信息传递损耗 | StoryArchitect的规划未完整传递给Writer    | Writer缺少上下文     |
| 反馈循环断裂 | ConsistencyChecker的反馈未触发Writer重写  | 问题无法自动修复     |
| 状态同步延迟 | BibleKeeper的更新可能在Writer完成后才生效 | 并行写作基于过期信息 |
| 职责边界模糊 | Editor和ConsistencyChecker职责有重叠      | 重复检查浪费资源     |

### 4.2 服务间协同

| 问题           | 描述                       | 影响           |
| -------------- | -------------------------- | -------------- |
| 事务边界不清   | 多表更新无事务包装         | 数据不一致     |
| 缓存失效不同步 | StoryBible更新后缓存未清理 | 读取过期数据   |
| 事件丢失风险   | WebSocket断连时事件丢失    | 前端状态不同步 |
| 服务依赖隐式   | 质量服务通过@Optional注入  | 静默降级       |

### 4.3 前后端协同

| 问题           | 描述                     | 影响               |
| -------------- | ------------------------ | ------------------ |
| 状态查询时机   | 步骤完成后未主动刷新数据 | 世界观TAB不显示    |
| 错误传递不完整 | 后端错误日志未传递到前端 | 用户不知道失败原因 |
| 进度粒度粗     | 只有Mission级别进度      | 用户等待焦虑       |
| 离线支持缺失   | 断网后无法继续           | 数据丢失风险       |

---

## 五、改进方案

### 5.1 P0 - 紧急修复（1-2天）

#### A01: 输出完整性验证

```typescript
// 新增: OutputValidator服务
@Injectable()
export class OutputValidatorService {
  // JSON完整性检查
  validateJsonCompleteness(output: string): ValidationResult {
    // 1. 检查括号闭合
    // 2. 尝试解析JSON
    // 3. 检查必需字段
    // 4. 返回验证结果
  }

  // 大纲验证
  validateOutline(
    outline: OutlineData,
    config: ProjectConfig,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 1. 章节数量验证: 目标字数 / 每章字数 = 预期章节数 ±20%
    const expectedChapters = config.targetWords / config.wordsPerChapter;
    if (outline.chapters.length < expectedChapters * 0.8) {
      issues.push({ severity: "ERROR", message: "章节数量不足" });
    }

    // 2. 标题重复检测
    const titles = outline.chapters.map((c) => c.title);
    const duplicates = findDuplicates(titles);
    if (duplicates.length > 0) {
      issues.push({
        severity: "ERROR",
        message: `重复标题: ${duplicates.join(", ")}`,
      });
    }

    // 3. 标题有效性检测（非空、非通用）
    const invalidTitles = titles.filter(
      (t) => !t || t.length < 2 || isGenericTitle(t),
    );
    if (invalidTitles.length > titles.length * 0.1) {
      issues.push({ severity: "ERROR", message: "超过10%的标题无效" });
    }

    return { valid: issues.length === 0, issues };
  }
}
```

#### A02: 可靠降级策略

```typescript
// 修改: writing-mission.service.ts
private async getAvailableFallbackModels(primaryModel: string): Promise<string[]> {
  // 从数据库获取所有可用模型，按优先级排序
  const models = await this.modelConfigService.getAvailableModels({
    capability: 'text-generation',
    minContextWindow: 8000,
  });

  // 排除主模型，返回降级列表
  return models
    .filter(m => m.name !== primaryModel)
    .sort((a, b) => b.priority - a.priority)
    .map(m => m.name);
}

private async callWithFallback(prompt: string, options: LLMOptions): Promise<string> {
  const fallbackModels = await this.getAvailableFallbackModels(options.model);

  for (let attempt = 0; attempt <= fallbackModels.length; attempt++) {
    const model = attempt === 0 ? options.model : fallbackModels[attempt - 1];

    try {
      return await this.llmService.chat({ ...options, model, timeout: 180000 });
    } catch (error) {
      this.logger.warn(`模型 ${model} 调用失败 (attempt ${attempt + 1}): ${error.message}`);

      if (attempt === fallbackModels.length) {
        throw new Error(`所有模型均调用失败`);
      }
    }
  }
}
```

#### A03: 强制质量服务

```typescript
// 修改: writer.agent.ts
// FROM:
@Optional() private readonly expressionMemory?: ExpressionMemoryService
// TO:
private readonly expressionMemory: ExpressionMemoryService // 移除Optional

// 新增: 质量服务健康检查
async validateQualityServices(): Promise<void> {
  const services = [
    { name: 'expressionMemory', service: this.expressionMemory },
    { name: 'characterPersonality', service: this.characterPersonality },
    { name: 'historicalKnowledge', service: this.historicalKnowledge },
  ];

  for (const { name, service } of services) {
    if (!service) {
      throw new Error(`质量服务 ${name} 未正确注入，写作任务无法执行`);
    }

    // 执行健康检查
    await service.healthCheck();
  }
}

// 在execute方法开始时调用
async execute(context: AgentExecutionContext): Promise<AgentResult> {
  await this.validateQualityServices(); // 强制检查
  // ...
}
```

#### A04: 完整数据同步

```typescript
// 修改: writing-mission.service.ts - 世界观保存逻辑
private async saveWorldBuildingResult(projectId: string, worldData: WorldBuildingResult) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 更新StoryBible主表
    const bible = await tx.storyBible.update({
      where: { projectId },
      data: {
        worldType: worldData.worldType,
        coreConflict: worldData.coreConflict,
        tone: worldData.tone,
        // ... 其他字段
        lastSyncAt: new Date(),
      },
    });

    // 2. 同步角色到WritingCharacter表
    await tx.writingCharacter.deleteMany({ where: { bibleId: bible.id } });
    for (const char of worldData.characters) {
      await tx.writingCharacter.create({
        data: {
          bibleId: bible.id,
          name: char.name,
          role: this.mapCharacterRole(char.role),
          appearance: char.appearance,
          personality: char.personality,
          background: char.background,
          // ... 其他字段
        },
      });
    }

    // 3. 同步世界设定到WorldSetting表
    await tx.worldSetting.deleteMany({ where: { bibleId: bible.id } });
    for (const setting of worldData.settings) {
      await tx.worldSetting.create({
        data: {
          bibleId: bible.id,
          category: setting.category,
          name: setting.name,
          description: setting.description,
          rules: setting.rules,
        },
      });
    }

    // 4. 同步时间线事件
    if (worldData.timelineEvents) {
      await tx.timelineEvent.deleteMany({ where: { bibleId: bible.id } });
      for (const event of worldData.timelineEvents) {
        await tx.timelineEvent.create({
          data: {
            bibleId: bible.id,
            eventType: event.type,
            title: event.title,
            description: event.description,
            storyTime: event.storyTime,
          },
        });
      }
    }

    return bible;
  });
}
```

#### A05: Checkpoint机制

```typescript
// 新增: CheckpointService
@Injectable()
export class CheckpointService {
  constructor(private readonly prisma: PrismaService) {}

  async saveCheckpoint(missionId: string, checkpoint: MissionCheckpoint) {
    await this.prisma.writingMissionCheckpoint.upsert({
      where: { missionId },
      create: {
        missionId,
        completedTasks: checkpoint.completedTasks,
        currentTask: checkpoint.currentTask,
        context: checkpoint.context,
        savedAt: new Date(),
      },
      update: {
        completedTasks: checkpoint.completedTasks,
        currentTask: checkpoint.currentTask,
        context: checkpoint.context,
        savedAt: new Date(),
      },
    });
  }

  async loadCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    return this.prisma.writingMissionCheckpoint.findUnique({
      where: { missionId },
    });
  }

  async resumeMission(missionId: string): Promise<void> {
    const checkpoint = await this.loadCheckpoint(missionId);
    if (!checkpoint) {
      throw new Error("无可恢复的检查点");
    }

    // 从checkpoint恢复执行
    await this.missionService.resumeFromCheckpoint(missionId, checkpoint);
  }
}
```

---

### 5.2 P1 - 架构优化（1周）

#### B01: 统一Agent接口

```typescript
// 新增: WritingAgentRegistry
@Injectable()
export class WritingAgentRegistry {
  private agents = new Map<string, IWritingAgent>();

  register(agent: IWritingAgent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): IWritingAgent {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent ${name} not found`);
    }
    return agent;
  }

  // 与全局AgentRegistry的桥接
  bridgeToGlobalRegistry(globalRegistry: AgentRegistry): void {
    for (const [name, agent] of this.agents) {
      globalRegistry.register(new WritingAgentAdapter(agent));
    }
  }
}

// 适配器模式
class WritingAgentAdapter implements IPlanBasedAgent {
  constructor(private readonly writingAgent: IWritingAgent) {}

  // 实现IPlanBasedAgent接口
  async execute(context: AgentContext): Promise<AgentResult> {
    return this.writingAgent.execute(context as AgentExecutionContext);
  }
}
```

#### B02: StoryBible审计日志

```typescript
// 新增: StoryBibleAuditLog表
model StoryBibleAuditLog {
  id          String   @id @default(uuid())
  bibleId     String
  version     Int
  changeType  String   // CREATE, UPDATE, DELETE
  field       String   // 变更的字段
  oldValue    Json?    // 旧值
  newValue    Json?    // 新值
  changedBy   String   // agent名称或用户ID
  reason      String?  // 变更原因
  createdAt   DateTime @default(now())

  bible       StoryBible @relation(fields: [bibleId], references: [id])
}

// 新增: AuditService
@Injectable()
export class StoryBibleAuditService {
  async logChange(
    bibleId: string,
    field: string,
    oldValue: any,
    newValue: any,
    changedBy: string,
    reason?: string
  ): Promise<void> {
    const bible = await this.prisma.storyBible.findUnique({
      where: { id: bibleId },
    });

    await this.prisma.storyBibleAuditLog.create({
      data: {
        bibleId,
        version: bible.version,
        changeType: oldValue ? 'UPDATE' : 'CREATE',
        field,
        oldValue,
        newValue,
        changedBy,
        reason,
      },
    });
  }

  async getChangeHistory(bibleId: string, field?: string): Promise<AuditLog[]> {
    return this.prisma.storyBibleAuditLog.findMany({
      where: { bibleId, ...(field && { field }) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

#### B03: 增强依赖分析

```typescript
// 新增: 高级依赖分析
@Injectable()
export class EnhancedDependencyService {
  // 检测循环依赖
  detectCircularDependencies(chapters: ChapterNode[]): CircularDependency[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: CircularDependency[] = [];

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = chapters.find((c) => c.id === nodeId);
      for (const depId of node?.dependencies || []) {
        if (!visited.has(depId)) {
          dfs(depId, [...path, nodeId]);
        } else if (recursionStack.has(depId)) {
          cycles.push({
            path: [...path, nodeId, depId],
            type: "CIRCULAR",
          });
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const chapter of chapters) {
      if (!visited.has(chapter.id)) {
        dfs(chapter.id, []);
      }
    }

    return cycles;
  }

  // 生成最优执行计划
  generateOptimalPlan(
    chapters: ChapterNode[],
    maxParallel: number,
  ): ExecutionPlan {
    // 拓扑排序 + 关键路径分析
    const sorted = this.topologicalSort(chapters);
    const criticalPath = this.findCriticalPath(chapters);

    // 生成执行轮次
    const rounds: ExecutionRound[] = [];
    const completed = new Set<string>();

    while (completed.size < chapters.length) {
      const ready = chapters.filter(
        (c) =>
          !completed.has(c.id) && c.dependencies.every((d) => completed.has(d)),
      );

      const round = ready.slice(0, maxParallel);
      rounds.push({
        chapters: round.map((c) => c.id),
        estimatedTime: Math.max(...round.map((c) => c.estimatedTime)),
      });

      round.forEach((c) => completed.add(c.id));
    }

    return {
      rounds,
      totalRounds: rounds.length,
      criticalPath,
      parallelizationRate: chapters.length / rounds.length,
    };
  }
}
```

---

### 5.3 P2 - 功能补全（2周）

#### C01: 历史知识库集成

```typescript
// 新增: HistoricalKnowledgeBase
@Injectable()
export class HistoricalKnowledgeBaseService {
  private knowledgeBases = new Map<string, HistoricalEra>();

  constructor() {
    this.loadKnowledgeBases();
  }

  private loadKnowledgeBases(): void {
    // 加载明朝知识库
    this.knowledgeBases.set("MING_DYNASTY", {
      era: "明朝",
      period: "1368-1644",
      keyFigures: [
        { name: "魏忠贤", role: "宦官", period: "天启年间", title: "九千岁" },
        { name: "朱由校", role: "皇帝", period: "天启年间", title: "天启帝" },
        { name: "张皇后", role: "皇后", period: "天启年间" },
        { name: "客氏", role: "乳母", period: "天启年间" },
        // ... 更多人物
      ],
      factions: [
        {
          name: "东林党",
          type: "文官集团",
          leaders: ["杨涟", "左光斗", "魏大中"],
        },
        { name: "阉党", type: "宦官集团", leaders: ["魏忠贤", "崔呈秀"] },
      ],
      events: [
        { name: "红丸案", year: 1620, description: "明光宗服用红丸后暴毙" },
        { name: "移宫案", year: 1620, description: "李选侍移宫风波" },
        // ... 更多事件
      ],
      terminology: [
        { term: "对食", definition: "宫女与太监的伴侣关系" },
        { term: "才人", definition: "后宫嫔妃低级位分" },
        // ... 更多术语
      ],
    });

    // 加载其他朝代...
  }

  validateHistoricalAccuracy(content: string, era: string): ValidationResult {
    const kb = this.knowledgeBases.get(era);
    if (!kb) return { valid: true, issues: [] };

    const issues: ValidationIssue[] = [];

    // 1. 检查人物名称是否准确
    for (const figure of kb.keyFigures) {
      const regex = new RegExp(figure.name, "g");
      if (content.includes(figure.name)) {
        // 验证人物描述是否符合历史
        // ...
      }
    }

    // 2. 检查是否使用了虚构人物名
    const fictionalNames = this.detectFictionalNames(content, kb);
    if (fictionalNames.length > 0) {
      issues.push({
        severity: "WARNING",
        type: "FICTIONAL_CHARACTER",
        message: `检测到可能的虚构人物: ${fictionalNames.join(", ")}`,
        suggestion: `建议使用历史人物: ${kb.keyFigures
          .slice(0, 5)
          .map((f) => f.name)
          .join(", ")}`,
      });
    }

    // 3. 检查事件时间线是否正确
    // ...

    return {
      valid: issues.filter((i) => i.severity === "ERROR").length === 0,
      issues,
    };
  }
}
```

#### C02: 角色性格约束实现

```typescript
// 修改: character-personality.service.ts
@Injectable()
export class CharacterPersonalityService {
  async getPersonalityConstraints(
    projectId: string,
    characterNames: string[],
  ): Promise<PersonalityConstraint[]> {
    const constraints: PersonalityConstraint[] = [];

    for (const name of characterNames) {
      // 1. 查找角色ID（解决TODO）
      const character = await this.prisma.writingCharacter.findFirst({
        where: {
          bible: { projectId },
          name: { contains: name, mode: "insensitive" },
        },
        include: {
          bible: true,
        },
      });

      if (!character) {
        this.logger.warn(`角色 "${name}" 未在StoryBible中找到`);
        continue;
      }

      // 2. 构建性格约束
      const personality = character.personality as PersonalityData;
      constraints.push({
        characterName: name,
        speechPatterns: personality.speechPatterns || [],
        vocabularyLevel: personality.vocabularyLevel || "NEUTRAL",
        emotionalTendency: personality.emotionalTendency || [],
        tabooWords: personality.tabooWords || [],
        catchphrases: personality.catchphrases || [],
        dialogueExamples: await this.getDialogueExamples(character.id),
      });
    }

    return constraints;
  }

  generateConstraintPrompt(constraints: PersonalityConstraint[]): string {
    if (constraints.length === 0) return "";

    let prompt = "【角色性格约束】\n";
    for (const c of constraints) {
      prompt += `\n## ${c.characterName}\n`;
      prompt += `- 说话方式: ${c.speechPatterns.join(", ")}\n`;
      prompt += `- 用词水平: ${c.vocabularyLevel}\n`;
      prompt += `- 情绪倾向: ${c.emotionalTendency.join(", ")}\n`;
      if (c.tabooWords.length > 0) {
        prompt += `- 禁止使用: ${c.tabooWords.join(", ")}\n`;
      }
      if (c.catchphrases.length > 0) {
        prompt += `- 口头禅: ${c.catchphrases.join(", ")}\n`;
      }
    }

    return prompt;
  }
}
```

#### C03: 大纲结构验证

```typescript
// 新增: OutlineValidatorService
@Injectable()
export class OutlineValidatorService {
  validateStructure(
    outline: StoryOutline,
    config: ProjectConfig,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 1. 章节数量验证
    const expectedChapters = Math.ceil(
      config.targetWords / config.wordsPerChapter,
    );
    const actualChapters = outline.chapters.length;

    if (actualChapters < expectedChapters * 0.8) {
      issues.push({
        severity: "ERROR",
        type: "INSUFFICIENT_CHAPTERS",
        message: `章节数量不足: 预期${expectedChapters}章，实际${actualChapters}章`,
      });
    }

    // 2. 标题唯一性验证
    const titleCounts = new Map<string, number>();
    for (const chapter of outline.chapters) {
      const count = (titleCounts.get(chapter.title) || 0) + 1;
      titleCounts.set(chapter.title, count);
    }

    for (const [title, count] of titleCounts) {
      if (count > 2) {
        issues.push({
          severity: "ERROR",
          type: "DUPLICATE_TITLE",
          message: `标题 "${title}" 重复出现 ${count} 次`,
        });
      }
    }

    // 3. 标题有效性验证
    const genericTitles = ["第一章", "第二章", "新的开始", "命运", "未知"];
    for (const chapter of outline.chapters) {
      if (!chapter.title || chapter.title.length < 2) {
        issues.push({
          severity: "ERROR",
          type: "INVALID_TITLE",
          message: `章节 ${chapter.orderIndex + 1} 标题为空或过短`,
        });
      } else if (genericTitles.includes(chapter.title)) {
        issues.push({
          severity: "WARNING",
          type: "GENERIC_TITLE",
          message: `章节 ${chapter.orderIndex + 1} 标题过于通用: "${chapter.title}"`,
        });
      }
    }

    // 4. 叙事节奏验证（起承转合）
    const hasIncitingIncident = outline.chapters
      .slice(0, 5)
      .some((c) => c.plotPoints?.some((p) => p.type === "INCITING_INCIDENT"));
    if (!hasIncitingIncident) {
      issues.push({
        severity: "WARNING",
        type: "MISSING_INCITING_INCIDENT",
        message: "前5章缺少激励事件，可能导致开篇节奏过慢",
      });
    }

    // 5. 角色出场验证
    const protagonistAppearance = outline.chapters.findIndex((c) =>
      c.involvedCharacters?.some((char) => char.role === "PROTAGONIST"),
    );
    if (protagonistAppearance > 0) {
      issues.push({
        severity: "WARNING",
        type: "LATE_PROTAGONIST",
        message: `主角首次出场在第 ${protagonistAppearance + 1} 章，建议第1章出场`,
      });
    }

    return {
      valid: issues.filter((i) => i.severity === "ERROR").length === 0,
      issues,
    };
  }
}
```

#### C04: 自动事实提取

```typescript
// 新增: FactExtractorService
@Injectable()
export class FactExtractorService {
  constructor(private readonly llmService: LLMService) {}

  async extractFacts(
    chapterContent: string,
    context: WritingContext,
  ): Promise<ExtractedFact[]> {
    const prompt = `
你是一个故事一致性分析专家。请从以下章节内容中提取所有可能影响后续章节一致性的事实。

【章节内容】
${chapterContent}

【已有设定】
- 主要角色: ${context.characters.map((c) => c.name).join(", ")}
- 时间背景: ${context.storyBible.era}

请提取以下类型的事实:
1. CHARACTER_STATE: 角色状态变化（位置、情绪、关系变化）
2. PLOT_EVENT: 关键剧情事件
3. WORLD_FACT: 世界设定相关事实
4. TIMELINE: 时间点/时间跨度
5. OBJECT: 重要物品状态

输出JSON格式:
{
  "facts": [
    {
      "type": "CHARACTER_STATE",
      "subject": "沈若芷",
      "predicate": "获得皇帝信任",
      "object": "朱由校",
      "confidence": 0.9,
      "evidence": "原文引用"
    }
  ]
}
`;

    const response = await this.llmService.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const parsed = JSON.parse(response);
    return parsed.facts;
  }

  async saveFacts(
    projectId: string,
    chapterId: string,
    facts: ExtractedFact[],
  ): Promise<void> {
    for (const fact of facts) {
      await this.prisma.establishedFact.create({
        data: {
          projectId,
          chapterId,
          factType: fact.type,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: fact.confidence,
          evidence: fact.evidence,
        },
      });
    }
  }
}
```

---

### 5.4 P3 - 技术债务清理（持续）

| ID  | 任务                | 改进方案                                     |
| --- | ------------------- | -------------------------------------------- |
| D01 | MissionType命名统一 | 使用 `CONSISTENCY_CHECK`，废弃 `consistency` |
| D02 | 项目统计优化        | 使用物化视图或缓存聚合                       |
| D03 | 错误处理增强        | 使用 Result 类型，区分可恢复/不可恢复错误    |
| D04 | DTO命名规范         | 添加模块前缀，如 `WritingProjectDto`         |
| D05 | 前端状态同步        | WebSocket事件驱动 + 乐观更新                 |

---

## 六、改进优先级矩阵

```
                    高影响
                      ↑
                      │
    ┌─────────────────┼─────────────────┐
    │   P1-MAJOR      │   P0-CRITICAL   │
    │                 │                 │
    │ B01 Agent接口   │ A01 输出验证    │
    │ B02 审计日志    │ A02 降级策略    │
    │ B03 依赖分析    │ A03 强制质量    │
    │ C01 历史知识    │ A04 数据同步    │
    │ C02 角色性格    │ A05 Checkpoint  │
    │                 │                 │
────┼─────────────────┼─────────────────┼──── 低工作量 ←──→ 高工作量
    │                 │                 │
    │   P3-MINOR      │   P2-MEDIUM     │
    │                 │                 │
    │ D01 命名统一    │ C03 大纲验证    │
    │ D04 DTO规范     │ C04 事实提取    │
    │ D05 状态同步    │ D02 统计优化    │
    │                 │ D03 错误处理    │
    │                 │                 │
    └─────────────────┼─────────────────┘
                      │
                      ↓
                    低影响
```

---

## 七、实施路线图

### Phase 1: 紧急修复（第1-2天）

- [ ] A01: 实现 OutputValidatorService
- [ ] A02: 重构 callWithFallback 使用数据库配置
- [ ] A03: 移除质量服务的 @Optional，添加健康检查
- [ ] A04: 实现事务性数据同步
- [ ] A05: 实现基础 CheckpointService

### Phase 2: 架构优化（第3-7天）

- [ ] B01: 设计并实现 WritingAgentRegistry
- [ ] B02: 添加 StoryBibleAuditLog 表和服务
- [ ] B03: 实现 EnhancedDependencyService
- [ ] B04: 扩展 ConsistencyCheck 记录逻辑

### Phase 3: 功能补全（第8-14天）

- [ ] C01: 构建历史知识库（明朝为起点）
- [ ] C02: 完成 CharacterPersonalityService 实现
- [ ] C03: 实现 OutlineValidatorService
- [ ] C04: 实现 FactExtractorService

### Phase 4: 债务清理（持续）

- [ ] D01-D05: 逐步重构和优化

---

## 八、验收标准

### 功能验收

| 场景       | 验收标准                                          |
| ---------- | ------------------------------------------------- |
| 大纲生成   | 章节数量达到目标字数要求的80%+，标题无重复超过2次 |
| 世界观保存 | 角色和世界设定正确保存到子表，前端TAB可正常显示   |
| 章节写作   | 连续生成10章无中断，每章字数在目标范围内          |
| 质量控制   | 表达式重复率<5%，角色对话符合性格设定             |
| 历史准确性 | 历史题材无虚构核心人物，事件时间线正确            |

### 性能验收

| 指标            | 目标             |
| --------------- | ---------------- |
| 大纲生成时间    | <60秒（100章）   |
| 单章写作时间    | <120秒（1500字） |
| 并行写作效率    | 4章/轮次         |
| Mission恢复时间 | <10秒            |

### 稳定性验收

| 场景         | 要求                         |
| ------------ | ---------------------------- |
| LLM超时      | 自动重试+降级，不中断Mission |
| 质量服务异常 | 明确报错，阻止低质量内容     |
| 网络断连     | Checkpoint保存，支持断点续传 |

---

## 九、附录

### A. 相关文件清单

```
backend/src/modules/ai-app/writing/
├── services/mission/writing-mission.service.ts  # 核心修改
├── services/quality/*.ts                        # 质量服务增强
├── services/consistency/*.ts                    # 一致性检查增强
├── agents/*.ts                                  # Agent接口统一
└── dto/index.ts                                 # DTO命名规范

frontend/stores/
└── aiWritingStore.ts                            # 状态同步优化

docs/improvement/
└── ai-writing-improvement-plan.md               # 本文档
```

### B. 参考资料

- [AI Teams 架构文档](../architecture/ai-teams.md)
- [Long Content Engine 设计](../architecture/long-content-engine.md)
- [质量控制框架](../architecture/quality-control.md)

---

**文档版本**: 1.0
**创建日期**: 2025-01-09
**负责人**: Claude Code
**状态**: 待评审
