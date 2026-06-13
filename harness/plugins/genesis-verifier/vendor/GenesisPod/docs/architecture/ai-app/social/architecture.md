# AI Social 架构文档

> 版本: 1.0
> 更新时间: 2026-02-01
> 模块路径: `backend/src/modules/ai-app/social/`

## 概述

AI Social 是企业级社交媒体内容分发平台，提供跨平台发布、内容转换、会话管理等核心能力。支持微信公众号和小红书，采用可扩展的适配器模式。

### 核心特性

- 跨平台发布（微信公众号、小红书）
- AI 驱动的内容转换（支持双语）
- 浏览器自动化（Playwright headless）
- 会话加密存储和健康检查
- 平台适配版本管理
- 内容合规检测
- 人工审核工作流
- YouTube 字幕提取和双语支持

## 核心组件

### 主服务层

#### AiSocialService

**职责**: 主门面服务，协调所有子服务
**位置**: `ai-social.service.ts`
**核心功能**:

- 平台连接管理（初始化、验证、删除、测试）
- 内容 CRUD 操作
- 内容合规检测
- 发布任务调度
- 批量操作（批量删除、批量发布）
- 导入来源管理（Explore/Research/Office/Writing）

#### SocialLeaderService

**职责**: AI 内容策略和转换协调
**位置**: `services/social-leader.service.ts`
**核心功能**:

- 处理外部 URL（`processUrl`）
- 处理内部来源（`processSource`）
- 内容重新生成（`regenerateContent`）
- 字符串清理和数据库兼容性处理
- 数据库重试机制（防止瞬态错误）

### 内容处理层

#### ContentFetcherService

**职责**: 多源内容获取
**位置**: `services/content-fetcher.service.ts`
**支持来源**:

- 外部 URL（通过 Jina/Firecrawl）
- YouTube 视频（字幕提取，双语支持）
- AI Explore 资源
- AI Research 报告
- AI Office 文档
- AI Writing 章节

**安全特性**:

- SSRF 防护（阻止内网 IP）
- URL 格式和长度验证
- 协议限制（仅 HTTP/HTTPS）

#### ContentTransformerService

**职责**: AI 内容格式转换
**位置**: `services/content-transformer.service.ts`
**转换能力**:

- 微信公众号文章格式（1500-5000 字，HTML 样式）
- 小红书笔记格式（口语化，表情符号，话题标签）
- 双语内容处理（中英对照格式）
- 自动生成标题、摘要、标签

**双语格式支持**:

- 双语段落（中文 + 英文斜体）
- 双语小标题
- 双语要点卡片
- 双语引用块

#### ContentCheckerService

**职责**: 内容合规检测
**位置**: `services/content-checker.service.ts`
**检测内容**:

- 敏感词过滤
- 合规性评分
- 违规问题列表
- 修改建议

#### ContentVersionService

**职责**: 平台适配版本管理
**位置**: `services/content-version.service.ts`
**功能**:

- 生成平台特定版本（`generateVersion`）
- 生成所有平台版本（`generateAllVersions`）
- 版本 CRUD 操作
- 发布时版本选择（`getVersionForPublish`）

### 发布执行层

#### PublishExecutorService

**职责**: 发布任务执行
**位置**: `services/publish-executor.service.ts`
**核心流程**:

1. 验证内容和连接
2. 检查会话有效性（自动查找活跃连接）
3. 获取平台适配版本
4. 调用适配器发布
5. 更新发布状态
6. 记录发布日志

#### PlaywrightService

**职责**: 浏览器自动化
**位置**: `services/playwright.service.ts`
**功能**:

- 浏览器上下文管理
- 页面创建和导航
- 会话恢复（Cookies + LocalStorage）
- 登录会话管理
- 截图和调试

#### SessionHealthCheckScheduler

**职责**: 定时会话健康检查
**位置**: `services/session-health-check.scheduler.ts`
**功能**:

- 定期验证会话有效性
- 更新 `isActive` 状态
- 会话过期通知

### 平台适配器层

#### WechatAdapter

**职责**: 微信公众号发布
**位置**: `adapters/wechat.adapter.ts`
**核心流程**:

1. 解密并恢复会话（cookies）
2. 访问公众号后台并验证登录
3. 获取 token（优先使用保存的 `wechatToken`）
4. 通过点击或直接导航进入编辑器
5. 填充标题、正文、摘要
6. 保存为草稿
7. 返回草稿链接

**特性**:

- 支持多种文章类型（普通图文 type=10，小绿书 type=77）
- HTML 内容智能填充（execCommand/paste/innerHTML）
- 多重登录状态检测
- 详细调试信息捕获

#### XiaohongshuAdapter

**职责**: 小红书发布
**位置**: `adapters/xiaohongshu.adapter.ts`
**核心流程**:

1. 恢复会话
2. 访问创作者中心
3. 选择发布类型（图文/视频）
4. 上传图片（TODO）
5. 填充标题、正文、标签、位置
6. 保存草稿或发布

### 审核工作流

#### ReviewService

**职责**: 人工审核管理
**位置**: `services/review.service.ts`
**功能**:

- 获取待审核内容
- 批准内容（`approveContent`）
- 拒绝内容（`rejectContent`）
- 重新提交审核（`resubmitForReview`）

## 关键流程

### 平台连接流程（二维码登录）

```
用户发起连接
  ↓
PlaywrightService 启动浏览器
  ↓
导航到登录页
  ↓
等待二维码加载并截图
  ↓
前端轮询验证（initConnection → verifyConnection）
  ↓
用户扫码确认
  ↓
PlaywrightService 检测登录成功
  ↓
提取 sessionData（cookies + localStorage + wechatToken）
  ↓
加密会话数据（AES-256-CBC）
  ↓
存储到数据库（SocialPlatformConnection）
  ↓
清理登录会话
```

### 内容发布流程

```
用户选择内容并发布
  ↓
AiSocialService.publishContent
  ↓
验证内容和连接
  ↓
更新状态为 PENDING
  ↓
PublishExecutorService.execute
  ↓
检查连接会话有效性（hasValidSession）
  │  └─ 无效 → 查找用户活跃连接 → 更新关联
  ↓
获取平台适配版本（ContentVersionService）
  ↓
调用平台适配器（WechatAdapter/XiaohongshuAdapter）
  │  ├─ 解密会话数据
  │  ├─ 恢复浏览器会话
  │  ├─ 填充内容
  │  └─ 保存草稿
  ↓
更新发布结果（PUBLISHED/FAILED）
  ↓
记录发布日志（SocialPublishLog）
```

### Session 验证流程

```
定时任务触发（SessionHealthCheckScheduler）
  ↓
遍历所有平台连接
  ↓
解密 sessionData
  ↓
PlaywrightService 恢复会话
  ↓
创建页面并访问平台
  ↓
平台特定验证：
  ├─ 微信：检查 URL、页面元素、登录表单
  └─ 小红书：检查 URL、用户头像、发布容器
  ↓
更新 isActive 状态
  ↓
会话过期 → 发送通知
```

### 内容转换流程（支持双语）

```
用户导入来源（URL/内部资源）
  ↓
ContentFetcherService 获取内容
  │  ├─ YouTube → 提取字幕（原文 + 翻译）
  │  ├─ URL → Jina/Firecrawl 提取
  │  └─ 内部资源 → 数据库查询
  ↓
检测是否双语内容（isBilingual）
  ↓
ContentTransformerService 转换
  │  ├─ 构建双语 prompt（原文 + 翻译）
  │  ├─ AI 生成平台格式（中英对照 HTML）
  │  └─ 解析返回的 JSON（title/content/digest/tags）
  ↓
ContentCheckerService 合规检测
  ↓
创建内容记录（SocialContent）
  │  └─ 字符串清理（sanitizeString）
  ↓
ContentVersionService 生成平台版本
  │  ├─ 微信公众号版本（1500-5000 字）
  │  └─ 小红书版本（1000 字 + 话题标签）
  ↓
返回结果 + 版本数量
```

## 数据模型

### SocialPlatformConnection（平台连接）

```typescript
{
  id: string;
  userId: string;
  platformType: "WECHAT_MP" | "XIAOHONGSHU";
  accountName: string ? accountId : string ? sessionData : string; // 加密存储（AES-256-CBC）
  isActive: boolean;
  lastCheckAt: Date ? expiresAt : Date ? createdAt : Date;
  updatedAt: Date;
}
```

### SocialContent（社交内容）

```typescript
{
  id: string
  userId: string
  connectionId: string?
  contentType: "WECHAT_ARTICLE" | "XIAOHONGSHU_NOTE"
  sourceType: "MANUAL" | "EXTERNAL_URL" | "AI_EXPLORE" | ...
  sourceId: string?
  sourceUrl: string?
  title: string  // 必填
  content: string
  author: string?
  digest: string?
  coverImageUrl: string?
  images: string[]
  tags: string[]
  location: string?
  status: "DRAFT" | "PENDING" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED"
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | "REVISION_REQUESTED"
  reviewedById: string?
  reviewedAt: Date?
  reviewNote: string?
  complianceCheck: JSON
  scheduledAt: Date?
  publishedAt: Date?
  autoPublish: boolean
  externalId: string?
  externalUrl: string?
  errorMessage: string?
  retryCount: number
  createdAt: Date
  updatedAt: Date
}
```

### SocialContentVersion（平台版本）

```typescript
{
  id: string;
  contentId: string;
  platformType: "WECHAT_MP" | "XIAOHONGSHU";
  title: string;
  content: string;
  digest: string ? isDefault : boolean;
  generatedBy: "AI" | "MANUAL";
  createdAt: Date;
  updatedAt: Date;
}
```

### SocialPublishLog（发布日志）

```typescript
{
  id: string;
  contentId: string;
  action: "PUBLISH" | "SCHEDULE" | "CANCEL";
  status: "SUCCESS" | "FAILED" | "PENDING";
  details: JSON;
  errorMessage: string ? createdAt : Date;
}
```

### SessionData（会话数据 - 内存类型）

```typescript
{
  cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite?: "Strict" | "Lax" | "None"
  }>
  localStorage?: Record<string, string>
  sessionStorage?: Record<string, string>
  wechatToken?: string  // 微信公众号专用
}
```

## 文件结构

```
social/
├── ai-social.module.ts           # NestJS 模块定义
├── ai-social.service.ts          # 主门面服务
├── ai-social.controller.ts       # REST API 控制器
│
├── services/                     # 业务服务层
│   ├── social-leader.service.ts  # AI 内容策略
│   ├── content-fetcher.service.ts    # 内容获取
│   ├── content-transformer.service.ts # AI 转换
│   ├── content-checker.service.ts    # 合规检测
│   ├── content-version.service.ts    # 版本管理
│   ├── review.service.ts             # 审核工作流
│   ├── publish-executor.service.ts   # 发布执行
│   ├── playwright.service.ts         # 浏览器自动化
│   └── session-health-check.scheduler.ts # 会话检查
│
├── adapters/                     # 平台适配器
│   ├── wechat.adapter.ts         # 微信公众号
│   ├── xiaohongshu.adapter.ts    # 小红书
│   ├── wechat/                   # 微信专用组件（MCP）
│   │   ├── index.ts
│   │   └── wechat-publisher.service.ts
│   └── xiaohongshu/              # 小红书专用组件（MCP）
│       ├── index.ts
│       └── xhs-mcp.adapter.ts
│
├── core/                         # MCP 核心服务（未启用）
│   ├── mcp-client.service.ts     # MCP 客户端
│   ├── publish-queue.service.ts  # 发布队列
│   ├── rate-limiter.service.ts   # 频率限制
│   └── session-manager.service.ts # 会话管理器
│
├── config/                       # 配置文件
│   ├── platforms.config.ts       # 平台配置
│   ├── selectors.config.ts       # DOM 选择器
│   └── platform-limits.config.ts # 平台限制
│
├── utils/                        # 工具函数
│   ├── session-crypto.ts         # 会话加密/解密
│   ├── url-validator.ts          # URL 验证（SSRF 防护）
│   └── log-sanitizer.ts          # 日志清理
│
├── dto/                          # 数据传输对象
│   ├── create-content.dto.ts
│   ├── update-content.dto.ts
│   ├── publish-content.dto.ts
│   ├── process-url.dto.ts
│   ├── process-source.dto.ts
│   ├── batch-operation.dto.ts
│   └── content-version.dto.ts
│
└── types/                        # 类型定义
    ├── index.ts                  # 枚举和数据模型
    └── platform.types.ts         # 平台适配器类型
```

## 技术特性

### 安全特性

1. **会话加密**: AES-256-CBC 加密存储 cookies（`utils/session-crypto.ts`）
2. **SSRF 防护**: URL 验证阻止内网 IP 访问（`utils/url-validator.ts`）
3. **SQL 注入防护**: 使用 Prisma 参数化查询和 `$queryRaw` 安全模板
4. **字符串清理**: 移除 null 字节、控制字符、非法 Unicode（`sanitizeString`）

### 数据库兼容性

- **字符编码处理**: UTF-8 验证和清理（防止 PostgreSQL 协议错误 08P01）
- **重试机制**: 瞬态数据库错误自动重试（指数退避）
- **直接 SQL**: 对于 `text[]` 列使用 `$queryRaw` 绕过 Prisma ORM 类型不匹配

### 双语内容支持

- YouTube 字幕自动翻译（中英双语）
- 双语格式模板（HTML 样式）
- 关键术语中英对照
- AI 生成双语内容（原文 + 翻译）

### 浏览器自动化

- Playwright headless 模式
- 会话持久化（Cookies + LocalStorage）
- 多种元素定位策略（role/placeholder/selector）
- 智能内容填充（execCommand/paste/innerHTML/keyboard）
- 详细调试信息（截图/日志/页面状态）

## API 端点

### 平台连接管理

- `POST /ai-social/connections/:type/init` - 初始化连接（获取二维码）
- `POST /ai-social/connections/:type/verify` - 验证连接（轮询扫码状态）
- `DELETE /ai-social/connections/:type` - 删除连接
- `POST /ai-social/connections/:id/test` - 测试连接
- `POST /ai-social/connections/:id/refresh` - 刷新连接

### 内容管理

- `GET /ai-social/contents` - 获取内容列表（分页/筛选）
- `POST /ai-social/contents` - 创建内容
- `GET /ai-social/contents/:id` - 获取内容详情
- `PATCH /ai-social/contents/:id` - 更新内容
- `DELETE /ai-social/contents/:id` - 删除内容

### 平台版本管理

- `GET /ai-social/contents/:id/versions` - 获取版本列表
- `POST /ai-social/contents/:id/versions/generate` - 生成单平台版本
- `POST /ai-social/contents/:id/versions/generate-all` - 生成所有平台版本
- `PATCH /ai-social/contents/:id/versions/:platform` - 更新版本
- `DELETE /ai-social/contents/:id/versions/:platform` - 删除版本

### 批量操作

- `POST /ai-social/contents/batch-delete` - 批量删除
- `POST /ai-social/contents/batch-publish` - 批量发布

### 内容检测和发布

- `POST /ai-social/contents/:id/check` - 合规检测
- `POST /ai-social/contents/:id/publish` - 发布内容
- `POST /ai-social/contents/:id/schedule` - 定时发布
- `POST /ai-social/contents/:id/cancel` - 取消发布
- `GET /ai-social/contents/:id/logs` - 获取发布日志

### AI 引擎

- `POST /ai-social/ai/process-url` - 处理外部 URL
- `POST /ai-social/ai/process-source` - 处理内部来源
- `POST /ai-social/ai/regenerate/:id` - 重新生成内容

### 审核管理

- `GET /ai-social/contents/pending-review` - 获取待审核内容
- `POST /ai-social/contents/:id/approve` - 批准内容
- `POST /ai-social/contents/:id/reject` - 拒绝内容
- `POST /ai-social/contents/:id/resubmit` - 重新提交审核

### 导入来源

- `GET /ai-social/sources/explore` - AI Explore 资源
- `GET /ai-social/sources/research` - AI Research 报告
- `GET /ai-social/sources/office` - AI Office 文档
- `GET /ai-social/sources/writing` - AI Writing 章节

## 依赖模块

- **PrismaModule**: 数据库访问
- **AiEngineModule**: AI 对话和 Task Profile
- **ExploreModule**: YouTube 字幕服务
- **NotificationModule**: 会话过期通知
- **CreditsModule**: AI 调用计费

## 扩展性设计

### 新增平台适配器

1. 实现 `IPlatformAdapter` 接口（`types/platform.types.ts`）
2. 创建适配器类（如 `TikTokAdapter`）
3. 在 `PublishExecutorService` 添加 switch case
4. 在 `SocialPlatformType` 枚举添加平台类型
5. 运行 Prisma 迁移

### MCP 集成（未启用）

`core/` 目录包含 MCP（Model Context Protocol）支持：

- MCPClientService: 管理外部 MCP 服务器
- PublishQueueService: 异步发布队列
- RateLimiterService: 平台频率限制
- SessionManagerService: 集中会话管理

当前版本直接使用 Playwright，未启用 MCP。

## 最佳实践

### 调试发布失败

1. 检查日志中的 `[xxx]` 标记（如 `[processUrl]`）
2. 查看 `captureDebugInfo` 截图（base64）
3. 验证会话数据有效性（cookies 数量和过期时间）
4. 使用 `testConnection` 手动测试平台连接

### 处理会话过期

1. 前端监听 `isActive: false` 状态
2. 提示用户重新连接
3. SessionHealthCheckScheduler 定期检查
4. 自动查找用户的活跃连接作为 fallback

### 内容清理规范

使用 `sanitizeString` 处理所有用户输入和 AI 生成内容：

- 移除 null 字节 `\x00`
- 移除控制字符（保留 tab/LF/CR）
- 移除 Unicode 替换字符 `\uFFFD`
- 移除孤立代理对（lone surrogates）
- 验证 UTF-8 往返一致性

## 已知限制

1. **小红书图片上传**: 需要本地文件，远程 URL 需先下载
2. **微信公众号 token**: 优先使用保存的 `wechatToken`，URL 中可能不包含
3. **浏览器自动化稳定性**: 平台 UI 更新可能导致选择器失效
4. **并发登录验证**: 使用内存锁（`verifyingConnections`）防止并发

## 相关文档

- [AI 调用规范](../../../guides/ai-calling-standards.md)
- [代码规范](../../../../standards/04-code-style.md)
- [API 设计规范](../../../../standards/05-api-design.md)
- [Playwright 官方文档](https://playwright.dev/)
- [Prisma ORM 文档](https://www.prisma.io/docs)

---

**维护者**: AI Social Team
**代码位置**: `backend/src/modules/ai-app/social/`
**数据库表**: `social_platform_connections`, `social_contents`, `social_content_versions`, `social_publish_logs`
