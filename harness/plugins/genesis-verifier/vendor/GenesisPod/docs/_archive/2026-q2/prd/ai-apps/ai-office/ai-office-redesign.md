# AI Office 5.0 重新设计方案

> 基于业界最佳实践（Gamma、Napkin AI等）的全新架构设计
>
> 版本: 5.0 | 日期: 2024-12-04 | 状态: 设计阶段

---

## 一、竞品分析与最佳实践

### 1.1 Gamma AI 核心理念

| 特性                | 描述                               | 对我们的启示         |
| ------------------- | ---------------------------------- | -------------------- |
| **Anti-PowerPoint** | 不是传统幻灯片，是可滚动的动态文档 | 考虑卡片式布局       |
| **模块化Card布局**  | 每个Card是独立内容块，垂直堆叠     | 减少固定模板依赖     |
| **大纲优先**        | 先生成大纲，再转化为幻灯片         | 保持此流程但精简     |
| **集成第三方**      | 直接搜索Unsplash、嵌入YouTube等    | 减少AI图片生成       |
| **Research Mode**   | 从网页拉取实时数据                 | 已有类似功能，可优化 |

**参考**: [Gamma AI](https://gamma.design/), [Kroma Review](https://kroma.ai/what-is-gamma-ai/)

### 1.2 Napkin AI 核心理念

| 特性                 | 描述                          | 对我们的启示              |
| -------------------- | ----------------------------- | ------------------------- |
| **Generation-First** | 生成优先，非编辑器附加AI      | 简化编辑复杂度            |
| **文本→可视化**      | 专注将文本转为图表/信息图     | 减少通用图片生成          |
| **非扩散模型**       | 不用DALL-E等，用矢量/规则生成 | **关键：用SVG替代AI图片** |
| **即时推荐**         | 点击即生成多个可选视觉方案    | 减少用户等待              |
| **可编辑输出**       | 生成后可精细调整              | 保持编辑能力              |

**参考**: [Napkin AI](https://www.napkin.ai/), [TechCrunch报道](https://techcrunch.com/2024/08/07/napkin-turns-text-into-visuals-with-a-bit-of-generative-ai/)

### 1.3 Token优化最佳实践

| 策略           | 效果                    | 来源                                                                                                                                             |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **精简提示词** | 节省40-50% tokens       | [Token优化指南](https://guptadeepak.com/complete-guide-to-ai-tokens-understanding-optimization-and-cost-management/)                             |
| **上下文裁剪** | RAG场景97%是上下文token | [RAG优化](https://www.soeasie.com/blog/best-practices-for-optimizing-token-consumption-for-ai-chatbots-using-retrieval-augmented-generation-rag) |
| **批量处理**   | 合并多次调用为一次      | 业界共识                                                                                                                                         |
| **分层记忆**   | 长对话保留关键信息      | Agent最佳实践                                                                                                                                    |

---

## 二、当前问题诊断

### 2.1 经典模式问题

```
问题1: 过度依赖AI图片生成
- 每张幻灯片1-2张AI图片
- DALL-E/Midjourney成本高
- 生成时间长（5-10秒/张）

问题2: Token消耗过大
- 大纲生成: 4000 tokens
- 每张内容: 2000 tokens
- 演讲备注: 800 tokens/张
- 总计: 35,000-63,000 tokens/PPT

问题3: 版本存储浪费
- 每次保存完整拷贝
- 无增量存储
```

### 2.2 PPT 3.0 问题

```
问题1: 管道过于复杂
- 6个生成阶段
- 多次AI调用
- 串行处理慢

问题2: 图片策略僵化
- 强制每张幻灯片考虑图片
- 背景图+内容图双重成本
- 分辨率固定1920x1080

问题3: 缺乏快速模式
- 无法跳过图片生成
- 无法选择"文字优先"
```

---

## 三、新架构设计：AI Office 5.0

### 3.1 核心设计理念

```
┌─────────────────────────────────────────────────────────────┐
│                    设计原则                                   │
├─────────────────────────────────────────────────────────────┤
│ 1. 生成优先 (Generation-First)                               │
│    - 一次AI调用生成完整内容结构                                │
│    - 减少往返交互                                             │
│                                                              │
│ 2. 矢量优先 (Vector-First)                                   │
│    - 图表/图标用SVG规则生成                                    │
│    - AI图片仅用于封面/特殊场景                                 │
│                                                              │
│ 3. 渐进增强 (Progressive Enhancement)                        │
│    - 先出文字版，图片后台异步加载                               │
│    - 用户可选择质量等级                                        │
│                                                              │
│ 4. 模板驱动 (Template-Driven)                                │
│    - 预设高质量模板减少AI布局决策                               │
│    - 智能匹配而非AI生成布局                                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 新生成流程

```
┌─────────────────────────────────────────────────────────────┐
│                   AI Office 5.0 生成流程                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  用户输入 ──────────────────────────────────────────────────  │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 1: 一次性结构化生成 (Single AI Call)           │    │
│  │                                                     │    │
│  │  输入: 用户提示 + 可选URL/文件内容(截断至3000字)      │    │
│  │  输出: 完整JSON结构                                  │    │
│  │        - 标题/副标题                                 │    │
│  │        - 所有幻灯片内容                              │    │
│  │        - 建议的图表类型标记                          │    │
│  │        - 关键词标签(用于图片搜索)                    │    │
│  │                                                     │    │
│  │  Token预算: 6000-8000 (含输入输出)                  │    │
│  └─────────────────────────────────────────────────────┘    │
│      │                                                       │
│      ▼ (立即返回，用户可见)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 2: 客户端模板匹配 (No AI)                      │    │
│  │                                                     │    │
│  │  - 根据内容长度选择布局模板                          │    │
│  │  - 根据图表标记渲染SVG图表                           │    │
│  │  - 应用主题颜色/字体                                 │    │
│  │                                                     │    │
│  │  耗时: < 500ms                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│      │                                                       │
│      ▼ (后台异步，用户可继续编辑)                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 3: 可选图片增强 (Async, Optional)              │    │
│  │                                                     │    │
│  │  选项A: Unsplash/Pexels图片搜索 (免费)              │    │
│  │  选项B: AI图片生成 (仅封面/关键页，用户确认)         │    │
│  │  选项C: 用户上传自定义图片                           │    │
│  │                                                     │    │
│  │  默认: 不生成AI图片，使用图标/渐变背景               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 成本对比

| 项目       | 当前(PPT 3.0) | 新方案(5.0)  | 节省    |
| ---------- | ------------- | ------------ | ------- |
| AI调用次数 | 12-25次       | 1-3次        | **90%** |
| Token消耗  | 35,000-63,000 | 6,000-10,000 | **80%** |
| 图片生成   | 13-15张       | 0-3张        | **80%** |
| 生成时间   | 2.5-3.3分钟   | 15-30秒      | **85%** |
| 单PPT成本  | $2.46         | $0.30-0.50   | **80%** |

---

## 四、技术实现方案

### 4.1 新的Prompt设计

```typescript
// 单次生成的Prompt模板
const UNIFIED_GENERATION_PROMPT = `
You are a presentation expert. Generate a complete presentation structure in JSON format.

INPUT:
- Topic: {userPrompt}
- Source Content (if any): {truncatedContent}
- Slide Count: {slideCount} (default: 8-12)
- Style: {style} (professional/creative/minimal)

OUTPUT FORMAT (JSON):
{
  "title": "Presentation Title",
  "subtitle": "Optional Subtitle",
  "slides": [
    {
      "type": "title|content|comparison|timeline|quote|closing",
      "heading": "Slide Heading",
      "points": ["Point 1", "Point 2", "Point 3"],
      "visualHint": "chart:bar|icon:lightbulb|none",
      "imageKeywords": ["keyword1", "keyword2"],  // For Unsplash search
      "speakerNote": "Brief note for presenter"
    }
  ],
  "suggestedTheme": "blue|green|purple|orange|dark"
}

RULES:
1. Each slide should have 2-4 points maximum
2. Use visualHint for data (chart:pie, chart:bar, chart:line) or concepts (icon:xxx)
3. imageKeywords only for slides that truly need photos
4. Keep speakerNote under 50 words
5. Total output under 2000 tokens

Generate the presentation:
`;
```

### 4.2 SVG图表生成器（替代AI图片）

```typescript
// 基于规则的SVG生成，无需AI
class ChartGenerator {
  // 支持的图表类型
  static CHART_TYPES = ["bar", "pie", "line", "donut", "progress"];

  // 根据visualHint生成SVG
  generateChart(type: string, data: ChartData, theme: Theme): string {
    switch (type) {
      case "bar":
        return this.generateBarChart(data, theme);
      case "pie":
        return this.generatePieChart(data, theme);
      case "line":
        return this.generateLineChart(data, theme);
      case "progress":
        return this.generateProgressBar(data, theme);
      default:
        return this.generatePlaceholder(theme);
    }
  }

  // 示例：柱状图生成
  private generateBarChart(data: ChartData, theme: Theme): string {
    const { labels, values, colors } = data;
    const maxValue = Math.max(...values);
    const barWidth = 60;
    const gap = 20;

    let svg = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">`;

    values.forEach((value, i) => {
      const height = (value / maxValue) * 200;
      const x = 50 + i * (barWidth + gap);
      const y = 250 - height;
      const color = colors?.[i] || theme.primary;

      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}"
                    fill="${color}" rx="4"/>`;
      svg += `<text x="${x + barWidth / 2}" y="270" text-anchor="middle"
                    font-size="12" fill="${theme.text}">${labels[i]}</text>`;
    });

    svg += `</svg>`;
    return svg;
  }
}
```

### 4.3 图片策略：Unsplash优先

```typescript
// 图片来源优先级
class ImageService {
  async getImage(
    keywords: string[],
    options: ImageOptions,
  ): Promise<ImageResult> {
    // 优先级1: Unsplash免费图片
    const unsplashResult = await this.searchUnsplash(keywords);
    if (unsplashResult) {
      return { url: unsplashResult.url, source: "unsplash", cost: 0 };
    }

    // 优先级2: Pexels免费图片
    const pexelsResult = await this.searchPexels(keywords);
    if (pexelsResult) {
      return { url: pexelsResult.url, source: "pexels", cost: 0 };
    }

    // 优先级3: 用户明确要求时才用AI生成
    if (options.allowAIGeneration && options.userConfirmed) {
      const aiResult = await this.generateWithAI(keywords.join(" "));
      return { url: aiResult.url, source: "ai", cost: 0.04 };
    }

    // 兜底: 使用渐变背景
    return {
      url: this.generateGradientBackground(options.theme),
      source: "gradient",
      cost: 0,
    };
  }

  // Unsplash API (免费，每小时50次)
  private async searchUnsplash(
    keywords: string[],
  ): Promise<UnsplashResult | null> {
    const query = keywords.slice(0, 3).join(" ");
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } },
    );
    const data = await response.json();
    return data.results?.[0] || null;
  }
}
```

### 4.4 版本存储优化：Delta差分

```typescript
// 使用JSON Patch存储差异
import * as jsonpatch from "fast-json-patch";

class VersionService {
  // 保存新版本时只存储差异
  async saveVersion(documentId: string, newContent: any): Promise<void> {
    const previousVersion = await this.getLatestVersion(documentId);

    if (previousVersion) {
      // 计算差异
      const patch = jsonpatch.compare(previousVersion.content, newContent);

      // 只存储patch，而非完整内容
      await this.prisma.officeDocumentVersion.create({
        data: {
          documentId,
          versionNumber: previousVersion.versionNumber + 1,
          contentPatch: patch, // 新字段：只存差异
          patchSize: JSON.stringify(patch).length,
        },
      });
    } else {
      // 第一个版本存完整内容
      await this.prisma.officeDocumentVersion.create({
        data: {
          documentId,
          versionNumber: 1,
          contentSnapshot: newContent,
          isBaseVersion: true,
        },
      });
    }
  }

  // 恢复历史版本时重建内容
  async getVersion(documentId: string, versionNumber: number): Promise<any> {
    // 获取基础版本
    const baseVersion = await this.prisma.officeDocumentVersion.findFirst({
      where: { documentId, isBaseVersion: true },
    });

    // 获取所有patch直到目标版本
    const patches = await this.prisma.officeDocumentVersion.findMany({
      where: {
        documentId,
        versionNumber: { gt: 1, lte: versionNumber },
        isBaseVersion: false,
      },
      orderBy: { versionNumber: "asc" },
    });

    // 依次应用patch重建内容
    let content = baseVersion.contentSnapshot;
    for (const patch of patches) {
      content = jsonpatch.applyPatch(content, patch.contentPatch).newDocument;
    }

    return content;
  }
}
```

---

## 五、用户体验设计

### 5.1 生成模式选择

```
┌─────────────────────────────────────────────────────────────┐
│                    创建新演示文稿                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  选择生成模式:                                                │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  ⚡ 快速模式     │  │  🎨 标准模式     │  │  ✨ 高级模式  │ │
│  │                 │  │                 │  │              │ │
│  │  • 纯文字+图表   │  │  • 文字+图表     │  │  • 全部功能   │ │
│  │  • 15秒完成     │  │  • 免费图片      │  │  • AI图片    │ │
│  │  • 免费         │  │  • 30秒完成     │  │  • 1-2分钟   │ │
│  │                 │  │  • 免费         │  │  • 消耗积分   │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
│        [推荐]                                                │
│                                                              │
│  ────────────────────────────────────────────────────────   │
│                                                              │
│  描述你想要创建的内容:                                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 例如: 关于2024年AI发展趋势的商业报告，包含市场规模、  │    │
│  │ 主要玩家分析和未来预测...                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│                              [开始生成]                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 渐进式加载体验

```
第1秒: 显示大纲结构
      ✓ 标题: AI发展趋势报告
      ✓ 8张幻灯片已规划

第3秒: 第一张幻灯片渲染完成
      [封面] AI发展趋势报告 2024

第5秒: 所有文字内容加载完成
      用户可以开始编辑

第10秒: 图表SVG渲染完成
       柱状图、饼图等就位

第15秒: (后台) Unsplash图片加载
       用户可选择是否使用

第30秒: (可选) AI图片生成完成
       仅用户确认的关键页面
```

---

## 六、数据库Schema更新

```prisma
model OfficeDocument {
  // ... 现有字段 ...

  // 新增: 生成模式
  generationMode  String @default("standard") // quick|standard|premium

  // 新增: 图片策略
  imageStrategy   String @default("stock")    // none|stock|ai|mixed

  // 新增: Token使用统计
  tokenUsage      Int    @default(0)
  estimatedCost   Float  @default(0)
}

model OfficeDocumentVersion {
  // ... 现有字段 ...

  // 新增: 差分存储
  contentPatch    Json?   // JSON Patch格式
  patchSize       Int?    // Patch大小(字节)
  isBaseVersion   Boolean @default(false)

  // 移除或设为可选: 完整快照
  contentSnapshot Json?   // 仅baseVersion使用
}

// 新增: 图片来源追踪
model DocumentImage {
  id            String   @id @default(cuid())
  documentId    String
  slideIndex    Int
  source        String   // unsplash|pexels|ai|upload|gradient
  sourceUrl     String?  // 原始来源URL
  localUrl      String   // 存储URL
  cost          Float    @default(0)
  keywords      String[] // 搜索关键词
  createdAt     DateTime @default(now())

  document      OfficeDocument @relation(fields: [documentId], references: [id])

  @@index([documentId])
}
```

---

## 七、实施路线图

### Phase 1: 核心优化 (Week 1-2)

| 任务                       | 优先级 | 预计工时 |
| -------------------------- | ------ | -------- |
| 实现单次AI调用生成完整结构 | P0     | 3天      |
| SVG图表生成器              | P0     | 2天      |
| 版本Delta存储              | P0     | 2天      |
| Unsplash/Pexels集成        | P1     | 1天      |

### Phase 2: 用户体验 (Week 3)

| 任务           | 优先级 | 预计工时 |
| -------------- | ------ | -------- |
| 三种生成模式UI | P0     | 2天      |
| 渐进式加载体验 | P0     | 2天      |
| Token/成本显示 | P1     | 1天      |

### Phase 3: 高级功能 (Week 4)

| 任务              | 优先级 | 预计工时 |
| ----------------- | ------ | -------- |
| AI图片可选生成    | P1     | 2天      |
| 图片来源追踪      | P2     | 1天      |
| 性能监控Dashboard | P2     | 2天      |

---

## 八、成功指标

| 指标          | 当前基线 | 目标      | 衡量方式 |
| ------------- | -------- | --------- | -------- |
| 平均生成时间  | 180秒    | < 30秒    | 监控日志 |
| 平均Token消耗 | 45,000   | < 8,000   | API统计  |
| 单PPT成本     | $2.46    | < $0.50   | 成本核算 |
| AI图片调用    | 14次/PPT | < 2次/PPT | 调用统计 |
| 用户满意度    | -        | > 4.0/5   | 用户反馈 |

---

## 九、参考资料

- [Gamma AI](https://gamma.design/) - 卡片式演示文稿
- [Napkin AI](https://www.napkin.ai/) - 文本到可视化
- [Token优化最佳实践](https://guptadeepak.com/complete-guide-to-ai-tokens-understanding-optimization-and-cost-management/)
- [AI Presentation Makers比较](https://plusai.com/blog/best-ai-presentation-makers)

---

## 十、附录

### A. 竞品功能对比矩阵

| 功能             | Gamma | Napkin | 当前Genesis | Genesis 5.0 |
| ---------------- | ----- | ------ | ----------- | ----------- |
| 单次生成完整内容 | ✓     | ✓      | ✗           | ✓           |
| SVG图表生成      | ✗     | ✓      | ✗           | ✓           |
| 免费图片集成     | ✓     | ✗      | ✗           | ✓           |
| AI图片可选       | ✓     | ✗      | 强制        | 可选        |
| 渐进式加载       | ✓     | ✓      | ✗           | ✓           |
| 版本差分存储     | ?     | ?      | ✗           | ✓           |
| 成本透明         | ✗     | ✗      | ✗           | ✓           |

### B. Token消耗详细对比

```
当前方案 (PPT 3.0):
├─ 大纲生成: 4,000 tokens
├─ 内容生成: 2,000 × 10张 = 20,000 tokens
├─ 演讲备注: 800 × 10张 = 8,000 tokens
├─ 图片提示: 200 × 15张 = 3,000 tokens
└─ 总计: ~35,000 tokens

新方案 (5.0):
├─ 一次性生成: 6,000 tokens (含全部内容+备注)
├─ 图片搜索: 0 tokens (Unsplash API)
└─ 总计: ~6,000 tokens

节省: 83%
```
