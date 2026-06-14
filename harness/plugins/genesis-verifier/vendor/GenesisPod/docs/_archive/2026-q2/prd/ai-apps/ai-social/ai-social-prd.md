# AI Social 模块 PRD v1.0

> 社交媒体内容创作与发布一体化平台

## 概述

### 模块定位

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Social                             │
│              "社交媒体内容创作与发布中心"                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  内容创作 ────────────────────────────────────────────────  │
│  │                                                          │
│  ├── 公众号文章编辑器 (参考秀米/135编辑器)                  │
│  │   └── 富文本排版、样式模板、封面图                       │
│  │                                                          │
│  └── 小红书图文编辑器 (参考Reditor/uplog)                   │
│      └── 封面图、正文、emoji排版、标签、违禁词检测          │
│                                                             │
│  内容导入 ────────────────────────────────────────────────  │
│  │                                                          │
│  ├── 从 AI Research 导入研究报告 → AI 自动转换              │
│  ├── 从 AI Office 导入文档 → AI 自动转换                    │
│  └── 从 AI Writing 导入章节 → AI 自动转换                   │
│                                                             │
│  发布管理 ────────────────────────────────────────────────  │
│  │                                                          │
│  ├── 渠道连接（微信公众号、小红书账号）                     │
│  ├── 定时发布 / 立即发布                                    │
│  └── 发布状态追踪                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 与其他模块的关系

| 模块           | 定位     | 与 AI Social 的关系                |
| -------------- | -------- | ---------------------------------- |
| **AI Explore** | 内容发现 | YouTube/Papers/Blog 等素材来源     |
| AI Research    | 深度研究 | 报告可导入 AI Social 转换发布      |
| AI Writing     | 小说写作 | 章节可导入 AI Social 转换发布      |
| AI Office      | 文档办公 | 文档可导入 AI Social 转换发布      |
| **AI Social**  | 社交媒体 | AI Engine 驱动的内容创作与发布中心 |

### 核心价值

- **AI Engine 驱动**：告诉 Leader 一个链接，自动完成转换、审核、发布全流程
- **多源素材**：从 AI Explore（YouTube/Papers/Blog）导入素材
- **智能转换**：AI 自动适配不同平台格式和风格
- **一键发布**：Playwright 自动化发布到各平台
- **审核机制**：违禁词检测 + 人工审核（可选）

### 访问权限

仅 `isAdmin` 用户可见和使用（MVP 阶段）。

---

## AI Engine 驱动架构

### 核心理念

AI Social 采用 **AI Engine（Leader Agent）驱动** 的设计模式。用户只需提供一个链接或选择一篇内容，Leader 就会自动完成从转换到发布的全流程。

### 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Social Leader                         │
│                  "社交媒体内容发布专家"                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入触发 ──────────────────────────────────────────────    │
│  │                                                          │
│  ├── 用户输入 URL（YouTube/Blog/Paper 链接）                │
│  ├── 用户选择 AI Explore 中的素材                           │
│  └── 用户选择 AI Research/Office/Writing 中的内容           │
│                                                             │
│       ↓                                                     │
│                                                             │
│  Leader 自动执行 ────────────────────────────────────────   │
│  │                                                          │
│  ├── 1. 内容获取                                            │
│  │   └── 解析链接 / 读取素材内容                            │
│  │                                                          │
│  ├── 2. 内容分析                                            │
│  │   ├── 理解内容主题和要点                                 │
│  │   └── 确定目标平台（公众号/小红书）                      │
│  │                                                          │
│  ├── 3. AI 转换                                             │
│  │   ├── 生成适配平台的标题                                 │
│  │   ├── 改写内容为平台风格                                 │
│  │   ├── 生成封面图建议                                     │
│  │   └── 生成话题标签（小红书）                             │
│  │                                                          │
│  ├── 4. 合规检测                                            │
│  │   ├── 违禁词检测                                         │
│  │   ├── 敏感内容检测                                       │
│  │   └── 自动修复或标记                                     │
│  │                                                          │
│  ├── 5. 人工审核（可配置）                                  │
│  │   ├── 自动发布模式：跳过审核直接发布                     │
│  │   └── 审核模式：等待用户确认后发布                       │
│  │                                                          │
│  └── 6. 自动发布                                            │
│      ├── 调用 Playwright 执行发布                           │
│      └── 记录发布结果和外链                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 使用方式

**方式 1：输入链接**

```
用户：帮我把这个 YouTube 视频发到小红书
      https://www.youtube.com/watch?v=xxxxx

Leader：
  ✓ 已获取视频内容和字幕
  ✓ 已提取核心观点（5条）
  ✓ 已生成小红书标题："AI 最新突破！5分钟看懂..."
  ✓ 违禁词检测通过
  → 是否确认发布？[预览] [编辑] [发布]
```

**方式 2：选择素材**

```
用户：把 AI Explore 里那篇 OpenAI 的论文发到公众号

Leader：
  ✓ 已读取论文内容
  ✓ 已生成深度解读文章（3000字）
  ✓ 已生成封面图建议
  ✓ 违禁词检测通过
  → 是否确认发布？[预览] [编辑] [发布]
```

**方式 3：全自动模式**

```
用户：开启自动发布，每天从 AI Explore 选一篇热门内容发到小红书

Leader：
  ✓ 已设置每日自动任务
  ✓ 筛选条件：热度 > 100, 类型 = BLOG | YOUTUBE_VIDEO
  ✓ 发布时间：每天 10:00
  → 自动发布已开启
```

---

## 素材来源

### AI Explore 素材库

AI Explore 中的 Resource 是 AI Social 的**核心素材来源**。

| 素材类型         | ResourceType    | 转换策略                       |
| ---------------- | --------------- | ------------------------------ |
| **YouTube 视频** | `YOUTUBE_VIDEO` | 提取字幕 → 总结要点 → 生成图文 |
| **学术论文**     | `PAPER`         | 提取摘要/结论 → 通俗化解读     |
| **技术博客**     | `BLOG`          | 提取核心观点 → 精简改写        |
| **新闻资讯**     | `NEWS`          | 提取要点 → 加入评论视角        |
| **行业报告**     | `REPORT`        | 提取数据和结论 → 可视化呈现    |
| **RSS 订阅**     | `RSS`           | 聚合多篇 → 生成周报/速览       |

### 其他素材来源

| 来源        | 数据模型                 | 导入内容             |
| ----------- | ------------------------ | -------------------- |
| AI Research | `TopicReport.fullReport` | 研究报告 Markdown    |
| AI Office   | `OfficeDocument.content` | 文档内容             |
| AI Writing  | `WritingChapter.content` | 小说章节             |
| 手动输入    | -                        | 用户粘贴的链接或文本 |

---

## 功能设计

### 1. 内容创作

#### 1.1 公众号文章编辑器

**参考产品**：[秀米](https://xiumi.us/)、[135编辑器](https://www.135editor.com/)、[壹伴](https://yiban.io/)

**核心功能**：

- 富文本编辑（标题、正文、引用、列表等）
- 样式模板库（一键套用排版风格）
- 封面图设置（上传/AI生成）
- 摘要编辑
- 预览模式（模拟公众号阅读效果）

**数据结构**：

```typescript
interface WechatArticle {
  id: string;
  title: string; // 标题（64字以内）
  author?: string; // 作者
  digest?: string; // 摘要（120字以内）
  content: string; // 正文 HTML
  coverImage?: string; // 封面图 URL
  templateId?: string; // 使用的样式模板
  sourceType: "ORIGINAL" | "IMPORTED"; // 原创/导入
  sourceId?: string; // 导入来源 ID
}
```

#### 1.2 小红书图文编辑器

**参考产品**：[Reditor红薯编辑器](https://reditorapp.com/)、[uplog](https://uplog.cc/)、[135小红书神器](https://www.135editor.com/ai_editor/red-book/home/)

**核心功能**：

- 封面图编辑（多图支持，最多9张）
- 正文编辑（支持 emoji 排版）
- 标签管理（话题标签 #xxx）
- 违禁词检测（AI 实时检测敏感词）
- 预览模式（模拟小红书卡片效果）

**数据结构**：

```typescript
interface XiaohongshuPost {
  id: string;
  title: string; // 标题（20字以内）
  content: string; // 正文（1000字以内）
  images: string[]; // 图片 URL 列表（最多9张）
  tags: string[]; // 话题标签
  location?: string; // 位置
  sourceType: "ORIGINAL" | "IMPORTED";
  sourceId?: string;
}
```

### 2. 内容导入与转换

#### 2.1 支持的导入来源

| 来源        | 数据模型                 | 导入内容          |
| ----------- | ------------------------ | ----------------- |
| AI Research | `TopicReport.fullReport` | 研究报告 Markdown |
| AI Office   | `OfficeDocument.content` | 文档内容          |
| AI Writing  | `WritingChapter.content` | 小说章节          |

#### 2.2 AI 转换策略

**研究报告 → 公众号文章**：

- 保留结构和深度
- 优化排版格式
- 生成摘要和封面建议

**研究报告 → 小红书图文**：

- 提取核心观点（3-5条）
- 精简为 1000 字以内
- 生成吸引眼球的标题
- 建议话题标签

**小说章节 → 小红书图文**：

- 提取精彩片段
- 添加悬念引导
- 生成"想看更多"的钩子

### 3. 发布管理

#### 3.1 渠道连接

**微信公众号**：

- 登录方式：扫码登录（Playwright 保存 Session）
- 账号信息：公众号名称、头像
- 状态检测：定期检查登录状态

**小红书**：

- 登录方式：扫码/手机验证码（Playwright 保存 Session）
- 账号信息：用户昵称、头像
- 状态检测：定期检查登录状态

#### 3.2 发布执行

**技术方案**：Playwright 浏览器自动化

```
┌─────────────────────────────────────────────────────────────┐
│                    Backend Service (NestJS)                  │
├─────────────────────────────────────────────────────────────┤
│  PublishScheduler (Bull Queue)                              │
│       │                                                     │
│       ▼                                                     │
│  PublishExecutor Service                                    │
│       │                                                     │
│       ├──→ WechatAdapter (Playwright)                       │
│       │    └── 打开公众号后台 → 新建图文 → 填写内容 → 发布  │
│       │                                                     │
│       └──→ XiaohongshuAdapter (Playwright)                  │
│            └── 打开创作者中心 → 发布笔记 → 填写内容 → 发布  │
│                                                             │
│  PlaywrightService                                          │
│       └── 浏览器实例管理、Session 持久化、截图调试          │
└─────────────────────────────────────────────────────────────┘
```

#### 3.3 发布状态

| 状态       | 说明             |
| ---------- | ---------------- |
| DRAFT      | 草稿，未提交发布 |
| PENDING    | 待发布，等待执行 |
| SCHEDULED  | 已排期，定时发布 |
| PUBLISHING | 发布中           |
| PUBLISHED  | 已发布成功       |
| FAILED     | 发布失败         |

---

## 数据模型

### Prisma Schema

```prisma
// ==================== AI Social ====================

enum SocialPlatformType {
  WECHAT_MP      // 微信公众号
  XIAOHONGSHU    // 小红书
}

enum SocialContentType {
  WECHAT_ARTICLE     // 公众号文章
  XIAOHONGSHU_POST   // 小红书图文
}

enum SocialContentStatus {
  DRAFT          // 草稿
  PENDING        // 待发布
  SCHEDULED      // 已排期
  PUBLISHING     // 发布中
  PUBLISHED      // 已发布
  FAILED         // 发布失败
}

enum SocialContentSourceType {
  ORIGINAL           // 原创
  EXPLORE_RESOURCE   // 从 AI Explore 导入（YouTube/Paper/Blog 等）
  RESEARCH_REPORT    // 从 AI Research 导入
  OFFICE_DOCUMENT    // 从 AI Office 导入
  WRITING_CHAPTER    // 从 AI Writing 导入
  EXTERNAL_URL       // 外部链接（用户输入）
}

/// 平台账号连接
model SocialPlatformConnection {
  id           String             @id @default(uuid())
  userId       String             @map("user_id")
  platformType SocialPlatformType @map("platform_type")

  // 账号信息
  accountName  String?            @map("account_name")  // 账号名称/昵称
  accountId    String?            @map("account_id")    // 平台账号 ID
  avatarUrl    String?            @map("avatar_url")    // 头像

  // Session 存储（加密）
  sessionData  String?            @map("session_data") @db.Text

  // 状态
  isActive     Boolean            @default(true) @map("is_active")
  lastCheckAt  DateTime?          @map("last_check_at")
  expiresAt    DateTime?          @map("expires_at")

  // 时间戳
  createdAt    DateTime           @default(now()) @map("created_at")
  updatedAt    DateTime           @updatedAt @map("updated_at")

  // 关系
  user         User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  contents     SocialContent[]

  @@unique([userId, platformType])
  @@index([userId])
  @@map("social_platform_connections")
}

/// 社交媒体内容
model SocialContent {
  id              String                   @id @default(uuid())
  userId          String                   @map("user_id")
  connectionId    String?                  @map("connection_id")

  // 内容类型
  contentType     SocialContentType        @map("content_type")
  status          SocialContentStatus      @default(DRAFT)

  // 内容来源
  sourceType      SocialContentSourceType  @map("source_type")
  sourceId        String?                  @map("source_id")  // 来源内容 ID（Resource/TopicReport/OfficeDocument 等）
  sourceUrl       String?                  @map("source_url") @db.Text  // 外部链接

  // 通用字段
  title           String                   @db.VarChar(200)
  content         String                   @db.Text           // 正文内容

  // 公众号文章专用
  author          String?                  @db.VarChar(50)
  digest          String?                  @db.VarChar(200)   // 摘要
  coverImageUrl   String?                  @map("cover_image_url")

  // 小红书专用
  images          Json                     @default("[]")     // 图片 URL 数组
  tags            Json                     @default("[]")     // 话题标签数组
  location        String?                  @db.VarChar(100)

  // AI Engine 处理记录
  aiProcessLog    Json?                    @map("ai_process_log")  // Leader 处理日志
  aiSuggestions   Json?                    @map("ai_suggestions")  // AI 建议（封面、标签等）

  // 审核相关
  reviewStatus    String?                  @map("review_status")   // PENDING | APPROVED | REJECTED
  reviewedAt      DateTime?                @map("reviewed_at")
  reviewNote      String?                  @map("review_note") @db.Text
  complianceCheck Json?                    @map("compliance_check")  // 违禁词检测结果

  // 发布配置
  scheduledAt     DateTime?                @map("scheduled_at")
  publishedAt     DateTime?                @map("published_at")
  autoPublish     Boolean                  @default(false) @map("auto_publish")  // 是否自动发布

  // 发布结果
  externalUrl     String?                  @map("external_url")  // 发布后的链接
  externalId      String?                  @map("external_id")   // 平台内容 ID

  // 错误处理
  errorMessage    String?                  @map("error_message") @db.Text
  retryCount      Int                      @default(0) @map("retry_count")

  // 时间戳
  createdAt       DateTime                 @default(now()) @map("created_at")
  updatedAt       DateTime                 @updatedAt @map("updated_at")

  // 关系
  user            User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  connection      SocialPlatformConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)

  @@index([userId, status])
  @@index([status, scheduledAt])
  @@index([contentType])
  @@index([reviewStatus])
  @@map("social_contents")
}
```

---

## API 设计

### 端点列表

| Method        | Endpoint                                     | 描述                         |
| ------------- | -------------------------------------------- | ---------------------------- |
| **平台连接**  |
| GET           | `/api/v1/ai-social/connections`              | 获取用户的平台连接列表       |
| POST          | `/api/v1/ai-social/connections/:type/init`   | 初始化平台连接（获取二维码） |
| POST          | `/api/v1/ai-social/connections/:type/verify` | 验证连接状态                 |
| DELETE        | `/api/v1/ai-social/connections/:type`        | 断开平台连接                 |
| **内容管理**  |
| GET           | `/api/v1/ai-social/contents`                 | 获取内容列表                 |
| POST          | `/api/v1/ai-social/contents`                 | 创建内容（原创）             |
| POST          | `/api/v1/ai-social/contents/import`          | 导入并转换内容               |
| GET           | `/api/v1/ai-social/contents/:id`             | 获取内容详情                 |
| PATCH         | `/api/v1/ai-social/contents/:id`             | 更新内容                     |
| DELETE        | `/api/v1/ai-social/contents/:id`             | 删除内容                     |
| **内容检测**  |
| POST          | `/api/v1/ai-social/contents/:id/check`       | 违禁词检测                   |
| **发布管理**  |
| POST          | `/api/v1/ai-social/contents/:id/publish`     | 立即发布                     |
| POST          | `/api/v1/ai-social/contents/:id/schedule`    | 定时发布                     |
| POST          | `/api/v1/ai-social/contents/:id/cancel`      | 取消发布                     |
| **导入来源**  |
| GET           | `/api/v1/ai-social/sources/explore`          | 获取 AI Explore 素材列表     |
| GET           | `/api/v1/ai-social/sources/research`         | 获取可导入的研究报告列表     |
| GET           | `/api/v1/ai-social/sources/office`           | 获取可导入的文档列表         |
| GET           | `/api/v1/ai-social/sources/writing`          | 获取可导入的章节列表         |
| **AI Engine** |
| POST          | `/api/v1/ai-social/ai/process-url`           | AI 处理外部链接              |
| POST          | `/api/v1/ai-social/ai/process-source`        | AI 处理选定素材              |
| POST          | `/api/v1/ai-social/ai/regenerate/:id`        | AI 重新生成内容              |
| **审核管理**  |
| GET           | `/api/v1/ai-social/contents/pending-review`  | 获取待审核内容列表           |
| POST          | `/api/v1/ai-social/contents/:id/approve`     | 审核通过                     |
| POST          | `/api/v1/ai-social/contents/:id/reject`      | 审核拒绝                     |

### 请求/响应示例

#### 创建公众号文章

```typescript
// POST /api/v1/ai-social/contents
{
  "contentType": "WECHAT_ARTICLE",
  "sourceType": "ORIGINAL",
  "title": "2024年AI发展趋势深度分析",
  "content": "<p>正文内容...</p>",
  "author": "Genesis",
  "digest": "本文深入分析了2024年AI领域的关键发展趋势...",
  "coverImageUrl": "https://..."
}
```

#### 导入研究报告并转换

```typescript
// POST /api/v1/ai-social/contents/import
{
  "sourceType": "RESEARCH_REPORT",
  "sourceId": "topic-report-uuid",
  "targetType": "XIAOHONGSHU_POST"  // 转换为小红书图文
}

// Response
{
  "id": "content-uuid",
  "contentType": "XIAOHONGSHU_POST",
  "status": "DRAFT",
  "title": "AI趋势速览",  // AI 生成的精简标题
  "content": "核心观点1...\n核心观点2...",  // AI 提炼的内容
  "tags": ["AI", "人工智能", "科技趋势"],  // AI 建议的标签
  "suggestions": [
    "标题已优化为小红书风格",
    "内容已精简至800字",
    "建议添加3-5张配图"
  ]
}
```

#### AI 处理外部链接

```typescript
// POST /api/v1/ai-social/ai/process-url
{
  "url": "https://www.youtube.com/watch?v=xxxxx",
  "targetPlatform": "XIAOHONGSHU",  // 目标平台
  "autoPublish": false              // 是否自动发布
}

// Response
{
  "id": "content-uuid",
  "contentType": "XIAOHONGSHU_POST",
  "status": "PENDING_REVIEW",
  "sourceType": "EXTERNAL_URL",
  "sourceUrl": "https://www.youtube.com/watch?v=xxxxx",
  "title": "AI 最新突破！5分钟看懂 GPT-5",
  "content": "1. 核心观点一...\n2. 核心观点二...",
  "tags": ["AI", "GPT5", "科技"],
  "aiProcessLog": {
    "steps": [
      { "step": "fetch_content", "status": "success", "message": "已获取视频字幕" },
      { "step": "analyze", "status": "success", "message": "已分析内容主题" },
      { "step": "transform", "status": "success", "message": "已生成小红书格式内容" },
      { "step": "compliance_check", "status": "success", "message": "违禁词检测通过" }
    ]
  },
  "aiSuggestions": {
    "coverImages": ["建议使用视频截图作为封面"],
    "tags": ["AI", "GPT5", "科技", "人工智能"],
    "improvements": ["可以添加更多 emoji 增加阅读体验"]
  },
  "complianceCheck": {
    "passed": true,
    "issues": []
  }
}
```

#### AI 处理 Explore 素材

```typescript
// POST /api/v1/ai-social/ai/process-source
{
  "sourceType": "EXPLORE_RESOURCE",
  "sourceId": "resource-uuid",       // AI Explore 中的 Resource ID
  "targetPlatform": "WECHAT_MP",
  "autoPublish": false
}

// Response
{
  "id": "content-uuid",
  "contentType": "WECHAT_ARTICLE",
  "status": "PENDING_REVIEW",
  "title": "深度解读：OpenAI 最新论文揭示的 AI 未来",
  "content": "<p>引言...</p><h2>核心发现</h2>...",
  "digest": "本文深入解读 OpenAI 最新研究成果...",
  "aiProcessLog": { ... },
  "aiSuggestions": { ... }
}
```

---

## 文件结构

### 后端 (NestJS)

```
backend/src/modules/ai-app/social/
├── ai-social.module.ts
├── ai-social.controller.ts
├── ai-social.service.ts
├── dto/
│   ├── index.ts
│   ├── create-content.dto.ts
│   ├── update-content.dto.ts
│   ├── import-content.dto.ts
│   ├── process-url.dto.ts              # AI 处理链接
│   ├── process-source.dto.ts           # AI 处理素材
│   └── publish-content.dto.ts
├── services/
│   ├── social-leader.service.ts        # AI Leader Agent（核心）
│   ├── content-fetcher.service.ts      # 内容获取（URL解析、素材读取）
│   ├── content-transformer.service.ts  # AI 内容转换
│   ├── content-checker.service.ts      # 违禁词检测
│   ├── review.service.ts               # 审核管理
│   ├── publish-executor.service.ts     # 发布执行调度
│   ├── publish-scheduler.service.ts    # 定时任务管理
│   └── playwright.service.ts           # Playwright 浏览器控制
├── adapters/
│   ├── base-platform.adapter.ts        # 抽象基类
│   ├── wechat.adapter.ts               # 微信公众号适配器
│   └── xiaohongshu.adapter.ts          # 小红书适配器
├── fetchers/                           # 内容获取器
│   ├── base-fetcher.ts
│   ├── youtube-fetcher.ts              # YouTube 视频/字幕获取
│   ├── web-fetcher.ts                  # 通用网页内容获取
│   └── resource-fetcher.ts             # AI Explore Resource 获取
└── interfaces/
    ├── social.interface.ts
    ├── leader.interface.ts             # Leader Agent 接口
    └── platform-adapter.interface.ts
```

### 前端 (Next.js)

```
frontend/
├── app/ai-social/
│   ├── page.tsx                        # 主页面（内容列表）
│   ├── create/page.tsx                 # 创建内容页
│   ├── [id]/page.tsx                   # 内容详情/编辑页
│   └── connections/page.tsx            # 平台连接管理页
├── components/ai-social/
│   ├── index.ts
│   ├── ContentList.tsx                 # 内容列表
│   ├── ContentCard.tsx                 # 内容卡片
│   ├── WechatEditor.tsx                # 公众号文章编辑器
│   ├── XiaohongshuEditor.tsx           # 小红书图文编辑器
│   ├── ContentImporter.tsx             # 内容导入组件
│   ├── PlatformConnectionCard.tsx      # 平台连接卡片
│   ├── PublishDialog.tsx               # 发布确认弹窗
│   └── ContentPreview.tsx              # 内容预览
└── hooks/domain/
    └── useAISocial.ts                  # API hooks
```

---

## UI 设计

### 主页面布局

```
┌─────────────────────────────────────────────────────────────┐
│  AI Social                              [创建内容 ▼] [设置] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  平台连接                                                    │
│  ┌──────────────────────┐ ┌──────────────────────┐          │
│  │  微信公众号          │ │  小红书              │          │
│  │  ✓ Genesis官方号   │ │  ○ 未连接            │          │
│  │  [管理]              │ │  [连接]              │          │
│  └──────────────────────┘ └──────────────────────┘          │
│                                                             │
│  我的内容                    筛选: [全部▼] [公众号▼] [小红书▼]│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ [图] AI趋势分析        公众号文章   已发布   1-15 10:00 ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ [图] 科技速递          小红书图文   已排期   1-20 10:00 ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ [图] 研究笔记          公众号文章   草稿     -          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 创建内容流程

```
1. 选择内容类型
   ├── 公众号文章
   └── 小红书图文

2. 选择创建方式
   ├── 原创（打开对应编辑器）
   └── 导入（选择来源 → AI 转换）

3. 编辑内容
   └── 使用专业编辑器编辑

4. 预览检查
   ├── 预览效果
   └── 违禁词检测

5. 发布设置
   ├── 选择发布账号
   ├── 立即发布 / 定时发布
   └── 确认发布
```

---

## i18n 翻译

### zh.json

```json
{
  "nav": {
    "aiSocial": "AI 社媒"
  },
  "aiSocial": {
    "title": "AI Social",
    "subtitle": "社交媒体内容创作与发布",
    "createContent": "创建内容",
    "connections": "平台连接",
    "myContents": "我的内容",
    "contentType": {
      "wechatArticle": "公众号文章",
      "xiaohongshuPost": "小红书图文"
    },
    "sourceType": {
      "original": "原创",
      "researchReport": "从研究报告导入",
      "officeDocument": "从文档导入",
      "writingChapter": "从小说章节导入"
    },
    "status": {
      "draft": "草稿",
      "pending": "待发布",
      "scheduled": "已排期",
      "publishing": "发布中",
      "published": "已发布",
      "failed": "发布失败"
    },
    "platform": {
      "wechatMp": "微信公众号",
      "xiaohongshu": "小红书"
    },
    "editor": {
      "title": "标题",
      "content": "正文",
      "coverImage": "封面图",
      "digest": "摘要",
      "author": "作者",
      "tags": "话题标签",
      "images": "图片",
      "preview": "预览",
      "checkContent": "内容检测"
    },
    "publish": {
      "now": "立即发布",
      "schedule": "定时发布",
      "selectAccount": "选择发布账号",
      "confirm": "确认发布"
    },
    "import": {
      "title": "导入内容",
      "selectSource": "选择来源",
      "transform": "AI 转换",
      "transforming": "正在转换..."
    }
  }
}
```

### en.json

```json
{
  "nav": {
    "aiSocial": "AI Social"
  },
  "aiSocial": {
    "title": "AI Social",
    "subtitle": "Social media content creation and publishing",
    "createContent": "Create Content",
    "connections": "Platform Connections",
    "myContents": "My Contents",
    "contentType": {
      "wechatArticle": "WeChat Article",
      "xiaohongshuPost": "Xiaohongshu Post"
    },
    "sourceType": {
      "original": "Original",
      "researchReport": "Import from Research Report",
      "officeDocument": "Import from Document",
      "writingChapter": "Import from Novel Chapter"
    },
    "status": {
      "draft": "Draft",
      "pending": "Pending",
      "scheduled": "Scheduled",
      "publishing": "Publishing",
      "published": "Published",
      "failed": "Failed"
    },
    "platform": {
      "wechatMp": "WeChat Official Account",
      "xiaohongshu": "Xiaohongshu"
    },
    "editor": {
      "title": "Title",
      "content": "Content",
      "coverImage": "Cover Image",
      "digest": "Digest",
      "author": "Author",
      "tags": "Tags",
      "images": "Images",
      "preview": "Preview",
      "checkContent": "Check Content"
    },
    "publish": {
      "now": "Publish Now",
      "schedule": "Schedule",
      "selectAccount": "Select Account",
      "confirm": "Confirm Publish"
    },
    "import": {
      "title": "Import Content",
      "selectSource": "Select Source",
      "transform": "AI Transform",
      "transforming": "Transforming..."
    }
  }
}
```

---

## 实施步骤

### 阶段 1: 基础设置

1. 重命名"我的团队"为"自建团队"（i18n）
2. 添加 Prisma 数据模型，执行迁移
3. 创建后端模块骨架
4. 注册模块到 app.module.ts
5. 安装 `playwright-core` 依赖

### 阶段 2: 前端页面

6. 创建 /ai-social 路由和主页面
7. 添加侧边栏导航入口
8. 添加 i18n 翻译
9. 创建平台连接管理组件

### 阶段 3: 内容编辑器

10. 实现公众号文章编辑器（基础版）
11. 实现小红书图文编辑器（基础版）
12. 实现内容预览组件

### 阶段 4: 导入与转换

13. 实现 ContentTransformerService（AI 转换）
14. 实现内容导入 API
15. 实现违禁词检测服务

### 阶段 5: 发布功能

16. 实现 PlaywrightService（浏览器管理）
17. 实现微信公众号 Adapter（Playwright）
18. 实现小红书 Adapter（Playwright）
19. 实现 PublishExecutorService
20. 实现 PublishSchedulerService（定时任务）

### 阶段 6: 测试与部署

21. 配置 Railway/Docker Playwright 环境
22. 端到端测试
23. 上线发布

---

## 验证清单

- [ ] `npm run type-check` 类型检查通过
- [ ] `npx prisma migrate dev` 数据库迁移成功
- [ ] `npm run dev` 启动正常
- [ ] 管理员登录可见"AI 社媒"菜单
- [ ] 非管理员登录不可见"AI 社媒"菜单
- [ ] /ai-social 页面正常渲染
- [ ] 平台连接功能正常（扫码登录）
- [ ] 公众号文章编辑器正常工作
- [ ] 小红书图文编辑器正常工作
- [ ] 内容导入和 AI 转换正常
- [ ] 违禁词检测正常
- [ ] 发布到微信公众号成功
- [ ] 发布到小红书成功

---

## 参考资料

### 公众号排版工具

- [秀米](https://xiumi.us/) - 布局概念、H5制作
- [135编辑器](https://www.135editor.com/) - 10w+ 素材、AI功能
- [壹伴](https://yiban.io/) - 嵌入公众号后台

### 小红书编辑工具

- [Reditor红薯编辑器](https://reditorapp.com/) - AI文案、违禁词检测
- [uplog](https://uplog.cc/) - 智能排版、行业模板
- [135小红书神器](https://www.135editor.com/ai_editor/red-book/home/) - AI生成

### 多平台发布工具

- [新榜小豆芽](https://www.newrank.cn/) - 一键分发
- [蚁小二](https://www.yixiaoer.cn/) - 智能创作+分发

---

**版本**: v1.0
**创建日期**: 2025-01-18
**状态**: 待实施
