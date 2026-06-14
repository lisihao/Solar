# AI Group 用户输入内容智能解析

## 产品需求文档 (PRD)

**版本**: v1.0
**创建日期**: 2025-12-04
**产品负责人**: Genesis Team
**关联文档**: ai-group-prd.md, ai-group-spec.md

---

## 一、需求背景

### 1.1 问题描述

当前 AI Group 系统中，用户在消息输入框中输入包含 URL、文件引用等内容时，系统存在以下问题：

1. **URL 未解析**：用户粘贴 URL 后，系统不会自动提取链接内容，AI 只能看到原始 URL 字符串
2. **内容类型未识别**：无法区分用户输入的是普通文本、链接、文件路径还是其他结构化内容
3. **任务理解受限**：AI 无法获取 URL 指向的实际内容（如网页标题、文章摘要、图片等），导致任务理解不完整
4. **资源未关联**：输入中的资源链接没有自动关联到 Topic 资源池

### 1.2 用户场景

| 场景         | 用户行为              | 期望结果                    | 当前问题             |
| ------------ | --------------------- | --------------------------- | -------------------- |
| 分享文章讨论 | 粘贴文章 URL 并提问   | AI 理解文章内容后回答       | AI 只看到 URL 字符串 |
| 分享图片分析 | 粘贴图片 URL          | 显示图片预览，AI 可分析     | 显示为纯文本链接     |
| 分享视频讨论 | 粘贴 YouTube 链接     | 显示视频预览，提取字幕/摘要 | 无法获取视频内容     |
| 引用文档讨论 | 粘贴 Google Docs 链接 | 提取文档内容供 AI 分析      | AI 无法访问文档      |
| 多链接任务   | 一次输入多个 URL      | 逐一解析，统一呈现          | 全部当作纯文本       |

### 1.3 核心价值

- **提升 AI 理解能力**：让 AI 获取完整的上下文信息，而非仅看到 URL 字符串
- **改善用户体验**：自动预览和解析，减少用户手动描述内容的负担
- **增强协作效率**：分享的资源自动沉淀到 Topic 资源池，方便后续查阅

---

## 二、功能设计

### 2.1 支持的内容类型

| 类型         | 识别方式                           | 解析内容                               | 优先级 |
| ------------ | ---------------------------------- | -------------------------------------- | ------ |
| **网页链接** | URL 正则匹配                       | OG 元数据（title, description, image） | P0     |
| **图片链接** | URL 后缀 (.png, .jpg, .gif, .webp) | 图片预览、尺寸信息                     | P0     |
| **视频链接** | YouTube/Bilibili/Vimeo 等域名      | 视频封面、标题、字幕/摘要              | P1     |
| **文档链接** | Google Docs/Notion/Confluence 等   | 文档标题、部分内容摘要                 | P1     |
| **代码仓库** | GitHub/GitLab 等                   | README、文件列表、最近提交             | P2     |
| **社交媒体** | Twitter/X/LinkedIn 等              | 帖子内容、作者信息                     | P2     |
| **文件上传** | 拖拽/粘贴文件                      | 文件预览、内容提取                     | P1     |

### 2.2 解析流程设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户输入处理流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│  │   用户输入    │───▶│  内容检测器   │───▶│  类型分类器   │        │
│  │  (文本/粘贴)  │    │ (URL/文件等) │    │              │        │
│  └──────────────┘    └──────────────┘    └──────┬───────┘        │
│                                                   │               │
│                    ┌──────────────────────────────┼───────────┐  │
│                    ▼                              ▼           ▼  │
│              ┌──────────┐                  ┌──────────┐ ┌──────┐ │
│              │ 网页解析器 │                  │ 媒体解析器 │ │ ... │ │
│              │ (OG Meta) │                  │ (图片/视频)│ │      │ │
│              └────┬─────┘                  └────┬─────┘ └──┬───┘ │
│                   │                              │          │     │
│                   └──────────────┬───────────────┴──────────┘     │
│                                  ▼                                │
│                         ┌──────────────┐                          │
│                         │  预览生成器   │                          │
│                         │ (LinkPreview)│                          │
│                         └──────┬───────┘                          │
│                                │                                  │
│            ┌───────────────────┼───────────────────┐              │
│            ▼                   ▼                   ▼              │
│     ┌────────────┐     ┌────────────┐      ┌────────────┐        │
│     │  UI 预览卡  │     │ AI 上下文  │      │ 资源关联   │        │
│     │  (用户可见) │     │ (注入内容) │      │ (沉淀到池) │        │
│     └────────────┘     └────────────┘      └────────────┘        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 URL 检测规则

```typescript
// URL 检测正则表达式
const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

// 特殊平台识别
const PLATFORM_PATTERNS = {
  youtube: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i,
  bilibili: /bilibili\.com\/video\/(BV[\w]+)/i,
  github: /github\.com\/([\w-]+\/[\w-]+)/i,
  twitter: /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i,
  notion: /notion\.(?:so|site)\/([\w-]+)/i,
  googleDocs: /docs\.google\.com\/document\/d\/([\w-]+)/i,
};

// 媒体文件识别
const MEDIA_EXTENSIONS = {
  image: /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?.*)?$/i,
  video: /\.(mp4|webm|mov|avi)(\?.*)?$/i,
  audio: /\.(mp3|wav|ogg|m4a)(\?.*)?$/i,
  document: /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)(\?.*)?$/i,
};
```

### 2.4 解析结果数据结构

```typescript
// 解析结果类型
interface ParsedContent {
  type:
    | "URL"
    | "IMAGE"
    | "VIDEO"
    | "DOCUMENT"
    | "CODE_REPO"
    | "SOCIAL"
    | "FILE";
  originalText: string; // 原始输入文本
  url: string; // 解析出的 URL
  platform?: string; // 平台识别（youtube, github 等）

  // 预览信息
  preview: {
    title?: string; // 标题
    description?: string; // 描述/摘要
    image?: string; // 预览图
    favicon?: string; // 网站图标
    siteName?: string; // 站点名称
    author?: string; // 作者
    publishedAt?: Date; // 发布时间
  };

  // 内容提取（供 AI 使用）
  extractedContent?: {
    fullText?: string; // 完整文本内容
    summary?: string; // AI 生成摘要
    keyPoints?: string[]; // 关键点提取
    metadata?: Record<string, any>; // 其他元数据
  };

  // 状态
  status: "pending" | "parsing" | "success" | "failed";
  error?: string;
}
```

---

## 三、详细功能说明

### 3.1 网页链接解析 (P0)

**解析流程**：

1. 检测到 URL 后，显示 "正在加载预览..." 占位符
2. 后端请求目标 URL，提取 OG 元数据：
   - `og:title` / `<title>`
   - `og:description` / `<meta name="description">`
   - `og:image`
   - `og:site_name`
   - `favicon`
3. 返回预览卡片数据
4. 前端渲染预览卡片

**预览卡片 UI**：

```
┌─────────────────────────────────────────────────┐
│ [favicon] Site Name                              │
│                                                  │
│ 文章标题 Title                                    │
│                                                  │
│ 文章描述摘要，最多显示两行文字...                  │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │                                            │  │
│ │          [Preview Image]                   │  │
│ │                                            │  │
│ └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**AI 上下文注入**：

```markdown
[用户分享了一个链接]

- 来源: {siteName}
- 标题: {title}
- 摘要: {description}
- 链接: {url}

{如果有提取的完整内容}
--- 链接内容摘要 ---
{extractedContent.summary}
--- 内容结束 ---
```

### 3.2 图片链接解析 (P0)

**解析流程**：

1. 识别图片后缀或 Content-Type
2. 验证图片可访问性
3. 获取图片尺寸信息
4. 生成缩略图（如果图片过大）

**预览 UI**：

- 直接在消息中内嵌显示图片
- 点击可放大查看
- 显示图片尺寸信息

**AI 上下文注入**：

```markdown
[用户分享了一张图片]

- 链接: {url}
- 尺寸: {width} x {height}
- 格式: {format}

{如果 AI 支持图像分析}
请分析这张图片的内容。
```

### 3.3 视频链接解析 (P1)

**YouTube 特殊处理**：

1. 提取视频 ID
2. 调用 YouTube API 获取：
   - 视频标题
   - 频道名称
   - 时长
   - 封面图
3. 提取字幕（如有）
4. 生成视频内容摘要

**预览卡片**：

```
┌─────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────┐  │
│ │        ▶                                   │  │
│ │    [Video Thumbnail]                       │  │
│ │                           12:34            │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ 视频标题                                         │
│ Channel Name • 1.2M views • 3 days ago          │
└─────────────────────────────────────────────────┘
```

**AI 上下文注入**：

```markdown
[用户分享了一个视频]

- 平台: YouTube
- 标题: {title}
- 频道: {channelName}
- 时长: {duration}
- 链接: {url}

--- 视频字幕/内容摘要 ---
{subtitleOrSummary}
--- 内容结束 ---
```

### 3.4 实时预览交互

**输入时检测**：

```typescript
// 防抖检测，用户停止输入 500ms 后触发
const debouncedDetect = useMemo(
  () =>
    debounce((text: string) => {
      const urls = extractUrls(text);
      if (urls.length > 0) {
        setPendingUrls(urls);
        urls.forEach((url) => fetchPreview(url));
      }
    }, 500),
  [],
);
```

**预览状态显示**：

```
输入框
┌─────────────────────────────────────────────────┐
│ @小C 请分析一下这个链接的内容                     │
│ https://example.com/article                     │
└─────────────────────────────────────────────────┘

预览区域（输入框下方）
┌─────────────────────────────────────────────────┐
│ 🔄 正在加载预览...                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ [skeleton loading...]                       │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘

加载完成后
┌─────────────────────────────────────────────────┐
│ ✓ 已解析 1 个链接                                │
│ ┌─────────────────────────────────────────────┐ │
│ │ [favicon] Example.com                       │ │
│ │ 文章标题：深度学习入门指南                    │ │
│ │ 这是一篇介绍深度学习基础的文章...             │ │
│ │ [x] 移除预览                                 │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 四、技术方案

### 4.1 前端实现

**1. 消息输入组件改造**

```typescript
// MessageInput 组件新增
interface MessageInputState {
  content: string;
  mentions: Mention[];
  // 新增
  detectedUrls: string[];
  urlPreviews: Map<string, ParsedContent>;
  isParsingUrls: boolean;
}

// URL 检测 Hook
function useUrlDetection(content: string) {
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Map<string, ParsedContent>>(
    new Map(),
  );

  useEffect(() => {
    const urls = extractUrls(content);
    setDetectedUrls(urls);

    // 获取预览
    urls.forEach(async (url) => {
      if (!previews.has(url)) {
        const preview = await fetchUrlPreview(url);
        setPreviews((prev) => new Map(prev).set(url, preview));
      }
    });
  }, [content]);

  return { detectedUrls, previews };
}
```

**2. 预览卡片组件**

```typescript
// LinkPreviewCard.tsx
interface LinkPreviewCardProps {
  preview: ParsedContent;
  onRemove?: () => void;
}

function LinkPreviewCard({ preview, onRemove }: LinkPreviewCardProps) {
  if (preview.status === 'parsing') {
    return <LinkPreviewSkeleton />;
  }

  if (preview.status === 'failed') {
    return <LinkPreviewError url={preview.url} error={preview.error} />;
  }

  return (
    <div className="link-preview-card">
      {preview.preview.image && (
        <img src={preview.preview.image} alt="" />
      )}
      <div className="content">
        <div className="site">
          {preview.preview.favicon && <img src={preview.preview.favicon} />}
          {preview.preview.siteName}
        </div>
        <h4>{preview.preview.title}</h4>
        <p>{preview.preview.description}</p>
      </div>
      {onRemove && (
        <button onClick={onRemove}>×</button>
      )}
    </div>
  );
}
```

### 4.2 后端实现

**1. URL 解析服务**

```typescript
// url-parser.service.ts
@Injectable()
export class UrlParserService {
  constructor(
    private readonly httpService: HttpService,
    private readonly cacheManager: CacheManager,
  ) {}

  async parseUrl(url: string): Promise<ParsedContent> {
    // 检查缓存
    const cached = await this.cacheManager.get(`url:${url}`);
    if (cached) return cached;

    // 识别 URL 类型
    const urlType = this.identifyUrlType(url);

    // 根据类型选择解析器
    let result: ParsedContent;
    switch (urlType) {
      case "youtube":
        result = await this.parseYouTube(url);
        break;
      case "github":
        result = await this.parseGitHub(url);
        break;
      case "image":
        result = await this.parseImage(url);
        break;
      default:
        result = await this.parseGenericUrl(url);
    }

    // 缓存结果（1小时）
    await this.cacheManager.set(`url:${url}`, result, 3600);

    return result;
  }

  private async parseGenericUrl(url: string): Promise<ParsedContent> {
    const response = await this.httpService.get(url).toPromise();
    const html = response.data;

    // 提取 OG 元数据
    const $ = cheerio.load(html);

    return {
      type: "URL",
      url,
      originalText: url,
      preview: {
        title:
          $('meta[property="og:title"]').attr("content") || $("title").text(),
        description:
          $('meta[property="og:description"]').attr("content") ||
          $('meta[name="description"]').attr("content"),
        image: $('meta[property="og:image"]').attr("content"),
        siteName: $('meta[property="og:site_name"]').attr("content"),
        favicon: this.extractFavicon($, url),
      },
      status: "success",
    };
  }
}
```

**2. API 端点**

```typescript
// ai-group.controller.ts
@Post('parse-url')
@UseGuards(AuthGuard)
async parseUrl(
  @Body() dto: { url: string },
  @Req() req: AuthenticatedRequest,
) {
  return this.urlParserService.parseUrl(dto.url);
}

@Post('parse-urls')
@UseGuards(AuthGuard)
async parseUrls(
  @Body() dto: { urls: string[] },
  @Req() req: AuthenticatedRequest,
) {
  const results = await Promise.all(
    dto.urls.map(url => this.urlParserService.parseUrl(url))
  );
  return results;
}
```

**3. 消息发送时注入解析内容**

```typescript
// ai-group.service.ts - sendMessage 修改
async sendMessage(topicId: string, userId: string, dto: SendMessageDto) {
  // 检测并解析 URL
  const urls = this.extractUrls(dto.content);
  const parsedUrls: ParsedContent[] = [];

  if (urls.length > 0) {
    for (const url of urls) {
      const parsed = await this.urlParserService.parseUrl(url);
      parsedUrls.push(parsed);

      // 自动添加到资源池
      if (parsed.status === 'success') {
        await this.addResource(topicId, userId, {
          type: 'LINK',
          name: parsed.preview.title || url,
          url: url,
          sourceMessageId: messageId,
        });
      }
    }
  }

  // 存储解析结果
  const message = await this.prisma.topicMessage.create({
    data: {
      ...messageData,
      parsedUrls: parsedUrls, // JSON 字段
    },
  });

  return message;
}
```

**4. AI 上下文构建时注入解析内容**

```typescript
// ai-group.service.ts - buildSmartContext 修改
private buildEnhancedContext(message: TopicMessage): string {
  let context = message.content;

  if (message.parsedUrls && message.parsedUrls.length > 0) {
    context += '\n\n--- 链接内容解析 ---\n';

    for (const parsed of message.parsedUrls) {
      if (parsed.status === 'success') {
        context += `\n[${parsed.type}] ${parsed.url}\n`;
        context += `标题: ${parsed.preview.title}\n`;
        if (parsed.preview.description) {
          context += `摘要: ${parsed.preview.description}\n`;
        }
        if (parsed.extractedContent?.summary) {
          context += `内容摘要:\n${parsed.extractedContent.summary}\n`;
        }
      }
    }

    context += '\n--- 解析结束 ---\n';
  }

  return context;
}
```

---

## 五、UI/UX 设计

### 5.1 输入框改进

**状态 1: 正常输入**

```
┌─────────────────────────────────────────────────────────┐
│ Type a message... Use @ to mention                      │
│                                                  [发送] │
└─────────────────────────────────────────────────────────┘
```

**状态 2: 检测到 URL，正在解析**

```
┌─────────────────────────────────────────────────────────┐
│ @小C 请分析这个链接 https://example.com/article        │
│                                                  [发送] │
├─────────────────────────────────────────────────────────┤
│ 🔄 正在解析链接...                                      │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**状态 3: 解析完成**

```
┌─────────────────────────────────────────────────────────┐
│ @小C 请分析这个链接 https://example.com/article        │
│                                                  [发送] │
├─────────────────────────────────────────────────────────┤
│ ✓ 1 个链接已解析                              [展开/收起]│
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🌐 Example.com                              [×]     ││
│ │ 深度学习入门完整指南                                 ││
│ │ 本文介绍深度学习的基础概念、常用框架和实践案例...     ││
│ │ ┌────────────────────────────────────────────────┐ ││
│ │ │              [Preview Image]                   │ ││
│ │ └────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 5.2 消息气泡中的链接预览

**发送后的消息显示**：

```
┌─────────────────────────────────────────────────────────┐
│ 👤 User Name                               2:30 PM      │
├─────────────────────────────────────────────────────────┤
│ @小C 请分析这个链接 https://example.com/article        │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🌐 Example.com                                      ││
│ │ 深度学习入门完整指南                                 ││
│ │ 本文介绍深度学习的基础概念...                        ││
│ │ [缩略图]                                            ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 5.3 多链接处理

当用户输入多个链接时，以折叠列表形式展示：

```
┌─────────────────────────────────────────────────────────┐
│ ✓ 3 个链接已解析                              [展开全部]│
│                                                         │
│ 🌐 Example.com - 深度学习入门指南              [×]      │
│ 📹 YouTube - TensorFlow 教程 (15:30)           [×]      │
│ 📁 GitHub - tensorflow/tensorflow              [×]      │
│                                                         │
│ [点击展开查看详情]                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 六、数据库设计

### 6.1 ParsedUrl 存储

在 `TopicMessage` 中添加 JSON 字段存储解析结果：

```prisma
model TopicMessage {
  id              String   @id @default(cuid())
  topicId         String
  content         String
  contentType     MessageContentType @default(TEXT)

  // 新增：解析的 URL 内容
  parsedUrls      Json?    // ParsedContent[]

  // ... 其他字段
}
```

### 6.2 URL 缓存表（可选）

```prisma
model UrlCache {
  id          String   @id @default(cuid())
  url         String   @unique
  type        String   // URL | IMAGE | VIDEO | etc.
  preview     Json     // { title, description, image, ... }
  content     Json?    // { fullText, summary, ... }
  status      String   // success | failed
  error       String?
  fetchedAt   DateTime @default(now())
  expiresAt   DateTime

  @@index([url])
  @@index([expiresAt])
}
```

---

## 七、性能优化

### 7.1 缓存策略

| 内容类型   | 缓存时间 | 说明               |
| ---------- | -------- | ------------------ |
| 静态网页   | 24 小时  | 新闻、博客文章等   |
| 动态页面   | 1 小时   | 社交媒体帖子等     |
| 图片元数据 | 7 天     | 图片尺寸等不变数据 |
| 视频信息   | 6 小时   | 可能更新播放量等   |

### 7.2 并发控制

- 同时解析的 URL 数量限制：5 个
- 单个 URL 解析超时：10 秒
- 失败重试次数：2 次

### 7.3 内容大小限制

- 网页内容提取：最大 100KB
- 图片预览：最大 5MB
- 视频元数据：不下载视频内容，仅获取元数据

---

## 八、安全考虑

### 8.1 URL 验证

- 禁止访问内网地址（SSRF 防护）
- 禁止访问本地文件 (file://)
- 域名白名单/黑名单机制

### 8.2 内容安全

- 图片内容审核（可选）
- 恶意链接检测
- 敏感信息过滤

### 8.3 速率限制

- 单用户每分钟最多解析 20 个 URL
- 全局每分钟最多解析 100 个 URL

---

## 九、发布计划

### Phase 1: 基础链接预览 (P0)

**范围**：

- 网页 OG 元数据提取
- 图片链接预览
- 前端预览卡片组件
- 基础缓存机制

**预计时间**：1 周

### Phase 2: 视频和特殊平台 (P1)

**范围**：

- YouTube 视频解析（标题、封面、时长）
- Bilibili 视频解析
- YouTube 字幕提取（如有）
- 视频内容摘要生成

**预计时间**：1 周

### Phase 3: 深度内容提取 (P2)

**范围**：

- 网页正文提取
- GitHub 仓库解析
- 文档链接解析
- AI 内容摘要生成

**预计时间**：2 周

### Phase 4: 文件上传处理 (P1)

**范围**：

- 文件拖拽上传
- 图片粘贴上传
- 文件预览和内容提取
- 与资源池整合

**预计时间**：1 周

---

## 十、成功指标

| 指标              | 目标值   | 测量方式               |
| ----------------- | -------- | ---------------------- |
| URL 解析成功率    | > 90%    | 成功解析数 / 总请求数  |
| 平均解析延迟      | < 2 秒   | 从请求到返回的时间     |
| 用户使用率        | > 30%    | 使用链接分享的消息占比 |
| AI 回复相关性提升 | 定性评估 | 用户反馈               |

---

## 十一、附录

### A. 竞品参考

| 产品      | 链接预览   | 内容提取   | AI 理解 |
| --------- | ---------- | ---------- | ------- |
| Slack     | ✓ OG 预览  | ✗          | ✗       |
| Discord   | ✓ OG 预览  | ✗          | ✗       |
| Notion AI | ✓ 内嵌预览 | ✓ 部分     | ✓       |
| ChatGPT   | ✗          | ✓ 浏览模式 | ✓       |
| Claude    | ✗          | ✓ 需手动   | ✓       |

### B. 相关 API

- **Open Graph Protocol**: https://ogp.me/
- **YouTube Data API**: https://developers.google.com/youtube/v3
- **GitHub API**: https://docs.github.com/en/rest
- **Unfurl (npm)**: https://github.com/jacktuck/unfurl

---

**文档结束**
