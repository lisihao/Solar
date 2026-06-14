# Visual Engine 完整迁移方案

> 将视觉能力（图片生成 + 视频生成）沉淀到 AI Engine 层的系统架构设计

## 目录

1. [架构概览](#1-架构概览)
2. [目录结构规划](#2-目录结构规划)
3. [核心接口定义](#3-核心接口定义)
4. [迁移步骤](#4-迁移步骤)
5. [数据库模型](#5-数据库模型)
6. [API 端点设计](#6-api-端点设计)
7. [与其他模块集成](#7-与其他模块集成)
8. [实施计划](#8-实施计划)

---

## 1. 架构概览

### 1.1 现状分析

```
当前架构（问题）：
┌─────────────────────────────────────────────────────────┐
│                     App Layer                            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │ AI Office │  │ AI Image  │  │ AI Social │            │
│  │  (Slides) │  │  (图片)   │  │  (发布)   │            │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘            │
│        │              │              │                   │
│        └──────────────┼──────────────┘                   │
│                       ↓                                  │
│               网状依赖，耦合度高                          │
└─────────────────────────────────────────────────────────┘

问题：
- AI Image 是 App 层模块，其他 App 调用会形成网状依赖
- 视觉能力（图片/视频）是通用能力，不应属于特定业务
- 违反架构分层原则：App 层不应互相调用
```

### 1.2 目标架构

```
目标架构（解耦）：
┌─────────────────────────────────────────────────────────┐
│                     App Layer                            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │ AI Office │  │ AI Visual │  │ AI Social │            │
│  │  (Slides) │  │ (UI/业务) │  │  (发布)   │            │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘            │
│        │              │              │                   │
│        └──────────────┼──────────────┘                   │
│                       ↓                                  │
├─────────────────────────────────────────────────────────┤
│                   AI Engine Layer                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │                 Visual Module                        ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ││
│  │  │   Image     │  │    Video    │  │   Shared    │  ││
│  │  │   Engine    │  │   Engine    │  │  (模板/品牌) │  ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

优势：
- 星型依赖，所有 App 统一调用 Engine
- 视觉能力独立演进，可被任意模块复用
- 符合架构分层原则
```

### 1.3 职责划分

| 层级          | 模块      | 职责               | 示例                           |
| ------------- | --------- | ------------------ | ------------------------------ |
| **AI Engine** | `visual/` | 纯能力，无业务逻辑 | 图片生成、视频渲染、模板引擎   |
| **AI App**    | `visual/` | 业务逻辑，用户交互 | 历史记录、收藏、权限、积分扣费 |

---

## 2. 目录结构规划

### 2.1 Engine 层结构（核心能力）

```
backend/src/modules/ai-engine/visual/
├── visual.module.ts                    # 模块定义
├── index.ts                            # Barrel exports
│
├── core/                               # 共享核心
│   ├── visual.types.ts                 # 统一类型定义
│   ├── visual.constants.ts             # 常量配置
│   ├── visual.errors.ts                # 错误类型
│   └── visual.utils.ts                 # 工具函数
│
├── image/                              # 图片生成引擎
│   ├── abstractions/
│   │   └── image-adapter.interface.ts  # IImageAdapter 接口
│   ├── adapters/
│   │   ├── base-image.adapter.ts       # 基础适配器
│   │   ├── openai-image.adapter.ts     # OpenAI DALL-E
│   │   ├── stability-image.adapter.ts  # Stability AI
│   │   ├── gemini-image.adapter.ts     # Google Gemini
│   │   ├── together-image.adapter.ts   # Together FLUX
│   │   └── grok-image-adapter.ts       # Grok Vision
│   ├── factory/
│   │   └── image.factory.ts            # 适配器工厂
│   ├── services/
│   │   ├── image-engine.service.ts     # 核心引擎服务
│   │   └── prompt-enhancement.service.ts # Prompt 增强
│   └── image.module.ts                 # 子模块
│
├── video/                              # 视频生成引擎（新增）
│   ├── abstractions/
│   │   ├── video-adapter.interface.ts  # IVideoAdapter 接口
│   │   └── video-composition.interface.ts # 合成接口
│   ├── adapters/
│   │   ├── base-video-adapter.ts       # 基础适配器
│   │   └── remotion-adapter.ts         # Remotion 适配器
│   ├── engines/
│   │   ├── remotion-engine.ts          # Remotion 核心
│   │   ├── remotion-renderer.ts        # 渲染器
│   │   └── ffmpeg-wrapper.ts           # FFmpeg 编码
│   ├── factory/
│   │   └── video-factory.ts            # 适配器工厂
│   ├── services/
│   │   ├── video-engine.service.ts     # 核心引擎服务
│   │   ├── video-composition.service.ts # 视频合成
│   │   └── video-export.service.ts     # 导出服务
│   └── video.module.ts                 # 子模块
│
├── infographic/                        # 信息图引擎
│   ├── services/
│   │   ├── infographic-engine.service.ts
│   │   ├── infographic-layout.service.ts
│   │   └── infographic-render.service.ts
│   ├── templates/
│   │   └── layout-templates.ts         # 布局模板
│   └── infographic.module.ts
│
├── shared/                             # 共享服务
│   ├── template/
│   │   ├── template-registry.service.ts # 模板注册表
│   │   ├── template-engine.service.ts   # 模板引擎
│   │   └── templates/
│   │       ├── image/                   # 图片模板
│   │       └── video/                   # 视频模板
│   ├── brand/
│   │   └── brand-engine.service.ts      # 品牌引擎
│   ├── asset/
│   │   └── asset-processor.service.ts   # 资源处理
│   └── 4-agent-team/
│       ├── visual-team.service.ts       # 4-Agent 视觉团队
│       ├── content-agent.ts
│       ├── layout-agent.ts
│       ├── visual-agent.ts
│       └── style-agent.ts
│
├── tools/                              # 视觉相关工具（注册到 ToolRegistry）
│   ├── image-generation.tool.ts        # 图片生成工具
│   ├── video-generation.tool.ts        # 视频生成工具
│   ├── infographic-generation.tool.ts  # 信息图工具
│   └── visual-analysis.tool.ts         # 视觉分析工具
│
└── facade/
    └── visual-engine.facade.ts         # 统一入口服务
```

### 2.2 App 层结构（业务逻辑）

```
backend/src/modules/ai-app/visual/
├── ai-visual.module.ts                 # 模块定义
├── index.ts
│
├── controllers/
│   ├── image.controller.ts             # 图片 API
│   ├── video.controller.ts             # 视频 API
│   ├── brand-kit.controller.ts         # 品牌套件 API
│   └── export.controller.ts            # 导出 API
│
├── services/
│   ├── ai-visual.service.ts            # 主业务服务
│   ├── image-business.service.ts       # 图片业务逻辑
│   ├── video-business.service.ts       # 视频业务逻辑
│   ├── history.service.ts              # 历史记录
│   ├── bookmark.service.ts             # 收藏管理
│   └── credits.service.ts              # 积分扣费
│
├── dto/
│   ├── generate-image.dto.ts
│   ├── generate-video.dto.ts
│   ├── export.dto.ts
│   └── brand-kit.dto.ts
│
└── types/
    └── index.ts
```

### 2.3 前端结构

```
frontend/
├── app/ai-visual/                      # 页面路由
│   ├── page.tsx                        # 主页面
│   ├── image/page.tsx                  # 图片生成页
│   ├── video/page.tsx                  # 视频生成页
│   └── history/page.tsx                # 历史记录页
│
├── components/ai-visual/               # 组件
│   ├── ImageGenerator/
│   ├── VideoGenerator/
│   ├── TemplateGallery/
│   ├── BrandKitEditor/
│   └── ExportDialog/
│
└── hooks/domain/
    ├── useImageGeneration.ts
    ├── useVideoGeneration.ts
    └── useVisualHistory.ts
```

---

## 3. 核心接口定义

### 3.1 图片生成接口

```typescript
// backend/src/modules/ai-engine/visual/image/abstractions/image-adapter.interface.ts

export type ImageProvider =
  | "openai"
  | "stability"
  | "gemini"
  | "together"
  | "grok";
export type ImageStyle =
  | "realistic"
  | "artistic"
  | "anime"
  | "3d"
  | "sketch"
  | "cinematic";
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface ImageGenerationOptions {
  prompt: string;
  negativePrompt?: string;
  style?: ImageStyle;
  aspectRatio?: AspectRatio;
  width?: number;
  height?: number;
  count?: number;
  quality?: "standard" | "hd";
  model?: string;
  referenceImage?: string; // 图生图
  referenceStrength?: number; // 参考强度 0-1
  seed?: number;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface GeneratedImage {
  url: string;
  base64?: string;
  width: number;
  height: number;
  seed?: number;
  revisedPrompt?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  images: GeneratedImage[];
  model: string;
  provider: ImageProvider;
  duration: number;
  tokensUsed?: number;
  cost?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface IImageAdapter {
  readonly id: string;
  readonly name: string;
  readonly provider: ImageProvider;
  readonly supportedModels: string[];
  readonly defaultModel: string;
  readonly supportedStyles: ImageStyle[];
  readonly supportedAspectRatios: AspectRatio[];
  readonly maxResolution: { width: number; height: number };

  generate(options: ImageGenerationOptions): Promise<ImageGenerationResult>;

  imageToImage?(
    options: ImageGenerationOptions & { referenceImage: string },
  ): Promise<ImageGenerationResult>;

  supportsModel(model: string): boolean;
  supportsStyle(style: ImageStyle): boolean;
  estimateCost(options: ImageGenerationOptions): number;
}
```

### 3.2 视频生成接口

```typescript
// backend/src/modules/ai-engine/visual/video/abstractions/video-adapter.interface.ts

export type VideoProvider = "remotion" | "runway" | "pika" | "custom";
export type VideoFormat = "mp4" | "webm" | "gif";
export type VideoResolution = "480p" | "720p" | "1080p" | "4k";
export type VideoStyle =
  | "marketing"
  | "tutorial"
  | "social-short"
  | "presentation"
  | "cinematic";

export interface VideoGenerationOptions {
  // 内容来源
  content: string; // 文本内容
  contentType: "text" | "script" | "slides" | "article";

  // 视频参数
  duration?: number; // 秒
  fps?: number; // 帧率
  resolution?: VideoResolution;
  format?: VideoFormat;

  // 风格和模板
  style?: VideoStyle;
  templateId?: string;

  // 品牌配置
  brandKit?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    logoUrl?: string;
    watermark?: boolean;
  };

  // 音频
  backgroundMusic?: string;
  voiceover?: boolean;
  voiceId?: string;

  // 其他
  metadata?: Record<string, unknown>;
}

export interface VideoScene {
  id: string;
  order: number;
  duration: number; // 帧数
  type: "text" | "image" | "video" | "transition";
  content: {
    text?: string;
    imageUrl?: string;
    videoUrl?: string;
    animation?: AnimationConfig;
  };
  style: {
    backgroundColor?: string;
    textColor?: string;
    fontSize?: number;
    position?: "center" | "top" | "bottom";
  };
}

export interface VideoComposition {
  id: string;
  scenes: VideoScene[];
  totalDuration: number; // 总帧数
  fps: number;
  width: number;
  height: number;
  audio?: {
    backgroundUrl?: string;
    voiceoverUrl?: string;
    volume: number;
  };
}

export interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration: number; // 秒
  fileSize: number; // 字节
  format: VideoFormat;
  resolution: VideoResolution;
  composition?: VideoComposition;
  error?: {
    code: string;
    message: string;
  };
}

export interface IVideoAdapter {
  readonly id: string;
  readonly name: string;
  readonly provider: VideoProvider;
  readonly supportedFormats: VideoFormat[];
  readonly supportedResolutions: VideoResolution[];
  readonly maxDuration: number; // 秒

  generate(options: VideoGenerationOptions): Promise<VideoGenerationResult>;

  generateFromComposition(
    composition: VideoComposition,
  ): Promise<VideoGenerationResult>;

  preview(
    composition: VideoComposition,
    options?: { quality: "low" | "medium" },
  ): Promise<{ previewUrl: string }>;

  estimateDuration(content: string): number;
  estimateCost(options: VideoGenerationOptions): number;
}
```

### 3.3 Visual Engine Facade

```typescript
// backend/src/modules/ai-engine/visual/facade/visual-engine.facade.ts

import { Injectable } from "@nestjs/common";
import { ImageFactory } from "../image/factory/image.factory";
import { VideoFactory } from "../video/factory/video-factory";
import { InfographicEngineService } from "../infographic/services/infographic-engine.service";
import { VisualTeamService } from "../shared/4-agent-team/visual-team.service";

@Injectable()
export class VisualEngineFacade {
  constructor(
    private readonly imageFactory: ImageFactory,
    private readonly videoFactory: VideoFactory,
    private readonly infographicEngine: InfographicEngineService,
    private readonly visualTeam: VisualTeamService,
  ) {}

  // ==================== 图片生成 ====================

  async generateImage(
    options: ImageGenerationOptions,
  ): Promise<ImageGenerationResult> {
    return this.imageFactory.generate(options);
  }

  async generateImageWithTeam(
    content: string,
    options?: Partial<ImageGenerationOptions>,
  ): Promise<ImageGenerationResult> {
    // 使用 4-Agent 团队优化 prompt
    const enhancedPrompt = await this.visualTeam.enhancePrompt(content);
    return this.imageFactory.generate({
      ...options,
      prompt: enhancedPrompt.imagePrompt,
    });
  }

  async imageToImage(
    referenceImage: string,
    options: ImageGenerationOptions,
  ): Promise<ImageGenerationResult> {
    return this.imageFactory.imageToImage({
      ...options,
      referenceImage,
    });
  }

  // ==================== 视频生成 ====================

  async generateVideo(
    options: VideoGenerationOptions,
  ): Promise<VideoGenerationResult> {
    return this.videoFactory.generate(options);
  }

  async generateVideoFromSlides(
    slidesSessionId: string,
    options?: Partial<VideoGenerationOptions>,
  ): Promise<VideoGenerationResult> {
    // 从 Slides 转换为视频
    const composition =
      await this.videoFactory.compositionFromSlides(slidesSessionId);
    return this.videoFactory.generateFromComposition(composition);
  }

  async previewVideo(
    composition: VideoComposition,
  ): Promise<{ previewUrl: string }> {
    return this.videoFactory.preview(composition);
  }

  // ==================== 信息图生成 ====================

  async generateInfographic(
    content: string,
    options?: InfographicOptions,
  ): Promise<InfographicResult> {
    return this.infographicEngine.generate(content, options);
  }

  // ==================== 工具方法 ====================

  getAvailableImageModels(): ImageModelInfo[] {
    return this.imageFactory.getAvailableModels();
  }

  getAvailableVideoTemplates(): VideoTemplateInfo[] {
    return this.videoFactory.getAvailableTemplates();
  }

  estimateImageCost(options: ImageGenerationOptions): number {
    return this.imageFactory.estimateCost(options);
  }

  estimateVideoCost(options: VideoGenerationOptions): number {
    return this.videoFactory.estimateCost(options);
  }
}
```

### 3.4 工具定义

```typescript
// backend/src/modules/ai-engine/visual/tools/image-generation.tool.ts

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../tools/base/base-tool";
import { VisualEngineFacade } from "../facade/visual-engine.facade";

interface ImageGenerationInput {
  prompt: string;
  style?: string;
  aspectRatio?: string;
  model?: string;
  referenceImage?: string;
}

interface ImageGenerationOutput {
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  model: string;
  provider: string;
}

@Injectable()
export class ImageGenerationTool extends BaseTool<
  ImageGenerationInput,
  ImageGenerationOutput
> {
  readonly id = "image-generation";
  readonly name = "图片生成";
  readonly description = "使用 AI 生成图片，支持多种风格和模型";
  readonly category = "generation";

  readonly inputSchema = {
    type: "object",
    properties: {
      prompt: { type: "string", description: "图片描述" },
      style: {
        type: "string",
        description: "风格：realistic, artistic, anime 等",
      },
      aspectRatio: { type: "string", description: "比例：1:1, 16:9, 9:16" },
      model: {
        type: "string",
        description: "模型：dall-e-3, stable-diffusion 等",
      },
      referenceImage: { type: "string", description: "参考图片 URL（可选）" },
    },
    required: ["prompt"],
  };

  readonly outputSchema = {
    type: "object",
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
      },
      model: { type: "string" },
      provider: { type: "string" },
    },
  };

  constructor(private readonly visualEngine: VisualEngineFacade) {
    super();
  }

  protected async doExecute(
    input: ImageGenerationInput,
    context: ToolContext,
  ): Promise<ImageGenerationOutput> {
    const result = await this.visualEngine.generateImage({
      prompt: input.prompt,
      style: input.style as ImageStyle,
      aspectRatio: input.aspectRatio as AspectRatio,
      model: input.model,
      referenceImage: input.referenceImage,
    });

    if (!result.success) {
      throw new Error(result.error?.message || "Image generation failed");
    }

    return {
      images: result.images.map((img) => ({
        url: img.url,
        width: img.width,
        height: img.height,
      })),
      model: result.model,
      provider: result.provider,
    };
  }
}
```

```typescript
// backend/src/modules/ai-engine/visual/tools/video-generation.tool.ts

@Injectable()
export class VideoGenerationTool extends BaseTool<
  VideoGenerationInput,
  VideoGenerationOutput
> {
  readonly id = "video-generation";
  readonly name = "视频生成";
  readonly description = "使用 Remotion 从文本或内容生成视频";
  readonly category = "generation";

  readonly inputSchema = {
    type: "object",
    properties: {
      content: { type: "string", description: "视频内容文本" },
      style: {
        type: "string",
        description: "风格：marketing, tutorial, social-short",
      },
      duration: { type: "number", description: "时长（秒）" },
      templateId: { type: "string", description: "模板 ID" },
      resolution: { type: "string", description: "分辨率：720p, 1080p, 4k" },
    },
    required: ["content"],
  };

  readonly outputSchema = {
    type: "object",
    properties: {
      videoUrl: { type: "string" },
      thumbnailUrl: { type: "string" },
      duration: { type: "number" },
      fileSize: { type: "number" },
    },
  };

  constructor(private readonly visualEngine: VisualEngineFacade) {
    super();
  }

  protected async doExecute(
    input: VideoGenerationInput,
    context: ToolContext,
  ): Promise<VideoGenerationOutput> {
    const result = await this.visualEngine.generateVideo({
      content: input.content,
      contentType: "text",
      style: input.style as VideoStyle,
      duration: input.duration,
      templateId: input.templateId,
      resolution: input.resolution as VideoResolution,
    });

    if (!result.success) {
      throw new Error(result.error?.message || "Video generation failed");
    }

    return {
      videoUrl: result.videoUrl!,
      thumbnailUrl: result.thumbnailUrl,
      duration: result.duration,
      fileSize: result.fileSize,
    };
  }
}
```

---

## 4. 迁移步骤

### 4.1 Phase 1: Engine 层基础架构（Week 1）

```
任务清单：
□ 创建 visual/ 目录结构
□ 定义核心接口（IImageAdapter, IVideoAdapter）
□ 创建 VisualModule
□ 迁移现有 Image 适配器到 Engine 层
□ 创建 ImageFactory
□ 创建 VisualEngineFacade
□ 单元测试
```

**关键文件：**

```bash
# 创建目录
mkdir -p backend/src/modules/ai-engine/visual/{core,image,video,infographic,shared,tools,facade}

# 核心文件
backend/src/modules/ai-engine/visual/visual.module.ts
backend/src/modules/ai-engine/visual/core/visual.types.ts
backend/src/modules/ai-engine/visual/image/abstractions/image-adapter.interface.ts
backend/src/modules/ai-engine/visual/image/factory/image.factory.ts
backend/src/modules/ai-engine/visual/facade/visual-engine.facade.ts
```

### 4.2 Phase 2: 图片能力迁移（Week 2）

```
任务清单：
□ 迁移 OpenAI 适配器
□ 迁移 Stability 适配器
□ 迁移 Gemini 适配器
□ 迁移 Together 适配器
□ 迁移 Grok 适配器
□ 迁移 Prompt 增强服务
□ 迁移 4-Agent 视觉团队
□ 迁移信息图引擎
□ 创建 ImageGenerationTool
□ 集成测试
```

**迁移映射：**

```
ai-app/image/generation/image-generation.service.ts
  → ai-engine/visual/image/adapters/*.ts

ai-app/image/generation/prompt-enhancement.service.ts
  → ai-engine/visual/shared/4-agent-team/visual-team.service.ts

ai-app/image/infographic/
  → ai-engine/visual/infographic/
```

### 4.3 Phase 3: 视频能力开发（Week 3-4）

```
任务清单：
□ 安装 Remotion 依赖
□ 创建 Remotion 适配器
□ 创建视频合成服务
□ 创建视频导出服务
□ 创建 3-5 个视频模板
□ 创建 VideoFactory
□ 创建 VideoGenerationTool
□ 与 FFmpeg 集成
□ 单元测试
```

**Remotion 集成：**

```bash
# 安装依赖
npm install remotion @remotion/renderer @remotion/cli

# 创建 Remotion 项目结构
backend/src/modules/ai-engine/visual/video/remotion/
├── compositions/
│   ├── MarketingVideo.tsx
│   ├── TutorialVideo.tsx
│   └── SocialShortVideo.tsx
├── components/
│   ├── TextSlide.tsx
│   ├── ImageSlide.tsx
│   └── Transition.tsx
└── index.ts
```

### 4.4 Phase 4: App 层重构（Week 5）

```
任务清单：
□ 重命名 ai-app/image → ai-app/visual
□ 更新控制器路由
□ 更新服务依赖（调用 Engine 层）
□ 添加视频控制器
□ 添加视频业务服务
□ 更新 DTO
□ 添加路由兼容层（旧路由重定向）
□ 更新前端调用
□ 集成测试
```

**路由兼容：**

```typescript
// backend/src/modules/ai-app/visual/controllers/compat.controller.ts

@Controller("ai-image")
export class CompatController {
  @All("*")
  redirectToVisual(@Req() req: Request, @Res() res: Response) {
    const newPath = req.path.replace("/ai-image", "/ai-visual/image");
    res.redirect(301, newPath);
  }
}
```

### 4.5 Phase 5: 集成与测试（Week 6）

```
任务清单：
□ AI Office 集成视频能力
□ AI Social 集成视频能力
□ AI Research 集成视觉能力
□ AI Writing 集成视觉能力
□ 端到端测试
□ 性能测试
□ 文档更新
```

---

## 5. 数据库模型

### 5.1 Prisma Schema 变更

```prisma
// backend/prisma/schema.prisma

// ==================== 视觉内容基础表 ====================

model VisualContent {
  id              String   @id @default(cuid())
  userId          String
  type            String   // 'image' | 'video' | 'infographic'

  // 生成配置
  prompt          String?
  enhancedPrompt  String?
  style           String?
  model           String?
  provider        String?

  // 输出
  url             String
  thumbnailUrl    String?
  width           Int?
  height          Int?
  duration        Int?     // 视频时长（秒）
  fileSize        Int?     // 字节
  format          String?  // 'png' | 'jpg' | 'mp4' | 'webm'

  // 元数据
  processingSteps Json?    // 处理步骤记录
  promptInsights  Json?    // AI 生成的设计见解
  composition     Json?    // 视频合成配置
  metadata        Json?

  // 业务字段
  title           String?
  description     String?
  tags            String[]
  isBookmarked    Boolean  @default(false)
  isPublic        Boolean  @default(false)

  // 关联
  brandKitId      String?
  brandKit        BrandKit? @relation(fields: [brandKitId], references: [id])
  templateId      String?

  // 时间戳
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@index([type])
  @@index([createdAt])
}

// ==================== 品牌套件 ====================

model BrandKit {
  id              String   @id @default(cuid())
  userId          String
  name            String
  description     String?

  // 品牌配置
  primaryColor    String?
  secondaryColor  String?
  accentColor     String?
  fontFamily      String?
  logoUrl         String?
  watermarkUrl    String?

  // 预设
  presets         Json?    // 预设样式配置

  // 关联
  contents        VisualContent[]

  // 时间戳
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, name])
  @@index([userId])
}

// ==================== 视频模板 ====================

model VideoTemplate {
  id              String   @id @default(cuid())
  name            String   @unique
  description     String?
  category        String   // 'marketing' | 'tutorial' | 'social' | 'presentation'

  // Remotion 配置
  composition     Json     // Remotion Component 配置
  defaultDuration Int      // 默认帧数
  fps             Int      @default(30)
  resolution      String   @default("1080p")

  // 预览
  thumbnailUrl    String?
  previewUrl      String?

  // 样式
  themes          Json?    // 预设主题

  // 状态
  isPublic        Boolean  @default(false)
  isSystem        Boolean  @default(false) // 系统内置模板

  // 时间戳
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([category])
}

// ==================== 生成任务队列 ====================

model VisualGenerationJob {
  id              String   @id @default(cuid())
  userId          String
  type            String   // 'image' | 'video' | 'infographic'

  // 任务配置
  input           Json     // 生成参数

  // 状态
  status          String   @default("pending") // 'pending' | 'processing' | 'completed' | 'failed'
  progress        Int      @default(0) // 0-100

  // 结果
  output          Json?    // 生成结果
  error           String?

  // 资源消耗
  creditsUsed     Int?
  durationMs      Int?     // 处理耗时

  // 时间戳
  createdAt       DateTime @default(now())
  startedAt       DateTime?
  completedAt     DateTime?

  @@index([userId])
  @@index([status])
}
```

### 5.2 数据迁移脚本

```typescript
// backend/prisma/migrations/visual-engine-migration.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateGeneratedImages() {
  // 将 GeneratedImage 数据迁移到 VisualContent
  const images = await prisma.generatedImage.findMany();

  for (const image of images) {
    await prisma.visualContent.create({
      data: {
        id: image.id,
        userId: image.userId,
        type: "image",
        prompt: image.prompt,
        enhancedPrompt: image.enhancedPrompt,
        style: image.style,
        model: image.imageModelUsed,
        url: image.imageUrl,
        width: image.width,
        height: image.height,
        processingSteps: image.processingSteps,
        promptInsights: image.promptInsights,
        isBookmarked: image.isBookmarked,
        isPublic: image.isPublic,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
      },
    });
  }

  console.log(`Migrated ${images.length} images to VisualContent`);
}

async function main() {
  await migrateGeneratedImages();
  // 其他迁移...
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## 6. API 端点设计

### 6.1 图片 API

```typescript
// 图片生成
POST   /api/v1/ai-visual/image/generate           // 生成图片
POST   /api/v1/ai-visual/image/generate/stream    // 流式生成（SSE）
POST   /api/v1/ai-visual/image/generate-with-team // 使用 4-Agent 团队
POST   /api/v1/ai-visual/image/image-to-image     // 图生图

// 图片管理
GET    /api/v1/ai-visual/image/history            // 历史记录
GET    /api/v1/ai-visual/image/:id                // 获取单个
DELETE /api/v1/ai-visual/image/:id                // 删除
POST   /api/v1/ai-visual/image/:id/bookmark       // 收藏
DELETE /api/v1/ai-visual/image/:id/bookmark       // 取消收藏
POST   /api/v1/ai-visual/image/:id/visibility     // 设置可见性

// 模型和配置
GET    /api/v1/ai-visual/image/models             // 可用模型
GET    /api/v1/ai-visual/image/styles             // 可用风格

// 导出
POST   /api/v1/ai-visual/image/:id/export         // 导出（png/svg/pdf）
```

### 6.2 视频 API

```typescript
// 视频生成
POST   /api/v1/ai-visual/video/generate           // 从文本生成
POST   /api/v1/ai-visual/video/generate/stream    // 流式生成（SSE）
POST   /api/v1/ai-visual/video/from-slides/:id    // 从 Slides 生成
POST   /api/v1/ai-visual/video/from-content/:id   // 从内容生成
POST   /api/v1/ai-visual/video/preview            // 快速预览

// 视频管理
GET    /api/v1/ai-visual/video/history            // 历史记录
GET    /api/v1/ai-visual/video/:id                // 获取单个
DELETE /api/v1/ai-visual/video/:id                // 删除
GET    /api/v1/ai-visual/video/:id/status         // 生成状态

// 模板
GET    /api/v1/ai-visual/video/templates          // 可用模板
GET    /api/v1/ai-visual/video/templates/:id      // 模板详情
POST   /api/v1/ai-visual/video/templates/:id/preview // 模板预览

// 导出
POST   /api/v1/ai-visual/video/:id/export         // 导出（mp4/webm/gif）
```

### 6.3 品牌套件 API

```typescript
// CRUD
GET    /api/v1/ai-visual/brand-kit                // 列表
POST   /api/v1/ai-visual/brand-kit                // 创建
GET    /api/v1/ai-visual/brand-kit/:id            // 获取
PUT    /api/v1/ai-visual/brand-kit/:id            // 更新
DELETE /api/v1/ai-visual/brand-kit/:id            // 删除

// 应用
POST   /api/v1/ai-visual/brand-kit/:id/apply      // 应用到生成
```

### 6.4 兼容旧路由

```typescript
// 兼容层（6 个月后废弃）
/api/v1/ai-image/*  →  301 Redirect  →  /api/v1/ai-visual/image/*
```

---

## 7. 与其他模块集成

### 7.1 AI Office 集成

```typescript
// backend/src/modules/ai-app/office/slides/services/slides-video.service.ts

@Injectable()
export class SlidesVideoService {
  constructor(private readonly visualEngine: VisualEngineFacade) {}

  async convertSlidesToVideo(
    sessionId: string,
    options?: VideoOptions,
  ): Promise<VideoGenerationResult> {
    // 获取 Slides 数据
    const slides = await this.getSlidesData(sessionId);

    // 调用 Engine 层生成视频
    return this.visualEngine.generateVideoFromSlides(sessionId, {
      ...options,
      style: "presentation",
    });
  }
}

// 控制器端点
@Controller("ai-office/slides")
export class SlidesController {
  @Post(":sessionId/to-video")
  async convertToVideo(
    @Param("sessionId") sessionId: string,
    @Body() dto: ConvertToVideoDto,
  ) {
    return this.slidesVideoService.convertSlidesToVideo(sessionId, dto);
  }
}
```

### 7.2 AI Social 集成

```typescript
// backend/src/modules/ai-app/social/services/social-video.service.ts

@Injectable()
export class SocialVideoService {
  constructor(private readonly visualEngine: VisualEngineFacade) {}

  async generateSocialVideo(
    contentId: string,
    platform: "wechat" | "xiaohongshu" | "douyin",
  ): Promise<VideoGenerationResult> {
    const content = await this.getContent(contentId);

    // 根据平台选择模板
    const templateId = this.getTemplateForPlatform(platform);

    return this.visualEngine.generateVideo({
      content: content.text,
      contentType: "article",
      style: "social-short",
      templateId,
      resolution: platform === "douyin" ? "1080p" : "720p",
      duration: platform === "douyin" ? 60 : 30,
    });
  }
}
```

### 7.3 AI Research 集成

```typescript
// backend/src/modules/ai-app/research/services/research-visual.service.ts

@Injectable()
export class ResearchVisualService {
  constructor(private readonly visualEngine: VisualEngineFacade) {}

  async generateReportInfographic(
    reportId: string,
  ): Promise<InfographicResult> {
    const report = await this.getReport(reportId);

    return this.visualEngine.generateInfographic(report.content, {
      layout: "statistics",
      style: "professional",
    });
  }

  async generateReportVideo(reportId: string): Promise<VideoGenerationResult> {
    const report = await this.getReport(reportId);

    return this.visualEngine.generateVideo({
      content: report.content,
      contentType: "article",
      style: "presentation",
      duration: 120,
    });
  }
}
```

### 7.4 AI Writing 集成

```typescript
// backend/src/modules/ai-app/writing/services/writing-visual.service.ts

@Injectable()
export class WritingVisualService {
  constructor(private readonly visualEngine: VisualEngineFacade) {}

  async generateChapterImage(
    chapterId: string,
  ): Promise<ImageGenerationResult> {
    const chapter = await this.getChapter(chapterId);

    return this.visualEngine.generateImageWithTeam(chapter.content, {
      style: "artistic",
      aspectRatio: "16:9",
    });
  }

  async generateBookTrailer(projectId: string): Promise<VideoGenerationResult> {
    const project = await this.getProject(projectId);

    return this.visualEngine.generateVideo({
      content: project.synopsis,
      contentType: "text",
      style: "cinematic",
      duration: 60,
    });
  }
}
```

---

## 8. 实施计划

### 8.1 时间线

```
Week 1: Engine 层基础架构
  ├── Day 1-2: 目录结构 + 核心接口
  ├── Day 3-4: ImageFactory + 适配器迁移
  └── Day 5: VisualEngineFacade + 单元测试

Week 2: 图片能力完整迁移
  ├── Day 1-2: 所有适配器迁移
  ├── Day 3: 4-Agent 团队迁移
  ├── Day 4: 信息图引擎迁移
  └── Day 5: ImageGenerationTool + 集成测试

Week 3: 视频能力开发（上）
  ├── Day 1: Remotion 依赖安装 + 项目配置
  ├── Day 2-3: Remotion 适配器开发
  ├── Day 4: 视频合成服务
  └── Day 5: 基础模板开发

Week 4: 视频能力开发（下）
  ├── Day 1-2: 更多模板 + FFmpeg 集成
  ├── Day 3: VideoFactory + 导出服务
  ├── Day 4: VideoGenerationTool
  └── Day 5: 单元测试

Week 5: App 层重构
  ├── Day 1-2: 重命名 + 路由更新
  ├── Day 3: 控制器 + 服务重构
  ├── Day 4: 前端更新
  └── Day 5: 集成测试

Week 6: 集成与发布
  ├── Day 1-2: 与其他模块集成
  ├── Day 3: 端到端测试
  ├── Day 4: 性能优化
  └── Day 5: 文档 + 发布
```

### 8.2 风险评估

| 风险                    | 影响 | 概率 | 缓解措施                |
| ----------------------- | ---- | ---- | ----------------------- |
| Remotion 服务端渲染复杂 | 高   | 中   | 预研 + 备用 FFmpeg 方案 |
| 数据迁移丢失            | 高   | 低   | 备份 + 回滚脚本         |
| 路由兼容性问题          | 中   | 中   | 全面测试 + 渐进式切换   |
| 性能下降                | 中   | 低   | 性能基准测试 + 优化     |

### 8.3 成功标准

```
功能完整性：
✅ 所有现有图片功能正常
✅ 视频生成功能可用
✅ 其他模块集成正常

性能指标：
✅ 图片生成延迟 < 10s
✅ 视频生成延迟 < 60s（30s 视频）
✅ API 响应时间 < 200ms

质量指标：
✅ 单元测试覆盖率 > 80%
✅ 无 P0/P1 级 Bug
✅ 文档完整
```

---

## 附录

### A. 依赖安装

```bash
# Remotion 相关
npm install remotion @remotion/renderer @remotion/cli @remotion/player

# FFmpeg（系统级）
# Windows: choco install ffmpeg
# macOS: brew install ffmpeg
# Linux: apt install ffmpeg

# 其他依赖
npm install sharp  # 图片处理
```

### B. 环境变量

```env
# 视觉能力配置
VISUAL_ENGINE_ENABLED=true

# Remotion 配置
REMOTION_CONCURRENCY=2
REMOTION_OUTPUT_DIR=/tmp/remotion-output

# FFmpeg 配置
FFMPEG_PATH=/usr/bin/ffmpeg
```

### C. 参考文档

- [Remotion 官方文档](https://www.remotion.dev/docs)
- [AI Engine 架构文档](../architecture/ai-engine-architecture.md)
- [工具系统开发指南](../guides/tool-development-guide.md)

---

**文档版本**: 1.0
**最后更新**: 2026-01-25
**作者**: Claude Code
