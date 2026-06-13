# FactExtractorService 使用指南

## 概述

`FactExtractorService` 是 AI Writing 模块的自动事实提取服务，用于从章节内容中提取关键事实，并支持事实查询和冲突检测。

## 核心功能

### 1. 事实提取

从章节内容中自动提取以下类型的事实：

- **CHARACTER_STATE**: 角色状态（位置、情绪、健康等）
- **PLOT_EVENT**: 情节事件（重要事件、决策等）
- **WORLD_FACT**: 世界事实（规则、设定）
- **TIMELINE**: 时间线事件
- **OBJECT**: 物品状态
- **RELATIONSHIP**: 角色关系变化

### 2. 事实存储

事实保存在 `WritingChapter` 的 `metadata` JSON 字段中。

### 3. 冲突检测

检测新事实与已有事实之间的冲突：

- **CONTRADICTION**: 直接矛盾
- **INCONSISTENCY**: 不一致
- **TIMELINE_ERROR**: 时间线错误

### 4. 事实上下文构建

为写作提供已确立事实的上下文摘要。

## 使用示例

### 基础使用

```typescript
import { FactExtractorService } from "./services/consistency/fact-extractor.service";

@Injectable()
export class ChapterWritingService {
  constructor(private readonly factExtractor: FactExtractorService) {}

  async writeChapter(chapterId: string) {
    // 1. 写作完成后提取事实
    const facts = await this.factExtractor.extractFacts(
      chapterContent,
      chapterContext,
    );

    // 2. 保存事实
    await this.factExtractor.saveFacts(projectId, chapterId, facts);

    // 3. 检测冲突
    const conflicts = await this.factExtractor.detectConflicts(
      projectId,
      facts,
    );

    if (conflicts.length > 0) {
      console.warn("发现冲突:", conflicts);
    }
  }
}
```

### 在写作前注入事实上下文

```typescript
async prepareWritingContext(projectId: string, chapterNumber: number) {
  // 构建事实上下文
  const factContext = await this.factExtractor.buildFactContext(
    projectId,
    chapterNumber,
  );

  // 注入到提示词
  const prompt = `
你是一位专业小说作者。请基于以下已确立的事实进行创作：

${factContext}

现在请写作第${chapterNumber}章...
  `;

  return prompt;
}
```

### 查询特定类型的事实

```typescript
// 查询所有角色状态
const characterStates = await this.factExtractor.getFacts(projectId, {
  type: "CHARACTER_STATE",
  limit: 20,
});

// 查询特定角色的事实
const heroFacts = await this.factExtractor.getFacts(projectId, {
  character: "主角",
});

// 查询特定章节的事实
const chapterFacts = await this.factExtractor.getFacts(projectId, {
  chapterNumber: 5,
});
```

## 数据结构

### ExtractedFact

```typescript
interface ExtractedFact {
  type: FactType;
  subject: string; // 主体
  predicate: string; // 谓语
  object?: string; // 宾语（可选）
  confidence: number; // 置信度 0-1
  evidence: string; // 原文引用
  chapterNumber: number; // 章节编号
  storyTime?: string; // 故事内时间
  extractedAt: string; // 提取时间
}
```

### FactConflict

```typescript
interface FactConflict {
  existingFact: ExtractedFact;
  newFact: ExtractedFact;
  conflictType: ConflictType;
  description: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
}
```

## 集成到写作流程

### 1. 在 ConsistencyEngineService 中集成

```typescript
@Injectable()
export class ConsistencyEngineService {
  constructor(private readonly factExtractor: FactExtractorService) {}

  async validateChapter(chapterId: string) {
    // 原有的一致性检查...

    // 提取并保存事实
    const facts = await this.factExtractor.extractFacts(content, context);
    await this.factExtractor.saveFacts(projectId, chapterId, facts);

    // 检测冲突
    const conflicts = await this.factExtractor.detectConflicts(
      projectId,
      facts,
    );

    return { facts, conflicts };
  }
}
```

### 2. 在 WriterAgent 中使用

```typescript
@Injectable()
export class WriterAgent extends BaseAgent {
  async execute(input: WriterInput) {
    // 构建事实上下文
    const factContext = await this.factExtractor.buildFactContext(
      input.projectId,
      input.chapterNumber,
    );

    // 将事实上下文注入到提示词
    const enhancedPrompt = this.buildPrompt(input, factContext);

    // 执行写作...
  }
}
```

## 性能考虑

### LLM 调用成本

- 每次提取事实会调用 LLM（GPT-4o）
- 建议在章节写作完成后异步提取
- 可以配置是否自动提取

### 缓存策略

- 事实存储在 `metadata` JSON 字段
- 不需要单独的数据库表
- 查询时会加载所有章节的 metadata

### 优化建议

```typescript
// 批量提取多个章节的事实
async batchExtractFacts(chapterIds: string[]) {
  const results = await Promise.all(
    chapterIds.map(id => this.extractFacts(id))
  );
  return results;
}
```

## 最佳实践

### 1. 提取时机

- **推荐**: 章节写作完成后自动提取
- **可选**: 用户手动触发提取

### 2. 冲突处理

```typescript
async handleConflicts(conflicts: FactConflict[]) {
  for (const conflict of conflicts) {
    if (conflict.severity === 'CRITICAL') {
      // 阻止发布，要求修改
      throw new Error(`严重冲突: ${conflict.description}`);
    } else if (conflict.severity === 'WARNING') {
      // 警告用户，允许继续
      this.logger.warn(`警告: ${conflict.description}`);
    }
  }
}
```

### 3. 事实上下文长度控制

```typescript
// 只取最近 N 章的事实
const recentFacts = await this.factExtractor.getFacts(projectId, {
  limit: 50, // 限制数量
});

// 或按章节范围过滤
const relevantChapters = Array.from(
  { length: 5 },
  (_, i) => currentChapter - 5 + i,
);
```

## 故障排除

### 事实提取失败

```typescript
try {
  const facts = await this.factExtractor.extractFacts(content, context);
} catch (error) {
  this.logger.error("事实提取失败:", error);
  // 降级方案：使用规则提取
  return this.fallbackExtraction(content);
}
```

### LLM 返回格式错误

服务内部已处理 JSON 解析错误，会返回空数组。

### 冲突误报

调整提示词中的 `temperature` 参数或修改冲突检测逻辑。

## 未来增强

- [ ] 支持事实的手动编辑和审核
- [ ] 提供事实可视化界面
- [ ] 支持事实之间的关系图谱
- [ ] 集成知识图谱存储（Neo4j）
- [ ] 支持多版本事实追踪

## 相关服务

- `ConsistencyEngineService`: 一致性检查引擎
- `PostWriteValidationService`: 写后验证
- `ContextBuilderService`: 上下文构建
- `StoryBibleService`: 故事圣经管理

---

**最后更新**: 2025-01-09
**维护者**: Claude Code
