# AI Writing 最强大脑 - 系统设计文档

> 基于 AI Engine + AI Teams 底座的智能写作系统升级方案

---

## 一、架构定位

### 1.1 当前架构回顾

```
┌─────────────────────────────────────────────────────────────┐
│  AI Writing Application                                      │
│  - 5-Agent 团队（架构师、作家、守护者、检查员、编辑）           │
│  - Story Bible 系统（角色、世界观、术语、时间线）              │
│  - WritingMissionService 编排                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AI Teams - 协作机制层                                        │
│  - MissionOrchestrator (任务编排)                            │
│  - RoleRegistry / TeamRegistry (角色/团队注册)               │
│  - HandoffCoordinator (交接协调)                             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AI Engine - 核心能力层                                       │
│  - LLM Abstraction (多模型适配)                              │
│  - Long Content Engine (长内容处理)                          │
│  - Constraint System (约束系统)                              │
│  - Tools / Skills (工具/技能)                                │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 最强大脑升级架构

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Writing Application (升级版)                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  最强大脑层 (Super Brain Layer) - 新增                       ││
│  │  - PlotIntelligenceEngine (剧情智能引擎)                    ││
│  │  - DeepConsistencyEngine (深度一致性引擎)                   ││
│  │  - StyleTransferEngine (风格迁移引擎)                       ││
│  │  - CreativeEnhancementEngine (创意增强引擎)                 ││
│  │  - SelfLearningEngine (自学习引擎)                          ││
│  │  - DynamicAgentOrchestrator (动态Agent编排器)               ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  现有层 (增强)                                               ││
│  │  - 5-Agent 团队 → 动态 Agent 池                              ││
│  │  - Story Bible → 知识图谱增强                               ││
│  │  - WritingMissionService → SuperBrainMissionService         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、最强大脑核心模块设计

### 2.1 模块总览

| 模块                      | 职责                               | 优先级 | 复杂度 |
| ------------------------- | ---------------------------------- | ------ | ------ |
| PlotIntelligenceEngine    | 剧情智能规划、伏笔管理、多线程叙事 | P0     | 高     |
| DeepConsistencyEngine     | 深度一致性检查、知识图谱、信息隔离 | P0     | 高     |
| CreativeEnhancementEngine | 多方案生成、创意激发、场景增强     | P1     | 中     |
| StyleTransferEngine       | 风格学习、风格迁移、风格一致性     | P1     | 高     |
| SelfLearningEngine        | 用户偏好学习、反馈适配、持续优化   | P2     | 中     |
| DynamicAgentOrchestrator  | 动态 Agent 调度、场景化团队组建    | P2     | 中     |

---

## 三、PlotIntelligenceEngine (剧情智能引擎)

### 3.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  PlotIntelligenceEngine                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 动态大纲系统 (DynamicOutlineService)                     │
│     - 大纲实时评估和调整                                     │
│     - 伏笔铺设建议                                          │
│     - 剧情树可视化                                          │
│                                                             │
│  2. 伏笔管理器 (ForeshadowingManager)                        │
│     - 伏笔追踪：planted → developing → resolved             │
│     - 悬空伏笔提醒                                          │
│     - 自动伏笔回收建议                                       │
│                                                             │
│  3. 多线叙事协调器 (MultiThreadNarrativeCoordinator)          │
│     - 多视角/多线程管理                                      │
│     - 线程交汇点规划                                         │
│     - 时间线同步                                            │
│                                                             │
│  4. 剧情分析器 (PlotAnalyzer)                                │
│     - 张力曲线分析                                          │
│     - 节奏评估                                              │
│     - 高潮/低谷识别                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据模型

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/plot-intelligence/interfaces/

/**
 * 伏笔实体
 */
interface Foreshadowing {
  id: string;
  type: "character" | "event" | "item" | "prophecy" | "hint";

  // 伏笔内容
  content: string;
  significance: "major" | "minor" | "subtle";

  // 生命周期
  status: "planted" | "developing" | "resolved" | "abandoned";
  plantedAt: ChapterReference; // 埋下伏笔的章节
  developedAt?: ChapterReference[]; // 发展的章节
  resolvedAt?: ChapterReference; // 回收的章节

  // 关联
  relatedCharacters: string[];
  relatedEvents: string[];

  // 回收建议
  suggestedResolution?: {
    chapterRange: [number, number]; // 建议回收的章节范围
    resolutionHints: string[]; // 回收方式建议
  };
}

/**
 * 剧情线程
 */
interface NarrativeThread {
  id: string;
  name: string;
  type: "main" | "subplot" | "character_arc" | "mystery";

  // 状态
  status: "active" | "paused" | "concluded" | "merged";

  // 视角
  primaryPOV?: string; // 主要视角角色

  // 时间范围
  timelineStart: StoryTime;
  timelineCurrent: StoryTime;

  // 关键节点
  keyMoments: {
    chapterNumber: number;
    event: string;
    significance: number; // 1-10
  }[];

  // 交汇点
  intersections: {
    withThread: string;
    atChapter: number;
    type: "merge" | "cross" | "branch";
  }[];
}

/**
 * 剧情张力分析
 */
interface PlotTensionAnalysis {
  chapterNumber: number;

  // 张力指标
  tensionLevel: number; // 0-100
  pacingScore: number; // 节奏评分
  emotionalIntensity: number; // 情感强度

  // 类型
  chapterType:
    | "setup"
    | "rising_action"
    | "climax"
    | "falling_action"
    | "resolution";

  // 建议
  suggestions: {
    type:
      | "increase_tension"
      | "add_relief"
      | "deepen_conflict"
      | "resolve_subplot";
    description: string;
  }[];
}

/**
 * 动态大纲节点
 */
interface DynamicOutlineNode {
  chapterNumber: number;
  title: string;
  outline: string;

  // 状态
  status: "planned" | "writing" | "completed" | "needs_revision";

  // 依赖
  dependencies: number[]; // 依赖的前置章节
  blockedBy?: string; // 被什么阻塞

  // 伏笔
  foreshadowingsToPlant: string[]; // 需要埋的伏笔
  foreshadowingsToResolve: string[]; // 需要收的伏笔

  // 分支可能性
  branchPoints?: {
    condition: string;
    options: {
      label: string;
      nextChapters: number[];
      impact: string;
    }[];
  }[];

  // 评估
  coherenceScore?: number; // 与前文连贯性
  necessityScore?: number; // 剧情必要性
}
```

### 3.3 服务设计

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/plot-intelligence/

@Injectable()
export class PlotIntelligenceEngine {
  constructor(
    private readonly dynamicOutline: DynamicOutlineService,
    private readonly foreshadowing: ForeshadowingManagerService,
    private readonly multiThread: MultiThreadNarrativeService,
    private readonly plotAnalyzer: PlotAnalyzerService,
    private readonly aiChat: AiChatService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 分析当前剧情状态，生成智能建议
   */
  async analyzeAndSuggest(
    projectId: string,
    currentChapter: number,
  ): Promise<PlotIntelligenceSuggestions> {
    // 1. 获取剧情状态
    const plotState = await this.getPlotState(projectId);

    // 2. 分析伏笔状态
    const foreshadowingAnalysis = await this.foreshadowing.analyze(plotState);

    // 3. 分析张力曲线
    const tensionAnalysis = await this.plotAnalyzer.analyzeTension(plotState);

    // 4. 检查多线叙事一致性
    const threadAnalysis = await this.multiThread.checkCoherence(plotState);

    // 5. 生成综合建议
    return this.generateSuggestions({
      foreshadowingAnalysis,
      tensionAnalysis,
      threadAnalysis,
      currentChapter,
    });
  }

  /**
   * 动态调整大纲
   */
  async adjustOutline(
    projectId: string,
    completedChapter: number,
    chapterContent: string,
  ): Promise<OutlineAdjustment> {
    return this.dynamicOutline.evaluateAndAdjust(
      projectId,
      completedChapter,
      chapterContent,
    );
  }

  /**
   * 生成剧情分支选项
   */
  async generatePlotBranches(
    projectId: string,
    decisionPoint: string,
  ): Promise<PlotBranchOptions[]> {
    // 使用 AI 生成多种剧情走向
    const context = await this.buildPlotContext(projectId);

    return this.aiChat.chat({
      model: "gpt-4o",
      messages: [
        { role: "system", content: PLOT_BRANCH_GENERATION_PROMPT },
        { role: "user", content: JSON.stringify({ context, decisionPoint }) },
      ],
      response_format: { type: "json_object" },
    });
  }
}

@Injectable()
export class ForeshadowingManagerService {
  /**
   * 追踪伏笔状态
   */
  async trackForeshadowing(
    projectId: string,
    chapterNumber: number,
    content: string,
  ): Promise<ForeshadowingTrackingResult> {
    // 1. 检测新埋的伏笔
    const newForeshadowings = await this.detectNewForeshadowings(content);

    // 2. 检测伏笔发展
    const developedForeshadowings = await this.detectDevelopment(content);

    // 3. 检测伏笔回收
    const resolvedForeshadowings = await this.detectResolution(content);

    // 4. 检查悬空伏笔
    const orphanedForeshadowings = await this.checkOrphaned(projectId);

    return {
      newForeshadowings,
      developedForeshadowings,
      resolvedForeshadowings,
      orphanedForeshadowings,
      suggestions: await this.generateSuggestions(orphanedForeshadowings),
    };
  }

  /**
   * 获取伏笔回收建议
   */
  async getResolutionSuggestions(
    projectId: string,
    upcomingChapters: number,
  ): Promise<ForeshadowingResolutionSuggestion[]> {
    const orphaned = await this.getOrphanedForeshadowings(projectId);

    return orphaned.map((f) => ({
      foreshadowing: f,
      urgency: this.calculateUrgency(f, upcomingChapters),
      suggestions: this.generateResolutionIdeas(f),
    }));
  }
}
```

### 3.4 与现有系统集成

```typescript
// 在 WritingMissionService 中集成

async executeChapterWriting(input: ChapterWritingInput) {
  // 1. 写前：获取剧情智能建议
  const plotSuggestions = await this.plotIntelligence.analyzeAndSuggest(
    input.projectId,
    input.chapterNumber,
  );

  // 2. 注入到写作上下文
  const enhancedContext = {
    ...input.context,
    plotIntelligence: {
      foreshadowingsToPlant: plotSuggestions.foreshadowingsToPlant,
      foreshadowingsToResolve: plotSuggestions.foreshadowingsToResolve,
      tensionTarget: plotSuggestions.tensionTarget,
      narrativeThreadFocus: plotSuggestions.threadFocus,
    },
  };

  // 3. 执行写作
  const result = await this.writerAgent.execute(enhancedContext);

  // 4. 写后：追踪伏笔变化
  await this.plotIntelligence.foreshadowing.trackForeshadowing(
    input.projectId,
    input.chapterNumber,
    result.content,
  );

  // 5. 写后：评估是否需要调整大纲
  const outlineAdjustment = await this.plotIntelligence.adjustOutline(
    input.projectId,
    input.chapterNumber,
    result.content,
  );

  if (outlineAdjustment.needsAdjustment) {
    await this.applyOutlineAdjustment(outlineAdjustment);
  }

  return result;
}
```

---

## 四、DeepConsistencyEngine (深度一致性引擎)

### 4.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  DeepConsistencyEngine                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 知识图谱服务 (StoryKnowledgeGraphService)                │
│     - 角色关系图谱                                          │
│     - 事件因果图谱                                          │
│     - 地点空间图谱                                          │
│                                                             │
│  2. 角色行为验证器 (CharacterBehaviorValidator)              │
│     - 性格一致性检查                                         │
│     - 能力边界验证                                          │
│     - 关系演变合理性                                         │
│                                                             │
│  3. 信息隔离检查器 (InformationIsolationChecker)             │
│     - 角色知识边界                                          │
│     - 信息穿越检测                                          │
│     - 视角一致性                                            │
│                                                             │
│  4. 时空连续性验证器 (SpaceTimeConsistencyValidator)         │
│     - 时间线逻辑                                            │
│     - 空间移动合理性                                         │
│     - 因果关系验证                                          │
│                                                             │
│  5. 世界观规则引擎 (WorldRulesEngine)                        │
│     - 魔法/科技体系规则                                      │
│     - 社会结构规则                                          │
│     - 物理法则约束                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 数据模型

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/deep-consistency/interfaces/

/**
 * 角色知识状态（信息隔离关键）
 */
interface CharacterKnowledge {
  characterId: string;

  // 角色已知的事实
  knownFacts: {
    factId: string;
    fact: string;
    learnedAt: ChapterReference;
    source: "witnessed" | "told" | "deduced" | "overheard";
    confidence: number; // 角色对此信息的确信程度
  }[];

  // 角色的错误认知
  misconceptions: {
    belief: string;
    reality: string;
    willLearnTruthAt?: ChapterReference;
  }[];

  // 角色不知道的重要事实
  unknownCriticalFacts: string[];
}

/**
 * 角色状态快照
 */
interface CharacterStateSnapshot {
  characterId: string;
  asOfChapter: number;

  // 物理状态
  physical: {
    location: string;
    health: "healthy" | "injured" | "critical" | "dead";
    injuries?: string[];
    possessions: string[];
  };

  // 心理状态
  mental: {
    mood: string;
    currentGoal: string;
    fears: string[];
    motivations: string[];
    recentTrauma?: string;
  };

  // 社交状态
  social: {
    allies: string[];
    enemies: string[];
    relationships: {
      withCharacterId: string;
      type: string;
      trust: number; // -100 to 100
      recentChanges?: string;
    }[];
  };

  // 能力状态
  abilities: {
    skills: { name: string; level: number }[];
    powers?: { name: string; limitations: string[] }[];
    resources: { type: string; amount: string }[];
  };
}

/**
 * 一致性检查结果
 */
interface ConsistencyCheckResult {
  isConsistent: boolean;

  violations: {
    id: string;
    type: ConsistencyViolationType;
    severity: "critical" | "major" | "minor" | "suggestion";

    // 问题描述
    description: string;
    evidence: {
      currentText: string;
      conflictsWith: string;
      conflictSource: ChapterReference;
    };

    // 修复建议
    suggestions: {
      approach: string;
      revisedText?: string;
      requiresRetcon?: boolean;
    }[];
  }[];

  // 统计
  stats: {
    checksPerformed: number;
    violationsFound: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
}

type ConsistencyViolationType =
  | "character_personality" // 性格不一致
  | "character_knowledge" // 信息穿越
  | "character_ability" // 能力超限
  | "character_location" // 位置不可能
  | "timeline_paradox" // 时间悖论
  | "causality_violation" // 因果错误
  | "world_rule_violation" // 世界观违规
  | "relationship_inconsistency" // 关系矛盾
  | "terminology_mismatch"; // 术语不一致
```

### 4.3 服务设计

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/deep-consistency/

@Injectable()
export class DeepConsistencyEngine {
  constructor(
    private readonly knowledgeGraph: StoryKnowledgeGraphService,
    private readonly characterValidator: CharacterBehaviorValidatorService,
    private readonly infoIsolation: InformationIsolationCheckerService,
    private readonly spaceTime: SpaceTimeConsistencyValidatorService,
    private readonly worldRules: WorldRulesEngineService,
    private readonly aiChat: AiChatService,
  ) {}

  /**
   * 深度一致性检查（写前）
   */
  async preWriteCheck(
    projectId: string,
    chapterOutline: string,
    involvedCharacters: string[],
  ): Promise<PreWriteConsistencyReport> {
    // 1. 加载角色当前状态
    const characterStates = await this.loadCharacterStates(
      projectId,
      involvedCharacters,
    );

    // 2. 检查角色知识边界
    const knowledgeBoundaries =
      await this.infoIsolation.getKnowledgeBoundaries(involvedCharacters);

    // 3. 生成约束清单
    const constraints = await this.generateConstraints({
      characterStates,
      knowledgeBoundaries,
      chapterOutline,
    });

    return {
      characterStates,
      knowledgeBoundaries,
      constraints,
      warnings: await this.detectPotentialIssues(constraints, chapterOutline),
    };
  }

  /**
   * 深度一致性检查（写后）
   */
  async postWriteCheck(
    projectId: string,
    chapterNumber: number,
    content: string,
  ): Promise<ConsistencyCheckResult> {
    const checks = await Promise.all([
      // 1. 角色行为验证
      this.characterValidator.validateBehaviors(projectId, content),

      // 2. 信息隔离检查
      this.infoIsolation.checkViolations(projectId, content),

      // 3. 时空连续性验证
      this.spaceTime.validateConsistency(projectId, chapterNumber, content),

      // 4. 世界观规则检查
      this.worldRules.checkRuleViolations(projectId, content),
    ]);

    return this.aggregateResults(checks);
  }

  /**
   * 更新角色状态（章节完成后）
   */
  async updateCharacterStates(
    projectId: string,
    chapterNumber: number,
    content: string,
  ): Promise<CharacterStateUpdate[]> {
    // 1. 提取角色状态变化
    const changes = await this.extractStateChanges(content);

    // 2. 更新知识图谱
    await this.knowledgeGraph.applyChanges(projectId, changes);

    // 3. 创建状态快照
    return this.createStateSnapshots(projectId, chapterNumber, changes);
  }
}

@Injectable()
export class InformationIsolationCheckerService {
  /**
   * 检查信息穿越
   */
  async checkViolations(
    projectId: string,
    content: string,
  ): Promise<InformationViolation[]> {
    // 1. 提取内容中角色的言行
    const characterActions = await this.extractCharacterActions(content);

    // 2. 对每个角色检查其知识边界
    const violations: InformationViolation[] = [];

    for (const action of characterActions) {
      const knowledge = await this.getCharacterKnowledge(
        projectId,
        action.characterId,
      );

      // 检查角色是否使用了不应该知道的信息
      const violation = await this.checkAgainstKnowledge(action, knowledge);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * 获取角色知识边界（用于写前约束）
   */
  async getKnowledgeBoundaries(
    characterIds: string[],
  ): Promise<Map<string, CharacterKnowledge>> {
    const boundaries = new Map();

    for (const charId of characterIds) {
      boundaries.set(charId, await this.buildKnowledgeProfile(charId));
    }

    return boundaries;
  }
}
```

### 4.4 知识图谱设计

```typescript
// 使用 Neo4j 存储知识图谱

// 节点类型
type KnowledgeNode =
  | CharacterNode
  | EventNode
  | LocationNode
  | ItemNode
  | FactionNode
  | ConceptNode;

interface CharacterNode {
  type: "Character";
  id: string;
  name: string;
  aliases: string[];
  traits: string[];
}

interface EventNode {
  type: "Event";
  id: string;
  name: string;
  chapter: number;
  storyTime: StoryTime;
  description: string;
}

// 关系类型
type KnowledgeRelation =
  | { type: "KNOWS"; properties: { since: number; trust: number } }
  | { type: "ENEMY_OF"; properties: { reason: string } }
  | { type: "LOCATED_AT"; properties: { since: number } }
  | { type: "PARTICIPATED_IN"; properties: { role: string } }
  | { type: "OWNS"; properties: { since: number } }
  | { type: "WITNESSED"; properties: { chapter: number } }
  | { type: "CAUSED"; properties: {} }
  | { type: "RESULTED_IN"; properties: {} };

// 查询示例
const QUERY_CHARACTER_KNOWLEDGE = `
  MATCH (c:Character {id: $characterId})
  MATCH (c)-[:WITNESSED|TOLD|DEDUCED]->(e:Event)
  WHERE e.chapter <= $currentChapter
  RETURN e
`;

const QUERY_CHARACTER_RELATIONSHIPS = `
  MATCH (c:Character {id: $characterId})
  MATCH (c)-[r:KNOWS|ENEMY_OF|ALLY_OF|LOVES|HATES]->(other:Character)
  RETURN other, r
`;
```

---

## 五、CreativeEnhancementEngine (创意增强引擎)

### 5.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  CreativeEnhancementEngine                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 多方案生成器 (MultiOptionGenerator)                      │
│     - 剧情走向多选项                                        │
│     - 场景描写变体                                          │
│     - 对话风格选择                                          │
│                                                             │
│  2. 场景增强器 (SceneEnhancer)                               │
│     - 五感描写增强                                          │
│     - 氛围渲染                                              │
│     - 细节补充                                              │
│                                                             │
│  3. 对话优化器 (DialogueOptimizer)                           │
│     - 角色声音一致性                                         │
│     - 潜台词增强                                            │
│     - 冲突深化                                              │
│                                                             │
│  4. 创意激发器 (CreativityStimulator)                        │
│     - 意外元素注入                                          │
│     - 隐喻/象征建议                                         │
│     - 平行情节建议                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 服务设计

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/creative-enhancement/

@Injectable()
export class CreativeEnhancementEngine {
  constructor(
    private readonly multiOption: MultiOptionGeneratorService,
    private readonly sceneEnhancer: SceneEnhancerService,
    private readonly dialogueOptimizer: DialogueOptimizerService,
    private readonly creativityStimulator: CreativityStimulatorService,
    private readonly aiChat: AiChatService,
  ) {}

  /**
   * 生成多种写法选项
   */
  async generateOptions(
    context: WritingContext,
    targetType: "plot" | "scene" | "dialogue",
    count: number = 3,
  ): Promise<CreativeOption[]> {
    const generator = this.getGenerator(targetType);

    const options = await generator.generate(context, count);

    // 为每个选项评分
    return Promise.all(
      options.map(async (option) => ({
        ...option,
        scores: await this.evaluateOption(option, context),
      })),
    );
  }

  /**
   * 增强场景描写
   */
  async enhanceScene(
    scene: string,
    enhancementType: "sensory" | "atmosphere" | "detail",
  ): Promise<EnhancedScene> {
    return this.sceneEnhancer.enhance(scene, enhancementType);
  }

  /**
   * 优化对话
   */
  async optimizeDialogue(
    dialogue: string,
    characters: CharacterProfile[],
    context: DialogueContext,
  ): Promise<OptimizedDialogue> {
    return this.dialogueOptimizer.optimize(dialogue, characters, context);
  }

  /**
   * 获取创意建议
   */
  async getCreativeSuggestions(
    currentContent: string,
    storyContext: StoryContext,
  ): Promise<CreativeSuggestion[]> {
    return this.creativityStimulator.generateSuggestions(
      currentContent,
      storyContext,
    );
  }
}

interface CreativeOption {
  id: string;
  type: "plot" | "scene" | "dialogue";

  // 内容
  title: string;
  description: string;
  content: string;

  // 特点
  style: string; // 风格描述
  tone: string; // 基调
  impact: string; // 对剧情的影响

  // 评分
  scores: {
    plotTension: number; // 剧情张力 1-10
    characterFit: number; // 人设契合 1-10
    creativity: number; // 创意度 1-10
    coherence: number; // 连贯性 1-10
    extensibility: number; // 后续可延展性 1-10
  };

  // 推荐理由
  recommendation?: string;
}
```

---

## 六、StyleTransferEngine (风格迁移引擎)

### 6.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  StyleTransferEngine                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 风格分析器 (StyleAnalyzer)                               │
│     - 从样本提取风格特征                                     │
│     - 风格向量化                                            │
│     - 风格对比分析                                          │
│                                                             │
│  2. 风格迁移器 (StyleTransfer)                               │
│     - 单一风格迁移                                          │
│     - 多风格融合                                            │
│     - 渐进式风格过渡                                         │
│                                                             │
│  3. 风格一致性监控 (StyleConsistencyMonitor)                  │
│     - 章节间风格漂移检测                                     │
│     - 风格修正建议                                          │
│     - 风格基线维护                                          │
│                                                             │
│  4. 预设风格库 (StylePresetLibrary)                          │
│     - 名家风格（罗贯中、金庸、东野圭吾...）                   │
│     - 类型风格（武侠、悬疑、都市...）                        │
│     - 自定义风格                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 数据模型

```typescript
// backend/src/modules/ai-app/writing/services/super-brain/style-transfer/interfaces/

/**
 * 风格特征
 */
interface StyleFeatures {
  // 语言特征
  language: {
    vocabulary: "classical" | "modern" | "colloquial" | "technical";
    sentenceLength: "short" | "medium" | "long" | "varied";
    paragraphLength: "compact" | "medium" | "expansive";
    rhetoricalDevices: string[]; // 修辞手法
  };

  // 叙事特征
  narrative: {
    pov: "first" | "third_limited" | "third_omniscient" | "multiple";
    tense: "past" | "present" | "mixed";
    pacing: "fast" | "moderate" | "slow" | "varied";
    showTell: number; // show vs tell 比例 0-1
  };

  // 描写特征
  description: {
    sensoryEmphasis: (
      | "visual"
      | "auditory"
      | "tactile"
      | "olfactory"
      | "gustatory"
    )[];
    detailLevel: "sparse" | "moderate" | "rich";
    metaphorDensity: "low" | "medium" | "high";
  };

  // 对话特征
  dialogue: {
    frequency: "rare" | "moderate" | "frequent";
    tagStyle: "minimal" | "varied" | "descriptive";
    dialectUse: boolean;
  };

  // 情感特征
  emotional: {
    tone: string[]; // 基调
    intensity: "subtle" | "moderate" | "dramatic";
    humorLevel: "none" | "light" | "frequent";
  };
}

/**
 * 风格预设
 */
interface StylePreset {
  id: string;
  name: string;
  author?: string; // 如果是名家风格
  description: string;

  features: StyleFeatures;

  // 示例片段
  examples: {
    type: "action" | "dialogue" | "description" | "introspection";
    text: string;
  }[];

  // 提示词增强
  promptEnhancements: string[];
}
```

### 6.3 服务设计

```typescript
@Injectable()
export class StyleTransferEngine {
  constructor(
    private readonly analyzer: StyleAnalyzerService,
    private readonly transfer: StyleTransferService,
    private readonly monitor: StyleConsistencyMonitorService,
    private readonly presetLibrary: StylePresetLibraryService,
  ) {}

  /**
   * 分析文本风格
   */
  async analyzeStyle(text: string): Promise<StyleFeatures> {
    return this.analyzer.analyze(text);
  }

  /**
   * 应用风格迁移
   */
  async applyStyle(
    content: string,
    targetStyle: StylePreset | StyleFeatures,
    intensity: number = 0.8, // 0-1, 风格应用强度
  ): Promise<string> {
    return this.transfer.transfer(content, targetStyle, intensity);
  }

  /**
   * 混合多种风格
   */
  async blendStyles(
    content: string,
    styles: { style: StylePreset; weight: number }[],
  ): Promise<string> {
    return this.transfer.blend(content, styles);
  }

  /**
   * 检测风格漂移
   */
  async checkStyleDrift(
    projectId: string,
    newChapterContent: string,
  ): Promise<StyleDriftReport> {
    // 1. 获取项目基线风格
    const baselineStyle = await this.getProjectBaselineStyle(projectId);

    // 2. 分析新章节风格
    const newStyle = await this.analyzer.analyze(newChapterContent);

    // 3. 计算漂移程度
    return this.monitor.calculateDrift(baselineStyle, newStyle);
  }
}
```

---

## 七、SelfLearningEngine (自学习引擎)

### 7.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  SelfLearningEngine                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户行为追踪器 (UserBehaviorTracker)                     │
│     - 编辑操作追踪                                          │
│     - 阅读行为分析                                          │
│     - 偏好模式识别                                          │
│                                                             │
│  2. 偏好学习器 (PreferenceLearner)                           │
│     - 风格偏好学习                                          │
│     - 内容偏好学习                                          │
│     - 节奏偏好学习                                          │
│                                                             │
│  3. 反馈适配器 (FeedbackAdapter)                             │
│     - 显式反馈处理（点赞/踩）                               │
│     - 隐式反馈推断                                          │
│     - 反馈转化为约束                                        │
│                                                             │
│  4. 模型微调接口 (ModelTuningInterface)                      │
│     - Prompt 优化                                           │
│     - 参数调整建议                                          │
│     - A/B 测试框架                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 数据模型

```typescript
/**
 * 用户偏好档案
 */
interface UserPreferenceProfile {
  userId: string;
  projectId?: string; // 可以是项目级偏好

  // 风格偏好
  stylePreferences: {
    preferredVocabulary: "classical" | "modern" | "mixed";
    preferredPacing: "fast" | "moderate" | "slow";
    descriptionDensity: "sparse" | "moderate" | "rich";
    dialogueFrequency: "low" | "medium" | "high";
    showTellRatio: number; // 0-1
  };

  // 内容偏好
  contentPreferences: {
    favoriteThemes: string[];
    avoidedThemes: string[];
    preferredConflictTypes: string[];
    romanticContentLevel: "none" | "subtle" | "moderate" | "explicit";
    violenceLevel: "none" | "mild" | "moderate" | "graphic";
  };

  // 结构偏好
  structurePreferences: {
    preferredChapterLength: number; // 目标字数
    cliffhangerFrequency: "rare" | "occasional" | "frequent";
    subplotDensity: "low" | "medium" | "high";
  };

  // 学习元数据
  metadata: {
    lastUpdated: Date;
    dataPoints: number;
    confidence: number;
  };
}

/**
 * 用户行为事件
 */
interface UserBehaviorEvent {
  userId: string;
  projectId: string;
  chapterId: string;

  eventType:
    | "edit_content" // 编辑内容
    | "delete_content" // 删除内容
    | "regenerate" // 重新生成
    | "accept_suggestion" // 接受建议
    | "reject_suggestion" // 拒绝建议
    | "rate_positive" // 正面评价
    | "rate_negative" // 负面评价
    | "share" // 分享
    | "reading_time"; // 阅读时长

  // 事件详情
  details: {
    originalContent?: string;
    newContent?: string;
    reason?: string;
    duration?: number;
  };

  timestamp: Date;
}
```

### 7.3 服务设计

```typescript
@Injectable()
export class SelfLearningEngine {
  constructor(
    private readonly behaviorTracker: UserBehaviorTrackerService,
    private readonly preferenceLearner: PreferenceLearnerService,
    private readonly feedbackAdapter: FeedbackAdapterService,
    private readonly modelTuning: ModelTuningInterfaceService,
  ) {}

  /**
   * 记录用户行为
   */
  async trackBehavior(event: UserBehaviorEvent): Promise<void> {
    // 1. 存储事件
    await this.behaviorTracker.record(event);

    // 2. 触发增量学习
    if (this.shouldUpdatePreferences(event)) {
      await this.preferenceLearner.incrementalUpdate(event.userId, event);
    }
  }

  /**
   * 获取个性化写作参数
   */
  async getPersonalizedParams(
    userId: string,
    projectId: string,
  ): Promise<PersonalizedWritingParams> {
    // 1. 获取用户偏好
    const preferences = await this.preferenceLearner.getPreferences(
      userId,
      projectId,
    );

    // 2. 转化为写作参数
    return this.convertToWritingParams(preferences);
  }

  /**
   * 从反馈中学习
   */
  async learnFromFeedback(
    userId: string,
    feedback: UserFeedback,
  ): Promise<LearningResult> {
    // 1. 处理反馈
    const insights = await this.feedbackAdapter.process(feedback);

    // 2. 更新偏好
    await this.preferenceLearner.applyInsights(userId, insights);

    // 3. 建议模型调整
    return this.modelTuning.suggestAdjustments(insights);
  }
}
```

---

## 八、DynamicAgentOrchestrator (动态 Agent 编排器)

### 8.1 核心能力

```
┌─────────────────────────────────────────────────────────────┐
│  DynamicAgentOrchestrator                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 场景分类器 (SceneClassifier)                             │
│     - 识别场景类型（动作戏、情感戏、悬疑、对话...）           │
│     - 预测所需专业能力                                       │
│                                                             │
│  2. 动态团队组建器 (DynamicTeamBuilder)                      │
│     - 根据场景选择 Agent                                     │
│     - Agent 能力匹配                                         │
│     - 团队组合优化                                          │
│                                                             │
│  3. 专家 Agent 池 (SpecialistAgentPool)                      │
│     - 武术指导 Agent                                         │
│     - 心理分析 Agent                                         │
│     - 伏笔管理 Agent                                         │
│     - 节奏控制 Agent                                         │
│     - 对话打磨 Agent                                         │
│     - 场景渲染 Agent                                         │
│     - ...                                                   │
│                                                             │
│  4. 协作协调器 (CollaborationCoordinator)                    │
│     - Agent 间任务分配                                       │
│     - 输出整合                                              │
│     - 冲突解决                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 专家 Agent 定义

```typescript
// backend/src/modules/ai-app/writing/agents/specialists/

/**
 * 专家 Agent 基类
 */
abstract class SpecialistAgent extends BaseAgent {
  abstract readonly specialty: AgentSpecialty;
  abstract readonly suitableScenes: SceneType[];

  /**
   * 评估对特定场景的适用度
   */
  abstract evaluateFitness(scene: SceneContext): number; // 0-1
}

/**
 * 武术指导 Agent
 */
@Injectable()
export class MartialArtsDirectorAgent extends SpecialistAgent {
  readonly name = "martial-arts-director";
  readonly specialty = AgentSpecialty.ACTION;
  readonly suitableScenes = [SceneType.BATTLE, SceneType.DUEL, SceneType.CHASE];

  protected async executeCore(input: WriterInput): Promise<WriterOutput> {
    // 专注于动作场面的精彩描写
    // - 招式设计
    // - 节奏把控
    // - 画面感营造
  }
}

/**
 * 心理分析 Agent
 */
@Injectable()
export class PsychologicalAnalystAgent extends SpecialistAgent {
  readonly name = "psychological-analyst";
  readonly specialty = AgentSpecialty.PSYCHOLOGY;
  readonly suitableScenes = [
    SceneType.INTROSPECTION,
    SceneType.CONFRONTATION,
    SceneType.REVELATION,
  ];

  protected async executeCore(input: WriterInput): Promise<WriterOutput> {
    // 专注于人物心理描写
    // - 内心独白
    // - 情绪变化
    // - 心理博弈
  }
}

/**
 * 伏笔大师 Agent
 */
@Injectable()
export class ForeshadowingMasterAgent extends SpecialistAgent {
  readonly name = "foreshadowing-master";
  readonly specialty = AgentSpecialty.FORESHADOWING;
  readonly suitableScenes = [
    SceneType.MYSTERY,
    SceneType.SETUP,
    SceneType.REVELATION,
  ];

  protected async executeCore(input: WriterInput): Promise<WriterOutput> {
    // 专注于伏笔的埋设和回收
    // - 隐晦的暗示
    // - 自然的铺垫
    // - 惊人的揭示
  }
}

// 更多专家 Agent...
```

### 8.3 动态编排逻辑

```typescript
@Injectable()
export class DynamicAgentOrchestrator {
  constructor(
    private readonly sceneClassifier: SceneClassifierService,
    private readonly teamBuilder: DynamicTeamBuilderService,
    private readonly agentPool: SpecialistAgentPoolService,
    private readonly coordinator: CollaborationCoordinatorService,
  ) {}

  /**
   * 为章节组建最优团队
   */
  async assembleTeam(
    chapterOutline: string,
    storyContext: StoryContext,
  ): Promise<DynamicTeam> {
    // 1. 分析章节中的场景
    const scenes = await this.sceneClassifier.classifyScenes(chapterOutline);

    // 2. 为每个场景确定所需专家
    const requiredSpecialties = new Set<AgentSpecialty>();
    for (const scene of scenes) {
      const specialists =
        await this.sceneClassifier.getRequiredSpecialists(scene);
      specialists.forEach((s) => requiredSpecialties.add(s));
    }

    // 3. 从 Agent 池中选择最佳匹配
    const selectedAgents = await this.agentPool.selectBestAgents(
      Array.from(requiredSpecialties),
      storyContext,
    );

    // 4. 组建团队
    return this.teamBuilder.buildTeam({
      leader: this.agentPool.getCoreArchitect(),
      specialists: selectedAgents,
      scenes,
    });
  }

  /**
   * 执行动态协作写作
   */
  async executeCollaborativeWriting(
    team: DynamicTeam,
    input: ChapterWritingInput,
  ): Promise<ChapterWritingOutput> {
    // 1. Leader 分解任务
    const taskPlan = await team.leader.planTasks(input);

    // 2. 分配任务给专家
    const assignments = this.coordinator.assignTasks(
      taskPlan.tasks,
      team.specialists,
    );

    // 3. 并行执行
    const results = await Promise.all(
      assignments.map(async ({ agent, task }) => ({
        task,
        result: await agent.execute(task),
      })),
    );

    // 4. 整合输出
    return this.coordinator.integrateResults(results, input.context);
  }
}
```

---

## 九、数据库 Schema 扩展

### 9.1 新增 Prisma 模型

```prisma
// backend/prisma/schema.prisma

// ==================== 伏笔管理 ====================

model WritingForeshadowing {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  project     WritingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // 伏笔内容
  type        String   @db.VarChar(50)  // character, event, item, prophecy, hint
  content     String   @db.Text
  significance String  @db.VarChar(20)  // major, minor, subtle

  // 生命周期
  status      String   @default("planted") @db.VarChar(20)  // planted, developing, resolved, abandoned
  plantedAt   Int      @map("planted_at")      // 章节号
  resolvedAt  Int?     @map("resolved_at")     // 章节号

  // 关联
  relatedCharacters String[] @default([]) @map("related_characters")
  relatedEvents     String[] @default([]) @map("related_events")

  // 建议
  suggestedResolutionRange Json? @map("suggested_resolution_range")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // 发展记录
  developments WritingForeshadowingDevelopment[]

  @@index([projectId])
  @@index([status])
  @@map("writing_foreshadowings")
}

model WritingForeshadowingDevelopment {
  id              String   @id @default(uuid())
  foreshadowingId String   @map("foreshadowing_id")
  foreshadowing   WritingForeshadowing @relation(fields: [foreshadowingId], references: [id], onDelete: Cascade)

  chapterNumber   Int      @map("chapter_number")
  developmentType String   @db.VarChar(50)  // hint, reveal_partial, strengthen
  description     String   @db.Text

  createdAt       DateTime @default(now()) @map("created_at")

  @@index([foreshadowingId])
  @@map("writing_foreshadowing_developments")
}

// ==================== 叙事线程 ====================

model WritingNarrativeThread {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  project     WritingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  name        String   @db.VarChar(200)
  type        String   @db.VarChar(50)  // main, subplot, character_arc, mystery
  status      String   @default("active") @db.VarChar(20)  // active, paused, concluded, merged

  primaryPOV  String?  @map("primary_pov")  // 主视角角色ID

  timelineStart   Json?   @map("timeline_start")
  timelineCurrent Json?   @map("timeline_current")

  keyMoments      Json    @default("[]") @map("key_moments")
  intersections   Json    @default("[]")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([projectId])
  @@index([status])
  @@map("writing_narrative_threads")
}

// ==================== 角色知识状态 ====================

model WritingCharacterKnowledge {
  id          String   @id @default(uuid())
  characterId String   @map("character_id")
  character   WritingCharacter @relation(fields: [characterId], references: [id], onDelete: Cascade)

  // 已知事实
  knownFacts  Json     @default("[]") @map("known_facts")

  // 错误认知
  misconceptions Json  @default("[]")

  // 关键未知
  unknownCriticalFacts String[] @default([]) @map("unknown_critical_facts")

  asOfChapter Int      @map("as_of_chapter")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([characterId, asOfChapter])
  @@index([characterId])
  @@map("writing_character_knowledge")
}

// ==================== 角色状态快照 ====================

model WritingCharacterStateSnapshot {
  id          String   @id @default(uuid())
  characterId String   @map("character_id")
  character   WritingCharacter @relation(fields: [characterId], references: [id], onDelete: Cascade)

  chapterNumber Int    @map("chapter_number")

  // 状态数据
  physicalState Json   @map("physical_state")
  mentalState   Json   @map("mental_state")
  socialState   Json   @map("social_state")
  abilityState  Json   @map("ability_state")

  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([characterId, chapterNumber])
  @@index([characterId])
  @@map("writing_character_state_snapshots")
}

// ==================== 风格配置 ====================

model WritingStyleProfile {
  id          String   @id @default(uuid())
  projectId   String   @unique @map("project_id")
  project     WritingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // 基线风格
  baselineStyle Json   @map("baseline_style")

  // 风格预设（如果使用）
  presetId    String?  @map("preset_id")
  presetName  String?  @map("preset_name")

  // 混合配置
  blendConfig Json?    @map("blend_config")  // 多风格混合时

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("writing_style_profiles")
}

// ==================== 用户偏好 ====================

model WritingUserPreference {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  projectId   String?  @map("project_id")  // null 表示全局偏好

  // 偏好数据
  stylePreferences    Json @map("style_preferences")
  contentPreferences  Json @map("content_preferences")
  structurePreferences Json @map("structure_preferences")

  // 元数据
  dataPoints  Int      @default(0) @map("data_points")
  confidence  Float    @default(0) @map("confidence")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([userId, projectId])
  @@index([userId])
  @@map("writing_user_preferences")
}

// ==================== 用户行为事件 ====================

model WritingUserBehaviorEvent {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  projectId   String   @map("project_id")
  chapterId   String?  @map("chapter_id")

  eventType   String   @map("event_type") @db.VarChar(50)
  details     Json

  createdAt   DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([projectId])
  @@index([eventType])
  @@index([createdAt])
  @@map("writing_user_behavior_events")
}

// ==================== 剧情张力分析 ====================

model WritingPlotTensionAnalysis {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  chapterId   String   @map("chapter_id")

  tensionLevel      Float @map("tension_level")
  pacingScore       Float @map("pacing_score")
  emotionalIntensity Float @map("emotional_intensity")

  chapterType String  @map("chapter_type") @db.VarChar(50)
  suggestions Json    @default("[]")

  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([chapterId])
  @@index([projectId])
  @@map("writing_plot_tension_analyses")
}
```

---

## 十、实施路线图

### Phase 1: 核心智能 (P0) - 2-3 周

**目标**: 解决最核心的一致性和伏笔管理问题

```
Week 1-2:
├── DeepConsistencyEngine 基础
│   ├── CharacterBehaviorValidator
│   ├── InformationIsolationChecker (基础版)
│   └── SpaceTimeConsistencyValidator
├── Database Schema Migration
└── 集成到 WritingMissionService

Week 2-3:
├── PlotIntelligenceEngine 基础
│   ├── ForeshadowingManager
│   └── DynamicOutlineService (基础版)
└── 前端 UI 展示
```

### Phase 2: 创意增强 (P1) - 2 周

**目标**: 提供多方案生成和场景增强能力

```
Week 4-5:
├── CreativeEnhancementEngine
│   ├── MultiOptionGenerator
│   ├── SceneEnhancer
│   └── DialogueOptimizer
├── 前端多方案选择 UI
└── A/B 测试框架
```

### Phase 3: 风格系统 (P1) - 2 周

**目标**: 实现风格分析和迁移

```
Week 6-7:
├── StyleTransferEngine
│   ├── StyleAnalyzer
│   ├── StylePresetLibrary
│   └── StyleConsistencyMonitor
├── 预设风格库构建
└── 前端风格配置 UI
```

### Phase 4: 自学习 (P2) - 2 周

**目标**: 实现用户偏好学习

```
Week 8-9:
├── SelfLearningEngine
│   ├── UserBehaviorTracker
│   ├── PreferenceLearner
│   └── FeedbackAdapter
├── 行为事件收集
└── 偏好可视化
```

### Phase 5: 动态编排 (P2) - 2 周

**目标**: 实现场景化 Agent 调度

```
Week 10-11:
├── DynamicAgentOrchestrator
│   ├── SceneClassifier
│   ├── SpecialistAgentPool
│   └── DynamicTeamBuilder
├── 专家 Agent 实现
└── 协作优化
```

### Phase 6: 优化和完善 - 持续

```
├── 性能优化
├── 用户反馈收集
├── 模型微调
└── 功能迭代
```

---

## 十一、目录结构

```
backend/src/modules/ai-app/writing/
├── services/
│   ├── super-brain/                          # 最强大脑模块
│   │   ├── index.ts                          # 统一导出
│   │   ├── super-brain.module.ts             # 模块定义
│   │   │
│   │   ├── plot-intelligence/                # 剧情智能
│   │   │   ├── plot-intelligence.engine.ts
│   │   │   ├── dynamic-outline.service.ts
│   │   │   ├── foreshadowing-manager.service.ts
│   │   │   ├── multi-thread-narrative.service.ts
│   │   │   ├── plot-analyzer.service.ts
│   │   │   └── interfaces/
│   │   │
│   │   ├── deep-consistency/                 # 深度一致性
│   │   │   ├── deep-consistency.engine.ts
│   │   │   ├── story-knowledge-graph.service.ts
│   │   │   ├── character-behavior-validator.service.ts
│   │   │   ├── information-isolation-checker.service.ts
│   │   │   ├── space-time-consistency-validator.service.ts
│   │   │   ├── world-rules.engine.ts
│   │   │   └── interfaces/
│   │   │
│   │   ├── creative-enhancement/             # 创意增强
│   │   │   ├── creative-enhancement.engine.ts
│   │   │   ├── multi-option-generator.service.ts
│   │   │   ├── scene-enhancer.service.ts
│   │   │   ├── dialogue-optimizer.service.ts
│   │   │   ├── creativity-stimulator.service.ts
│   │   │   └── interfaces/
│   │   │
│   │   ├── style-transfer/                   # 风格迁移
│   │   │   ├── style-transfer.engine.ts
│   │   │   ├── style-analyzer.service.ts
│   │   │   ├── style-transfer.service.ts
│   │   │   ├── style-consistency-monitor.service.ts
│   │   │   ├── style-preset-library.service.ts
│   │   │   └── interfaces/
│   │   │
│   │   ├── self-learning/                    # 自学习
│   │   │   ├── self-learning.engine.ts
│   │   │   ├── user-behavior-tracker.service.ts
│   │   │   ├── preference-learner.service.ts
│   │   │   ├── feedback-adapter.service.ts
│   │   │   └── interfaces/
│   │   │
│   │   └── dynamic-orchestration/            # 动态编排
│   │       ├── dynamic-agent-orchestrator.ts
│   │       ├── scene-classifier.service.ts
│   │       ├── dynamic-team-builder.service.ts
│   │       ├── specialist-agent-pool.service.ts
│   │       └── interfaces/
│   │
│   └── ... (existing services)
│
├── agents/
│   ├── specialists/                          # 专家 Agent
│   │   ├── martial-arts-director.agent.ts
│   │   ├── psychological-analyst.agent.ts
│   │   ├── foreshadowing-master.agent.ts
│   │   ├── rhythm-controller.agent.ts
│   │   ├── dialogue-polisher.agent.ts
│   │   ├── scene-renderer.agent.ts
│   │   └── index.ts
│   │
│   └── ... (existing agents)
│
└── ... (other files)
```

---

## 十二、API 设计

### 新增 API 端点

```typescript
// 剧情智能
POST   /api/ai-writing/projects/:id/plot/analyze
GET    /api/ai-writing/projects/:id/foreshadowings
POST   /api/ai-writing/projects/:id/foreshadowings
PATCH  /api/ai-writing/foreshadowings/:id
GET    /api/ai-writing/projects/:id/narrative-threads
POST   /api/ai-writing/projects/:id/plot/branches

// 一致性检查
POST   /api/ai-writing/chapters/:id/consistency/check
GET    /api/ai-writing/projects/:id/consistency/report
GET    /api/ai-writing/characters/:id/knowledge
GET    /api/ai-writing/characters/:id/state-history

// 创意增强
POST   /api/ai-writing/creative/options
POST   /api/ai-writing/creative/enhance-scene
POST   /api/ai-writing/creative/optimize-dialogue

// 风格
GET    /api/ai-writing/styles/presets
POST   /api/ai-writing/projects/:id/style/analyze
POST   /api/ai-writing/projects/:id/style/apply
GET    /api/ai-writing/projects/:id/style/drift

// 用户偏好
GET    /api/ai-writing/users/:id/preferences
PATCH  /api/ai-writing/users/:id/preferences
POST   /api/ai-writing/feedback
```

---

这份设计文档完整定义了"最强大脑"的架构和实现方案。需要我开始实现 Phase 1 的核心模块吗？
