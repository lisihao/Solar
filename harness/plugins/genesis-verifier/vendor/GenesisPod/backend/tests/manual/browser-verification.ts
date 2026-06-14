#!/usr/bin/env npx ts-node
/**
 * 🚀 Reader Mode 浏览器自动化验证测试
 *
 * 使用 Puppeteer 启动真实浏览器，对 Railway 部署进行端到端验证
 *
 * 使用方式：
 *   npx ts-node scripts/browser-verification.ts [API_URL]
 *
 * 示例：
 *   npx ts-node scripts/browser-verification.ts https://your-api.railway.app
 *   npx ts-node scripts/browser-verification.ts http://localhost:4000
 */

import * as puppeteer from "puppeteer";

// 配置
const API_URL =
  process.argv[2] || process.env.API_URL || "http://localhost:4000";
const API_ENDPOINT = `${API_URL}/api/v1/proxy/html-reader-news`;

interface TestResult {
  name: string;
  url: string;
  status: "success" | "fallback" | "captcha" | "failed";
  title?: string;
  contentLength?: number;
  plan?: string;
  loadTime: number;
  error?: string;
  screenshot?: string;
}

// 测试用例 - 覆盖不同场景
const TEST_CASES = [
  {
    name: "TechCrunch (正常获取)",
    url: "https://techcrunch.com/",
    expectedStatus: ["success", "fallback"],
  },
  {
    name: "Adafruit Blog (Cloudflare 保护)",
    url: "https://blog.adafruit.com/",
    expectedStatus: ["success", "fallback", "captcha"],
  },
  {
    name: "Hacker News (简单页面)",
    url: "https://news.ycombinator.com/",
    expectedStatus: ["success"],
  },
  {
    name: "Medium (Bot Detection)",
    url: "https://medium.com/",
    expectedStatus: ["success", "fallback", "captcha"],
  },
  {
    name: "ArXiv PDF 检测",
    url: "https://arxiv.org/pdf/2312.00000.pdf",
    expectedStatus: ["success"], // Should detect as PDF
  },
];

async function runTest(
  browser: puppeteer.Browser,
  testCase: { name: string; url: string; expectedStatus: string[] },
  index: number,
): Promise<TestResult> {
  const page = await browser.newPage();
  const startTime = Date.now();

  console.log(
    `\n📋 [${index + 1}/${TEST_CASES.length}] 测试: ${testCase.name}`,
  );
  console.log(`   URL: ${testCase.url}`);

  try {
    // 设置超时
    page.setDefaultTimeout(60000);

    // 构建 API URL
    const apiUrl = `${API_ENDPOINT}?url=${encodeURIComponent(testCase.url)}`;
    console.log(`   API: ${apiUrl}`);

    // 导航到 API 端点
    const response = await page.goto(apiUrl, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    const loadTime = Date.now() - startTime;

    if (!response) {
      throw new Error("No response received");
    }

    // 获取响应内容
    const content = await page.content();
    let jsonData: any;

    try {
      // 尝试从页面中提取 JSON
      const bodyText = await page.evaluate(() => document.body.innerText);
      jsonData = JSON.parse(bodyText);
    } catch {
      // 如果不是 JSON，检查 HTML 内容
      jsonData = { rawHtml: content };
    }

    // 截图保存
    const screenshotPath = `screenshots/test-${index + 1}-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });

    // 分析结果
    let status: TestResult["status"] = "failed";

    if (jsonData.isPdf) {
      console.log(`   ✅ PDF 检测成功`);
      status = "success";
    } else if (jsonData.requiresCaptcha) {
      console.log(`   ⚠️ 需要人机验证 (Cloudflare 保护)`);
      status = "captcha";
    } else if (jsonData.title && jsonData.content) {
      console.log(`   ✅ 成功获取内容`);
      console.log(`      标题: ${jsonData.title?.substring(0, 50)}...`);
      console.log(`      内容长度: ${jsonData.content?.length || 0} 字符`);
      console.log(`      提取方案: ${jsonData.plan || "unknown"}`);
      status = jsonData.viaJinaReader ? "fallback" : "success";
    } else if (jsonData.title) {
      console.log(`   ⚠️ 部分成功 (有标题但内容可能不完整)`);
      status = "fallback";
    }

    console.log(`   ⏱️ 耗时: ${loadTime}ms`);

    return {
      name: testCase.name,
      url: testCase.url,
      status,
      title: jsonData.title,
      contentLength: jsonData.content?.length || 0,
      plan: jsonData.plan,
      loadTime,
      screenshot: screenshotPath,
    };
  } catch (error: any) {
    const loadTime = Date.now() - startTime;
    console.log(`   ❌ 失败: ${error.message}`);

    // 截图错误页面
    try {
      const screenshotPath = `screenshots/error-${index + 1}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch {}

    return {
      name: testCase.name,
      url: testCase.url,
      status: "failed",
      loadTime,
      error: error.message,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log("═".repeat(70));
  console.log("🌐 Reader Mode 浏览器自动化验证测试");
  console.log("═".repeat(70));
  console.log(`📍 API 地址: ${API_URL}`);
  console.log(`🔗 端点: ${API_ENDPOINT}`);
  console.log(`📊 测试用例: ${TEST_CASES.length} 个`);
  console.log("");

  // 创建截图目录
  const fs = await import("fs");
  if (!fs.existsSync("screenshots")) {
    fs.mkdirSync("screenshots");
  }

  // 启动浏览器
  console.log("🚀 启动 Puppeteer 浏览器...");
  const browser = await puppeteer.launch({
    headless: true, // 设为 false 可以看到浏览器界面
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
    ],
  });

  console.log("✅ 浏览器已启动\n");

  const results: TestResult[] = [];

  // 运行所有测试
  for (let i = 0; i < TEST_CASES.length; i++) {
    const result = await runTest(browser, TEST_CASES[i], i);
    results.push(result);

    // 测试间隔，避免触发速率限制
    if (i < TEST_CASES.length - 1) {
      console.log("   ⏳ 等待 2 秒...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // 关闭浏览器
  await browser.close();
  console.log("\n🔒 浏览器已关闭");

  // 生成报告
  console.log("\n" + "═".repeat(70));
  console.log("📊 验证报告");
  console.log("═".repeat(70));

  const success = results.filter((r) => r.status === "success").length;
  const fallback = results.filter((r) => r.status === "fallback").length;
  const captcha = results.filter((r) => r.status === "captcha").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(`\n统计:`);
  console.log(`  ✅ 直接成功: ${success}/${TEST_CASES.length}`);
  console.log(`  🔄 Fallback 成功: ${fallback}/${TEST_CASES.length}`);
  console.log(`  ⚠️ 需要验证码: ${captcha}/${TEST_CASES.length}`);
  console.log(`  ❌ 失败: ${failed}/${TEST_CASES.length}`);

  const totalSuccess = success + fallback;
  const successRate = ((totalSuccess / TEST_CASES.length) * 100).toFixed(1);
  console.log(
    `\n📈 总体成功率: ${successRate}% (${totalSuccess}/${TEST_CASES.length})`,
  );

  console.log("\n详细结果:");
  console.log("-".repeat(70));

  for (const result of results) {
    const icon =
      result.status === "success"
        ? "✅"
        : result.status === "fallback"
          ? "🔄"
          : result.status === "captcha"
            ? "⚠️"
            : "❌";

    const detail =
      result.status === "success" || result.status === "fallback"
        ? `${result.contentLength} chars, ${result.loadTime}ms, plan: ${result.plan}`
        : result.status === "captcha"
          ? `需要人机验证`
          : result.error || "未知错误";

    console.log(`${icon} ${result.name}`);
    console.log(`   ${detail}`);
  }

  console.log("-".repeat(70));

  // 保存 JSON 报告
  const reportPath = `screenshots/report-${Date.now()}.json`;
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        apiUrl: API_URL,
        summary: {
          total: TEST_CASES.length,
          success,
          fallback,
          captcha,
          failed,
          successRate: `${successRate}%`,
        },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n📄 报告已保存: ${reportPath}`);

  // 退出码
  if (failed > 0) {
    console.log("\n⚠️ 存在失败的测试用例");
    process.exit(1);
  } else {
    console.log("\n🎉 所有测试通过！");
    process.exit(0);
  }
}

// 运行
main().catch((error) => {
  console.error("❌ 测试执行失败:", error);
  process.exit(1);
});
