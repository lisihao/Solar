# AI 调用规范指南

> **状态**: 生效中
> **创建日期**: 2026-01-10
> **适用范围**: 所有 AI 相关开发

---

## 1. 问题背景

当前代码库存在多种 AI 调用接口，导致：

- 参数传递方式不统一
- 无法集中管理模型配置
- 新开发者难以选择正确的接口
- TaskProfile 抽象层难以全面覆盖

### 1.1 现有接口统计

| 接口                                            | 使用场景     | 支持 TaskProfile | 支持 modelType |
| ----------------------------------------------- | ------------ | ---------------- | -------------- |
| `AiChatService.chat()`                          | ★ 推荐接口   | ✅ 是            | ✅ 是          |
| `AiChatService.generateChatCompletion()`        | 底层接口     | ❌ 否            | ❌ 否          |
| `AiChatService.generateChatCompletionWithKey()` | 指定 API Key | ✅ 是            | ❌ 否          |
| `LLMFactory.getAdapter().chat()`                | 适配器模式   | ✅ 是            | ❌ 否          |
| `AiOrchestrationService.call()`                 | 编排调用     | ❌ 否            | ❌ 否          |
| `callbacks.callAIWithConfig()`                  | 回调模式     | ❌ 否            | ❌ 否          |

---

## 2. 统一调用规范

### 2.1 推荐接口：`AiChatService.chat()`

**所有新代码必须使用此接口**，除非有特殊理由。

```typescript
import { AiChatService } from "@/modules/ai-engine/llm/services/ai-chat.service";
import { TaskProfile } from "@/modules/ai-engine/llm/types";
import { AIModelType } from "@prisma/client";

// ★ 推荐方式：使用 TaskProfile + modelType
const response = await this.aiChatService.chat({
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ],
  modelType: AIModelType.CHAT, // 让 AI Engine 选择具体模型
  taskProfile: {
    creativity: "medium", // 任务创意度
    outputLength: "medium", // 输出长度
    outputFormat: "json", // 可选：输出格式
  },
});
```

### 2.2 参数优先级

```
1. 直接参数（maxTokens, temperature）  ← 最高优先级（紧急覆盖）
     ↓ 如果未指定
2. TaskProfile 映射                    ← 推荐方式
     ↓ 如果未指定
3. 数据库模型配置                      ← 模型默认值
     ↓ 如果未配置
4. 硬编码默认值（4096, 0.7）          ← 最后兜底
```

### 2.3 TaskProfile 映射规则

#### 创意度 (creativity)

| 等级            | temperature | 适用场景                        |
| --------------- | ----------- | ------------------------------- |
| `deterministic` | 0.1         | 分类、提取、JSON 解析、精确匹配 |
| `low`           | 0.3         | 分析、总结、评估、事实检查      |
| `medium`        | 0.7         | 对话、研究、规划、通用任务      |
| `high`          | 0.9         | 创意写作、头脑风暴、故事创作    |

#### 输出长度 (outputLength)

| 等级       | maxTokens | 适用场景                      |
| ---------- | --------- | ----------------------------- |
| `minimal`  | 500       | 是/否判断、分类标签、简短回复 |
| `short`    | 1500      | 摘要、要点提取、简短分析      |
| `medium`   | 4000      | 详细分析、标准对话、中等报告  |
| `standard` | 6000      | 编辑任务、结构化输出          |
| `long`     | 8000      | 报告、章节、全面分析          |
| `extended` | 16000     | 超长内容、推理模型任务        |

### 2.4 模型类型选择

```typescript
import { AIModelType } from "@prisma/client";

// 根据任务选择合适的模型类型
AIModelType.CHAT; // 标准对话（GPT-4o, Claude 3.5 Sonnet）
AIModelType.CHAT_FAST; // 快速低成本（GPT-4o-mini, Claude Haiku）
AIModelType.MULTIMODAL; // 多模态（图片理解）
AIModelType.EMBEDDING; // 向量嵌入
AIModelType.RERANK; // 重排序
```

---

## 3. 接口使用决策树

```
需要调用 AI 模型
    │
    ├─ 是否需要指定具体 API Key？
    │   ├─ 是 → AiChatService.generateChatCompletionWithKey()
    │   │       （添加 taskProfile 参数）
    │   │
    │   └─ 否 ↓
    │
    ├─ 是否在 Agent 基类中？
    │   ├─ 是 → 继承 BaseAgent，使用 this.callLLM()
    │   │       （内部使用 AiChatService.chat）
    │   │
    │   └─ 否 ↓
    │
    ├─ 是否需要 Function Calling？
    │   ├─ 是 → LLMFactory.getAdapter().chat() with tools
    │   │       （确保传递 taskProfile）
    │   │
    │   └─ 否 ↓
    │
    └─ 使用 AiChatService.chat()  ★ 默认选择
```

---

## 4. 代码示例

### 4.1 分析任务（低创意，中等输出）

```typescript
const analysis = await this.aiChatService.chat({
  messages: [{ role: "user", content: `分析以下内容：${content}` }],
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    outputFormat: "json",
  },
});
```

### 4.2 创意写作（高创意，长输出）

```typescript
const chapter = await this.aiChatService.chat({
  messages: [
    { role: "system", content: writerPrompt },
    { role: "user", content: `写第 ${chapterNumber} 章` },
  ],
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "high",
    outputLength: "long",
  },
});
```

### 4.3 快速分类（确定性，最小输出）

```typescript
const category = await this.aiChatService.chat({
  messages: [{ role: "user", content: `分类：${item}` }],
  modelType: AIModelType.CHAT_FAST, // 使用快速模型
  taskProfile: {
    creativity: "deterministic",
    outputLength: "minimal",
    outputFormat: "json",
  },
});
```

---

## 5. 禁止的做法

### ❌ 硬编码模型名称

```typescript
// ❌ 错误
const response = await this.aiChatService.chat({
  model: "gpt-4o-mini", // 硬编码模型名
  messages,
});

// ✅ 正确
const response = await this.aiChatService.chat({
  modelType: AIModelType.CHAT_FAST,
  messages,
});
```

### ❌ 硬编码 temperature/maxTokens

```typescript
// ❌ 错误
const response = await this.aiChatService.chat({
  temperature: 0.7,
  maxTokens: 4000,
  messages,
});

// ✅ 正确
const response = await this.aiChatService.chat({
  taskProfile: {
    creativity: "medium",
    outputLength: "medium",
  },
  messages,
});
```

### ❌ 直接使用底层接口

```typescript
// ❌ 避免（除非有特殊需求）
const response = await this.aiChatService.generateChatCompletion({
  model: "gpt-4o",
  messages,
  maxTokens: 4000,
});

// ✅ 使用推荐接口
const response = await this.aiChatService.chat({
  modelType: AIModelType.CHAT,
  taskProfile: { creativity: "medium", outputLength: "medium" },
  messages,
});
```

---

## 6. 迁移指南

### 6.1 从硬编码参数迁移

**迁移前：**

```typescript
await this.aiChatService.chat({
  messages,
  temperature: 0.3,
  maxTokens: 2000,
});
```

**迁移后：**

```typescript
await this.aiChatService.chat({
  messages,
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "low", // 0.3 → low
    outputLength: "short", // 2000 → short
  },
});
```

### 6.2 参数映射速查表

| 原 temperature | creativity      |
| -------------- | --------------- |
| 0.1-0.2        | "deterministic" |
| 0.3-0.4        | "low"           |
| 0.5-0.7        | "medium"        |
| 0.8-1.0        | "high"          |

| 原 maxTokens | outputLength |
| ------------ | ------------ |
| ≤500         | "minimal"    |
| ≤1500        | "short"      |
| ≤4000        | "medium"     |
| ≤6000        | "standard"   |
| ≤8000        | "long"       |
| >8000        | "extended"   |

---

## 7. 自动化检查（建议）

### 7.1 ESLint 规则建议

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // 禁止硬编码模型名
    "no-restricted-syntax": [
      "error",
      {
        selector: 'Property[key.name="model"][value.type="Literal"]',
        message: "使用 modelType: AIModelType.CHAT 代替硬编码模型名",
      },
    ],
  },
};
```

### 7.2 Code Review 检查清单

- [ ] 是否使用 `AiChatService.chat()` 接口？
- [ ] 是否使用 `modelType` 而非硬编码模型名？
- [ ] 是否使用 `taskProfile` 而非硬编码 temperature/maxTokens？
- [ ] 如果使用其他接口，是否有充分理由？

---

## 8. 例外情况

以下情况可以使用其他接口，但需要在代码中注释说明原因：

1. **测试代码** - 可以使用具体模型名进行 mock
2. **配置表** - 模型价格表、上下文窗口表等需要具体模型名
3. **特定 Provider 功能** - 某些功能只有特定模型支持
4. **性能关键路径** - 需要绕过抽象层的极端情况

```typescript
// 例外情况注释示例
// NOTE: 使用 generateChatCompletion 因为需要直接控制 Claude API 的特定参数
await this.aiChatService.generateChatCompletion({
  model: "claude-3-opus-20240229",
  // ...
});
```

---

## 9. 更新日志

| 日期       | 版本 | 变更                             |
| ---------- | ---- | -------------------------------- |
| 2026-01-10 | 1.0  | 初始版本，TaskProfile 抽象层完成 |

---

## 附录：相关文件

- 类型定义：`backend/src/modules/ai-engine/llm/types/task-profile.types.ts`
- 参数映射：`backend/src/modules/ai-engine/llm/services/task-profile.types-mapper.service.ts`
- 核心服务：`backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`
- 架构文档：`docs/architecture/ai-engine-parameter-abstraction.md`
