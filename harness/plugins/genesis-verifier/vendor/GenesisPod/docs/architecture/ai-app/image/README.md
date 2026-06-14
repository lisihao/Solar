# AI Image - 智能图像生成平台

> 文生图 + 品牌套件 + 信息图生成 + 图像分析

**最后更新**: 2026-01-15
**版本**: v1.0
**状态**: 生产环境

---

## 概述

AI Image 是 GenesisPod 的图像生成和处理模块，提供从文本到图像的全流程服务，支持品牌一致性管理和专业信息图生成。

### 核心特性

- **多模型支持**: Imagen4, Flux, Stable Diffusion, DALL-E 3
- **提示词增强**: 自动优化用户输入，提升生成质量
- **品牌套件**: 管理品牌色彩、字体、Logo
- **信息图生成**: 数据可视化自动生成
- **图像分析**: 提取图像中的视觉元素和主题
- **批量导出**: 多种格式导出

---

## 系统架构

### 核心流程

```
用户输入提示词
    ↓
[Prompt Enhancement] 提示词增强
    ↓
[Brand Kit Injection] 品牌元素注入（可选）
    ↓
[Image Generation] 调用图像模型
    ↓
[Storage] 云存储保存
    ↓
[Metadata Extraction] 提取元数据
    ↓
返回图像 URL
```

### 技术栈

| 层级       | 技术选型                        |
| ---------- | ------------------------------- |
| 后端       | NestJS + AI Engine ImageFactory |
| 图像存储   | Cloudinary / AWS S3             |
| 数据存储   | PostgreSQL                      |
| 提示词增强 | PromptEnhancementService        |
| 品牌管理   | BrandKitService                 |

---

## 功能模块

### 1. 图像生成

#### 基础生成

```typescript
POST /api/v1/ai-image/generate
{
  "prompt": "一只可爱的猫咪在花园里玩耍",
  "model": "imagen4", // imagen4 | flux | stable-diffusion | dalle3
  "size": "1024x1024", // 1024x1024 | 1024x1792 | 1792x1024
  "quality": "standard", // standard | hd
  "style": "natural" // natural | vivid
}

Response:
{
  "id": "img-xxx",
  "url": "https://cdn.gens.team/images/xxx.png",
  "prompt": "一只可爱的猫咪在花园里玩耍",
  "enhancedPrompt": "A cute fluffy cat playing in a colorful garden, sunlight filtering through leaves, photorealistic, 8k resolution",
  "model": "imagen4",
  "metadata": {
    "width": 1024,
    "height": 1024,
    "format": "png"
  }
}
```

#### 提示词增强模式

```typescript
POST /api/v1/ai-image/generate
{
  "prompt": "猫",
  "enhancePrompt": true // 启用提示词增强
}

# 系统自动:
# 1. 分析用户意图
# 2. 补充细节描述
# 3. 添加质量关键词（8k, photorealistic）
# 4. 优化语法结构

# 原始: "猫"
# 增强后: "A majestic cat with piercing green eyes, sitting on a windowsill, golden hour lighting, shallow depth of field, professional photography, 8k resolution, ultra detailed"
```

#### 品牌风格生成

```typescript
POST /api/v1/ai-image/generate
{
  "prompt": "产品宣传海报",
  "brandKitId": "brand-xxx", // 应用品牌套件
  "applyBrandColors": true,
  "includelogo": true
}

# 系统自动:
# 1. 注入品牌主色调
# 2. 应用品牌字体样式
# 3. 添加 Logo（如需要）
```

### 2. 品牌套件管理

#### 创建品牌套件

```typescript
POST /api/v1/ai-image/brand-kits
{
  "name": "GenesisPod 品牌",
  "primaryColor": "#3B82F6", // 主色
  "secondaryColor": "#10B981", // 辅色
  "accentColor": "#F59E0B", // 强调色
  "fonts": {
    "primary": "Inter",
    "secondary": "Roboto Mono"
  },
  "logoUrl": "https://cdn.gens.team/logo.svg",
  "guidelines": "品牌色以蓝色为主，传达科技感和专业性"
}

Response:
{
  "id": "brand-xxx",
  "name": "GenesisPod 品牌",
  "colors": {
    "primary": "#3B82F6",
    "secondary": "#10B981",
    "accent": "#F59E0B"
  },
  "createdAt": "2026-01-15T10:00:00Z"
}
```

#### 使用品牌套件

```typescript
GET /api/v1/ai-image/brand-kits/:id

# 获取品牌配置，应用到生成参数
# 颜色、字体、Logo 自动注入提示词
```

### 3. 信息图生成

#### 数据可视化

```typescript
POST /api/v1/ai-image/infographics
{
  "type": "chart", // chart | timeline | comparison | flowchart
  "title": "2025 年收入增长",
  "data": {
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "values": [100, 150, 200, 280]
  },
  "style": "modern", // modern | minimal | colorful
  "brandKitId": "brand-xxx" // 可选
}

Response:
{
  "id": "infographic-xxx",
  "url": "https://cdn.gens.team/infographics/xxx.png",
  "type": "chart",
  "thumbnail": "https://cdn.gens.team/thumbnails/xxx.jpg"
}
```

#### 信息图类型

| 类型         | 说明                   | 适用场景           |
| ------------ | ---------------------- | ------------------ |
| `chart`      | 图表（柱状图、折线图） | 数据趋势展示       |
| `timeline`   | 时间轴                 | 历史事件、路线图   |
| `comparison` | 对比图                 | 产品对比、优劣对比 |
| `flowchart`  | 流程图                 | 流程说明、架构图   |

### 4. 图像分析

#### 提取视觉元素

```typescript
POST /api/v1/ai-image/analyze
{
  "imageUrl": "https://example.com/image.jpg"
}

Response:
{
  "colors": [
    {"hex": "#3B82F6", "name": "蓝色", "percentage": 0.45},
    {"hex": "#10B981", "name": "绿色", "percentage": 0.30}
  ],
  "objects": ["cat", "garden", "flowers"],
  "mood": "peaceful",
  "dominantTheme": "nature",
  "technicalDetails": {
    "width": 1920,
    "height": 1080,
    "format": "jpeg",
    "fileSize": 245678
  }
}
```

### 5. 批量导出

#### 导出多种格式

```typescript
POST /api/v1/ai-image/export
{
  "imageIds": ["img-1", "img-2", "img-3"],
  "formats": ["png", "jpg", "webp"],
  "sizes": ["1024x1024", "512x512", "256x256"]
}

Response:
{
  "exportId": "export-xxx",
  "downloadUrl": "https://cdn.gens.team/exports/xxx.zip",
  "files": [
    {"name": "img-1_1024x1024.png", "size": 1234567},
    {"name": "img-1_512x512.png", "size": 345678}
  ]
}
```

---

## API 接口

### 图像生成

| 方法   | 路径                        | 说明         |
| ------ | --------------------------- | ------------ |
| POST   | `/api/v1/ai-image/generate` | 生成图像     |
| GET    | `/api/v1/ai-image/:id`      | 获取图像详情 |
| DELETE | `/api/v1/ai-image/:id`      | 删除图像     |

### 品牌套件

| 方法   | 路径                              | 说明         |
| ------ | --------------------------------- | ------------ |
| POST   | `/api/v1/ai-image/brand-kits`     | 创建品牌套件 |
| GET    | `/api/v1/ai-image/brand-kits`     | 获取品牌列表 |
| GET    | `/api/v1/ai-image/brand-kits/:id` | 获取品牌详情 |
| PATCH  | `/api/v1/ai-image/brand-kits/:id` | 更新品牌     |
| DELETE | `/api/v1/ai-image/brand-kits/:id` | 删除品牌     |

### 信息图生成

| 方法 | 路径                                | 说明           |
| ---- | ----------------------------------- | -------------- |
| POST | `/api/v1/ai-image/infographics`     | 生成信息图     |
| GET  | `/api/v1/ai-image/infographics/:id` | 获取信息图详情 |

### 图像分析

| 方法 | 路径                              | 说明         |
| ---- | --------------------------------- | ------------ |
| POST | `/api/v1/ai-image/analyze`        | 分析图像     |
| POST | `/api/v1/ai-image/extract-colors` | 提取配色方案 |

### 批量导出

| 方法 | 路径                           | 说明         |
| ---- | ------------------------------ | ------------ |
| POST | `/api/v1/ai-image/export`      | 批量导出     |
| GET  | `/api/v1/ai-image/exports/:id` | 获取导出状态 |

---

## 数据模型

### GeneratedImage

```prisma
model GeneratedImage {
  id               String   @id @default(cuid())
  userId           String
  prompt           String   @db.Text
  enhancedPrompt   String?  @db.Text
  model            String   // imagen4 | flux | stable-diffusion | dalle3
  url              String
  thumbnailUrl     String?
  brandKitId       String?
  metadata         Json?    // 尺寸、格式、模型参数
  createdAt        DateTime @default(now())

  brandKit         BrandKit? @relation(fields: [brandKitId], references: [id])
}
```

### BrandKit

```prisma
model BrandKit {
  id              String   @id @default(cuid())
  userId          String
  name            String
  primaryColor    String
  secondaryColor  String?
  accentColor     String?
  fonts           Json?
  logoUrl         String?
  guidelines      String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  images          GeneratedImage[]
}
```

---

## 核心服务说明

### ImageGenerationService

图像生成服务，负责：

- 调用 AI Engine ImageFactory
- 管理多模型切换
- 处理生成参数

### PromptEnhancementService

提示词增强服务，负责：

- 分析用户输入
- 补充细节描述
- 添加质量关键词
- 优化语法结构

### Imagen4PromptService

Imagen4 专用提示词优化：

- 针对 Imagen4 模型特点优化
- 支持多语言提示词
- 处理特殊场景（人像、风景、产品）

### BrandKitService

品牌套件服务，负责：

- 品牌配置管理
- 颜色、字体提取
- Logo 处理
- 品牌元素注入提示词

### InfographicService

信息图服务，负责：

- 数据可视化
- 模板管理
- 图表生成
- 布局优化

### StorageService

存储服务，负责：

- 图像上传到云存储
- 生成缩略图
- 管理 CDN URL
- 清理过期文件

---

## 前端集成

### Hook 使用

```typescript
import { useImageGeneration, useBrandKits } from '@/hooks/domain';

function ImageGenerator() {
  const { generate, generating } = useImageGeneration();
  const { brandKits } = useBrandKits();

  const handleGenerate = async () => {
    const result = await generate({
      prompt: "科技感的背景图",
      model: "imagen4",
      brandKitId: brandKits[0]?.id,
    });
    console.log('生成的图像:', result.url);
  };

  return <button onClick={handleGenerate}>生成图像</button>;
}
```

### 路由结构

```
/ai-image
  ├── /                         # 图像库
  ├── /generate                 # 生成界面
  ├── /brand-kits               # 品牌套件管理
  │   ├── /                     # 品牌列表
  │   └── /[id]                 # 品牌详情
  ├── /infographics             # 信息图生成
  └── /exports                  # 导出记录
```

---

## 使用指南

### 1. 生成基础图像

```bash
curl -X POST https://api.gens.team/api/v1/ai-image/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一只猫",
    "model": "imagen4",
    "enhancePrompt": true
  }'
```

### 2. 创建品牌套件

```bash
# 1. 创建品牌
curl -X POST https://api.gens.team/api/v1/ai-image/brand-kits \
  -d '{
    "name": "我的品牌",
    "primaryColor": "#3B82F6"
  }'

# 2. 使用品牌生成
curl -X POST https://api.gens.team/api/v1/ai-image/generate \
  -d '{
    "prompt": "产品海报",
    "brandKitId": "brand-xxx"
  }'
```

### 3. 生成信息图

```bash
curl -X POST https://api.gens.team/api/v1/ai-image/infographics \
  -d '{
    "type": "chart",
    "title": "月度收入",
    "data": {
      "labels": ["1月", "2月", "3月"],
      "values": [100, 150, 200]
    }
  }'
```

---

## 最佳实践

### 1. 提示词编写

**清晰具体**

- ❌ "猫"
- ✅ "一只橘色的猫咪坐在窗台上，阳光照射，专业摄影"

**关键词优化**

- 添加质量词: `8k`, `ultra detailed`, `professional photography`
- 添加风格词: `photorealistic`, `oil painting`, `minimalist`
- 添加光线词: `golden hour`, `soft lighting`, `dramatic shadows`

### 2. 品牌一致性

- 为每个项目创建独立的品牌套件
- 定期更新品牌配色和字体
- 使用品牌套件生成所有营销素材

### 3. 模型选择

| 模型             | 适用场景 | 优势         |
| ---------------- | -------- | ------------ |
| Imagen4          | 通用场景 | 高质量、快速 |
| Flux             | 艺术创作 | 创意性强     |
| Stable Diffusion | 批量生成 | 成本低       |
| DALL-E 3         | 文字渲染 | 文字清晰     |

---

## 相关文档

- [AI Engine ImageFactory](../../../architecture/ai-engine.md#image.factory)
- [Cloudinary 集成配置](../../../guides/storage-configuration.md)

---

## 更新日志

### v1.0 (2026-01-15)

- 初始版本发布
- 支持 Imagen4, Flux, Stable Diffusion, DALL-E 3
- 品牌套件管理
- 提示词自动增强
- 信息图生成
- 批量导出功能
