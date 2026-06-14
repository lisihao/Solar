# 数据源集成

## 概述

Genesis 支持多种数据源，每种数据源有特定的接入方式和数据格式。

## 支持的数据源

| 数据源      | 类型 | 数据格式 | 更新频率 |
| ----------- | ---- | -------- | -------- |
| RSS/Atom    | 订阅 | XML      | 按需     |
| 网页        | 爬取 | HTML     | 按需     |
| YouTube     | API  | JSON     | 按需     |
| arXiv       | API  | XML      | 按需     |
| GitHub      | API  | JSON     | 按需     |
| Hacker News | API  | JSON     | 定时     |

## GitHub 集成

### 1. GitHub 服务

```typescript
// github.service.ts
import { Octokit } from "@octokit/rest";

@Injectable()
export class GithubService {
  private octokit: Octokit;

  constructor(private configService: ConfigService) {
    this.octokit = new Octokit({
      auth: this.configService.get("GITHUB_TOKEN"),
    });
  }

  async getRepository(owner: string, repo: string): Promise<RepoInfo> {
    const { data } = await this.octokit.repos.get({ owner, repo });

    return {
      id: data.id.toString(),
      fullName: data.full_name,
      description: data.description,
      url: data.html_url,
      stars: data.stargazers_count,
      forks: data.forks_count,
      language: data.language,
      topics: data.topics,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      pushedAt: new Date(data.pushed_at),
      license: data.license?.name,
    };
  }

  async getReadme(owner: string, repo: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getReadme({ owner, repo });
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return content;
    } catch {
      return null;
    }
  }

  async searchRepositories(
    query: string,
    options?: {
      sort?: "stars" | "forks" | "updated";
      order?: "asc" | "desc";
      perPage?: number;
    },
  ): Promise<RepoInfo[]> {
    const { data } = await this.octokit.search.repos({
      q: query,
      sort: options?.sort || "stars",
      order: options?.order || "desc",
      per_page: options?.perPage || 30,
    });

    return data.items.map((item) => ({
      id: item.id.toString(),
      fullName: item.full_name,
      description: item.description,
      url: item.html_url,
      stars: item.stargazers_count,
      forks: item.forks_count,
      language: item.language,
      topics: item.topics,
      updatedAt: new Date(item.updated_at),
    }));
  }

  async getTrendingRepos(
    language?: string,
    since: "daily" | "weekly" | "monthly" = "daily",
  ): Promise<RepoInfo[]> {
    // 使用 GitHub Search API 模拟趋势
    const date = new Date();
    if (since === "weekly") {
      date.setDate(date.getDate() - 7);
    } else if (since === "monthly") {
      date.setMonth(date.getMonth() - 1);
    } else {
      date.setDate(date.getDate() - 1);
    }

    const dateStr = date.toISOString().split("T")[0];
    let query = `created:>${dateStr}`;

    if (language) {
      query += ` language:${language}`;
    }

    return this.searchRepositories(query, { sort: "stars", perPage: 25 });
  }
}
```

## Hacker News 集成

### 1. HN 服务

```typescript
// hackernews.service.ts
@Injectable()
export class HackernewsService {
  private readonly baseUrl = "https://hacker-news.firebaseio.com/v0";

  async getTopStories(limit: number = 30): Promise<number[]> {
    const response = await axios.get(`${this.baseUrl}/topstories.json`);
    return response.data.slice(0, limit);
  }

  async getItem(id: number): Promise<HNItem> {
    const response = await axios.get(`${this.baseUrl}/item/${id}.json`);
    return response.data;
  }

  async getStoryWithComments(
    storyId: number,
    maxComments: number = 50,
  ): Promise<StoryWithComments> {
    const story = await this.getItem(storyId);

    if (story.type !== "story") {
      throw new Error("Item is not a story");
    }

    const comments = await this.getCommentsRecursive(
      story.kids || [],
      maxComments,
    );

    return {
      id: story.id,
      title: story.title,
      url: story.url,
      text: story.text,
      by: story.by,
      score: story.score,
      time: new Date(story.time * 1000),
      descendants: story.descendants,
      comments,
    };
  }

  private async getCommentsRecursive(
    commentIds: number[],
    maxComments: number,
    depth: number = 0,
  ): Promise<HNComment[]> {
    if (commentIds.length === 0 || maxComments <= 0) {
      return [];
    }

    const comments: HNComment[] = [];
    const batchSize = Math.min(commentIds.length, maxComments);

    await Promise.all(
      commentIds.slice(0, batchSize).map(async (id) => {
        const item = await this.getItem(id);

        if (item && item.type === "comment" && !item.deleted) {
          const replies =
            depth < 3
              ? await this.getCommentsRecursive(item.kids || [], 5, depth + 1)
              : [];

          comments.push({
            id: item.id,
            text: item.text,
            by: item.by,
            time: new Date(item.time * 1000),
            replies,
          });
        }
      }),
    );

    return comments;
  }

  async collectTopStories(): Promise<void> {
    const storyIds = await this.getTopStories(30);

    for (const storyId of storyIds) {
      const story = await this.getItem(storyId);

      // 检查是否已存在
      const existing = await this.prisma.resource.findFirst({
        where: {
          metadata: {
            path: ["hnId"],
            equals: story.id,
          },
        },
      });

      if (existing) continue;

      // 创建资源
      await this.prisma.resource.create({
        data: {
          title: story.title,
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          type: "news",
          content: story.text || "",
          metadata: {
            hnId: story.id,
            score: story.score,
            author: story.by,
            commentCount: story.descendants,
          },
          publishedAt: new Date(story.time * 1000),
        },
      });
    }
  }
}
```

### 2. HN 评论采集

```typescript
// hackernews-comments.service.ts
@Injectable()
export class HackernewsCommentsService {
  constructor(
    private hnService: HackernewsService,
    private prisma: PrismaService,
  ) {}

  async collectCommentsForStory(storyId: number): Promise<void> {
    const storyWithComments = await this.hnService.getStoryWithComments(
      storyId,
      100,
    );

    const resource = await this.prisma.resource.findFirst({
      where: {
        metadata: {
          path: ["hnId"],
          equals: storyId,
        },
      },
    });

    if (!resource) return;

    // 保存评论
    for (const comment of storyWithComments.comments) {
      await this.saveComment(resource.id, comment);
    }
  }

  private async saveComment(
    resourceId: string,
    comment: HNComment,
  ): Promise<void> {
    await this.prisma.comment.upsert({
      where: {
        externalId: `hn:${comment.id}`,
      },
      create: {
        resourceId,
        externalId: `hn:${comment.id}`,
        content: comment.text,
        author: comment.by,
        createdAt: comment.time,
        metadata: {
          source: "hackernews",
          replies: comment.replies?.length || 0,
        },
      },
      update: {
        content: comment.text,
      },
    });

    // 递归保存回复
    for (const reply of comment.replies || []) {
      await this.saveComment(resourceId, reply);
    }
  }
}
```

## 数据源配置

### 1. 数据源管理

```typescript
// data-source.entity.ts
interface DataSource {
  id: string;
  name: string;
  type: "rss" | "web" | "api" | "youtube";
  url: string;
  config: {
    // RSS 配置
    feedUrl?: string;

    // 网页爬虫配置
    selectors?: {
      title?: string;
      content?: string;
      author?: string;
      date?: string;
    };

    // API 配置
    apiKey?: string;
    endpoint?: string;

    // 通用配置
    interval?: number; // 采集间隔（分钟）
    maxItems?: number;
  };
  isActive: boolean;
  lastFetchedAt?: Date;
  lastFetchedGuid?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 2. 数据源管理服务

```typescript
// data-source.service.ts
@Injectable()
export class DataSourceService {
  constructor(private prisma: PrismaService) {}

  async createSource(data: CreateDataSourceDto): Promise<DataSource> {
    // 验证配置
    await this.validateSourceConfig(data);

    return this.prisma.dataSource.create({
      data: {
        name: data.name,
        type: data.type,
        url: data.url,
        config: data.config,
        isActive: true,
      },
    });
  }

  private async validateSourceConfig(data: CreateDataSourceDto): Promise<void> {
    switch (data.type) {
      case "rss":
        await this.validateRssSource(data.url);
        break;
      case "web":
        await this.validateWebSource(data.url, data.config?.selectors);
        break;
      case "youtube":
        this.validateYouTubeSource(data.url);
        break;
    }
  }

  private async validateRssSource(url: string): Promise<void> {
    const parser = new Parser();
    try {
      await parser.parseURL(url);
    } catch (error) {
      throw new BadRequestException(`Invalid RSS feed: ${error.message}`);
    }
  }

  private async validateWebSource(url: string, selectors?: any): Promise<void> {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(response.data);

      if (selectors?.content && $(selectors.content).length === 0) {
        throw new BadRequestException("Content selector not found");
      }
    } catch (error) {
      throw new BadRequestException(`Cannot access URL: ${error.message}`);
    }
  }

  private validateYouTubeSource(url: string): void {
    const patterns = [
      /youtube\.com\/channel\//,
      /youtube\.com\/c\//,
      /youtube\.com\/@/,
      /youtube\.com\/playlist\?list=/,
    ];

    if (!patterns.some((p) => p.test(url))) {
      throw new BadRequestException("Invalid YouTube channel or playlist URL");
    }
  }
}
```

## 数据质量

### 1. 数据验证

```typescript
// data-validation.service.ts
@Injectable()
export class DataValidationService {
  validateResource(data: Partial<Resource>): ValidationResult {
    const errors: string[] = [];

    // 必填字段
    if (!data.title?.trim()) {
      errors.push("Title is required");
    }

    if (!data.url?.trim()) {
      errors.push("URL is required");
    } else if (!this.isValidUrl(data.url)) {
      errors.push("Invalid URL format");
    }

    // 内容质量
    if (data.content && data.content.length < 100) {
      errors.push("Content too short");
    }

    // 检测垃圾内容
    if (this.isSpamContent(data.content || "")) {
      errors.push("Content appears to be spam");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isSpamContent(content: string): boolean {
    const spamPatterns = [
      /buy now/i,
      /click here/i,
      /limited offer/i,
      /free download/i,
    ];

    const spamScore = spamPatterns.filter((p) => p.test(content)).length;
    return spamScore >= 2;
  }
}
```

### 2. 数据清洗

```typescript
// data-cleaning.service.ts
@Injectable()
export class DataCleaningService {
  cleanResource(resource: RawResource): CleanedResource {
    return {
      ...resource,
      title: this.cleanTitle(resource.title),
      content: this.cleanContent(resource.content),
      url: this.normalizeUrl(resource.url),
    };
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // 零宽字符
      .trim()
      .slice(0, 500);
  }

  private cleanContent(content: string): string {
    // 移除 HTML 标签
    let cleaned = content.replace(/<[^>]*>/g, " ");

    // 规范化空白
    cleaned = cleaned.replace(/\s+/g, " ");

    // 移除特殊字符
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");

    return cleaned.trim();
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // 移除追踪参数
      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "ref",
      ];
      trackingParams.forEach((param) => parsed.searchParams.delete(param));

      return parsed.toString();
    } catch {
      return url;
    }
  }
}
```

## 参考资源

- [GitHub REST API](https://docs.github.com/en/rest)
- [Hacker News API](https://github.com/HackerNews/API)
- [YouTube Data API](https://developers.google.com/youtube/v3)
