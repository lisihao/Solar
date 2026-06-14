#!/usr/bin/env npx ts-node
/**
 * 🚀 独立浏览器抓取验证测试
 *
 * 直接使用 Puppeteer 测试各种受保护网站的抓取能力
 * 不需要后端服务器，模拟 PuppeteerFetcherService 的行为
 *
 * 使用方式：
 *   cd backend && npx ts-node scripts/standalone-browser-test.ts
 */

import * as puppeteer from "puppeteer";
import axios from "axios";

interface FetchResult {
  url: string;
  method: "direct" | "jina" | "puppeteer";
  success: boolean;
  title?: string;
  contentLength?: number;
  loadTime: number;
  error?: string;
  hasCloudflare?: boolean;
}

// 测试 URL 列表
const TEST_URLS = [
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/",
    expectCloudflare: false,
  },
  {
    name: "Hacker News",
    url: "https://news.ycombinator.com/",
    expectCloudflare: false,
  },
  {
    name: "Adafruit Blog",
    url: "https://blog.adafruit.com/",
    expectCloudflare: true,
  },
  {
    name: "ArsTechnica",
    url: "https://arstechnica.com/",
    expectCloudflare: false,
  },
  {
    name: "Medium",
    url: "https://medium.com/",
    expectCloudflare: false,
  },
];

// Jina Reader API
const JINA_READER_API = "https://r.jina.ai";

// Cloudflare 检测关键词
const CLOUDFLARE_INDICATORS = [
  "Just a moment...",
  "Checking your browser",
  "Verify you are human",
  "cf-browser-verification",
  "challenge-platform",
  "DDoS protection by",
];

// CAPTCHA 检测关键词
const CAPTCHA_INDICATORS = [
  "Verify you are human",
  "Please turn JavaScript on",
  "Enable JavaScript and cookies",
  "needs to review the security",
];

/**
 * 方法 1: 直接 HTTP 请求
 */
async function fetchDirect(url: string): Promise<FetchResult> {
  const startTime = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const html = response.data;
    const hasCloudflare = CLOUDFLARE_INDICATORS.some((indicator) =>
      html.includes(indicator),
    );

    // 提取标题
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    return {
      url,
      method: "direct",
      success: !hasCloudflare && html.length > 1000,
      title,
      contentLength: html.length,
      loadTime: Date.now() - startTime,
      hasCloudflare,
    };
  } catch (error: any) {
    return {
      url,
      method: "direct",
      success: false,
      loadTime: Date.now() - startTime,
      error: error.response?.status
        ? `HTTP ${error.response.status}`
        : error.message,
    };
  }
}

/**
 * 方法 2: Jina Reader API
 */
async function fetchViaJina(url: string): Promise<FetchResult> {
  const startTime = Date.now();
  try {
    const jinaUrl = `${JINA_READER_API}/${url}`;
    const response = await axios.get(jinaUrl, {
      timeout: 30000,
      headers: {
        Accept: "text/plain",
        "User-Agent": "DeepDive/1.0",
      },
    });

    const content = response.data;

    // 检测 CAPTCHA
    const hasCaptcha = CAPTCHA_INDICATORS.some((indicator) =>
      content.toLowerCase().includes(indicator.toLowerCase()),
    );

    if (hasCaptcha) {
      return {
        url,
        method: "jina",
        success: false,
        loadTime: Date.now() - startTime,
        error: "CAPTCHA detected",
        hasCloudflare: true,
      };
    }

    // 提取标题 (Markdown 格式)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : undefined;

    return {
      url,
      method: "jina",
      success: content.length > 500,
      title,
      contentLength: content.length,
      loadTime: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      url,
      method: "jina",
      success: false,
      loadTime: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * 方法 3: Puppeteer 无头浏览器
 */
async function fetchViaPuppeteer(
  browser: puppeteer.Browser,
  url: string,
): Promise<FetchResult> {
  const startTime = Date.now();
  const page = await browser.newPage();

  try {
    // 设置 viewport 和 user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    // 设置额外请求头
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });

    // 绕过 webdriver 检测
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
      (window as any).chrome = { runtime: {} };
    });

    // 导航到页面
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });

    // 等待 Cloudflare 验证完成
    await waitForCloudflare(page);

    // 获取页面内容
    const html = await page.content();
    const title = await page.title();

    const hasCloudflare = CLOUDFLARE_INDICATORS.some((indicator) =>
      html.includes(indicator),
    );

    return {
      url,
      method: "puppeteer",
      success: !hasCloudflare && html.length > 1000,
      title,
      contentLength: html.length,
      loadTime: Date.now() - startTime,
      hasCloudflare,
    };
  } catch (error: any) {
    return {
      url,
      method: "puppeteer",
      success: false,
      loadTime: Date.now() - startTime,
      error: error.message,
    };
  } finally {
    await page.close();
  }
}

/**
 * 等待 Cloudflare 验证完成
 */
async function waitForCloudflare(page: puppeteer.Page): Promise<void> {
  const maxWait = 15000;
  const checkInterval = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const html = await page.content();
    const isCloudflareChallenge = CLOUDFLARE_INDICATORS.some((indicator) =>
      html.includes(indicator),
    );

    if (!isCloudflareChallenge) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
}

/**
 * 测试单个 URL，尝试所有方法
 */
async function testUrl(
  browser: puppeteer.Browser,
  testCase: { name: string; url: string; expectCloudflare: boolean },
  index: number,
): Promise<{
  name: string;
  url: string;
  directResult: FetchResult;
  jinaResult?: FetchResult;
  puppeteerResult?: FetchResult;
  finalSuccess: boolean;
  usedMethod: string;
}> {
  console.log(
    `\n${"═".repeat(60)}\n📋 [${index + 1}/${TEST_URLS.length}] ${testCase.name}`,
  );
  console.log(`   URL: ${testCase.url}`);
  console.log(`   预期 Cloudflare: ${testCase.expectCloudflare ? "是" : "否"}`);

  // 方法 1: 直接请求
  console.log("\n   🔹 方法 1: 直接 HTTP 请求");
  const directResult = await fetchDirect(testCase.url);
  console.log(
    `      ${directResult.success ? "✅" : "❌"} ${directResult.success ? `成功 (${directResult.contentLength} chars, ${directResult.loadTime}ms)` : directResult.error || "Cloudflare 阻止"}`,
  );

  if (directResult.success) {
    return {
      name: testCase.name,
      url: testCase.url,
      directResult,
      finalSuccess: true,
      usedMethod: "direct",
    };
  }

  // 方法 2: Jina Reader
  console.log("\n   🔹 方法 2: Jina Reader API");
  const jinaResult = await fetchViaJina(testCase.url);
  console.log(
    `      ${jinaResult.success ? "✅" : "❌"} ${jinaResult.success ? `成功 (${jinaResult.contentLength} chars, ${jinaResult.loadTime}ms)` : jinaResult.error || "失败"}`,
  );

  if (jinaResult.success) {
    return {
      name: testCase.name,
      url: testCase.url,
      directResult,
      jinaResult,
      finalSuccess: true,
      usedMethod: "jina",
    };
  }

  // 方法 3: Puppeteer
  console.log("\n   🔹 方法 3: Puppeteer 无头浏览器");
  const puppeteerResult = await fetchViaPuppeteer(browser, testCase.url);
  console.log(
    `      ${puppeteerResult.success ? "✅" : "❌"} ${puppeteerResult.success ? `成功 (${puppeteerResult.contentLength} chars, ${puppeteerResult.loadTime}ms)` : puppeteerResult.error || "Cloudflare 仍然阻止"}`,
  );

  return {
    name: testCase.name,
    url: testCase.url,
    directResult,
    jinaResult,
    puppeteerResult,
    finalSuccess: puppeteerResult.success,
    usedMethod: puppeteerResult.success ? "puppeteer" : "none",
  };
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("🌐 Reader Mode 三层回退机制 - 独立浏览器验证测试");
  console.log("═".repeat(60));
  console.log("\n📊 测试 URL 数量:", TEST_URLS.length);
  console.log("🔧 回退策略: Direct HTTP → Jina Reader → Puppeteer");

  // 启动浏览器
  console.log("\n🚀 启动 Puppeteer 浏览器...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  console.log("✅ 浏览器已启动");

  const results: Awaited<ReturnType<typeof testUrl>>[] = [];

  // 运行测试
  for (let i = 0; i < TEST_URLS.length; i++) {
    const result = await testUrl(browser, TEST_URLS[i], i);
    results.push(result);

    if (i < TEST_URLS.length - 1) {
      console.log("\n   ⏳ 等待 2 秒...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // 关闭浏览器
  await browser.close();
  console.log("\n🔒 浏览器已关闭");

  // 生成报告
  console.log("\n" + "═".repeat(60));
  console.log("📊 最终验证报告");
  console.log("═".repeat(60));

  const directSuccess = results.filter((r) => r.usedMethod === "direct").length;
  const jinaSuccess = results.filter((r) => r.usedMethod === "jina").length;
  const puppeteerSuccess = results.filter(
    (r) => r.usedMethod === "puppeteer",
  ).length;
  const totalFailed = results.filter((r) => !r.finalSuccess).length;
  const totalSuccess = results.filter((r) => r.finalSuccess).length;

  console.log("\n📈 统计:");
  console.log(`   直接成功:      ${directSuccess}/${TEST_URLS.length}`);
  console.log(`   Jina 成功:     ${jinaSuccess}/${TEST_URLS.length}`);
  console.log(`   Puppeteer 成功: ${puppeteerSuccess}/${TEST_URLS.length}`);
  console.log(`   ─────────────────────`);
  console.log(`   总成功:        ${totalSuccess}/${TEST_URLS.length}`);
  console.log(`   失败:          ${totalFailed}/${TEST_URLS.length}`);

  const successRate = ((totalSuccess / TEST_URLS.length) * 100).toFixed(1);
  console.log(`\n🎯 总体成功率: ${successRate}%`);

  console.log("\n详细结果:");
  console.log("-".repeat(60));

  for (const result of results) {
    const icon = result.finalSuccess ? "✅" : "❌";
    const method =
      result.usedMethod === "direct"
        ? "直接"
        : result.usedMethod === "jina"
          ? "Jina"
          : result.usedMethod === "puppeteer"
            ? "Puppeteer"
            : "失败";

    console.log(`${icon} ${result.name}`);
    console.log(`   方法: ${method}`);
    if (result.finalSuccess) {
      const finalResult =
        result.usedMethod === "direct"
          ? result.directResult
          : result.usedMethod === "jina"
            ? result.jinaResult
            : result.puppeteerResult;
      console.log(`   标题: ${finalResult?.title?.substring(0, 40)}...`);
      console.log(
        `   内容: ${finalResult?.contentLength} chars, ${finalResult?.loadTime}ms`,
      );
    } else {
      console.log(`   错误: 所有方法都失败`);
    }
  }

  console.log("-".repeat(60));

  if (totalFailed > 0) {
    console.log("\n⚠️ 存在失败的测试");
    process.exit(1);
  } else {
    console.log("\n🎉 所有测试通过！三层回退机制工作正常！");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("❌ 测试执行失败:", error);
  process.exit(1);
});
