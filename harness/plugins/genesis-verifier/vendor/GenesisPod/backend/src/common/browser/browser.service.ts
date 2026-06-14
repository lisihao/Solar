/**
 * Browser Service
 * 通用浏览器生命周期管理（共享基础设施）
 *
 * 提供通用的浏览器操作能力：
 * - 基于 PuppeteerPoolService 的浏览器复用
 * - 浏览器上下文（incognito context）管理
 * - 页面管理
 * - 会话保存与恢复
 * - 截图
 * - 资源清理
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { BrowserContext, Page } from "puppeteer";
import { BrowserPageOptions, SessionData } from "./browser.types";
import { PuppeteerPoolService } from "./puppeteer-pool.service";

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private contexts: Map<string, BrowserContext> = new Map();

  constructor(private readonly puppeteerPool: PuppeteerPoolService) {}

  async onModuleDestroy() {
    await this.cleanup();
  }

  /**
   * 创建浏览器上下文（Puppeteer incognito context）
   */
  async createContext(
    contextId: string,
    _options?: BrowserPageOptions,
  ): Promise<BrowserContext> {
    const browser = await this.puppeteerPool.getBrowser();
    const context = await browser.createBrowserContext();
    this.contexts.set(contextId, context);
    return context;
  }

  /**
   * 获取已有的浏览器上下文
   */
  async getContext(contextId: string): Promise<BrowserContext | null> {
    return this.contexts.get(contextId) ?? null;
  }

  /**
   * 在指定上下文中创建新页面（上下文不存在时自动创建）
   */
  async createPage(
    contextId: string,
    options?: BrowserPageOptions,
  ): Promise<Page> {
    let context = this.contexts.get(contextId);
    if (!context) {
      context = await this.createContext(contextId, options);
    }
    const page = await context.newPage();

    // Apply viewport and userAgent
    const viewport = options?.viewport ?? { width: 1280, height: 720 };
    await page.setViewport(viewport);

    const userAgent =
      options?.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    await page.setUserAgent(userAgent);

    // 2026-05-16: Anti-detection runtime patches —— WeChat MP 等站对 puppeteer
    //   有 silent reject 反爬，仅 launch args `--disable-blink-features=
    //   AutomationControlled` 不够，runtime 还要 patch navigator.webdriver
    //   / window.chrome / navigator.plugins / languages 等指纹。
    //   参考 puppeteer-extra-plugin-stealth 的核心 evasions。
    await page.evaluateOnNewDocument(() => {
      // 1. 删 navigator.webdriver（最高优先级）
      Object.defineProperty(Navigator.prototype, "webdriver", {
        get: () => undefined,
        configurable: true,
      });

      // 2. 注入 window.chrome.runtime（headless Chrome 默认没有）
      if (!(window as unknown as { chrome?: unknown }).chrome) {
        (window as unknown as { chrome: Record<string, unknown> }).chrome = {
          runtime: {},
          loadTimes: () => ({}),
          csi: () => ({}),
          app: {},
        };
      }

      // 3. navigator.plugins 改成非空数组（headless 默认 length=0）
      Object.defineProperty(Navigator.prototype, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          {
            name: "Chrome PDF Viewer",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ],
        configurable: true,
      });

      // 4. navigator.languages 设为中文优先（headless 默认 ['en-US']）
      Object.defineProperty(Navigator.prototype, "languages", {
        get: () => ["zh-CN", "zh", "en"],
        configurable: true,
      });

      // 5. permissions.query 不再泄漏 'denied' for notifications（headless 特征）
      const originalQuery = window.navigator.permissions?.query?.bind(
        window.navigator.permissions,
      );
      if (originalQuery) {
        window.navigator.permissions.query = (
          parameters: PermissionDescriptor,
        ): Promise<PermissionStatus> =>
          parameters.name === "notifications"
            ? Promise.resolve({
                state: Notification.permission,
              } as PermissionStatus)
            : originalQuery(parameters);
      }
    });

    return page;
  }

  /**
   * 关闭指定上下文
   */
  async closeContext(contextId: string): Promise<void> {
    const context = this.contexts.get(contextId);
    if (context) {
      await context.close();
      this.contexts.delete(contextId);
    }
  }

  /**
   * 保存会话数据（cookies + localStorage + sessionStorage）
   */
  async saveSession(contextId: string): Promise<SessionData | null> {
    const context = this.contexts.get(contextId);
    if (!context) {
      return null;
    }

    const pages = await context.pages();
    if (pages.length === 0) {
      return null;
    }

    const page = pages[0];
    const rawCookies = await context.cookies();
    const cookies = rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (["Strict", "Lax", "None"] as const).includes(
        c.sameSite as "Strict" | "Lax" | "None",
      )
        ? (c.sameSite as "Strict" | "Lax" | "None")
        : undefined,
    }));

    // Get storage data
    const localStorage = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          data[key] = window.localStorage.getItem(key) || "";
        }
      }
      return data;
    });

    const sessionStorage = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key) {
          data[key] = window.sessionStorage.getItem(key) || "";
        }
      }
      return data;
    });

    return { cookies, localStorage, sessionStorage };
  }

  /**
   * 恢复会话数据到指定上下文（上下文不存在时自动创建）
   * 恢复 cookies + localStorage + sessionStorage
   */
  async restoreSession(
    contextId: string,
    sessionData: SessionData,
  ): Promise<void> {
    let context = this.contexts.get(contextId);
    if (!context) {
      context = await this.createContext(contextId);
    }

    // Restore cookies
    if (sessionData.cookies && sessionData.cookies.length > 0) {
      await context.setCookie(...sessionData.cookies);
    }

    // Restore localStorage and sessionStorage via a temporary page
    const hasLocalStorage =
      sessionData.localStorage &&
      Object.keys(sessionData.localStorage).length > 0;
    const hasSessionStorage =
      sessionData.sessionStorage &&
      Object.keys(sessionData.sessionStorage).length > 0;

    if (hasLocalStorage || hasSessionStorage) {
      // Need a page on the correct origin to set storage.
      // Determine origin from first cookie domain, fall back to about:blank.
      const domain = sessionData.cookies?.[0]?.domain?.replace(/^\./, "");
      const origin = domain ? `https://${domain}` : null;

      if (origin) {
        let tempPage: Page | null = null;
        try {
          tempPage = await context.newPage();
          // Navigate to origin so storage writes go to the right partition
          await tempPage.goto(origin, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });

          if (hasLocalStorage) {
            await tempPage.evaluate((storage: Record<string, string>) => {
              for (const [key, value] of Object.entries(storage)) {
                window.localStorage.setItem(key, value);
              }
            }, sessionData.localStorage!);
          }

          if (hasSessionStorage) {
            await tempPage.evaluate((storage: Record<string, string>) => {
              for (const [key, value] of Object.entries(storage)) {
                window.sessionStorage.setItem(key, value);
              }
            }, sessionData.sessionStorage!);
          }

          this.logger.debug(
            `Restored storage for context ${contextId}: ` +
              `localStorage=${Object.keys(sessionData.localStorage || {}).length}, ` +
              `sessionStorage=${Object.keys(sessionData.sessionStorage || {}).length}`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to restore storage for context ${contextId}: ${error}`,
          );
        } finally {
          if (tempPage) {
            await tempPage.close().catch(() => {});
          }
        }
      }
    }
  }

  /**
   * 截取页面截图（保存到指定路径）
   */
  async screenshot(page: Page, path: string): Promise<void> {
    await page.screenshot({ path, fullPage: true });
  }

  /**
   * 清理所有上下文（浏览器实例由 PuppeteerPoolService 管理）
   */
  async cleanup(): Promise<void> {
    for (const [id, context] of this.contexts) {
      try {
        await context.close();
      } catch (error) {
        this.logger.warn(`Failed to close context ${id}: ${error}`);
      }
      this.contexts.delete(id);
    }

    this.logger.log("Browser contexts cleanup completed");
  }
}
