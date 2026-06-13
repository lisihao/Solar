# 社媒热点工具集成方案

> 版本: 2.1
> 作者: Claude Code
> 日期: 2026-01-26
> 状态: 待审核

---

## 一、概述

### 1.1 目标

将社交媒体热点信息作为新的数据源集成到 Topic Research 系统中，使研究报告能够包含实时社会舆论、公众情绪和热门话题。

### 1.2 方案选型

| 方案                    | 优势                        | 成本      | 选择        |
| ----------------------- | --------------------------- | --------- | ----------- |
| **Grok Live Search**    | 原生 X 数据访问，项目已集成 | 免费 beta | ✅ 主方案   |
| Web Search + site:x.com | 效果有限但稳定              | 免费      | ✅ 降级方案 |
| 独立 X API              | 需要单独申请                | $100+/月  | ❌          |

### 1.3 核心发现

**项目已支持 Grok Live Search**（`ai-chat.service.ts:1940-1957`）：

```typescript
// Enable live search from X/Twitter and web
search_parameters: {
  mode: "auto",           // "auto" = search when needed
  return_citations: true, // Return source citations
},
```

---

## 二、代码审视与修正

### 2.1 类型安全（禁止 `any`）

```typescript
// 定义社媒数据类型
interface SocialTrendItem {
  title: string;
  url: string;
  author: string;
  authorFollowers?: string;
  content: string;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
  };
  sentiment: "positive" | "negative" | "neutral";
  publishedAt: string;
}

interface SocialSearchResponse {
  trends: SocialTrendItem[];
  summary: string;
  dominantSentiment: string;
}
```

### 2.2 降级方案（Grok 失败时）

```typescript
private async searchSocialX(
  query: string,
  maxResults: number,
): Promise<DataSourceResult[]> {
  // 主方案：Grok Live Search
  try {
    const results = await this.searchSocialXViaGrok(query, maxResults);
    if (results.length > 0) {
      return results;
    }
  } catch (error) {
    this.logger.warn(
      `[searchSocialX] Grok Live Search failed, falling back to web search: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 降级方案：Web Search + site:x.com
  return this.searchSocialXViaWebSearch(query, maxResults);
}

/**
 * 降级方案：通过 Web Search 获取 X 内容
 */
private async searchSocialXViaWebSearch(
  query: string,
  maxResults: number,
): Promise<DataSourceResult[]> {
  const webSearchTool = this.toolRegistry.tryGet("web-search");
  if (!webSearchTool) {
    this.logger.warn("[searchSocialXViaWebSearch] web-search tool not available");
    return [];
  }

  const socialQuery = `${query} site:x.com OR site:twitter.com`;
  const result = await webSearchTool.execute(
    { query: socialQuery, numResults: maxResults },
    this.createToolContext("web-search"),
  );

  if (!result.success || !result.data?.results) {
    return [];
  }

  return result.data.results.map((r: WebSearchResult) => ({
    sourceType: DataSourceType.SOCIAL_X,
    title: r.title,
    url: r.url,
    snippet: r.content || r.snippet,
    publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
    domain: "x.com",
    metadata: {
      fetchedVia: "web-search-fallback",
      sentiment: null,  // 降级方案无情感分析
    },
  }));
}
```

### 2.3 JSON 解析容错增强

````typescript
/**
 * 解析 Grok 社媒搜索响应
 * 增强容错：支持多种 JSON 格式
 */
private parseSocialSearchResponse(
  content: string,
  originalQuery: string,
): DataSourceResult[] {
  // 尝试多种 JSON 提取模式
  const extractJson = (text: string): string | null => {
    // 模式1：```json ... ```
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) return jsonBlockMatch[1];

    // 模式2：``` ... ```（无 json 标记）
    const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) return codeBlockMatch[1];

    // 模式3：直接 JSON 对象
    const jsonObjectMatch = text.match(/\{[\s\S]*"trends"[\s\S]*\}/);
    if (jsonObjectMatch) return jsonObjectMatch[0];

    return null;
  };

  try {
    const jsonStr = extractJson(content);
    if (!jsonStr) {
      this.logger.warn("[parseSocialSearchResponse] No JSON found in response");
      return this.extractFallbackResults(content, originalQuery);
    }

    const parsed = JSON.parse(jsonStr) as SocialSearchResponse;

    if (!parsed.trends || !Array.isArray(parsed.trends)) {
      this.logger.warn("[parseSocialSearchResponse] Invalid trends structure");
      return this.extractFallbackResults(content, originalQuery);
    }

    return parsed.trends.map((trend) => this.transformTrendToResult(trend, originalQuery));
  } catch (error) {
    this.logger.error(
      `[parseSocialSearchResponse] Parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return this.extractFallbackResults(content, originalQuery);
  }
}

/**
 * JSON 解析失败时的降级提取
 */
private extractFallbackResults(
  content: string,
  originalQuery: string,
): DataSourceResult[] {
  // 尝试从纯文本中提取 URL
  const urlMatches = content.match(/https?:\/\/(?:x\.com|twitter\.com)\/\S+/g) || [];

  return urlMatches.slice(0, 5).map((url, index) => ({
    sourceType: DataSourceType.SOCIAL_X,
    title: `X/Twitter 讨论 #${index + 1}`,
    url,
    snippet: `关于「${originalQuery}」的社媒讨论`,
    domain: "x.com",
    metadata: {
      fetchedVia: "grok-live-search-fallback",
      parseMethod: "url-extraction",
    },
  }));
}
````

### 2.4 重试机制

```typescript
/**
 * 带重试的 Grok 调用
 */
private async searchSocialXViaGrok(
  query: string,
  maxResults: number,
  retries = 2,
): Promise<DataSourceResult[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await this.aiChatService.chat({
        messages: [
          { role: "system", content: this.getSocialSearchSystemPrompt() },
          { role: "user", content: this.buildSocialSearchPrompt(query, maxResults) },
        ],
        modelType: AIModelType.CHAT,
        provider: "xai",
        taskProfile: { creativity: "low", outputLength: "long" },
      });

      const results = this.parseSocialSearchResponse(response.content, query);
      if (results.length > 0) {
        return results;
      }

      this.logger.warn(`[searchSocialXViaGrok] Attempt ${attempt + 1}: No results parsed`);
    } catch (error) {
      this.logger.warn(
        `[searchSocialXViaGrok] Attempt ${attempt + 1} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (attempt === retries) throw error;
    }
  }
  return [];
}
```

---

## 三、质量提升机制

### 3.1 核心原则：不降低现有质量

社媒数据作为**补充信号**，而非**权威来源**：

| 数据类型     | 定位         | 可信度 | 使用方式                 |
| ------------ | ------------ | ------ | ------------------------ |
| 学术论文     | 权威来源     | 90     | 直接引用作为论据         |
| 新闻报道     | 一手信息     | 75     | 引用作为事实             |
| 政府公告     | 官方立场     | 85     | 引用作为政策依据         |
| **社媒热点** | **补充信号** | **55** | **反映舆论，需交叉验证** |

### 3.2 交叉验证机制

**文件**: `backend/src/modules/ai-app/research/topic-research/services/evidence-validator.service.ts`

```typescript
/**
 * 社媒证据验证
 * 社媒观点需要其他来源印证才能提升可信度
 */
async validateSocialEvidence(
  socialEvidence: DataSourceResult[],
  otherEvidence: DataSourceResult[],
): Promise<ValidatedEvidence[]> {
  return socialEvidence.map((social) => {
    // 查找是否有其他来源支持此观点
    const corroborating = otherEvidence.filter((other) =>
      this.checkContentOverlap(social.snippet, other.snippet)
    );

    const validated: ValidatedEvidence = {
      ...social,
      validationStatus: corroborating.length > 0 ? "corroborated" : "unverified",
      corroboratingEvidence: corroborating.map((e) => e.id),
      // 有交叉验证时提升可信度
      adjustedCredibility: corroborating.length > 0
        ? Math.min(social.credibilityScore + 15, 75)
        : social.credibilityScore,
    };

    return validated;
  });
}
```

### 3.3 Prompt 增强：指导 AI 正确使用社媒数据

**文件**: `backend/src/modules/ai-app/research/topic-research/prompts/dimension-research.prompt.ts`

在系统提示词中添加社媒数据使用指南：

```typescript
export const SOCIAL_MEDIA_USAGE_GUIDELINES = `
## 社媒数据使用规范

社媒数据（来源: x.com）具有以下特点：
- **时效性强**：反映最新舆论动态
- **主观性强**：代表个人观点，非客观事实
- **噪音较多**：需要筛选有价值的信息

### 正确使用方式

1. **作为舆论信号引用**：
   ✅ "根据社媒讨论 [n]，公众对此普遍持谨慎态度"
   ✅ "KOL @xxx 认为 [n]，引发广泛讨论"
   ❌ "根据 Twitter 用户所述，该技术存在缺陷"（不能作为事实依据）

2. **标注情感倾向**：
   ✅ "社媒讨论中，正面情绪占主导 [n]"
   ✅ "部分用户表达担忧 [n]，但整体反响积极"

3. **需要交叉验证的观点**：
   ✅ "社媒用户提及 XX 问题 [n]，这与 YY 报告的结论一致 [m]"
   ❌ 仅凭社媒观点得出重要结论

4. **引用格式区分**：
   - 学术/新闻引用：[n] 直接引用
   - 社媒引用：[n] 并标注 @用户名 或 "社媒讨论"
`;
```

### 3.4 报告生成时的质量控制

```typescript
/**
 * 社媒数据融入报告时的质量检查
 */
interface SocialDataQualityCheck {
  // 社媒引用不超过总引用的 30%
  maxSocialRatio: 0.3;
  // 关键结论必须有非社媒来源支撑
  keyFindingsRequireNonSocialEvidence: true;
  // 社媒数据单独成段，不与事实混淆
  separateSocialSection: true;
}
```

### 3.5 引用格式区分

在 `formatEvidenceForPrompt` 中标注社媒来源：

```typescript
// 证据格式中增加来源类型标识
const sourceTypeLabel = {
  [DataSourceType.WEB]: "网页",
  [DataSourceType.ACADEMIC]: "学术",
  [DataSourceType.GITHUB]: "GitHub",
  [DataSourceType.SOCIAL_X]: "社媒/X", // 明确标注
};

// 输出示例：
// 证据 [5] (社媒/X) - @techleader 的观点
```

---

## 四、Skills 更新

### 4.1 更新 `ai-app-developer` Skill

**文件**: `.claude/skills/ai/ai-app-developer/references/data-sources.md`（新建）

```markdown
# Data Source Extension Guide

## Adding New Data Sources

### Pattern

1. Add `DataSourceType` enum value
2. Implement search method in `DataSourceRouterService`
3. Add capability description in `DataSourcePlannerService`
4. Update `capability-mapping.ts` for Admin UI

### Data Source Categories

| Category       | Credibility | Use Case          |
| -------------- | ----------- | ----------------- |
| Academic       | 85-95       | Research evidence |
| Government     | 80-90       | Policy reference  |
| News           | 70-80       | Current events    |
| Tech Community | 60-70       | Industry trends   |
| Social Media   | 50-60       | Public sentiment  |

### Social Media Integration

Social media data requires special handling:

- Lower credibility score (55)
- Cross-validation with other sources
- Sentiment tagging
- Separate presentation in reports
```

### 4.2 更新 Skill 引用

**文件**: `.claude/skills/ai/ai-app-developer/SKILL.md`

在 "Related Docs" 中添加：

```markdown
- [Data Source Extension](references/data-sources.md)
```

---

## 五、实现步骤（更新）

### Phase 1（MVP）

| 步骤     | 内容                                 | 文件                             | 工作量      |
| -------- | ------------------------------------ | -------------------------------- | ----------- |
| 1        | 定义类型接口                         | `data-source.types.ts`           | 15 min      |
| 2        | 添加 `DataSourceType.SOCIAL_X`       | `data-source.types.ts`           | 5 min       |
| 3        | 实现 `searchSocialX()` + 降级 + 重试 | `data-source-router.service.ts`  | 1.5 hr      |
| 4        | 添加能力描述                         | `data-source-planner.service.ts` | 15 min      |
| 5        | 更新 Prompt 添加社媒使用指南         | `dimension-research.prompt.ts`   | 30 min      |
| 6        | 更新 Admin 能力定义                  | `capability-mapping.ts`          | 20 min      |
| 7        | 添加国际化文本                       | `zh.json`, `en.json`             | 10 min      |
| 8        | 创建 Skill 参考文档                  | `data-sources.md`                | 20 min      |
| **总计** |                                      |                                  | **~3.5 hr** |

### Phase 2（质量增强）

| 任务 | 描述                             |
| ---- | -------------------------------- |
| 2.1  | 实现交叉验证服务                 |
| 2.2  | 情感分析可视化                   |
| 2.3  | 报告质量检查（社媒引用比例控制） |
| 2.4  | KOL 影响力权重                   |

---

## 六、测试验证（增强）

### 6.1 单元测试

````typescript
describe("DataSourceRouterService - Social X", () => {
  describe("searchSocialX", () => {
    it("should fetch via Grok Live Search", async () => {
      const results = await service["searchSocialX"]("AI regulation", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
    });

    it("should fallback to web search when Grok fails", async () => {
      // Mock Grok failure
      jest
        .spyOn(service["aiChatService"], "chat")
        .mockRejectedValue(new Error("API Error"));

      const results = await service["searchSocialX"]("AI regulation", 10);
      expect(results[0].metadata?.fetchedVia).toBe("web-search-fallback");
    });

    it("should parse various JSON formats", () => {
      const formats = [
        '```json\n{"trends":[]}\n```',
        '```\n{"trends":[]}\n```',
        '{"trends":[]}',
      ];
      formats.forEach((format) => {
        const results = service["parseSocialSearchResponse"](format, "test");
        expect(Array.isArray(results)).toBe(true);
      });
    });
  });
});
````

### 6.2 质量验证

1. 创建 Topic，包含 "舆论反响" 维度
2. 执行研究，验证：
   - 社媒数据作为补充出现
   - 关键结论有非社媒来源支撑
   - 引用格式正确区分来源类型
3. 对比有/无社媒数据的报告质量

---

## 七、风险和限制

| 风险                       | 影响           | 缓解措施                            |
| -------------------------- | -------------- | ----------------------------------- |
| Grok Live Search beta 结束 | 可能收费       | 降级方案已就绪                      |
| 响应格式不稳定             | 解析失败       | 多模式解析 + 降级提取               |
| 社媒数据噪音大             | 影响报告质量   | 可信度评分 + 交叉验证 + Prompt 指导 |
| 社媒引用过多               | 降低报告权威性 | 引用比例控制（≤30%）                |

---

## 八、总结

v2.1 相比 v2.0 的改进：

| 改进项      | 说明                                  |
| ----------- | ------------------------------------- |
| 类型安全    | 定义完整类型接口，禁止 `any`          |
| 降级方案    | Grok 失败时自动切换 Web Search        |
| JSON 容错   | 支持多种格式，失败时 URL 提取         |
| 重试机制    | 默认 2 次重试                         |
| 质量提升    | 交叉验证 + Prompt 指导 + 引用比例控制 |
| Skills 更新 | 新增数据源扩展参考文档                |

**核心设计原则**：社媒数据是**补充信号**，不是**权威来源**，通过分层处理确保不降低现有洞察质量。
