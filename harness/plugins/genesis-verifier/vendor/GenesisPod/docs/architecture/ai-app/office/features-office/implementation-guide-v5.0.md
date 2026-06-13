# AI Office 5.0 实现指南

> 详细的技术实现步骤和代码示例
>
> 版本: 5.0 | 日期: 2024-12-04

---

## 一、架构变更概览

### 1.1 文件变更清单

| 文件                                                            | 变更类型 | 说明           |
| --------------------------------------------------------------- | -------- | -------------- |
| `backend/src/modules/ai-office/unified-generation.service.ts`   | 新增     | 统一生成服务   |
| `backend/src/modules/ai-office/chart-generator.service.ts`      | 新增     | SVG图表生成    |
| `backend/src/modules/ai-office/stock-image.service.ts`          | 新增     | 免费图片搜索   |
| `backend/src/modules/ai-office/version-delta.service.ts`        | 新增     | 差分版本存储   |
| `backend/src/modules/ai-office/ppt/ppt-orchestrator.service.ts` | 重构     | 简化流程       |
| `backend/src/modules/ai-office/ppt/slide-content.service.ts`    | 删除     | 合并到统一生成 |
| `backend/src/modules/ai-office/ppt/slide-image.service.ts`      | 重构     | 改为可选服务   |
| `frontend/components/ai-office/GenerationModeSelector.tsx`      | 新增     | 模式选择UI     |
| `frontend/components/ai-office/ProgressiveLoader.tsx`           | 新增     | 渐进加载组件   |

### 1.2 数据库迁移

```sql
-- Migration: 20241204_ai_office_v5

-- 1. 添加新字段到 OfficeDocument
ALTER TABLE office_documents ADD COLUMN generation_mode VARCHAR(20) DEFAULT 'standard';
ALTER TABLE office_documents ADD COLUMN image_strategy VARCHAR(20) DEFAULT 'stock';
ALTER TABLE office_documents ADD COLUMN token_usage INTEGER DEFAULT 0;
ALTER TABLE office_documents ADD COLUMN estimated_cost DECIMAL(10,4) DEFAULT 0;

-- 2. 添加差分存储字段到 OfficeDocumentVersion
ALTER TABLE office_document_versions ADD COLUMN content_patch JSONB;
ALTER TABLE office_document_versions ADD COLUMN patch_size INTEGER;
ALTER TABLE office_document_versions ADD COLUMN is_base_version BOOLEAN DEFAULT false;

-- 3. 创建图片来源追踪表
CREATE TABLE document_images (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES office_documents(id) ON DELETE CASCADE,
  slide_index INTEGER NOT NULL,
  source VARCHAR(20) NOT NULL, -- unsplash|pexels|ai|upload|gradient
  source_url TEXT,
  local_url TEXT NOT NULL,
  cost DECIMAL(10,4) DEFAULT 0,
  keywords TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_document_images_doc ON document_images(document_id);

-- 4. 更新现有版本为基础版本
UPDATE office_document_versions
SET is_base_version = true
WHERE version_number = 1;
```

---

## 二、核心服务实现

### 2.1 统一生成服务 (UnifiedGenerationService)

```typescript
// backend/src/modules/ai-office/unified-generation.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { AIModelService } from "./ai-model.service";

export interface GenerationRequest {
  prompt: string;
  sourceContent?: string;
  slideCount?: number;
  style?: "professional" | "creative" | "minimal";
  mode: "quick" | "standard" | "premium";
}

export interface GeneratedPresentation {
  title: string;
  subtitle?: string;
  slides: GeneratedSlide[];
  suggestedTheme: string;
  tokenUsage: number;
}

export interface GeneratedSlide {
  type: "title" | "content" | "comparison" | "timeline" | "quote" | "closing";
  heading: string;
  points: string[];
  visualHint?: string; // chart:bar, icon:lightbulb, none
  imageKeywords?: string[];
  speakerNote?: string;
}

@Injectable()
export class UnifiedGenerationService {
  private readonly logger = new Logger(UnifiedGenerationService.name);

  constructor(private readonly aiModel: AIModelService) {}

  /**
   * 一次性生成完整演示文稿结构
   * 核心优化：单次AI调用，而非多次
   */
  async generatePresentation(
    request: GenerationRequest,
  ): Promise<GeneratedPresentation> {
    const startTime = Date.now();

    // 构建精简的提示词
    const prompt = this.buildPrompt(request);

    // 获取模型（根据模式选择）
    const model = await this.selectModel(request.mode);

    // 单次AI调用
    const response = await this.aiModel.generateText({
      model,
      prompt,
      maxTokens: this.getMaxTokens(request.mode),
      temperature: 0.7,
      responseFormat: "json",
    });

    // 解析结果
    const presentation = this.parseResponse(response.content);

    // 记录统计
    const tokenUsage = response.usage?.totalTokens || 0;
    this.logger.log(
      `Generated presentation in ${Date.now() - startTime}ms, ` +
        `tokens: ${tokenUsage}, slides: ${presentation.slides.length}`,
    );

    return {
      ...presentation,
      tokenUsage,
    };
  }

  private buildPrompt(request: GenerationRequest): string {
    const slideCount = request.slideCount || 10;
    const style = request.style || "professional";

    // 截断源内容，防止token爆炸
    const truncatedContent = request.sourceContent
      ? request.sourceContent.substring(0, 3000)
      : "";

    return `Generate a ${style} presentation with ${slideCount} slides.

Topic: ${request.prompt}
${truncatedContent ? `\nReference content:\n${truncatedContent}` : ""}

Output JSON format:
{
  "title": "string",
  "subtitle": "string or null",
  "slides": [
    {
      "type": "title|content|comparison|timeline|quote|closing",
      "heading": "string",
      "points": ["string", "string"],
      "visualHint": "chart:bar|chart:pie|chart:line|icon:xxx|none",
      "imageKeywords": ["keyword1", "keyword2"],
      "speakerNote": "brief note under 50 words"
    }
  ],
  "suggestedTheme": "blue|green|purple|orange|dark"
}

Rules:
- 2-4 points per slide maximum
- visualHint for data visualization or icons
- imageKeywords only when photo truly needed
- Keep total output under 2000 tokens`;
  }

  private async selectModel(mode: string): Promise<string> {
    // quick模式用更便宜/快速的模型
    if (mode === "quick") {
      return await this.aiModel.getModelId("fast"); // e.g., gpt-3.5-turbo
    }
    // premium模式用最好的模型
    if (mode === "premium") {
      return await this.aiModel.getModelId("best"); // e.g., gpt-4
    }
    // standard模式用默认模型
    return await this.aiModel.getDefaultTextModelId();
  }

  private getMaxTokens(mode: string): number {
    switch (mode) {
      case "quick":
        return 1500;
      case "standard":
        return 2500;
      case "premium":
        return 4000;
      default:
        return 2500;
    }
  }

  private parseResponse(
    content: string,
  ): Omit<GeneratedPresentation, "tokenUsage"> {
    try {
      // 尝试解析JSON
      const parsed = JSON.parse(content);
      return {
        title: parsed.title || "Untitled Presentation",
        subtitle: parsed.subtitle,
        slides: parsed.slides || [],
        suggestedTheme: parsed.suggestedTheme || "blue",
      };
    } catch (e) {
      this.logger.error("Failed to parse AI response", e);
      // 返回最小可用结构
      return {
        title: "Presentation",
        slides: [
          {
            type: "title",
            heading: "Presentation",
            points: ["Content generation failed. Please try again."],
          },
        ],
        suggestedTheme: "blue",
      };
    }
  }
}
```

### 2.2 SVG图表生成服务 (ChartGeneratorService)

```typescript
// backend/src/modules/ai-office/chart-generator.service.ts

import { Injectable } from "@nestjs/common";

export interface ChartData {
  labels: string[];
  values: number[];
  colors?: string[];
}

export interface ChartTheme {
  primary: string;
  secondary: string;
  text: string;
  background: string;
}

@Injectable()
export class ChartGeneratorService {
  private readonly defaultTheme: ChartTheme = {
    primary: "#3B82F6",
    secondary: "#10B981",
    text: "#374151",
    background: "#F9FAFB",
  };

  /**
   * 根据visualHint生成SVG图表
   * 无需AI调用，纯规则引擎
   */
  generateChart(
    hint: string,
    data?: ChartData,
    theme?: Partial<ChartTheme>,
  ): string {
    const mergedTheme = { ...this.defaultTheme, ...theme };

    // 解析hint类型
    const [category, type] = hint.split(":");

    if (category === "chart" && data) {
      switch (type) {
        case "bar":
          return this.generateBarChart(data, mergedTheme);
        case "pie":
          return this.generatePieChart(data, mergedTheme);
        case "line":
          return this.generateLineChart(data, mergedTheme);
        case "donut":
          return this.generateDonutChart(data, mergedTheme);
        case "progress":
          return this.generateProgressBar(data, mergedTheme);
        default:
          return this.generatePlaceholder(mergedTheme);
      }
    }

    if (category === "icon") {
      return this.generateIcon(type, mergedTheme);
    }

    return "";
  }

  private generateBarChart(data: ChartData, theme: ChartTheme): string {
    const { labels, values, colors } = data;
    const maxValue = Math.max(...values);
    const barWidth = 50;
    const gap = 15;
    const height = 200;
    const width = (barWidth + gap) * values.length + 60;

    let svg = `<svg viewBox="0 0 ${width} 280" xmlns="http://www.w3.org/2000/svg">`;

    // 背景
    svg += `<rect width="100%" height="100%" fill="${theme.background}" rx="8"/>`;

    // 柱状图
    values.forEach((value, i) => {
      const barHeight = (value / maxValue) * height;
      const x = 40 + i * (barWidth + gap);
      const y = 230 - barHeight;
      const color = colors?.[i] || this.getColorByIndex(i, theme);

      // 柱子
      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"
                    fill="${color}" rx="4">
                <animate attributeName="height" from="0" to="${barHeight}" dur="0.5s"/>
                <animate attributeName="y" from="230" to="${y}" dur="0.5s"/>
              </rect>`;

      // 数值标签
      svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle"
                    font-size="11" fill="${theme.text}" font-weight="500">${value}</text>`;

      // X轴标签
      svg += `<text x="${x + barWidth / 2}" y="255" text-anchor="middle"
                    font-size="10" fill="${theme.text}">${labels[i]}</text>`;
    });

    svg += `</svg>`;
    return svg;
  }

  private generatePieChart(data: ChartData, theme: ChartTheme): string {
    const { labels, values, colors } = data;
    const total = values.reduce((a, b) => a + b, 0);
    const cx = 150,
      cy = 120,
      r = 80;

    let svg = `<svg viewBox="0 0 300 280" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="${theme.background}" rx="8"/>`;

    let startAngle = -90;

    values.forEach((value, i) => {
      const percentage = value / total;
      const angle = percentage * 360;
      const endAngle = startAngle + angle;

      const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
      const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
      const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
      const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);

      const largeArc = angle > 180 ? 1 : 0;
      const color = colors?.[i] || this.getColorByIndex(i, theme);

      svg += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z"
                    fill="${color}" stroke="white" stroke-width="2"/>`;

      startAngle = endAngle;
    });

    // 图例
    labels.forEach((label, i) => {
      const color = colors?.[i] || this.getColorByIndex(i, theme);
      const y = 220 + (i % 2) * 20;
      const x = i < 2 ? 20 : 160;

      svg += `<rect x="${x}" y="${y}" width="12" height="12" fill="${color}" rx="2"/>`;
      svg += `<text x="${x + 18}" y="${y + 10}" font-size="10" fill="${theme.text}">${label}</text>`;
    });

    svg += `</svg>`;
    return svg;
  }

  private generateLineChart(data: ChartData, theme: ChartTheme): string {
    const { labels, values } = data;
    const maxValue = Math.max(...values);
    const width = 320;
    const height = 200;
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding;

    let svg = `<svg viewBox="0 0 ${width} 260" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="${theme.background}" rx="8"/>`;

    // 网格线
    for (let i = 0; i <= 4; i++) {
      const y = padding + (graphHeight / 4) * i;
      svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"
                    stroke="#E5E7EB" stroke-dasharray="4"/>`;
    }

    // 折线路径
    const points = values
      .map((value, i) => {
        const x = padding + (graphWidth / (values.length - 1)) * i;
        const y = padding + graphHeight - (value / maxValue) * graphHeight;
        return `${x},${y}`;
      })
      .join(" ");

    svg += `<polyline points="${points}" fill="none"
                      stroke="${theme.primary}" stroke-width="3" stroke-linecap="round"/>`;

    // 数据点
    values.forEach((value, i) => {
      const x = padding + (graphWidth / (values.length - 1)) * i;
      const y = padding + graphHeight - (value / maxValue) * graphHeight;

      svg += `<circle cx="${x}" cy="${y}" r="5" fill="${theme.primary}" stroke="white" stroke-width="2"/>`;
      svg += `<text x="${x}" y="235" text-anchor="middle" font-size="10" fill="${theme.text}">${labels[i]}</text>`;
    });

    svg += `</svg>`;
    return svg;
  }

  private generateDonutChart(data: ChartData, theme: ChartTheme): string {
    // 类似饼图但中间有空洞
    const { labels, values, colors } = data;
    const total = values.reduce((a, b) => a + b, 0);
    const cx = 150,
      cy = 120,
      outerR = 80,
      innerR = 50;

    let svg = `<svg viewBox="0 0 300 280" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="${theme.background}" rx="8"/>`;

    let startAngle = -90;

    values.forEach((value, i) => {
      const percentage = value / total;
      const angle = percentage * 360;
      const endAngle = startAngle + angle;
      const color = colors?.[i] || this.getColorByIndex(i, theme);

      const path = this.describeArc(
        cx,
        cy,
        outerR,
        innerR,
        startAngle,
        endAngle,
      );
      svg += `<path d="${path}" fill="${color}" stroke="white" stroke-width="1"/>`;

      startAngle = endAngle;
    });

    // 中心文字
    svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="24" font-weight="bold" fill="${theme.text}">${total}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="11" fill="${theme.text}">Total</text>`;

    svg += `</svg>`;
    return svg;
  }

  private generateProgressBar(data: ChartData, theme: ChartTheme): string {
    const { labels, values } = data;
    const maxValue = Math.max(...values, 100);

    let svg = `<svg viewBox="0 0 320 ${40 + values.length * 45}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="${theme.background}" rx="8"/>`;

    values.forEach((value, i) => {
      const y = 30 + i * 45;
      const percentage = (value / maxValue) * 100;
      const color = this.getColorByIndex(i, theme);

      // 标签
      svg += `<text x="15" y="${y}" font-size="12" fill="${theme.text}">${labels[i]}</text>`;

      // 背景条
      svg += `<rect x="15" y="${y + 8}" width="250" height="16" fill="#E5E7EB" rx="8"/>`;

      // 进度条
      svg += `<rect x="15" y="${y + 8}" width="${percentage * 2.5}" height="16" fill="${color}" rx="8">
                <animate attributeName="width" from="0" to="${percentage * 2.5}" dur="0.6s"/>
              </rect>`;

      // 数值
      svg += `<text x="275" y="${y + 20}" font-size="11" fill="${theme.text}">${value}%</text>`;
    });

    svg += `</svg>`;
    return svg;
  }

  private generateIcon(iconName: string, theme: ChartTheme): string {
    // 预定义的常用图标
    const icons: Record<string, string> = {
      lightbulb: `<path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h6a1 1 0 001-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm2 14H10v-1h4v1zm0-2H10v-1h4v1zm-1-3.18V13H11v-2.18A4.996 4.996 0 017 6c0-2.76 2.24-5 5-5s5 2.24 5 5c0 2.05-1.23 3.81-3 4.58z" fill="${theme.primary}"/>`,
      rocket: `<path d="M12.5 2c-1.6 0-3 1.4-3 3.2V6l-2.1 2.1c-.3.3-.4.6-.4 1V12c0 .8.7 1.5 1.5 1.5h1v3c0 .8.7 1.5 1.5 1.5h2c.8 0 1.5-.7 1.5-1.5v-3h1c.8 0 1.5-.7 1.5-1.5V9.1c0-.4-.1-.7-.4-1L13.5 6v-.8c0-1.8-1.4-3.2-3-3.2z" fill="${theme.primary}"/>`,
      chart: `<path d="M3 3v18h18v-2H5V3H3zm15 4h-2v10h2V7zm-4 4h-2v6h2v-6zm-4 2H8v4h2v-4z" fill="${theme.primary}"/>`,
      target: `<circle cx="12" cy="12" r="10" stroke="${theme.primary}" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="6" stroke="${theme.primary}" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2" fill="${theme.primary}"/>`,
      users: `<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="${theme.primary}"/>`,
    };

    const iconPath = icons[iconName] || icons.lightbulb;

    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
      ${iconPath}
    </svg>`;
  }

  private generatePlaceholder(theme: ChartTheme): string {
    return `<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${theme.background}" rx="8"/>
      <rect x="20" y="20" width="160" height="110" fill="#E5E7EB" rx="4"/>
      <text x="100" y="80" text-anchor="middle" font-size="14" fill="${theme.text}">Visual</text>
    </svg>`;
  }

  private getColorByIndex(index: number, theme: ChartTheme): string {
    const colors = [
      theme.primary,
      theme.secondary,
      "#8B5CF6", // purple
      "#F59E0B", // amber
      "#EF4444", // red
      "#06B6D4", // cyan
    ];
    return colors[index % colors.length];
  }

  private describeArc(
    cx: number,
    cy: number,
    outerR: number,
    innerR: number,
    startAngle: number,
    endAngle: number,
  ): string {
    const start1 = this.polarToCartesian(cx, cy, outerR, endAngle);
    const end1 = this.polarToCartesian(cx, cy, outerR, startAngle);
    const start2 = this.polarToCartesian(cx, cy, innerR, endAngle);
    const end2 = this.polarToCartesian(cx, cy, innerR, startAngle);

    const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

    return [
      "M",
      start1.x,
      start1.y,
      "A",
      outerR,
      outerR,
      0,
      largeArc,
      0,
      end1.x,
      end1.y,
      "L",
      end2.x,
      end2.y,
      "A",
      innerR,
      innerR,
      0,
      largeArc,
      1,
      start2.x,
      start2.y,
      "Z",
    ].join(" ");
  }

  private polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    const rad = (angle * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }
}
```

### 2.3 免费图片搜索服务 (StockImageService)

```typescript
// backend/src/modules/ai-office/stock-image.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface ImageSearchResult {
  url: string;
  thumbnailUrl: string;
  source: "unsplash" | "pexels";
  photographer?: string;
  downloadUrl?: string;
}

@Injectable()
export class StockImageService {
  private readonly logger = new Logger(StockImageService.name);

  constructor(private config: ConfigService) {}

  /**
   * 搜索免费图片
   * 优先Unsplash，fallback到Pexels
   */
  async searchImages(
    keywords: string[],
    count: number = 3,
  ): Promise<ImageSearchResult[]> {
    const query = keywords.slice(0, 3).join(" ");

    // 尝试Unsplash
    const unsplashResults = await this.searchUnsplash(query, count);
    if (unsplashResults.length > 0) {
      return unsplashResults;
    }

    // Fallback到Pexels
    const pexelsResults = await this.searchPexels(query, count);
    return pexelsResults;
  }

  private async searchUnsplash(
    query: string,
    count: number,
  ): Promise<ImageSearchResult[]> {
    const accessKey = this.config.get("UNSPLASH_ACCESS_KEY");
    if (!accessKey) {
      this.logger.warn("Unsplash API key not configured");
      return [];
    }

    try {
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
        {
          headers: {
            Authorization: `Client-ID ${accessKey}`,
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(`Unsplash API error: ${response.status}`);
        return [];
      }

      const data = await response.json();

      return data.results.map((photo: any) => ({
        url: photo.urls.regular,
        thumbnailUrl: photo.urls.thumb,
        source: "unsplash" as const,
        photographer: photo.user.name,
        downloadUrl: photo.links.download_location,
      }));
    } catch (error) {
      this.logger.error("Unsplash search failed", error);
      return [];
    }
  }

  private async searchPexels(
    query: string,
    count: number,
  ): Promise<ImageSearchResult[]> {
    const apiKey = this.config.get("PEXELS_API_KEY");
    if (!apiKey) {
      this.logger.warn("Pexels API key not configured");
      return [];
    }

    try {
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
        {
          headers: {
            Authorization: apiKey,
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(`Pexels API error: ${response.status}`);
        return [];
      }

      const data = await response.json();

      return data.photos.map((photo: any) => ({
        url: photo.src.large,
        thumbnailUrl: photo.src.tiny,
        source: "pexels" as const,
        photographer: photo.photographer,
      }));
    } catch (error) {
      this.logger.error("Pexels search failed", error);
      return [];
    }
  }

  /**
   * 生成渐变背景（当无图片时使用）
   */
  generateGradientBackground(theme: string): string {
    const gradients: Record<string, string> = {
      blue: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      green: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
      purple: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      orange: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
      dark: "linear-gradient(135deg, #232526 0%, #414345 100%)",
    };

    return gradients[theme] || gradients.blue;
  }
}
```

### 2.4 版本差分存储服务 (VersionDeltaService)

```typescript
// backend/src/modules/ai-office/version-delta.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import * as jsonpatch from "fast-json-patch";

@Injectable()
export class VersionDeltaService {
  private readonly logger = new Logger(VersionDeltaService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 保存新版本（使用差分存储）
   */
  async saveVersion(documentId: string, newContent: any): Promise<number> {
    // 获取最新版本
    const latestVersion = await this.prisma.officeDocumentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
    });

    if (!latestVersion) {
      // 第一个版本，存完整内容
      const version = await this.prisma.officeDocumentVersion.create({
        data: {
          documentId,
          versionNumber: 1,
          contentSnapshot: newContent,
          isBaseVersion: true,
          patchSize: JSON.stringify(newContent).length,
        },
      });
      return version.versionNumber;
    }

    // 获取基础版本内容
    const baseVersion = await this.getBaseVersion(documentId);
    const currentContent = await this.rebuildContent(
      documentId,
      latestVersion.versionNumber,
    );

    // 计算与当前内容的差异
    const patch = jsonpatch.compare(currentContent, newContent);

    // 如果差异太大（超过原内容50%），创建新的基础版本
    const patchSize = JSON.stringify(patch).length;
    const contentSize = JSON.stringify(newContent).length;

    if (patchSize > contentSize * 0.5) {
      this.logger.log(
        `Patch too large (${patchSize} vs ${contentSize}), creating new base version`,
      );

      const version = await this.prisma.officeDocumentVersion.create({
        data: {
          documentId,
          versionNumber: latestVersion.versionNumber + 1,
          contentSnapshot: newContent,
          isBaseVersion: true,
          patchSize: contentSize,
        },
      });
      return version.versionNumber;
    }

    // 存储差分
    const version = await this.prisma.officeDocumentVersion.create({
      data: {
        documentId,
        versionNumber: latestVersion.versionNumber + 1,
        contentPatch: patch,
        isBaseVersion: false,
        patchSize,
      },
    });

    this.logger.log(
      `Saved version ${version.versionNumber} with patch size ${patchSize} ` +
        `(${((1 - patchSize / contentSize) * 100).toFixed(1)}% savings)`,
    );

    return version.versionNumber;
  }

  /**
   * 获取指定版本的内容
   */
  async getVersionContent(
    documentId: string,
    versionNumber: number,
  ): Promise<any> {
    return this.rebuildContent(documentId, versionNumber);
  }

  /**
   * 获取版本列表（带存储大小统计）
   */
  async getVersionList(documentId: string) {
    const versions = await this.prisma.officeDocumentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        isBaseVersion: true,
        patchSize: true,
        createdAt: true,
      },
    });

    const totalSize = versions.reduce((sum, v) => sum + (v.patchSize || 0), 0);

    return {
      versions,
      totalSize,
      versionCount: versions.length,
    };
  }

  private async getBaseVersion(documentId: string) {
    return this.prisma.officeDocumentVersion.findFirst({
      where: { documentId, isBaseVersion: true },
      orderBy: { versionNumber: "desc" },
    });
  }

  private async rebuildContent(
    documentId: string,
    targetVersion: number,
  ): Promise<any> {
    // 找到最近的基础版本
    const baseVersion = await this.prisma.officeDocumentVersion.findFirst({
      where: {
        documentId,
        isBaseVersion: true,
        versionNumber: { lte: targetVersion },
      },
      orderBy: { versionNumber: "desc" },
    });

    if (!baseVersion) {
      throw new Error(`No base version found for document ${documentId}`);
    }

    let content = baseVersion.contentSnapshot;

    // 获取从基础版本到目标版本的所有patch
    const patches = await this.prisma.officeDocumentVersion.findMany({
      where: {
        documentId,
        versionNumber: {
          gt: baseVersion.versionNumber,
          lte: targetVersion,
        },
        isBaseVersion: false,
      },
      orderBy: { versionNumber: "asc" },
    });

    // 依次应用patch
    for (const patch of patches) {
      if (patch.contentPatch) {
        const result = jsonpatch.applyPatch(
          content,
          patch.contentPatch as jsonpatch.Operation[],
        );
        content = result.newDocument;
      }
    }

    return content;
  }
}
```

---

## 三、前端组件实现

### 3.1 生成模式选择器

```tsx
// frontend/components/ai-office/GenerationModeSelector.tsx

"use client";

import { useState } from "react";

interface GenerationMode {
  id: "quick" | "standard" | "premium";
  name: string;
  description: string[];
  time: string;
  cost: string;
  recommended?: boolean;
}

const MODES: GenerationMode[] = [
  {
    id: "quick",
    name: "快速模式",
    description: ["纯文字 + 图表", "15秒完成", "无图片"],
    time: "15秒",
    cost: "免费",
    recommended: true,
  },
  {
    id: "standard",
    name: "标准模式",
    description: ["文字 + 图表", "免费图库图片", "30秒完成"],
    time: "30秒",
    cost: "免费",
  },
  {
    id: "premium",
    name: "高级模式",
    description: ["全部功能", "AI生成图片", "1-2分钟"],
    time: "1-2分钟",
    cost: "消耗积分",
  },
];

interface Props {
  selectedMode: string;
  onModeChange: (mode: string) => void;
}

export default function GenerationModeSelector({
  selectedMode,
  onModeChange,
}: Props) {
  return (
    <div className="mb-6">
      <label className="mb-3 block text-sm font-medium text-gray-700">
        选择生成模式
      </label>
      <div className="grid grid-cols-3 gap-4">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            className={`relative rounded-lg border-2 p-4 text-left transition-all ${
              selectedMode === mode.id
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            {mode.recommended && (
              <span className="absolute -top-2 left-4 rounded bg-blue-500 px-2 py-0.5 text-xs text-white">
                推荐
              </span>
            )}

            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">
                {mode.id === "quick"
                  ? "⚡"
                  : mode.id === "standard"
                    ? "🎨"
                    : "✨"}
              </span>
              <span className="font-medium">{mode.name}</span>
            </div>

            <ul className="mb-3 space-y-1 text-xs text-gray-600">
              {mode.description.map((item, i) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>

            <div className="flex justify-between text-xs">
              <span className="text-gray-500">{mode.time}</span>
              <span
                className={
                  mode.cost === "免费" ? "text-green-600" : "text-orange-600"
                }
              >
                {mode.cost}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### 3.2 渐进式加载组件

```tsx
// frontend/components/ai-office/ProgressiveLoader.tsx

"use client";

import { useEffect, useState } from "react";

interface LoadingPhase {
  id: string;
  name: string;
  status: "pending" | "loading" | "done";
  progress?: number;
}

interface Props {
  phases: LoadingPhase[];
  currentPhase: string;
  onComplete?: () => void;
}

export default function ProgressiveLoader({
  phases,
  currentPhase,
  onComplete,
}: Props) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-lg">
      <h3 className="mb-4 text-lg font-semibold">正在生成演示文稿...</h3>

      <div className="space-y-3">
        {phases.map((phase, index) => (
          <div key={phase.id} className="flex items-center gap-3">
            {/* 状态图标 */}
            <div className="flex-shrink-0">
              {phase.status === "done" ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600">
                  ✓
                </span>
              ) : phase.status === "loading" ? (
                <span className="flex h-6 w-6 items-center justify-center">
                  <svg
                    className="h-5 w-5 animate-spin text-blue-500"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                </span>
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  {index + 1}
                </span>
              )}
            </div>

            {/* 阶段名称 */}
            <div className="flex-1">
              <span
                className={`text-sm ${
                  phase.status === "done"
                    ? "text-green-600"
                    : phase.status === "loading"
                      ? "font-medium text-blue-600"
                      : "text-gray-400"
                }`}
              >
                {phase.name}
              </span>

              {/* 进度条 */}
              {phase.status === "loading" && phase.progress !== undefined && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${phase.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 提示信息 */}
      <p className="mt-4 text-xs text-gray-500">
        生成完成后可以立即编辑，图片会在后台继续加载
      </p>
    </div>
  );
}
```

---

## 四、API端点更新

### 4.1 新的生成端点

```typescript
// backend/src/modules/ai-office/ppt/ppt-generation.controller.ts

import { Controller, Post, Body, Query } from "@nestjs/common";
import { UnifiedGenerationService } from "../unified-generation.service";
import { ChartGeneratorService } from "../chart-generator.service";
import { StockImageService } from "../stock-image.service";

@Controller("api/v1/ai-office/ppt")
export class PPTGenerationController {
  constructor(
    private unifiedGen: UnifiedGenerationService,
    private chartGen: ChartGeneratorService,
    private stockImage: StockImageService,
  ) {}

  /**
   * 新的统一生成端点
   * 替代原有的多阶段生成
   */
  @Post("generate-v5")
  async generateV5(
    @Body()
    body: {
      prompt: string;
      sourceContent?: string;
      slideCount?: number;
      style?: string;
      mode: "quick" | "standard" | "premium";
    },
  ) {
    // Phase 1: 生成内容结构
    const presentation = await this.unifiedGen.generatePresentation({
      prompt: body.prompt,
      sourceContent: body.sourceContent,
      slideCount: body.slideCount,
      style: body.style as any,
      mode: body.mode,
    });

    // Phase 2: 生成图表SVG（同步，快速）
    const slidesWithCharts = presentation.slides.map((slide) => {
      if (slide.visualHint?.startsWith("chart:")) {
        // 从内容推断图表数据（简化示例）
        const chartData = this.inferChartData(slide);
        const svg = this.chartGen.generateChart(slide.visualHint, chartData);
        return { ...slide, chartSvg: svg };
      }
      return slide;
    });

    // Phase 3: 搜索免费图片（仅standard/premium模式）
    let images: Record<number, any[]> = {};
    if (body.mode !== "quick") {
      const imagePromises = slidesWithCharts.map(async (slide, index) => {
        if (slide.imageKeywords?.length) {
          const results = await this.stockImage.searchImages(
            slide.imageKeywords,
            3,
          );
          return { index, images: results };
        }
        return null;
      });

      const imageResults = await Promise.all(imagePromises);
      imageResults.forEach((result) => {
        if (result) {
          images[result.index] = result.images;
        }
      });
    }

    return {
      ...presentation,
      slides: slidesWithCharts,
      stockImages: images,
      mode: body.mode,
    };
  }

  private inferChartData(slide: any) {
    // 简化：从幻灯片内容推断图表数据
    // 实际实现需要更复杂的解析逻辑
    return {
      labels: ["A", "B", "C", "D"],
      values: [30, 50, 20, 40],
    };
  }
}
```

---

## 五、环境变量配置

```env
# .env 新增配置

# 免费图片API
UNSPLASH_ACCESS_KEY=your_unsplash_access_key
PEXELS_API_KEY=your_pexels_api_key

# AI Office配置
AI_OFFICE_DEFAULT_MODE=standard
AI_OFFICE_MAX_SLIDES=20
AI_OFFICE_CONTENT_TRUNCATE_LENGTH=3000

# 成本追踪
AI_OFFICE_TRACK_COSTS=true
```

---

## 六、测试计划

### 6.1 单元测试

```typescript
// backend/src/modules/ai-office/__tests__/unified-generation.service.spec.ts

describe("UnifiedGenerationService", () => {
  it("should generate presentation with single AI call", async () => {
    const result = await service.generatePresentation({
      prompt: "AI trends 2024",
      mode: "quick",
    });

    expect(result.slides.length).toBeGreaterThan(0);
    expect(result.tokenUsage).toBeLessThan(8000);
  });

  it("should respect mode token limits", async () => {
    const quickResult = await service.generatePresentation({
      prompt: "Test",
      mode: "quick",
    });

    const premiumResult = await service.generatePresentation({
      prompt: "Test",
      mode: "premium",
    });

    expect(quickResult.tokenUsage).toBeLessThan(premiumResult.tokenUsage);
  });
});

describe("ChartGeneratorService", () => {
  it("should generate valid SVG for bar chart", () => {
    const svg = service.generateChart("chart:bar", {
      labels: ["A", "B", "C"],
      values: [10, 20, 30],
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
  });
});

describe("VersionDeltaService", () => {
  it("should save delta instead of full content", async () => {
    const docId = "test-doc";

    // 保存初始版本
    await service.saveVersion(docId, { title: "Test", slides: [] });

    // 保存小改动
    await service.saveVersion(docId, { title: "Test Updated", slides: [] });

    const versions = await service.getVersionList(docId);

    // 第二个版本应该是patch，大小远小于完整内容
    expect(versions.versions[0].isBaseVersion).toBe(false);
    expect(versions.versions[0].patchSize).toBeLessThan(100);
  });
});
```

---

## 七、迁移指南

### 7.1 从PPT 3.0迁移

```typescript
// 迁移脚本：将现有文档的版本转换为差分存储

async function migrateVersionsToDelta() {
  const documents = await prisma.officeDocument.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
      },
    },
  });

  for (const doc of documents) {
    if (doc.versions.length === 0) continue;

    // 第一个版本标记为基础版本
    await prisma.officeDocumentVersion.update({
      where: { id: doc.versions[0].id },
      data: { isBaseVersion: true },
    });

    // 后续版本计算patch
    for (let i = 1; i < doc.versions.length; i++) {
      const prevContent = doc.versions[i - 1].contentSnapshot;
      const currContent = doc.versions[i].contentSnapshot;

      const patch = jsonpatch.compare(prevContent, currContent);

      await prisma.officeDocumentVersion.update({
        where: { id: doc.versions[i].id },
        data: {
          contentPatch: patch,
          patchSize: JSON.stringify(patch).length,
          contentSnapshot: null, // 清空完整快照
          isBaseVersion: false,
        },
      });
    }

    console.log(
      `Migrated ${doc.versions.length} versions for document ${doc.id}`,
    );
  }
}
```

---

**文档完成。可以根据此指南开始实施 AI Office 5.0 的重构工作。**
