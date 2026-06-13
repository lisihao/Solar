# AI Social MCP 重构方案

> 彻底重构 AI Social 模块，集成 MCP Server，实现稳定的自动化发布

## 目录

1. [现状分析](#1-现状分析)
2. [目标架构](#2-目标架构)
3. [核心改进](#3-核心改进)
4. [详细设计](#4-详细设计)
5. [MCP 集成方案](#5-mcp-集成方案)
6. [数据库设计](#6-数据库设计)
7. [API 设计](#7-api-设计)
8. [容器化部署](#8-容器化部署)
9. [风控策略](#9-风控策略)
10. [实施计划](#10-实施计划)

---

## 1. 现状分析

### 1.1 当前问题

| 问题                   | 影响       | 根因                    |
| ---------------------- | ---------- | ----------------------- |
| 微信只保存草稿，不发布 | 需手动发布 | 代码未实现群发流程      |
| 小红书发布失败         | 功能不可用 | 图片上传等核心功能 TODO |
| Cookie 频繁过期        | 需反复登录 | 会话管理不健壮          |
| UI 变化导致失败        | 维护成本高 | 选择器硬编码            |

### 1.2 现有代码结构

```
ai-app/social/
├── adapters/
│   ├── wechat.adapter.ts      # 1236行，只实现到保存草稿
│   └── xiaohongshu.adapter.ts # 303行，核心功能 TODO
├── services/
│   ├── playwright.service.ts  # 浏览器管理
│   └── publish-executor.service.ts
└── ai-social.service.ts       # 1148行
```

### 1.3 平台限制

| 平台       | API 支持              | 个人号限制      | 自动化可行性    |
| ---------- | --------------------- | --------------- | --------------- |
| 微信公众号 | 2025.7 后个人号无权限 | 无法用 API 发布 | Playwright 可行 |
| 小红书     | 无官方 API            | 无              | Playwright 可行 |

---

## 2. 目标架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Social 新架构                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     内容生产流水线                          │ │
│  │                                                             │ │
│  │   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │ │
│  │   │ 信息收集 │ → │ AI 整理 │ → │ 内容审核 │ → │ 排队发布 │   │ │
│  │   │ Fetcher │   │Transform│   │ Checker │   │ Queue  │   │ │
│  │   └─────────┘   └─────────┘   └─────────┘   └─────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    MCP Adapter Layer                        │ │
│  │                     (统一调度层)                             │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │              MCPClientService                         │  │ │
│  │  │  • 管理 MCP Server 连接                               │  │ │
│  │  │  • 统一调用接口                                       │  │ │
│  │  │  • 错误处理和重试                                     │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│            ┌─────────────────┼─────────────────┐                │
│            ▼                 ▼                 ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  WeChat MCP  │  │   XHS MCP    │  │  Future MCP  │          │
│  │   Adapter    │  │   Adapter    │  │  (抖音/B站)   │          │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤          │
│  │ • 登录管理   │  │ • 登录管理   │  │              │          │
│  │ • 草稿创建   │  │ • 图文发布   │  │              │          │
│  │ • 群发发布   │  │ • 视频发布   │  │              │          │
│  │ • 数据统计   │  │ • 数据采集   │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                                     │
│         ▼                 ▼                                     │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │  Playwright  │  │  Playwright  │                            │
│  │   Browser    │  │   Browser    │                            │
│  │  (容器内)    │  │  (容器内)    │                            │
│  └──────────────┘  └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心改进点

| 改进项     | 现状            | 目标                 |
| ---------- | --------------- | -------------------- |
| 微信发布   | 只保存草稿      | 完整群发流程         |
| 小红书发布 | TODO 未实现     | 集成 xhs-toolkit MCP |
| 会话管理   | Cookie 易过期   | 健康检查 + 自动刷新  |
| 部署方式   | 本地 Playwright | Docker 容器化        |
| 发布调度   | 即时发布        | 队列 + 定时 + 限流   |

---

## 3. 核心改进

### 3.1 微信公众号 - 补充群发流程

```typescript
// 当前流程（只到保存草稿）
async publish(content, sessionData) {
  await this.restoreSession(sessionData);
  await this.navigateToEditor();
  await this.fillContent(content);
  await this.saveDraft();        // ← 止步于此
  return { success: true, type: 'draft' };
}

// 新增流程（完整发布）
async publish(content, sessionData, options) {
  await this.restoreSession(sessionData);
  await this.navigateToEditor();
  await this.fillContent(content);

  if (options.publishMode === 'draft') {
    await this.saveDraft();
    return { success: true, type: 'draft' };
  }

  // 新增：群发流程
  await this.saveDraft();
  await this.clickMassPublish();      // 点击群发按钮
  await this.selectAudience();        // 选择发送对象（全部用户）
  await this.confirmPublish();        // 确认发送
  await this.waitForPublishResult();  // 等待发送结果

  return { success: true, type: 'published', url: articleUrl };
}
```

### 3.2 小红书 - 集成 xhs-toolkit MCP

```typescript
// 不再自己实现，而是调用 MCP Server
class XhsMcpAdapter {
  private mcpClient: MCPClient;

  async publish(content: XhsContent): Promise<PublishResult> {
    // 调用 xhs-toolkit MCP 的 smart_publish_note 工具
    return this.mcpClient.callTool("smart_publish_note", {
      title: content.title,
      content: content.content,
      images: content.images,
      tags: content.tags,
    });
  }

  async login(): Promise<LoginResult> {
    return this.mcpClient.callTool("login_xiaohongshu", {});
  }

  async getAnalytics(): Promise<AnalyticsData> {
    return this.mcpClient.callTool("get_creator_data_analysis", {});
  }
}
```

---

## 4. 详细设计

### 4.1 目录结构

```
backend/src/modules/ai-app/social/
├── ai-social.module.ts
├── ai-social.controller.ts          # API 端点
├── ai-social.service.ts             # 主业务逻辑
│
├── types/
│   ├── index.ts                     # 类型定义
│   ├── mcp.types.ts                 # MCP 相关类型
│   └── platform.types.ts            # 平台相关类型
│
├── dto/
│   ├── create-content.dto.ts
│   ├── publish-content.dto.ts
│   └── ...
│
├── core/                            # 核心服务
│   ├── mcp-client.service.ts        # MCP 客户端管理
│   ├── publish-queue.service.ts     # 发布队列
│   ├── session-manager.service.ts   # 会话管理
│   └── rate-limiter.service.ts      # 频率限制
│
├── adapters/                        # 平台适配器
│   ├── base.adapter.ts              # 基础适配器接口
│   ├── wechat/
│   │   ├── wechat.adapter.ts        # 微信适配器
│   │   ├── wechat-publisher.ts      # 发布逻辑
│   │   └── wechat-selectors.ts      # 选择器配置（易维护）
│   └── xiaohongshu/
│       ├── xhs.adapter.ts           # 小红书适配器
│       └── xhs-mcp.adapter.ts       # MCP 模式适配器
│
├── services/
│   ├── content-pipeline.service.ts  # 内容流水线
│   ├── content-fetcher.service.ts   # 内容获取
│   ├── content-transformer.service.ts # 内容转换
│   ├── content-checker.service.ts   # 内容审核
│   └── analytics.service.ts         # 数据分析
│
├── queue/                           # 队列处理
│   ├── publish.processor.ts         # 发布任务处理器
│   └── publish.queue.ts             # 队列定义
│
├── scheduler/                       # 定时任务
│   ├── session-health.scheduler.ts  # 会话健康检查
│   └── scheduled-publish.scheduler.ts # 定时发布
│
└── config/
    ├── platforms.config.ts          # 平台配置
    └── selectors.config.ts          # 选择器配置
```

### 4.2 核心接口定义

```typescript
// types/platform.types.ts

export interface IPlatformAdapter {
  readonly platformType: SocialPlatformType;
  readonly name: string;

  // 登录管理
  initLogin(): Promise<LoginSession>;
  checkLoginStatus(sessionKey: string): Promise<boolean>;
  refreshSession(sessionData: SessionData): Promise<SessionData>;

  // 发布能力
  publish(
    content: SocialContent,
    options: PublishOptions,
  ): Promise<PublishResult>;
  saveDraft(content: SocialContent): Promise<DraftResult>;

  // 数据能力
  getAnalytics?(): Promise<AnalyticsData>;
  getPublishedArticles?(): Promise<Article[]>;
}

export interface PublishOptions {
  mode: "draft" | "publish"; // 草稿或发布
  scheduledAt?: Date; // 定时发布
  retryOnFailure?: boolean; // 失败重试
  maxRetries?: number;
}

export interface PublishResult {
  success: boolean;
  type: "draft" | "published";
  externalId?: string; // 平台文章 ID
  externalUrl?: string; // 平台文章链接
  errorCode?: string;
  errorMessage?: string;
  debugInfo?: DebugInfo;
}
```

### 4.3 MCP Client 服务

```typescript
// core/mcp-client.service.ts

import { Injectable, OnModuleInit } from "@nestjs/common";
import { spawn, ChildProcess } from "child_process";

interface MCPServerConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

@Injectable()
export class MCPClientService implements OnModuleInit {
  private servers: Map<string, ChildProcess> = new Map();
  private serverConfigs: MCPServerConfig[] = [
    {
      id: "xhs-toolkit",
      command: "uv",
      args: [
        "--directory",
        "/app/mcp/xhs-toolkit",
        "run",
        "python",
        "-m",
        "src.server.mcp_server",
        "--stdio",
      ],
      env: {
        CHROME_PATH: process.env.CHROME_PATH,
      },
    },
  ];

  async onModuleInit() {
    for (const config of this.serverConfigs) {
      await this.startServer(config);
    }
  }

  private async startServer(config: MCPServerConfig) {
    const process = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.servers.set(config.id, process);
    this.logger.log(`MCP Server ${config.id} started`);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: unknown,
  ): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP Server ${serverId} not found`);
    }

    // 通过 stdio 发送 JSON-RPC 请求
    const request = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };

    return this.sendRequest(server, request);
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP Server ${serverId} not found`);
    }

    const request = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
    };

    return this.sendRequest(server, request);
  }
}
```

### 4.4 发布队列服务

```typescript
// core/publish-queue.service.ts

import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";

@Injectable()
export class PublishQueueService {
  constructor(@InjectQueue("social-publish") private publishQueue: Queue) {}

  async addToQueue(
    content: SocialContent,
    options: PublishOptions,
  ): Promise<string> {
    const job = await this.publishQueue.add(
      "publish",
      {
        contentId: content.id,
        platformType: content.contentType,
        options,
      },
      {
        delay: options.scheduledAt
          ? options.scheduledAt.getTime() - Date.now()
          : 0,
        attempts: options.maxRetries || 3,
        backoff: {
          type: "exponential",
          delay: 60000, // 1分钟起步，指数退避
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    return job.id.toString();
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const job = await this.publishQueue.getJob(jobId);
    if (!job) return { status: "not_found" };

    const state = await job.getState();
    return {
      status: state,
      progress: job.progress(),
      result: job.returnvalue,
      failReason: job.failedReason,
    };
  }
}
```

### 4.5 频率限制服务

```typescript
// core/rate-limiter.service.ts

import { Injectable } from "@nestjs/common";

interface RateLimitConfig {
  maxPerDay: number;
  minIntervalMinutes: number;
  maxPerHour: number;
}

const PLATFORM_LIMITS: Record<string, RateLimitConfig> = {
  WECHAT_MP: {
    maxPerDay: 1, // 订阅号每天1次群发
    minIntervalMinutes: 0,
    maxPerHour: 1,
  },
  XIAOHONGSHU: {
    maxPerDay: 3, // 建议每天不超过3篇
    minIntervalMinutes: 240, // 间隔4小时
    maxPerHour: 1,
  },
};

@Injectable()
export class RateLimiterService {
  async canPublish(
    userId: string,
    platformType: string,
  ): Promise<RateLimitResult> {
    const config = PLATFORM_LIMITS[platformType];
    if (!config) {
      return { allowed: true };
    }

    // 检查今日发布数量
    const todayCount = await this.getTodayPublishCount(userId, platformType);
    if (todayCount >= config.maxPerDay) {
      return {
        allowed: false,
        reason: `今日发布已达上限 (${config.maxPerDay}篇)`,
        nextAvailableAt: this.getNextDayStart(),
      };
    }

    // 检查发布间隔
    const lastPublishTime = await this.getLastPublishTime(userId, platformType);
    if (lastPublishTime) {
      const minutesSinceLast = (Date.now() - lastPublishTime.getTime()) / 60000;
      if (minutesSinceLast < config.minIntervalMinutes) {
        const waitMinutes = config.minIntervalMinutes - minutesSinceLast;
        return {
          allowed: false,
          reason: `发布间隔不足，需等待 ${Math.ceil(waitMinutes)} 分钟`,
          nextAvailableAt: new Date(
            lastPublishTime.getTime() + config.minIntervalMinutes * 60000,
          ),
        };
      }
    }

    return { allowed: true };
  }
}
```

---

## 5. MCP 集成方案

### 5.1 小红书 - xhs-toolkit 集成

#### 5.1.1 安装和配置

```bash
# 在容器中安装
git clone https://github.com/aki66938/xhs-toolkit.git /app/mcp/xhs-toolkit
cd /app/mcp/xhs-toolkit
pip install -r requirements.txt
```

#### 5.1.2 适配器实现

```typescript
// adapters/xiaohongshu/xhs-mcp.adapter.ts

import { Injectable } from "@nestjs/common";
import { MCPClientService } from "../../core/mcp-client.service";
import { IPlatformAdapter, PublishResult, SocialContent } from "../../types";

@Injectable()
export class XhsMcpAdapter implements IPlatformAdapter {
  readonly platformType = "XIAOHONGSHU";
  readonly name = "小红书 (MCP)";

  constructor(
    private readonly mcpClient: MCPClientService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  async initLogin(): Promise<LoginSession> {
    // 调用 MCP 的登录工具
    const result = await this.mcpClient.callTool(
      "xhs-toolkit",
      "login_xiaohongshu",
      {},
    );

    return {
      sessionKey: result.sessionKey,
      qrCodeUrl: result.qrCodeBase64,
      expiresAt: new Date(Date.now() + 300000), // 5分钟过期
    };
  }

  async checkLoginStatus(sessionKey: string): Promise<boolean> {
    const result = await this.mcpClient.callTool(
      "xhs-toolkit",
      "check_login_status",
      {
        sessionKey,
      },
    );
    return result.loggedIn;
  }

  async publish(
    content: SocialContent,
    options: PublishOptions,
  ): Promise<PublishResult> {
    try {
      // 1. 检查会话有效性
      const session = await this.sessionManager.getSession(
        content.userId,
        "XIAOHONGSHU",
      );
      if (!session) {
        return { success: false, errorMessage: "请先登录小红书" };
      }

      // 2. 准备发布数据
      const publishData = {
        title: content.title,
        content: content.content,
        images: content.images,
        tags: content.tags || [],
        location: content.location,
        // 传递 Cookie 路径
        cookiePath: session.cookiePath,
      };

      // 3. 调用 MCP 发布
      const result = await this.mcpClient.callTool(
        "xhs-toolkit",
        "smart_publish_note",
        publishData,
      );

      if (result.success) {
        return {
          success: true,
          type: "published",
          externalId: result.noteId,
          externalUrl: result.noteUrl,
        };
      } else {
        return {
          success: false,
          errorMessage: result.error || "发布失败",
        };
      }
    } catch (error) {
      this.logger.error("XHS publish error", error);
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  async getAnalytics(): Promise<AnalyticsData> {
    const result = await this.mcpClient.callTool(
      "xhs-toolkit",
      "get_creator_data_analysis",
      {},
    );

    return {
      followers: result.fans_count,
      likes: result.like_count,
      views: result.view_count,
      notes: result.note_count,
    };
  }
}
```

### 5.2 微信公众号 - 完善 Playwright 实现

#### 5.2.1 选择器配置（便于维护）

```typescript
// config/selectors.config.ts

export const WECHAT_SELECTORS = {
  // 登录页面
  login: {
    qrCode: ".login__type__container__scan__qrcode",
    nickname: ".weui-desktop-account__nickname",
  },

  // 后台首页
  home: {
    newArticleButton: [
      '.new-creation__menu-content:has-text("图文")',
      'button:has-text("写新文章")',
      '.weui-desktop-btn:has-text("新的创作")',
    ],
  },

  // 编辑器页面
  editor: {
    titleInput: ["#title", 'input[placeholder*="标题"]', ".title-input"],
    contentEditor: [".ProseMirror", "#edui_editor_0", ".edui-editor"],
    digestInput: ["#js_description", 'textarea[placeholder*="摘要"]'],
    saveButton: [
      'button:has-text("保存")',
      '.weui-desktop-btn_primary:has-text("保存")',
    ],
    publishButton: [
      'button:has-text("群发")',
      '.weui-desktop-btn_primary:has-text("群发")',
      ".mass-send-btn",
    ],
  },

  // 群发确认
  massPublish: {
    confirmDialog: ".weui-desktop-dialog",
    sendToAllRadio: 'input[value="all"]',
    confirmButton: 'button:has-text("确定")',
    successToast: '.weui-desktop-toast:has-text("成功")',
  },
};

// 工具函数：尝试多个选择器
export async function trySelectors(
  page: Page,
  selectors: string[],
  action: "click" | "fill" | "wait",
  value?: string,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector);
      if (await element.isVisible({ timeout: 2000 })) {
        switch (action) {
          case "click":
            await element.click();
            break;
          case "fill":
            await element.fill(value!);
            break;
          case "wait":
            await element.waitFor({ timeout: 5000 });
            break;
        }
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
```

#### 5.2.2 微信发布器实现

```typescript
// adapters/wechat/wechat-publisher.ts

import { Page } from "playwright";
import { WECHAT_SELECTORS, trySelectors } from "../../config/selectors.config";

export class WechatPublisher {
  constructor(private page: Page) {}

  async saveDraft(content: WechatContent): Promise<DraftResult> {
    // 1. 填写标题
    const titleFilled = await trySelectors(
      this.page,
      WECHAT_SELECTORS.editor.titleInput,
      "fill",
      content.title,
    );
    if (!titleFilled) {
      return { success: false, error: "找不到标题输入框" };
    }

    // 2. 填写正文
    const contentFilled = await this.fillContent(content.content);
    if (!contentFilled) {
      return { success: false, error: "填写正文失败" };
    }

    // 3. 填写摘要
    if (content.digest) {
      await trySelectors(
        this.page,
        WECHAT_SELECTORS.editor.digestInput,
        "fill",
        content.digest,
      );
    }

    // 4. 保存草稿
    const saved = await trySelectors(
      this.page,
      WECHAT_SELECTORS.editor.saveButton,
      "click",
    );
    if (!saved) {
      return { success: false, error: "找不到保存按钮" };
    }

    // 5. 等待保存完成
    await this.page.waitForResponse(
      (resp) =>
        resp.url().includes("/cgi-bin/operate_appmsg") && resp.status() === 200,
      { timeout: 10000 },
    );

    return { success: true, draftUrl: this.page.url() };
  }

  async massPublish(): Promise<PublishResult> {
    // 1. 点击群发按钮
    const clicked = await trySelectors(
      this.page,
      WECHAT_SELECTORS.editor.publishButton,
      "click",
    );
    if (!clicked) {
      return { success: false, error: "找不到群发按钮" };
    }

    // 2. 等待确认弹窗
    await this.page.waitForSelector(
      WECHAT_SELECTORS.massPublish.confirmDialog,
      { timeout: 5000 },
    );

    // 3. 选择发送给所有人
    await this.page.click(WECHAT_SELECTORS.massPublish.sendToAllRadio);

    // 4. 点击确认
    await this.page.click(WECHAT_SELECTORS.massPublish.confirmButton);

    // 5. 等待发送结果
    try {
      await this.page.waitForSelector(
        WECHAT_SELECTORS.massPublish.successToast,
        { timeout: 30000 },
      );

      // 获取文章链接
      const articleUrl = await this.getPublishedArticleUrl();

      return {
        success: true,
        type: "published",
        externalUrl: articleUrl,
      };
    } catch {
      // 检查是否有错误提示
      const errorText = await this.page.textContent(".weui-desktop-dialog__bd");
      return {
        success: false,
        error: errorText || "群发失败，请检查公众号后台",
      };
    }
  }

  private async fillContent(html: string): Promise<boolean> {
    const methods = [
      // 方法1: execCommand
      async () => {
        await this.page.evaluate((html) => {
          const editor = document.querySelector(".ProseMirror");
          if (editor) {
            editor.innerHTML = html;
            return true;
          }
          return false;
        }, html);
      },
      // 方法2: 剪贴板粘贴
      async () => {
        await this.page.evaluate((html) => {
          const editor = document.querySelector(".ProseMirror");
          if (editor) {
            const event = new ClipboardEvent("paste", {
              clipboardData: new DataTransfer(),
            });
            event.clipboardData?.setData("text/html", html);
            editor.dispatchEvent(event);
            return true;
          }
          return false;
        }, html);
      },
      // 方法3: 键盘输入（纯文本）
      async () => {
        const text = html.replace(/<[^>]*>/g, "\n").trim();
        await this.page.locator(".ProseMirror").fill(text);
      },
    ];

    for (const method of methods) {
      try {
        await method();
        // 验证内容长度
        const length = await this.page.evaluate(() => {
          const editor = document.querySelector(".ProseMirror");
          return editor?.textContent?.length || 0;
        });
        if (length > 10) return true;
      } catch {
        continue;
      }
    }
    return false;
  }
}
```

#### 5.2.3 完整适配器

```typescript
// adapters/wechat/wechat.adapter.ts

import { Injectable } from "@nestjs/common";
import { PlaywrightService } from "../../services/playwright.service";
import { WechatPublisher } from "./wechat-publisher";
import { IPlatformAdapter, PublishOptions, PublishResult } from "../../types";

@Injectable()
export class WechatAdapter implements IPlatformAdapter {
  readonly platformType = "WECHAT_MP";
  readonly name = "微信公众号";

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  async publish(
    content: SocialContent,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const session = await this.sessionManager.getSession(
      content.userId,
      "WECHAT_MP",
    );
    if (!session) {
      return { success: false, errorMessage: "请先登录微信公众号" };
    }

    let page;
    try {
      // 1. 恢复会话
      page = await this.playwright.createPageWithSession(session.sessionData);

      // 2. 导航到编辑器
      await page.goto(
        "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit",
      );
      await page.waitForLoadState("networkidle");

      // 3. 检查登录状态
      if (page.url().includes("login")) {
        return { success: false, errorMessage: "登录已过期，请重新登录" };
      }

      // 4. 创建发布器
      const publisher = new WechatPublisher(page);

      // 5. 保存草稿
      const draftResult = await publisher.saveDraft({
        title: content.title,
        content: content.content,
        digest: content.digest,
      });

      if (!draftResult.success) {
        return { success: false, errorMessage: draftResult.error };
      }

      // 6. 根据模式决定是否群发
      if (options.mode === "draft") {
        return {
          success: true,
          type: "draft",
          externalUrl: draftResult.draftUrl,
        };
      }

      // 7. 执行群发
      const publishResult = await publisher.massPublish();
      return publishResult;
    } catch (error) {
      this.logger.error("Wechat publish error", error);
      return {
        success: false,
        errorMessage: error.message,
        debugInfo: await this.captureDebugInfo(page),
      };
    } finally {
      if (page) await page.close();
    }
  }
}
```

---

## 6. 数据库设计

### 6.1 新增/修改表

```prisma
// prisma/schema.prisma

// MCP 服务器配置
model MCPServer {
  id              String   @id @default(cuid())
  name            String   @unique  // xhs-toolkit, wechat-publisher
  command         String   // 启动命令
  args            String[] // 启动参数
  env             Json?    // 环境变量
  status          String   @default("stopped") // running, stopped, error
  lastHealthCheck DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// 发布任务队列
model SocialPublishJob {
  id              String   @id @default(cuid())
  contentId       String
  content         SocialContent @relation(fields: [contentId], references: [id])

  // 任务配置
  mode            String   // draft, publish
  scheduledAt     DateTime?

  // 状态
  status          String   @default("pending") // pending, processing, completed, failed
  progress        Int      @default(0)
  attempts        Int      @default(0)
  maxAttempts     Int      @default(3)

  // 结果
  result          Json?
  errorMessage    String?

  // 时间戳
  createdAt       DateTime @default(now())
  startedAt       DateTime?
  completedAt     DateTime?

  @@index([status])
  @@index([scheduledAt])
}

// 平台连接增强
model SocialPlatformConnection {
  id              String   @id @default(cuid())
  userId          String
  platformType    String   // WECHAT_MP, XIAOHONGSHU

  // 账号信息
  accountName     String?
  accountId       String?  // 平台账号 ID

  // 会话数据
  sessionData     Json     // cookies, localStorage 等
  cookiePath      String?  // Cookie 文件路径（用于 MCP）

  // 状态
  isActive        Boolean  @default(true)
  lastCheckAt     DateTime?
  lastPublishAt   DateTime?
  expiresAt       DateTime?

  // 发布统计
  todayPublishCount Int    @default(0)
  totalPublishCount Int    @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, platformType])
  @@index([userId])
}

// 发布日志增强
model SocialPublishLog {
  id              String   @id @default(cuid())
  contentId       String
  jobId           String?  // 关联任务

  // 操作信息
  action          String   // publish, draft, retry
  platformType    String
  mode            String   // mcp, playwright

  // 结果
  status          String   // success, failed
  externalId      String?
  externalUrl     String?

  // 调试信息
  duration        Int?     // 耗时（毫秒）
  requestLog      Json?    // 请求日志
  responseLog     Json?    // 响应日志
  screenshotUrl   String?  // 失败截图
  errorMessage    String?

  createdAt       DateTime @default(now())

  @@index([contentId])
  @@index([createdAt])
}
```

---

## 7. API 设计

### 7.1 API 端点

```typescript
// 连接管理
POST   /api/v1/ai-social/connections/:type/init     // 初始化登录
POST   /api/v1/ai-social/connections/:type/verify   // 验证登录
GET    /api/v1/ai-social/connections                // 获取所有连接
POST   /api/v1/ai-social/connections/:id/test       // 测试连接
POST   /api/v1/ai-social/connections/:id/refresh    // 刷新会话
DELETE /api/v1/ai-social/connections/:id            // 删除连接

// 内容管理
GET    /api/v1/ai-social/contents                   // 内容列表
POST   /api/v1/ai-social/contents                   // 创建内容
GET    /api/v1/ai-social/contents/:id               // 内容详情
PATCH  /api/v1/ai-social/contents/:id               // 更新内容
DELETE /api/v1/ai-social/contents/:id               // 删除内容

// 发布管理 - 增强
POST   /api/v1/ai-social/contents/:id/publish       // 发布
  Body: { mode: 'draft' | 'publish', scheduledAt?: Date }
POST   /api/v1/ai-social/contents/:id/schedule      // 定时发布
POST   /api/v1/ai-social/contents/:id/cancel        // 取消发布
GET    /api/v1/ai-social/contents/:id/status        // 发布状态
GET    /api/v1/ai-social/contents/:id/logs          // 发布日志

// 队列管理
GET    /api/v1/ai-social/queue                      // 队列状态
GET    /api/v1/ai-social/queue/:jobId               // 任务状态
POST   /api/v1/ai-social/queue/:jobId/retry         // 重试任务
DELETE /api/v1/ai-social/queue/:jobId               // 取消任务

// 限流状态
GET    /api/v1/ai-social/rate-limit/:platformType   // 查询限流状态

// MCP 管理
GET    /api/v1/ai-social/mcp/servers                // MCP 服务器列表
GET    /api/v1/ai-social/mcp/servers/:id/status     // 服务器状态
POST   /api/v1/ai-social/mcp/servers/:id/restart    // 重启服务器
```

### 7.2 发布请求示例

```typescript
// POST /api/v1/ai-social/contents/:id/publish
{
  "mode": "publish",        // draft = 只保存草稿, publish = 发布
  "scheduledAt": null,      // 定时发布时间（可选）
  "options": {
    "retryOnFailure": true,
    "maxRetries": 3
  }
}

// Response
{
  "success": true,
  "jobId": "job_123",       // 队列任务 ID
  "message": "发布任务已加入队列",
  "estimatedTime": "30秒"
}
```

---

## 8. 容器化部署

### 8.1 Dockerfile

```dockerfile
# Dockerfile.social

FROM mcr.microsoft.com/playwright:v1.42.0-jammy

# 安装 Python 和 Node.js
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv (Python 包管理)
RUN pip install uv

# 设置工作目录
WORKDIR /app

# 安装 xhs-toolkit MCP
RUN git clone https://github.com/aki66938/xhs-toolkit.git /app/mcp/xhs-toolkit
WORKDIR /app/mcp/xhs-toolkit
RUN pip install -r requirements.txt

# 回到主目录
WORKDIR /app

# 复制应用代码
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# 环境变量
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CHROME_PATH=/ms-playwright/chromium-*/chrome-linux/chrome

# 启动命令
CMD ["node", "dist/main.js"]
```

### 8.2 Docker Compose

```yaml
# docker-compose.social.yml

version: "3.8"

services:
  ai-social:
    build:
      context: .
      dockerfile: Dockerfile.social
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
    volumes:
      - social-sessions:/app/data/sessions # 会话数据持久化
      - social-cookies:/app/data/cookies # Cookie 持久化
    ports:
      - "3001:3000"
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  social-sessions:
  social-cookies:
  redis-data:
```

### 8.3 会话持久化

```typescript
// 会话数据目录结构
/app/data/
├── sessions/
│   └── {userId}/
│       ├── wechat_mp.json      # 微信会话
│       └── xiaohongshu.json    # 小红书会话
└── cookies/
    └── {userId}/
        ├── wechat_mp/          # 微信 Playwright context
        └── xiaohongshu/        # 小红书 Playwright context
```

---

## 9. 风控策略

### 9.1 发布频率限制

```typescript
// 平台发布限制配置
const PLATFORM_LIMITS = {
  WECHAT_MP: {
    maxPerDay: 1, // 订阅号每天1次
    minIntervalMinutes: 0,
    requireManualConfirm: false,
  },
  XIAOHONGSHU: {
    maxPerDay: 3, // 每天最多3篇
    minIntervalMinutes: 240, // 间隔4小时
    requireManualConfirm: false,
  },
};
```

### 9.2 行为模拟

```typescript
// 模拟人工操作
async function humanLikeDelay() {
  // 随机延迟 1-3 秒
  const delay = 1000 + Math.random() * 2000;
  await sleep(delay);
}

async function humanLikeTyping(page: Page, selector: string, text: string) {
  await page.click(selector);
  await humanLikeDelay();

  // 逐字输入，随机间隔
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(50 + Math.random() * 100);
  }
}
```

### 9.3 会话健康检查

```typescript
// 定时检查会话有效性
@Cron('0 */30 * * * *') // 每30分钟
async checkSessionHealth() {
  const connections = await this.getActiveConnections();

  for (const conn of connections) {
    const isValid = await this.adapter.checkSession(conn.sessionData);

    if (!isValid) {
      // 标记为需要重新登录
      await this.markSessionExpired(conn.id);

      // 通知用户
      await this.notifyUser(conn.userId, {
        type: 'session_expired',
        platform: conn.platformType,
      });
    }
  }
}
```

---

## 10. 实施计划

### 10.1 阶段划分

| 阶段    | 时间   | 目标                             |
| ------- | ------ | -------------------------------- |
| Phase 1 | Week 1 | 基础架构：MCP Client、队列、限流 |
| Phase 2 | Week 2 | 微信适配器：补充群发流程         |
| Phase 3 | Week 3 | 小红书适配器：集成 xhs-toolkit   |
| Phase 4 | Week 4 | 容器化部署、测试、上线           |

### 10.2 Phase 1 详细任务

```
Week 1: 基础架构
├── Day 1-2: 目录重构 + 类型定义
├── Day 3: MCP Client 服务实现
├── Day 4: 发布队列 (Bull) 集成
├── Day 5: 频率限制服务 + 测试
```

### 10.3 Phase 2 详细任务

```
Week 2: 微信公众号
├── Day 1: 选择器配置抽取
├── Day 2: WechatPublisher 实现（草稿 + 群发）
├── Day 3: WechatAdapter 重构
├── Day 4: 会话管理优化
├── Day 5: 集成测试
```

### 10.4 Phase 3 详细任务

```
Week 3: 小红书
├── Day 1: xhs-toolkit 容器化安装
├── Day 2: XhsMcpAdapter 实现
├── Day 3: 登录流程对接
├── Day 4: 发布流程对接
├── Day 5: 数据采集对接 + 测试
```

### 10.5 Phase 4 详细任务

```
Week 4: 部署上线
├── Day 1: Dockerfile 编写
├── Day 2: Docker Compose 配置
├── Day 3: 端到端测试
├── Day 4: 监控和日志
├── Day 5: 上线 + 文档
```

---

## 附录

### A. 参考资源

- [xhs-toolkit GitHub](https://github.com/aki66938/xhs-toolkit)
- [wechat-publisher-mcp GitHub](https://github.com/BobGod/wechat-publisher-mcp)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [Playwright 文档](https://playwright.dev/)

### B. 风险和应对

| 风险            | 概率 | 影响 | 应对措施               |
| --------------- | ---- | ---- | ---------------------- |
| 微信 UI 更新    | 中   | 高   | 选择器配置化，快速修复 |
| 小红书封号      | 低   | 高   | 严格限流，人工审核     |
| Cookie 过期频繁 | 中   | 中   | 健康检查，主动提醒     |
| MCP Server 崩溃 | 低   | 中   | 进程监控，自动重启     |

---

**文档版本**: 1.0
**最后更新**: 2026-01-25
**作者**: Claude Code
