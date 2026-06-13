/**
 * Reader Mode E2E 验证测试脚本
 *
 * 用于验证 Reader Mode 三层回退机制在真实环境中的工作情况：
 * 1. 直接 HTTP 获取
 * 2. Jina Reader API fallback
 * 3. Puppeteer headless browser fallback
 *
 * 使用方式：
 *   npx ts-node scripts/test-reader-mode-e2e.ts
 *
 * 注意：运行前需要先启动后端服务器
 */

import axios from "axios";

const API_BASE_URL = process.env.API_URL || "http://localhost:4000/api/v1";

interface TestCase {
  name: string;
  url: string;
  expectedBehavior: string;
  shouldSucceed: boolean;
}

interface TestResult {
  name: string;
  url: string;
  success: boolean;
  hasContent: boolean;
  title?: string;
  contentLength?: number;
  plan?: string;
  loadTime?: number;
  error?: string;
  requiresCaptcha?: boolean;
}

const TEST_CASES: TestCase[] = [
  // 场景 1: 直接获取成功（主流新闻网站）
  {
    name: "BBC News (直接获取)",
    url: "https://www.bbc.com/news",
    expectedBehavior: "直接 HTTP 获取成功",
    shouldSucceed: true,
  },
  {
    name: "TechCrunch (直接获取)",
    url: "https://techcrunch.com/",
    expectedBehavior: "直接 HTTP 获取成功",
    shouldSucceed: true,
  },
  {
    name: "Ars Technica (直接获取)",
    url: "https://arstechnica.com/",
    expectedBehavior: "直接 HTTP 获取成功",
    shouldSucceed: true,
  },

  // 场景 2: 可能需要 Jina Reader (bot detection)
  {
    name: "Medium Article",
    url: "https://medium.com/",
    expectedBehavior: "可能需要 Jina Reader fallback",
    shouldSucceed: true,
  },

  // 场景 3: Cloudflare 保护（可能需要 Puppeteer）
  {
    name: "Adafruit Blog (Cloudflare)",
    url: "https://blog.adafruit.com/",
    expectedBehavior: "可能需要 Puppeteer fallback",
    shouldSucceed: true,
  },

  // 场景 4: PDF 检测
  {
    name: "PDF Document",
    url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf",
    expectedBehavior: "检测为 PDF，返回 isPdf: true",
    shouldSucceed: true,
  },

  // 场景 5: Meta Refresh 重定向
  {
    name: "DeepMind (重定向到 blog.google)",
    url: "https://deepmind.google/",
    expectedBehavior: "可能跟随 meta refresh 重定向",
    shouldSucceed: true,
  },
];

async function testReaderMode(testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now();
  console.log(`\n📋 测试: ${testCase.name}`);
  console.log(`   URL: ${testCase.url}`);
  console.log(`   预期: ${testCase.expectedBehavior}`);

  try {
    const response = await axios.get(`${API_BASE_URL}/proxy/html-reader-news`, {
      params: { url: testCase.url },
      timeout: 60000, // 60秒超时
    });

    const data = response.data;
    const loadTime = Date.now() - startTime;

    // 检查是否为 PDF
    if (data.isPdf) {
      console.log(`   ✅ PDF 检测成功`);
      return {
        name: testCase.name,
        url: testCase.url,
        success: true,
        hasContent: false,
        title: data.title,
        plan: "pdf",
        loadTime,
      };
    }

    // 检查是否需要 CAPTCHA
    if (data.requiresCaptcha) {
      console.log(`   ⚠️ 需要人机验证 (graceful degradation)`);
      return {
        name: testCase.name,
        url: testCase.url,
        success: false,
        hasContent: false,
        requiresCaptcha: true,
        error: data.message,
        loadTime,
      };
    }

    // 验证内容
    const hasTitle = data.title && data.title.length > 0;
    const hasContent = data.content && data.content.length > 100;

    if (hasTitle && hasContent) {
      console.log(`   ✅ 成功获取内容`);
      console.log(`      标题: ${data.title?.substring(0, 50)}...`);
      console.log(`      内容长度: ${data.content?.length || 0} 字符`);
      console.log(`      提取方案: ${data.plan || "unknown"}`);
      console.log(`      耗时: ${loadTime}ms`);
    } else {
      console.log(`   ⚠️ 内容不完整`);
      console.log(`      标题: ${hasTitle ? "有" : "无"}`);
      console.log(`      内容: ${hasContent ? "有" : "无"}`);
    }

    return {
      name: testCase.name,
      url: testCase.url,
      success: hasTitle && hasContent,
      hasContent,
      title: data.title,
      contentLength: data.content?.length || 0,
      plan: data.plan,
      loadTime,
    };
  } catch (error: any) {
    const loadTime = Date.now() - startTime;
    const errorMessage =
      error.response?.data?.message || error.message || "Unknown error";
    console.log(`   ❌ 失败: ${errorMessage}`);
    return {
      name: testCase.name,
      url: testCase.url,
      success: false,
      hasContent: false,
      error: errorMessage,
      loadTime,
    };
  }
}

async function runAllTests() {
  console.log("═".repeat(60));
  console.log("🔍 Reader Mode E2E 验证测试");
  console.log("═".repeat(60));
  console.log(`API 地址: ${API_BASE_URL}`);
  console.log(`测试用例数: ${TEST_CASES.length}`);

  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    const result = await testReaderMode(testCase);
    results.push(result);
    // 在测试之间添加延迟，避免触发速率限制
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 生成报告
  console.log("\n" + "═".repeat(60));
  console.log("📊 测试报告");
  console.log("═".repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success && !r.requiresCaptcha).length;
  const captcha = results.filter((r) => r.requiresCaptcha).length;

  console.log(`✅ 成功: ${passed}/${TEST_CASES.length}`);
  console.log(`❌ 失败: ${failed}/${TEST_CASES.length}`);
  console.log(`⚠️ 需验证: ${captcha}/${TEST_CASES.length}`);

  console.log("\n详细结果:");
  console.log("-".repeat(60));

  for (const result of results) {
    const status = result.success ? "✅" : result.requiresCaptcha ? "⚠️" : "❌";
    console.log(
      `${status} ${result.name}: ${result.success ? `${result.contentLength} chars in ${result.loadTime}ms` : result.error || "需要人机验证"}`,
    );
  }

  console.log("-".repeat(60));

  // 计算总体成功率（不包括需要验证的）
  const totalTestable = TEST_CASES.length - captcha;
  const successRate =
    totalTestable > 0 ? ((passed / totalTestable) * 100).toFixed(1) : "N/A";
  console.log(`\n总体成功率: ${successRate}% (${passed}/${totalTestable})`);

  // 如果有失败的测试，退出码为 1
  if (failed > 0) {
    process.exit(1);
  }
}

// 检查服务器是否可用
async function checkServerHealth() {
  try {
    await axios.get(`${API_BASE_URL.replace("/api/v1", "")}/health`, {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("🚀 启动 Reader Mode E2E 验证测试...\n");

  const serverAvailable = await checkServerHealth();
  if (!serverAvailable) {
    console.log(
      "❌ 错误: 后端服务器不可用。请先启动服务器:\n   npm run start:dev",
    );
    console.log(`\n尝试连接: ${API_BASE_URL.replace("/api/v1", "")}/health`);
    process.exit(1);
  }

  console.log("✅ 服务器连接成功\n");
  await runAllTests();
}

main().catch(console.error);
