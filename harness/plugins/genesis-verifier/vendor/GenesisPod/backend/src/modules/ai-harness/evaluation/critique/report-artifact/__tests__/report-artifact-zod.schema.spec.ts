/**
 * ReportArtifactZodSchema spec
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §7.2 + §8.1
 *
 * 反向证据矩阵（PR-R0）：
 *   - happy: 完整 ReportArtifact (mission c195035f 类似形态) 通过校验
 *   - fail: 各字段超限 / 注入 / 类型漂移单独锁
 *   - DoS 防护：fullMarkdown > 2MB / metadata 51 keys / payload size guard
 */

import {
  ReportArtifactZodSchema,
  parseReportArtifact,
} from "../report-artifact-zod.schema";

function buildValidArtifact() {
  return {
    content: {
      fullMarkdown: "## 执行摘要\n\n摘要正文。\n\n## 结论\n\n结论正文。",
      fullReportSize: 100,
    },
    sections: [
      {
        id: "sec-1",
        type: "executive_summary",
        level: 2,
        title: "执行摘要",
        anchor: "执行摘要",
        startOffset: 0,
        endOffset: 30,
        wordCount: 100,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ],
    citations: [],
    figures: [],
    factTable: [],
    quickView: {
      executiveSummary: { markdown: "AI", wordCount: 10 },
      estimatedReadingTime: 3,
      topHighlights: [],
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations: [],
      keyFigures: [],
      whatYouWillLearn: [],
    },
    metadata: {
      topic: "AI",
      generatedAt: new Date().toISOString(),
      generationTimeMs: 1000,
      version: 1,
      isIncremental: false,
      dimensionCount: 1,
      sourceCount: 0,
      factCount: 0,
      figureCount: 0,
      wordCount: 100,
      readingTimeMinutes: 1,
      styleProfile: "analytical",
      lengthProfile: "standard",
      audienceProfile: "professional",
      language: "zh-CN",
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: ["gpt-4"],
      templateId: "multi-dimension-report@v1",
      sanitizerVersion: "1.0.0",
    },
    quality: {
      overall: 80,
      dimensions: { traceability: 80 },
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
      finalVerdict: "good",
    },
  };
}

describe("ReportArtifactZodSchema", () => {
  describe("happy path", () => {
    it("完整 artifact 通过校验", () => {
      const result = ReportArtifactZodSchema.safeParse(buildValidArtifact());
      expect(result.success).toBe(true);
    });

    it("含 sectionCountMismatch 字段也通过", () => {
      const a = buildValidArtifact();
      a.metadata.sectionCountMismatch = { expected: 15, actual: 14 };
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(true);
    });

    it("metadata 含合法扩展字段（≤ 50 keys）通过", () => {
      const a = buildValidArtifact();
      // 加 5 个扩展字段
      for (let i = 1; i <= 5; i++) {
        (a.metadata as Record<string, unknown>)[`customField${i}`] = `v${i}`;
      }
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(true);
    });
  });

  describe("DoS 防护", () => {
    it("metadata 51 keys 拒绝（v1.2 类别 E.metadata.refine）", () => {
      const a = buildValidArtifact();
      for (let i = 0; i < 51; i++) {
        (a.metadata as Record<string, unknown>)[`extra${i}`] = i;
      }
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("metadata key 长度 > 64 拒绝", () => {
      const a = buildValidArtifact();
      const longKey = "x".repeat(65);
      (a.metadata as Record<string, unknown>)[longKey] = "v";
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("fullMarkdown > 2MB 拒绝", () => {
      const a = buildValidArtifact();
      a.content.fullMarkdown = "x".repeat(2_000_001);
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("sections > 100 拒绝", () => {
      const a = buildValidArtifact();
      a.sections = Array.from({ length: 101 }, (_, i) => ({
        id: `sec-${i}`,
        type: "dimension" as const,
        level: 2 as const,
        title: `s${i}`,
        anchor: `s${i}`,
        startOffset: 0,
        endOffset: 10,
        wordCount: 1,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      }));
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("sanitizerVersion 非 \\d+.\\d+.\\d+ 格式拒绝（防注入）", () => {
      const a = buildValidArtifact();
      a.metadata.sanitizerVersion = "1.0.0; DROP TABLE";
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });
  });

  describe("字段级校验", () => {
    it("section.type 不在 enum 拒绝", () => {
      const a = buildValidArtifact();
      a.sections[0].type = "INJECTED" as never;
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("缺 metadata.topic 拒绝", () => {
      const a = buildValidArtifact() as unknown as Record<string, unknown>;
      delete (a.metadata as Record<string, unknown>).topic;
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("citations.occurrences > 1000 拒绝", () => {
      const a = buildValidArtifact();
      a.citations = [
        {
          index: 1,
          uuid: "u1",
          title: "T",
          url: "u",
          domain: "d",
          accessedAt: "2026-01-01",
          sourceType: "blog",
          credibilityScore: 50,
          occurrences: Array.from({ length: 1001 }, (_, i) => ({
            sectionId: "sec-1",
            paragraphIndex: i,
            characterOffset: i,
          })),
        },
      ];
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    it("section.wordCount 负数拒绝", () => {
      const a = buildValidArtifact();
      a.sections[0].wordCount = -1;
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    // PR-R0 reviewer 收尾建议：补 level 反例 spec（仅 2/3 合法）
    it("section.level=4 拒绝（仅允许 2/3）", () => {
      const a = buildValidArtifact();
      (a.sections[0] as { level: number }).level = 4;
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });
    it("section.level=2.5 拒绝（必须整数 2/3）", () => {
      const a = buildValidArtifact();
      (a.sections[0] as { level: number }).level = 2.5;
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });

    // PR-R0 security 收尾：url 必须合法格式
    it("citation.url 非合法 URL 拒绝", () => {
      const a = buildValidArtifact();
      a.citations = [
        {
          index: 1,
          uuid: "u1",
          title: "T",
          url: "not-a-url",
          domain: "d",
          accessedAt: "2026-01-01",
          sourceType: "blog",
          credibilityScore: 50,
          occurrences: [],
        },
      ];
      const result = ReportArtifactZodSchema.safeParse(a);
      expect(result.success).toBe(false);
    });
  });

  describe("parseReportArtifact helper", () => {
    it("ok=true 时返回 data", () => {
      const r = parseReportArtifact(buildValidArtifact());
      expect(r.ok).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.errorMessage).toBeUndefined();
    });

    it("ok=false 时返回结构化错误（不直接 throw）", () => {
      const a = buildValidArtifact();
      a.metadata.topic = ""; // 违反 min(1)
      const r = parseReportArtifact(a);
      expect(r.ok).toBe(false);
      expect(r.errorMessage).toContain("zod validation failed");
      expect(r.issues).toBeDefined();
      expect(r.issues!.length).toBeGreaterThan(0);
    });

    it("payload > 2MB 入口快速拒（reviewer 修订：构造确定超 2MB 锁 ok=false）", () => {
      // 构造确定 > 2MB 的 payload —— 在 metadata 加超长 string（绕过 fullMarkdown 自身 zod 限制
      // 让 parseReportArtifact 入口 size guard 真触发，验证 ok=false 与 errorMessage 含 "size"）
      const a = buildValidArtifact();
      // 4MB 超长 metadata 字段（虽然违反 max(64) 但 size guard 在 zod 之前拒，永远进不到 zod）
      (a.metadata as Record<string, unknown>).hugeField = "x".repeat(4_000_000);
      const r = parseReportArtifact(a);
      expect(r.ok).toBe(false);
      expect(r.errorMessage).toContain("2MB"); // size guard 信息
    });

    it("不可序列化对象（含 BigInt）→ JSON.stringify 抛 → 友好错误", () => {
      // function 在 JSON.stringify 不会 throw 但会被忽略，所以本 case 用 BigInt 触发 stringify error
      const badWithBigInt = {
        content: { fullMarkdown: "x" },
        weirdBig: BigInt(1),
      } as never;
      const r = parseReportArtifact(badWithBigInt);
      expect(r.ok).toBe(false);
      expect(r.errorMessage).toContain("JSON.stringify failed");
    });
  });

  describe("stateless 并发", () => {
    it("Promise.all 并发互不污染", async () => {
      const a1 = buildValidArtifact();
      const a2 = buildValidArtifact();
      a2.metadata.topic = "AI 2";
      const [r1, r2] = await Promise.all([
        Promise.resolve(parseReportArtifact(a1)),
        Promise.resolve(parseReportArtifact(a2)),
      ]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.data?.metadata.topic).toBe("AI");
      expect(r2.data?.metadata.topic).toBe("AI 2");
    });
  });
});
