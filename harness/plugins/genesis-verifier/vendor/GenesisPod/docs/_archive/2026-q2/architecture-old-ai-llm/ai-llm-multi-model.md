# 多模型架构

## 概述

Genesis 支持多个 AI 模型提供商，每个提供商有不同的特点和适用场景。

## 支持的模型

### 1. OpenAI 模型

| 模型            | 特点           | 适用场景           |
| --------------- | -------------- | ------------------ |
| **GPT-5.1**     | 最强推理能力   | 复杂分析、代码生成 |
| **GPT-4o**      | 多模态、高性能 | 图像理解、快速响应 |
| **GPT-4o-mini** | 快速、低成本   | 简单任务、高并发   |
| **DALL-E 3**    | 图像生成       | 插图、信息图       |

```typescript
// OpenAI 配置
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// GPT-5.1 调用
const completion = await openai.chat.completions.create({
  model: "gpt-5.1",
  messages: [
    { role: "system", content: "你是一个专业的技术分析师。" },
    { role: "user", content: "分析这段代码的性能问题..." },
  ],
  temperature: 0.3,
  max_tokens: 4096,
});
```

### 2. Anthropic 模型

| 模型                | 特点           | 适用场景         |
| ------------------- | -------------- | ---------------- |
| **Claude 3 Opus**   | 最强文本理解   | 长文档分析、研究 |
| **Claude 3 Sonnet** | 平衡性能与成本 | 通用任务         |
| **Claude 3 Haiku**  | 快速、低成本   | 简单查询         |

```typescript
// Anthropic 配置
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude 调用
const message = await anthropic.messages.create({
  model: "claude-3-opus-20240229",
  max_tokens: 4096,
  messages: [{ role: "user", content: "请分析这篇论文的核心观点..." }],
});
```

### 3. Google 模型

| 模型                 | 特点           | 适用场景     |
| -------------------- | -------------- | ------------ |
| **Gemini 2.0 Flash** | 超快速、低成本 | 备用、高并发 |
| **Gemini Pro**       | 通用能力       | 多模态任务   |
| **Imagen**           | 图像生成       | 创意设计     |

```typescript
// Google AI 配置
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const result = await model.generateContent("解释量子计算的基本原理");
```

### 4. xAI 模型

| 模型     | 特点           | 适用场景           |
| -------- | -------------- | ------------------ |
| **Grok** | 实时信息、幽默 | 新闻分析、趣味对话 |

```typescript
// xAI (Grok) 调用
const response = await fetch("https://api.x.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "grok-beta",
    messages: [{ role: "user", content: "最新的科技趋势是什么？" }],
  }),
});
```

## 模型选择策略

### 1. 基于任务类型

```typescript
// model-selector.service.ts
@Injectable()
export class ModelSelectorService {
  selectModel(task: TaskType): ModelConfig {
    const modelMap: Record<TaskType, ModelConfig> = {
      // 复杂推理任务
      "code-generation": {
        model: "gpt-5.1",
        temperature: 0.2,
        maxTokens: 8192,
      },
      "research-analysis": {
        model: "claude-3-opus",
        temperature: 0.5,
        maxTokens: 16384,
      },

      // 快速任务
      "simple-qa": {
        model: "gpt-4o-mini",
        temperature: 0.7,
        maxTokens: 1024,
      },
      translation: {
        model: "gemini-2.0-flash",
        temperature: 0.3,
        maxTokens: 4096,
      },

      // 创意任务
      "creative-writing": {
        model: "claude-3-opus",
        temperature: 0.9,
        maxTokens: 4096,
      },

      // 实时信息
      "news-analysis": {
        model: "grok",
        temperature: 0.7,
        maxTokens: 2048,
      },
    };

    return modelMap[task] || modelMap["simple-qa"];
  }
}
```

### 2. 基于成本优化

```typescript
// cost-optimizer.service.ts
@Injectable()
export class CostOptimizerService {
  // 模型定价 (每 1M tokens, USD)
  private readonly pricing: Record<string, ModelPricing> = {
    "gpt-5.1": { input: 10, output: 30 },
    "gpt-4o": { input: 5, output: 15 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "claude-3-opus": { input: 15, output: 75 },
    "claude-3-sonnet": { input: 3, output: 15 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  };

  selectCostEffectiveModel(
    estimatedTokens: number,
    requiredCapability: "high" | "medium" | "low",
    budget?: number,
  ): string {
    const capabilityModels: Record<string, string[]> = {
      high: ["gpt-5.1", "claude-3-opus"],
      medium: ["gpt-4o", "claude-3-sonnet"],
      low: ["gpt-4o-mini", "gemini-2.0-flash", "claude-3-haiku"],
    };

    const candidates = capabilityModels[requiredCapability];

    // 按成本排序
    const sorted = candidates.sort((a, b) => {
      const costA = this.estimateCost(a, estimatedTokens);
      const costB = this.estimateCost(b, estimatedTokens);
      return costA - costB;
    });

    // 如果有预算限制，选择符合预算的最优模型
    if (budget) {
      const affordable = sorted.find(
        (model) => this.estimateCost(model, estimatedTokens) <= budget,
      );
      return affordable || sorted[0];
    }

    return sorted[0];
  }

  private estimateCost(model: string, tokens: number): number {
    const price = this.pricing[model];
    // 假设输入输出各占一半
    return ((tokens / 2) * price.input + (tokens / 2) * price.output) / 1000000;
  }
}
```

### 3. 基于延迟要求

```typescript
// latency-optimizer.service.ts
@Injectable()
export class LatencyOptimizerService {
  // 模型平均延迟 (ms/1K tokens)
  private readonly latency: Record<string, number> = {
    "gpt-4o-mini": 50,
    "gemini-2.0-flash": 30,
    "claude-3-haiku": 60,
    "gpt-4o": 100,
    "claude-3-sonnet": 120,
    "gpt-5.1": 200,
    "claude-3-opus": 250,
  };

  selectFastModel(maxLatencyMs: number, estimatedTokens: number): string[] {
    const candidates = Object.entries(this.latency)
      .filter(([_, latency]) => {
        const estimatedTime = (latency * estimatedTokens) / 1000;
        return estimatedTime <= maxLatencyMs;
      })
      .sort(([_, a], [__, b]) => a - b)
      .map(([model]) => model);

    return candidates;
  }
}
```

## 多模型协作

### 1. 链式调用

```typescript
// chain-execution.service.ts
@Injectable()
export class ChainExecutionService {
  async executeChain(input: string): Promise<ChainResult> {
    // Step 1: 快速模型进行初步分析
    const analysis = await this.aiOrchestration.chat({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "分析用户意图和关键点" },
        { role: "user", content: input },
      ],
    });

    // Step 2: 强模型进行深度处理
    const deepAnalysis = await this.aiOrchestration.chat({
      model: "gpt-5.1",
      messages: [
        { role: "system", content: "基于初步分析进行深度研究" },
        {
          role: "user",
          content: `初步分析:\n${analysis.content}\n\n原始输入:\n${input}`,
        },
      ],
    });

    // Step 3: 快速模型格式化输出
    const formatted = await this.aiOrchestration.chat({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "将分析结果格式化为结构化报告" },
        { role: "user", content: deepAnalysis.content },
      ],
    });

    return {
      analysis: analysis.content,
      deepAnalysis: deepAnalysis.content,
      formatted: formatted.content,
    };
  }
}
```

### 2. 并行调用

```typescript
// parallel-execution.service.ts
@Injectable()
export class ParallelExecutionService {
  async executeParallel(input: string): Promise<ConsensusResult> {
    // 并行调用多个模型
    const [gptResult, claudeResult, geminiResult] = await Promise.all([
      this.aiOrchestration.chat({
        model: "gpt-5.1",
        messages: [{ role: "user", content: input }],
      }),
      this.aiOrchestration.chat({
        model: "claude-3-opus",
        messages: [{ role: "user", content: input }],
      }),
      this.aiOrchestration.chat({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: input }],
      }),
    ]);

    // 综合多个模型的结果
    const consensus = await this.synthesizeResults([
      gptResult.content,
      claudeResult.content,
      geminiResult.content,
    ]);

    return {
      individual: {
        gpt: gptResult.content,
        claude: claudeResult.content,
        gemini: geminiResult.content,
      },
      consensus,
    };
  }

  private async synthesizeResults(results: string[]): Promise<string> {
    return this.aiOrchestration
      .chat({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "综合多个 AI 模型的分析结果，提取共识和关键分歧点",
          },
          {
            role: "user",
            content: results.map((r, i) => `模型 ${i + 1}:\n${r}`).join("\n\n"),
          },
        ],
      })
      .then((r) => r.content);
  }
}
```

### 3. 专家系统

```typescript
// expert-system.service.ts
@Injectable()
export class ExpertSystemService {
  private readonly experts: Record<string, ExpertConfig> = {
    codeReviewer: {
      model: "gpt-5.1",
      systemPrompt: "你是一位资深的代码审查专家...",
      specialties: ["code", "architecture", "security"],
    },
    dataAnalyst: {
      model: "claude-3-opus",
      systemPrompt: "你是一位数据分析专家...",
      specialties: ["data", "statistics", "visualization"],
    },
    contentWriter: {
      model: "claude-3-sonnet",
      systemPrompt: "你是一位专业的技术写作者...",
      specialties: ["documentation", "tutorial", "blog"],
    },
  };

  async consultExperts(
    input: string,
    relevantExperts: string[],
  ): Promise<ExpertOpinions> {
    const opinions = await Promise.all(
      relevantExperts.map(async (expertName) => {
        const expert = this.experts[expertName];

        const response = await this.aiOrchestration.chat({
          model: expert.model,
          messages: [
            { role: "system", content: expert.systemPrompt },
            { role: "user", content: input },
          ],
        });

        return {
          expert: expertName,
          opinion: response.content,
          model: expert.model,
        };
      }),
    );

    return { opinions };
  }
}
```

## 模型能力对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         模型能力雷达图                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   推理能力        代码能力         创意能力         速度          成本  │
│      ▲              ▲               ▲              ▲            ▲      │
│      │              │               │              │            │      │
│ GPT-5.1  ██████████ ██████████ ████████── ████──── ██──────     │      │
│ Claude3O ██████████ ████████── ██████████ ███───── █─────────   │      │
│ GPT-4o   ████████── ████████── ████████── ██████── ████─────    │      │
│ Gemini2F ██████──── ██████──── ██████──── ██████████ ██████████ │      │
│ GPT-4oM  ██████──── ██████──── ██████──── ██████████ ██████████ │      │
│                                                                          │
│ 图例: ██ = 高  ── = 低                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 参考资源

- [OpenAI 模型对比](https://platform.openai.com/docs/models)
- [Anthropic 模型指南](https://docs.anthropic.com/claude/docs/models-overview)
- [Google AI 模型](https://ai.google.dev/models)
