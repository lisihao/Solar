/**
 * Puppeteer 网页抓取服务
 * 用于处理需要 JavaScript 渲染或有 Cloudflare 保护的网页
 */

import { Injectable, Logger } from "@nestjs/common";
import * as puppeteer from "puppeteer";
import { PuppeteerPoolService } from "../../../../common/browser/puppeteer-pool.service";

export interface PuppeteerFetchResult {
  success: boolean;
  html?: string;
  title?: string;
  error?: string;
  loadTime?: number;
}

@Injectable()
export class PuppeteerFetcherService {
  private readonly logger = new Logger(PuppeteerFetcherService.name);

  constructor(private readonly browserPool: PuppeteerPoolService) {}

  /**
   * 使用 Puppeteer 获取网页内容
   * 可以绕过 Cloudflare 等 JavaScript 挑战
   *
   * 注意：在容器环境（如 Railway）中，Cloudflare 可能仍然无法绕过
   * 因为容器 IP 可能被标记，或者无头浏览器被检测到
   */
  async fetchPage(
    url: string,
    options: {
      timeout?: number;
      waitForSelector?: string;
      waitForNavigation?: boolean;
    } = {},
  ): Promise<PuppeteerFetchResult> {
    const {
      timeout = 30000,
      waitForSelector,
      waitForNavigation = true,
    } = options;
    const startTime = Date.now();

    // Cloudflare 等待的最大时间（固定 10 秒，不要太长）
    const CLOUDFLARE_MAX_WAIT = 10000;

    let page: puppeteer.Page | null = null;

    try {
      this.logger.log(`Fetching page with Puppeteer: ${url}`);

      const browser = await this.browserPool.getBrowser();
      page = await browser.newPage();

      // 设置 viewport 和 user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // 设置额外的请求头
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      });

      // 绕过 webdriver 检测
      await page.evaluateOnNewDocument(() => {
        // 移除 webdriver 标记
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });

        // 模拟 chrome 对象
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).chrome = {
          runtime: {},
        };

        // 模拟权限
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (
          parameters: PermissionDescriptor,
        ) =>
          parameters.name === "notifications"
            ? Promise.resolve({
                state: Notification.permission,
              } as PermissionStatus)
            : originalQuery(parameters);
      });

      // 导航到页面
      const response = await page.goto(url, {
        waitUntil: waitForNavigation ? "networkidle2" : "domcontentloaded",
        timeout,
      });

      if (!response) {
        throw new Error("No response received from page");
      }

      const status = response.status();
      if (status >= 400 && status !== 403) {
        // 403 可能是 Cloudflare 中间页面，继续等待
        throw new Error(`Page returned status ${status}`);
      }

      // 等待 Cloudflare 挑战完成（如果存在）
      // 使用固定的较短超时，避免长时间等待
      const cloudflareResult = await this.waitForCloudflare(
        page,
        CLOUDFLARE_MAX_WAIT,
      );

      if (!cloudflareResult.passed) {
        // Cloudflare 验证未通过，直接返回失败
        this.logger.warn(
          `Cloudflare challenge not passed for ${url}, returning failure`,
        );
        return {
          success: false,
          error:
            "Cloudflare protection detected - cannot bypass in container environment",
          loadTime: Date.now() - startTime,
        };
      }

      // 如果指定了等待选择器
      if (waitForSelector) {
        await page
          .waitForSelector(waitForSelector, { timeout: 10000 })
          .catch(() => {
            this.logger.warn(
              `Selector ${waitForSelector} not found, continuing anyway`,
            );
          });
      }

      // 获取页面 HTML
      const html = await page.content();
      const title = await page.title();

      // 最终检查：确保内容不是 Cloudflare 页面
      if (this.isCloudflareContent(html)) {
        this.logger.warn(`Final content is still Cloudflare page for ${url}`);
        return {
          success: false,
          error: "Page content is still Cloudflare challenge page",
          loadTime: Date.now() - startTime,
        };
      }

      const loadTime = Date.now() - startTime;
      this.logger.log(
        `Successfully fetched page with Puppeteer (${loadTime}ms): ${title}`,
      );

      return {
        success: true,
        html,
        title,
        loadTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Puppeteer fetch failed for ${url}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        loadTime: Date.now() - startTime,
      };
    } finally {
      // 关闭页面但保留浏览器实例
      if (page) {
        await page
          .close()
          .catch((err: Error) =>
            this.logger.debug(`Page close failed: ${err?.message}`),
          );
      }
    }
  }

  /**
   * 检查内容是否为 Cloudflare 挑战页面
   */
  private isCloudflareContent(html: string): boolean {
    const cloudflareIndicators = [
      "Just a moment...",
      "Checking your browser",
      "Verify you are human",
      "cf-browser-verification",
      "challenge-platform",
      "cf-turnstile",
      "_cf_chl_opt",
    ];

    return cloudflareIndicators.some((indicator) => html.includes(indicator));
  }

  /**
   * 等待 Cloudflare 挑战完成
   * @returns { passed: boolean } - 是否通过验证
   */
  private async waitForCloudflare(
    page: puppeteer.Page,
    maxWait: number,
  ): Promise<{ passed: boolean }> {
    const startTime = Date.now();
    const checkInterval = 1000; // 每秒检查一次，减少日志输出

    // 首先检查是否有 Cloudflare 挑战
    const initialHtml = await page.content();
    if (!this.isCloudflareContent(initialHtml)) {
      // 没有 Cloudflare 挑战，直接通过
      this.logger.log("No Cloudflare challenge detected");
      return { passed: true };
    }

    this.logger.log("Cloudflare challenge detected, waiting for completion...");

    while (Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));

      const html = await page.content();

      if (!this.isCloudflareContent(html)) {
        // 不再是 Cloudflare 挑战页面，验证已通过
        this.logger.log(
          `Cloudflare challenge passed after ${Date.now() - startTime}ms`,
        );
        return { passed: true };
      }

      // 只每 3 秒输出一次日志，减少日志噪音
      if ((Date.now() - startTime) % 3000 < checkInterval) {
        this.logger.debug(
          `Still waiting for Cloudflare... (${Math.round((Date.now() - startTime) / 1000)}s)`,
        );
      }
    }

    this.logger.warn(
      `Cloudflare challenge timeout after ${maxWait}ms - verification not completed`,
    );
    return { passed: false };
  }

  // Browser lifecycle managed by PuppeteerPoolService
}
