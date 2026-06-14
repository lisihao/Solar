/**
 * SecEdgarTool Unit Tests
 *
 * 离线单测：mock PolicyDataService.httpGet 注入 SEC 固定结构的 fixture，
 * 验证 CIK 解析（ticker / companyName / 显式 cik）+ 文件过滤 + URL 构造逻辑。
 * 不依赖真实 SEC 联网（真实连通属部署后冒烟检查）。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SecEdgarTool, SecEdgarInput, SecEdgarOutput } from "../sec-edgar.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-sec-001",
    toolId: "sec-edgar-search",
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Fixtures（SEC 真实结构的最小子集）────────────────────────────────────────
const MOCK_TICKERS = {
  "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
  "1": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  "2": { cik_str: 789019, ticker: "MSFT", title: "MICROSOFT CORP" },
};

const MOCK_SUBMISSIONS_NVDA = {
  cik: "1045810",
  name: "NVIDIA CORP",
  filings: {
    recent: {
      accessionNumber: [
        "0001045810-24-000029",
        "0001045810-24-000010",
        "0001045810-23-000017",
      ],
      form: ["10-K", "10-Q", "8-K"],
      filingDate: ["2024-02-21", "2024-01-15", "2023-11-21"],
      reportDate: ["2024-01-28", "2023-10-29", "2023-11-21"],
      primaryDocument: ["nvda-20240128.htm", "nvda-20231029.htm", "ex991.htm"],
      primaryDocDescription: ["10-K", "10-Q", "8-K"],
    },
  },
};

function createMockPolicyDataService() {
  return {
    httpGet: jest.fn((url: string) => {
      if (url.includes("company_tickers.json")) {
        return Promise.resolve(MOCK_TICKERS);
      }
      if (url.includes("/submissions/CIK")) {
        return Promise.resolve(MOCK_SUBMISSIONS_NVDA);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }),
    getApiKey: jest.fn(),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

describe("SecEdgarTool", () => {
  let tool: SecEdgarTool;
  let policy: ReturnType<typeof createMockPolicyDataService>;

  beforeEach(async () => {
    SecEdgarTool.resetForTesting();
    policy = createMockPolicyDataService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecEdgarTool,
        { provide: PolicyDataService, useValue: policy },
      ],
    }).compile();
    tool = module.get(SecEdgarTool);
  });

  async function run(input: SecEdgarInput): Promise<SecEdgarOutput> {
    const res = await tool.execute(input, makeContext());
    expect(res.success).toBe(true);
    return res.data as SecEdgarOutput;
  }

  it("按 ticker 精确解析 CIK 并补零 10 位", async () => {
    const out = await run({ ticker: "NVDA", formType: "10-K" });
    expect(out.success).toBe(true);
    expect(out.cik).toBe("0001045810");
    expect(out.companyName).toBe("NVIDIA CORP");
  });

  it("按 companyName 模糊解析 CIK", async () => {
    const out = await run({ companyName: "nvidia" });
    expect(out.cik).toBe("0001045810");
  });

  it("显式 cik 跳过查找并补零", async () => {
    const out = await run({ cik: "1045810" });
    expect(out.cik).toBe("0001045810");
    // 未调用 tickers 端点
    const calledTickers = policy.httpGet.mock.calls.some((c) =>
      String(c[0]).includes("company_tickers"),
    );
    expect(calledTickers).toBe(false);
  });

  it("formType 过滤只返回指定类型", async () => {
    const out = await run({ ticker: "NVDA", formType: "10-K" });
    expect(out.filings.length).toBe(1);
    expect(out.filings[0].form).toBe("10-K");
    expect(out.filings[0].accessionNumber).toBe("0001045810-24-000029");
  });

  it("formType=all 返回全部文件", async () => {
    const out = await run({ ticker: "NVDA", formType: "all" });
    expect(out.filings.length).toBe(3);
  });

  it("构造可访问的主文档 URL（accession 去横线 + cik 去零）", async () => {
    const out = await run({ ticker: "NVDA", formType: "10-K" });
    expect(out.filings[0].url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581024000029/nvda-20240128.htm",
    );
  });

  it("使用 SEC 合规 User-Agent（含联系邮箱）调用", async () => {
    await run({ ticker: "NVDA" });
    const submissionsCall = policy.httpGet.mock.calls.find((c) =>
      String(c[0]).includes("/submissions/CIK"),
    );
    const headers = submissionsCall?.[2] as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toMatch(/.+@.+/);
  });

  it("无法匹配公司时返回 success:false + error", async () => {
    const res = await tool.execute(
      { companyName: "不存在的公司zzz" },
      makeContext(),
    );
    expect(res.success).toBe(true); // BaseTool 包装层成功
    expect(res.data?.success).toBe(false);
    expect(res.data?.error).toContain("无法解析 CIK");
  });

  it("validateInput 要求至少一个标识符", () => {
    expect(tool.validateInput({})).toBe(false);
    expect(tool.validateInput({ ticker: "NVDA" })).toBe(true);
  });
});
