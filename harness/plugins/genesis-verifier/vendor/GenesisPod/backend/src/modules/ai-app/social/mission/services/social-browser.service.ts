import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { SessionData } from "../types/platform.types";
import { Page } from "puppeteer";
import { BrowserService } from "../../../../../common/browser/browser.service";

// Re-export SessionData for backward compatibility
export type { SessionData };

// Re-export Puppeteer Page type for adapters
export type { Page };

// Platform login configuration
export interface PlatformLoginConfig {
  loginUrl: string;
  loginSuccessIndicator: string; // CSS selector or URL pattern
  qrCodeSelector?: string;
  needClickLogin?: boolean; // 是否需要先点击登录按钮
  loginButtonSelector?: string; // 登录按钮选择器
}

// Pending login session
export interface PendingLoginSession {
  contextId: string;
  platformType: string;
  userId: string;
  createdAt: Date;
  page: Page;
}

// Platform configs
const PLATFORM_CONFIGS: Record<string, PlatformLoginConfig> = {
  WECHAT_MP: {
    loginUrl: "https://mp.weixin.qq.com/",
    loginSuccessIndicator: ".weui-desktop-account__nickname", // 登录后显示的昵称
    qrCodeSelector:
      ".login__type__container__scan__qrcode img, .qrcode img, [class*='qrcode'] img, canvas[class*='qr']", // 二维码元素 - 多个选择器
  },
  XIAOHONGSHU: {
    loginUrl: "https://www.xiaohongshu.com/explore",
    // 登录后显示的用户信息 - 多种选择器覆盖不同页面状态
    loginSuccessIndicator:
      ".user-info, .user-name, .header-user, .side-bar .avatar, .sidebar .avatar, [class*='avatar'][class*='sidebar'], .reds-button-new-note, [class*='publish'], .feeds-page",
    qrCodeSelector: ".qrcode-image img, [class*='qrcode'] img, canvas", // 主站二维码选择器
    needClickLogin: true, // 需要先点击登录按钮
    loginButtonSelector: ".login-btn, .login-button, button:has-text('登录')", // 登录按钮选择器
  },
};

// Export for use in other services
export { PLATFORM_CONFIGS };

@Injectable()
export class SocialBrowserService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(SocialBrowserService.name);
  private pendingLogins: Map<string, PendingLoginSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private readonly browserService: BrowserService) {}

  onModuleInit() {
    // Start periodic cleanup of expired sessions (every 2 minutes)
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredSessions().catch((err) => {
          this.logger.error("Failed to cleanup expired sessions", err);
        });
      },
      2 * 60 * 1000,
    ).unref();
    this.logger.log("Playwright service initialized with session cleanup");
  }

  async onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    // BrowserService handles its own cleanup via OnModuleDestroy
  }

  // ==================== 委托给 BrowserService 的方法 ====================

  async createContext(contextId: string) {
    return this.browserService.createContext(contextId);
  }

  async getContext(contextId: string) {
    return this.browserService.getContext(contextId);
  }

  async createPage(contextId: string): Promise<Page> {
    return this.browserService.createPage(contextId);
  }

  async saveSession(contextId: string): Promise<SessionData | null> {
    return this.browserService.saveSession(
      contextId,
    ) as Promise<SessionData | null>;
  }

  async restoreSession(
    contextId: string,
    sessionData: SessionData,
  ): Promise<void> {
    return this.browserService.restoreSession(contextId, sessionData);
  }

  async closeContext(contextId: string): Promise<void> {
    return this.browserService.closeContext(contextId);
  }

  async cleanup(): Promise<void> {
    return this.browserService.cleanup();
  }

  async screenshot(page: Page, path: string): Promise<void> {
    return this.browserService.screenshot(page, path);
  }

  // ==================== 登录会话管理 ====================

  /**
   * 开始登录会话 - 打开平台登录页面
   */
  async startLoginSession(
    userId: string,
    platformType: string,
  ): Promise<{ sessionKey: string; screenshot: string }> {
    const config = PLATFORM_CONFIGS[platformType];
    if (!config) {
      throw new Error(`Unknown platform: ${platformType}`);
    }

    const sessionKey = `login-${userId}-${platformType}-${uuidv4()}`;
    this.logger.log(`Starting login session: ${sessionKey}`);

    try {
      const page = await this.browserService.createPage(sessionKey);

      // 导航到登录页
      await page.goto(config.loginUrl, { waitUntil: "networkidle0" });

      // 等待页面加载
      await new Promise((r) => setTimeout(r, 2000));

      // 如果需要先点击登录按钮
      if (config.needClickLogin && config.loginButtonSelector) {
        try {
          // 先尝试关闭任何现有的遮罩层
          const mask = await page.$(".reds-mask, [class*='mask']");
          if (mask) {
            await mask.click();
            await new Promise((r) => setTimeout(r, 500));
          }

          const loginBtn = await page.$(config.loginButtonSelector);
          if (loginBtn) {
            await loginBtn.click();
            await new Promise((r) => setTimeout(r, 2000)); // 等待登录弹窗出现
            this.logger.log(`Clicked login button for ${platformType}`);
          }
        } catch (e) {
          this.logger.warn(`Failed to click login button: ${e}`);
        }
      }

      // 截取二维码区域（如果有配置选择器）
      let screenshotData: Uint8Array;
      if (config.qrCodeSelector) {
        try {
          // 等待二维码元素出现
          await page.waitForSelector(config.qrCodeSelector, { timeout: 10000 });
          const qrElement = await page.$(config.qrCodeSelector);
          if (qrElement) {
            screenshotData = await qrElement.screenshot({ type: "png" });
            this.logger.log(
              `QR code element screenshot taken for ${platformType}`,
            );
          } else {
            // 降级到全页截图
            screenshotData = await page.screenshot({ type: "png" });
            this.logger.warn(
              `QR code element not found, using full page screenshot`,
            );
          }
        } catch {
          // 降级到全页截图
          screenshotData = await page.screenshot({ type: "png" });
          this.logger.warn(
            `Failed to screenshot QR code element, using full page`,
          );
        }
      } else {
        screenshotData = await page.screenshot({ type: "png" });
      }
      const screenshotBase64 = `data:image/png;base64,${Buffer.from(screenshotData).toString("base64")}`;

      // 保存待验证的登录会话
      this.pendingLogins.set(sessionKey, {
        contextId: sessionKey,
        platformType,
        userId,
        createdAt: new Date(),
        page,
      });

      this.logger.log(`Login session started: ${sessionKey}`);

      return {
        sessionKey,
        screenshot: screenshotBase64,
      };
    } catch (error) {
      this.logger.error(`Failed to start login session: ${error}`);
      await this.browserService.closeContext(sessionKey);
      throw error;
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(sessionKey: string): Promise<{
    loggedIn: boolean;
    accountName?: string;
    screenshot?: string;
    sessionData?: SessionData;
  }> {
    const session = this.pendingLogins.get(sessionKey);
    if (!session) {
      // 详细的诊断日志
      const allSessionKeys = Array.from(this.pendingLogins.keys());
      this.logger.error(
        `Session not found: ${sessionKey}. ` +
          `Available sessions (${allSessionKeys.length}): ${allSessionKeys.join(", ") || "none"}`,
      );
      throw new Error(
        `登录会话已过期或不存在 (session: ${sessionKey.substring(0, 20)}...)`,
      );
    }

    const config = PLATFORM_CONFIGS[session.platformType];
    if (!config) {
      throw new Error(`不支持的平台类型: ${session.platformType}`);
    }

    try {
      const { page } = session;

      // 多种方式检测登录状态
      let loggedIn = false;

      // 方法1: 检查登录成功指示器元素
      const hasIndicator = await page
        .$(config.loginSuccessIndicator)
        .then((el: unknown) => !!el)
        .catch(() => false);

      if (hasIndicator) {
        loggedIn = true;
        this.logger.log(
          `Login detected via indicator for ${session.platformType}`,
        );
      }

      // 方法2: 微信公众号特殊检测 - 检查 URL 跳转 + cookies + 页面元素
      if (!loggedIn && session.platformType === "WECHAT_MP") {
        // 检查当前 URL 是否已跳转到管理后台
        const currentUrl = page.url();
        const isInDashboard =
          currentUrl.includes("/cgi-bin/home") ||
          currentUrl.includes("/cgi-bin/frame") ||
          currentUrl.includes("action=home") ||
          currentUrl.includes("t=home/index");

        if (isInDashboard) {
          loggedIn = true;
          this.logger.log(
            `WeChat MP login detected via URL redirect: ${currentUrl}`,
          );
        }

        // 检查微信公众号相关的 cookies
        if (!loggedIn) {
          const context = await this.browserService.getContext(sessionKey);
          if (context) {
            const cookies = await context.cookies();
            const hasLoginCookie = cookies.some(
              (c: { name: string }) =>
                c.name === "slave_user" ||
                c.name === "slave_sid" ||
                c.name === "bizuin" ||
                c.name === "data_bizuin" ||
                c.name === "data_ticket",
            );

            if (hasLoginCookie) {
              loggedIn = true;
              this.logger.log(
                `WeChat MP login detected via cookies: ${cookies.map((c: { name: string }) => c.name).join(", ")}`,
              );
            }
          }
        }

        // 检查页面是否包含登录后才有的元素
        if (!loggedIn) {
          const hasLoggedInContent = await page.evaluate(() => {
            // 微信公众号后台特有的元素 - 只有真正登录后才会出现
            const selectors = [
              ".weui-desktop-account", // 账号信息区域
              ".weui-desktop-sidebar", // 侧边栏
              ".weui-desktop-main", // 主内容区
              '[class*="menu-root"]', // 菜单
              '[class*="home-index"]', // 首页
              ".main_bd", // 主体区域
              "#menuBar", // 菜单栏
            ];
            for (const selector of selectors) {
              if (document.querySelector(selector)) {
                return true;
              }
            }
            // 检查是否有"扫码成功，请在手机上确认"的等待状态
            // 这表示用户扫码了但还没确认，不应该认为已登录
            const waitingForConfirm =
              document.body?.innerText?.includes("请在手机上确认");
            if (waitingForConfirm) {
              return false;
            }
            // 不再使用"二维码不存在=已登录"的逻辑，因为扫码后二维码消失但用户还没确认
            // 只有真正检测到后台元素才认为登录成功
            return false;
          });

          if (hasLoggedInContent) {
            loggedIn = true;
            this.logger.log(
              `WeChat MP login detected via page content analysis`,
            );
          }
        }
      }

      // 方法3: 小红书特殊检测 - 检查登录弹窗是否消失 + cookies
      if (!loggedIn && session.platformType === "XIAOHONGSHU") {
        // 检查登录弹窗是否还在
        const loginModalVisible = await page
          .$(".login-container, .login-modal, [class*='login-dialog']")
          .then((el: unknown) => !!el)
          .catch(() => false);

        // 检查是否有登录相关的 cookies
        const context = await this.browserService.getContext(sessionKey);
        if (context) {
          const cookies = await context.cookies();
          const hasLoginCookie = cookies.some(
            (c: { name: string }) =>
              c.name.includes("web_session") ||
              c.name.includes("customer") ||
              c.name.includes("userid") ||
              c.name.includes("xsecappid"),
          );

          if (hasLoginCookie && !loginModalVisible) {
            loggedIn = true;
            this.logger.log(
              `Xiaohongshu login detected via cookies: ${cookies.map((c: { name: string }) => c.name).join(", ")}`,
            );
          }
        }

        // 方法3: 检查页面内容是否包含登录后才有的元素
        if (!loggedIn) {
          const hasLoggedInContent = await page.evaluate(() => {
            // 检查是否有发布按钮、用户头像等
            const selectors = [
              '[class*="publish"]',
              '[class*="creator"]',
              ".reds-button-new-note",
              '[class*="sidebar"] [class*="avatar"]',
              '[class*="user-avatar"]',
            ];
            for (const selector of selectors) {
              if (document.querySelector(selector)) {
                return true;
              }
            }
            // 检查是否没有登录按钮了
            const loginBtn = document.querySelector(
              ".login-btn, [class*='login-button'], button:has-text('登录')",
            );
            return !loginBtn;
          });

          if (hasLoggedInContent) {
            loggedIn = true;
            this.logger.log(
              `Xiaohongshu login detected via page content analysis`,
            );
          }
        }
      }

      if (loggedIn) {
        // 尝试获取账号名称
        let accountName = "";
        try {
          accountName = await page.$eval(
            config.loginSuccessIndicator,
            (el: Element) => el.textContent?.trim() || "",
          );
        } catch {
          // 忽略获取账号名称的错误
        }

        // 等待一小段时间确保 cookies 完全设置
        await new Promise((r) => setTimeout(r, 2000));

        // 保存会话数据
        let sessionData = (await this.browserService.saveSession(
          sessionKey,
        )) as SessionData | null;

        // 验证 cookies 数量，如果为 0 则重试
        if (!sessionData?.cookies?.length) {
          this.logger.warn(
            `Session saved with 0 cookies, waiting and retrying...`,
          );
          await new Promise((r) => setTimeout(r, 3000));
          sessionData = (await this.browserService.saveSession(
            sessionKey,
          )) as SessionData | null;
        }

        // WeChat MP 特殊处理：从 URL 中提取并保存 token
        // Token 是微信公众号 CSRF 保护机制，不存储在 cookies 中
        // 必须在登录成功时保存，发布时使用
        if (session.platformType === "WECHAT_MP" && sessionData) {
          const currentUrl = page.url();
          const tokenMatch = currentUrl.match(/token=(\d+)/);
          if (tokenMatch) {
            sessionData.wechatToken = tokenMatch[1];
            this.logger.log(
              `WeChat MP token extracted and saved: ${sessionData.wechatToken}`,
            );
          } else {
            // 尝试从页面 JavaScript 变量中提取 token
            const pageToken = await page
              .evaluate(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                return w.wx?.commonData?.t || w.cgiData?.t || w.uin || "";
              })
              .catch(() => "");
            if (pageToken) {
              sessionData.wechatToken = pageToken;
              this.logger.log(
                `WeChat MP token extracted from page JS: ${sessionData.wechatToken}`,
              );
            } else {
              this.logger.warn(
                `WeChat MP login successful but no token found in URL or page. Publishing may fail.`,
              );
            }
          }
        }

        // 记录 cookies 数量用于诊断
        this.logger.log(
          `Login successful for session: ${sessionKey}, cookies count: ${sessionData?.cookies?.length || 0}`,
        );

        // 如果仍然没有 cookies，记录警告
        if (!sessionData?.cookies?.length) {
          this.logger.warn(
            `Warning: Session saved without cookies. This may cause issues during publishing.`,
          );
        }

        return {
          loggedIn: true,
          accountName,
          sessionData: sessionData || undefined,
        };
      }

      // 未登录，返回新截图（优先截取二维码区域）
      let screenshotData: Uint8Array | null = null;

      try {
        if (config.qrCodeSelector) {
          try {
            const qrElement = await page.$(config.qrCodeSelector);
            if (qrElement) {
              screenshotData = await qrElement.screenshot({ type: "png" });
            }
          } catch {
            // QR元素截图失败，使用全页截图
          }
        }

        if (!screenshotData) {
          screenshotData = await page.screenshot({ type: "png" });
        }
      } catch (screenshotError) {
        this.logger.warn(
          `Screenshot failed, returning pending status without new screenshot: ${screenshotError}`,
        );
        // 截图失败时返回 pending 状态但不包含新截图
        return {
          loggedIn: false,
        };
      }

      if (!screenshotData) {
        return {
          loggedIn: false,
        };
      }

      const screenshot = `data:image/png;base64,${Buffer.from(screenshotData).toString("base64")}`;

      return {
        loggedIn: false,
        screenshot,
      };
    } catch (error) {
      this.logger.error(`Failed to check login status: ${error}`);
      // 返回错误状态而不是抛出异常，让前端可以继续轮询
      return {
        loggedIn: false,
      };
    }
  }

  /**
   * 获取登录页面截图（优先截取二维码区域）
   */
  async getLoginScreenshot(sessionKey: string): Promise<string> {
    const session = this.pendingLogins.get(sessionKey);
    if (!session) {
      throw new Error(`Login session not found: ${sessionKey}`);
    }

    const config = PLATFORM_CONFIGS[session.platformType];
    const { page } = session;

    let screenshotData: Uint8Array;
    if (config?.qrCodeSelector) {
      try {
        const qrElement = await page.$(config.qrCodeSelector);
        if (qrElement) {
          screenshotData = await qrElement.screenshot({ type: "png" });
        } else {
          screenshotData = await page.screenshot({ type: "png" });
        }
      } catch {
        screenshotData = await page.screenshot({ type: "png" });
      }
    } else {
      screenshotData = await page.screenshot({ type: "png" });
    }
    return `data:image/png;base64,${Buffer.from(screenshotData).toString("base64")}`;
  }

  /**
   * 结束登录会话
   */
  async endLoginSession(sessionKey: string): Promise<void> {
    const session = this.pendingLogins.get(sessionKey);
    if (session) {
      this.pendingLogins.delete(sessionKey);
      await this.browserService.closeContext(sessionKey);
      this.logger.log(`Login session ended: ${sessionKey}`);
    }
  }

  /**
   * 清理过期的登录会话（超过10分钟）
   */
  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    const expireMs = 10 * 60 * 1000; // 10 minutes

    for (const [key, session] of this.pendingLogins) {
      if (now.getTime() - session.createdAt.getTime() > expireMs) {
        this.logger.log(`Cleaning up expired session: ${key}`);
        await this.endLoginSession(key);
      }
    }
  }
}
