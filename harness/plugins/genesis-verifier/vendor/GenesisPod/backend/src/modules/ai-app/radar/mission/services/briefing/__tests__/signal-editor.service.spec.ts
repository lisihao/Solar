import {
  SignalEditorService,
  SignalEditorInput,
} from "../signal-editor.service";

function mkInput(over?: Partial<SignalEditorInput>): SignalEditorInput {
  return {
    topic: {
      id: "topic-1",
      name: "英伟达股价与新闻",
      description: "AI 算力赛道",
      keywords: ["NVIDIA"],
      signalTypes: ["turning_point", "trend_acceleration", "key_event"],
      outputLanguage: "zh-CN",
    },
    candidates: [
      {
        itemId: "item-1",
        title: "NVIDIA Q1 财报",
        content: "数据中心收入 +427%",
        source: "NVIDIA",
        publishedAt: new Date("2026-05-18T06:30:00Z"),
        score: 0.95,
        relevance: 0.9,
        quality: 0.95,
      },
      {
        itemId: "item-2",
        title: "Jensen GTC keynote",
        content: "Blackwell Q2 量产",
        source: "CNBC",
        publishedAt: new Date("2026-05-18T08:00:00Z"),
        score: 0.85,
        relevance: 0.8,
        quality: 0.85,
      },
    ],
    yesterdayTopEntities: ["NVIDIA"],
    targetN: 3,
    ...over,
  };
}

describe("SignalEditorService (B2)", () => {
  const mkChat = (content: string) => ({
    chat: jest.fn().mockResolvedValue({ content }),
  });

  describe("buildUserPrompt", () => {
    it("XML escapes user-controlled fields (K1 prompt injection defense)", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const input = mkInput({
        topic: {
          ...mkInput().topic,
          name: "<script>alert(1)</script>",
          description: "a & b > c",
        },
      });
      const prompt = svc.buildUserPrompt(input);
      expect(prompt).toContain("&lt;script&gt;");
      expect(prompt).toContain("a &amp; b &gt; c");
      expect(prompt).not.toContain("<script>");
    });

    it("includes targetN + yesterdayTopEntities (B3 boost hint)", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const prompt = svc.buildUserPrompt(mkInput());
      expect(prompt).toContain("<targetN>3</targetN>");
      expect(prompt).toContain("<yesterdayTopEntities>");
      expect(prompt).toContain("NVIDIA");
    });

    it("truncates long content + rounds scores", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const longContent = "a".repeat(2000);
      const input = mkInput();
      input.candidates = [
        { ...input.candidates[0], content: longContent, score: 0.123456 },
      ];
      const prompt = svc.buildUserPrompt(input);
      // truncate to 600 + 1 char ellipsis
      expect(prompt).toContain("a".repeat(600) + "…");
      // round2
      expect(prompt).toContain('"score":0.12');
    });
  });

  describe("parseAndValidate", () => {
    const goodOutput = JSON.stringify({
      signals: [
        {
          tier: 3,
          title: "NVIDIA Q1 财报超预期",
          oneLineTakeaway: "数据中心 +427% 验证算力需求",
          whyItMatters: "AI 资本支出仍处加速曲线",
          whatsNext: "Blackwell Q2 出货进度",
          signalTags: ["turning_point"],
          entities: ["NVIDIA"],
          evidenceItemIds: ["item-1", "item-2"],
          narrativeId: null,
        },
      ],
    });

    it("parses and validates good LLM output", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const result = svc.parseAndValidate(goodOutput, mkInput());
      expect(result).toHaveLength(1);
      expect(result[0].tier).toBe(3);
      expect(result[0].evidenceItemIds).toEqual(["item-1", "item-2"]);
      expect(result[0].id).toMatch(/^[0-9a-f]{8}-/i);
    });

    it("rejects signal whose evidenceItemIds are NOT in candidate pool (K1)", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const bad = JSON.stringify({
        signals: [
          {
            tier: 3,
            title: "fabricated",
            oneLineTakeaway: "x",
            whyItMatters: "x",
            whatsNext: "x",
            signalTags: ["turning_point"],
            entities: [],
            evidenceItemIds: ["fake-uuid-not-in-pool"],
            narrativeId: null,
          },
        ],
      });
      const result = svc.parseAndValidate(bad, mkInput());
      expect(result).toHaveLength(0);
    });

    it("filters signalTags by user signalTypes preference", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const out = JSON.stringify({
        signals: [
          {
            tier: 3,
            title: "x",
            oneLineTakeaway: "x",
            whyItMatters: "x",
            whatsNext: "x",
            signalTags: ["anomaly"], // user did NOT enable anomaly
            entities: [],
            evidenceItemIds: ["item-1"],
            narrativeId: null,
          },
        ],
      });
      const result = svc.parseAndValidate(out, mkInput());
      expect(result).toHaveLength(0); // all tags filtered out → 0 allowed → drop
    });

    it("strips markdown code-fence around JSON", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const fenced = "```json\n" + goodOutput + "\n```";
      const result = svc.parseAndValidate(fenced, mkInput());
      expect(result).toHaveLength(1);
    });

    it("rejects extra fields (strict schema)", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const out = JSON.stringify({
        signals: [
          {
            tier: 3,
            title: "x",
            oneLineTakeaway: "x",
            whyItMatters: "x",
            whatsNext: "x",
            signalTags: ["turning_point"],
            entities: [],
            evidenceItemIds: ["item-1"],
            narrativeId: null,
            extraInjectedField: "leak", // strict 拒收
          },
        ],
      });
      expect(() => svc.parseAndValidate(out, mkInput())).toThrow();
    });

    it("truncates to targetN", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const out = JSON.stringify({
        signals: [3, 3, 3, 2, 2].map((tier, i) => ({
          tier,
          title: `t-${i}`,
          oneLineTakeaway: "x",
          whyItMatters: "x",
          whatsNext: "x",
          signalTags: ["turning_point"],
          entities: [],
          evidenceItemIds: ["item-1"],
          narrativeId: null,
        })),
      });
      const result = svc.parseAndValidate(out, { ...mkInput(), targetN: 3 });
      expect(result).toHaveLength(3);
      expect(result.every((s) => s.tier === 3)).toBe(true);
    });
  });

  describe("injectLanguageHeader (X2)", () => {
    it("prepends en-US header for English output", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const out = svc.injectLanguageHeader("body", "en-US");
      expect(out).toMatch(/^\[CRITICAL: Output all fields in English\./);
      expect(out).toContain("body");
    });
    it("prepends zh-CN header for Chinese", () => {
      const svc = new SignalEditorService(mkChat("") as never);
      const out = svc.injectLanguageHeader("body", "zh-CN");
      expect(out).toMatch(/^\[CRITICAL: 所有字段用中文输出/);
    });
  });

  describe("edit (integration)", () => {
    it("returns empty when candidates empty", async () => {
      const chat = mkChat("");
      const svc = new SignalEditorService(chat as never);
      const input = { ...mkInput(), candidates: [] };
      const result = await svc.edit(input, "skill");
      expect(result).toEqual([]);
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it("retries once on LLM error then returns [] (no_signals fallback)", async () => {
      const chat = {
        chat: jest
          .fn()
          .mockRejectedValueOnce(new Error("LLM 502"))
          .mockRejectedValueOnce(new Error("LLM 502")),
      };
      const svc = new SignalEditorService(chat as never);
      const result = await svc.edit(mkInput(), "skill");
      expect(result).toEqual([]);
      expect(chat.chat).toHaveBeenCalledTimes(2);
    });

    it("succeeds with valid LLM output on first call", async () => {
      const goodOutput = JSON.stringify({
        signals: [
          {
            tier: 3,
            title: "NVIDIA Q1",
            oneLineTakeaway: "x",
            whyItMatters: "x",
            whatsNext: "x",
            signalTags: ["turning_point"],
            entities: ["NVIDIA"],
            evidenceItemIds: ["item-1"],
            narrativeId: null,
          },
        ],
      });
      const chat = mkChat(goodOutput);
      const svc = new SignalEditorService(chat as never);
      const result = await svc.edit(mkInput(), "skill");
      expect(result).toHaveLength(1);
      expect(chat.chat).toHaveBeenCalledTimes(1);
    });
  });
});
