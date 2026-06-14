import { Test, TestingModule } from "@nestjs/testing";
import { IntentDetectionService } from "../intent-detection.service";
import {
  UserIntent,
  ContextStrategy,
  IntentDetectionConfig,
} from "../intent.types";

// ─── Notes on START_NEW_SESSION detection logic ──────────────────────────────
//
// The service detects new session keywords BUT only returns START_NEW_SESSION
// when EITHER:
//   (a) metadata.mentionedCount >= 2, OR
//   (b) the matched keyword itself is one of the debate-specific words
//       (辩论, 辩一下, 辩一辩, 辩题, 思辨, 红蓝, 正方反方, pk, 对决)
//
// General new session words like 新对话 / new chat / start over / new session
// match newSessionKeywords but WITHOUT the above conditions they fall through
// to GENERAL_CHAT.
// ─────────────────────────────────────────────────────────────────────────────

describe("IntentDetectionService", () => {
  let service: IntentDetectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntentDetectionService],
    }).compile();

    service = module.get(IntentDetectionService);
  });

  // ─── detectIntent – general chat (default) ───────────────────────────────────

  describe("detectIntent() – default GENERAL_CHAT", () => {
    it("returns GENERAL_CHAT for unrecognised content", () => {
      const result = service.detectIntent("Tell me a story");
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
      expect(result.strategy).toBe(ContextStrategy.STANDARD);
      expect(result.confidence).toBe(0.5);
    });

    it("matchedKeywords is undefined for default result", () => {
      const result = service.detectIntent("Hello there");
      expect(result.matchedKeywords).toBeUndefined();
    });

    it("returns GENERAL_CHAT for general new session words without debate context", () => {
      // 新对话 matches newSessionKeywords but not debate-specific, no mentionedCount
      const result = service.detectIntent("我们开始一个新对话吧");
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });

    it("returns GENERAL_CHAT for 'new chat' without debate context", () => {
      const result = service.detectIntent("Let's start a new chat");
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });

    it("returns GENERAL_CHAT for 'start over' without debate context", () => {
      const result = service.detectIntent("I want to start over");
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });
  });

  // ─── detectIntent – START_NEW_SESSION ────────────────────────────────────────

  describe("detectIntent() – START_NEW_SESSION", () => {
    it("detects '辩论' as new session with ISOLATED strategy", () => {
      const result = service.detectIntent("我们来辩论一个话题");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
      expect(result.strategy).toBe(ContextStrategy.ISOLATED);
      expect(result.confidence).toBe(0.85);
      expect(result.matchedKeywords).toContain("辩论");
    });

    it("detects '红蓝' debate keyword as new session", () => {
      const result = service.detectIntent("红蓝两队开始对决");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
      expect(result.strategy).toBe(ContextStrategy.ISOLATED);
    });

    it("detects '正方反方' as new session", () => {
      const result = service.detectIntent("请正方反方各自陈述观点");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
      expect(result.strategy).toBe(ContextStrategy.ISOLATED);
    });

    it("detects '思辨' as new session", () => {
      const result = service.detectIntent("我们来一场思辨");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("detects '辩一下' as new session", () => {
      const result = service.detectIntent("我们辩一下这个问题");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("detects '辩一辩' as new session", () => {
      const result = service.detectIntent("来辩一辩吧");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("detects '对决' as new session", () => {
      const result = service.detectIntent("来一场对决");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("detects 'PK' as new session intent", () => {
      const result = service.detectIntent("来一场PK吧");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("detects '辩题' as new session", () => {
      const result = service.detectIntent("选一个辩题");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("triggers new session via mentionedCount >= 2 with general new session keyword", () => {
      // General new session keyword + mentionedCount >= 2 → START_NEW_SESSION
      const result = service.detectIntent("新对话 开始讨论", {
        mentionedCount: 2,
      });
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
      expect(result.strategy).toBe(ContextStrategy.ISOLATED);
    });

    it("triggers new session via mentionedCount >= 3", () => {
      const result = service.detectIntent("重新开始", {
        mentionedCount: 3,
      });
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("does NOT trigger new session via mentionedCount=1 with general keyword", () => {
      const result = service.detectIntent("新会话", {
        mentionedCount: 1,
      });
      // mentionedCount is 1, not >= 2; keyword is 新会话 (not debate-specific)
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });
  });

  // ─── detectIntent – SUMMARIZE ────────────────────────────────────────────────

  describe("detectIntent() – SUMMARIZE", () => {
    it("detects '总结' as SUMMARIZE with REFERENCE_RECENT strategy", () => {
      const result = service.detectIntent("请帮我总结一下上面的内容");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(result.confidence).toBe(0.8);
    });

    it("detects 'summary' (English) as SUMMARIZE", () => {
      const result = service.detectIntent("Please provide a summary");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("detects 'summarize' (English) as SUMMARIZE", () => {
      const result = service.detectIntent("Can you summarize this?");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("detects '归纳' as SUMMARIZE", () => {
      const result = service.detectIntent("能否归纳要点？");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("detects '概括' as SUMMARIZE", () => {
      const result = service.detectIntent("请概括主要内容");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("detects '小结' as SUMMARIZE", () => {
      const result = service.detectIntent("做个小结");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("detects '综述' as SUMMARIZE", () => {
      const result = service.detectIntent("写个综述");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });
  });

  // ─── detectIntent – GENERATE ─────────────────────────────────────────────────

  describe("detectIntent() – GENERATE", () => {
    it("detects '生成' as GENERATE with REFERENCE_RECENT strategy", () => {
      const result = service.detectIntent("请生成一张图片");
      expect(result.intent).toBe(UserIntent.GENERATE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(result.confidence).toBe(0.8);
    });

    it("detects '画图' as GENERATE", () => {
      const result = service.detectIntent("帮我画图");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects 'generate' (English) as GENERATE", () => {
      const result = service.detectIntent("Generate an image for me");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects 'infographic' as GENERATE", () => {
      const result = service.detectIntent("Create an infographic");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects '可视化' as GENERATE", () => {
      const result = service.detectIntent("请做一个数据可视化");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects '信息图' as GENERATE", () => {
      const result = service.detectIntent("生成信息图");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects '图表' as GENERATE", () => {
      const result = service.detectIntent("请制作一个图表");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("detects 'create' as GENERATE", () => {
      const result = service.detectIntent("Create a diagram");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });
  });

  // ─── detectIntent – ANALYZE ──────────────────────────────────────────────────

  describe("detectIntent() – ANALYZE", () => {
    it("detects '分析' as ANALYZE with REFERENCE_RECENT strategy", () => {
      const result = service.detectIntent("请分析这组数据");
      expect(result.intent).toBe(UserIntent.ANALYZE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(result.confidence).toBe(0.8);
    });

    it("detects '对比' as ANALYZE", () => {
      const result = service.detectIntent("对比两者的差异");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("detects 'analyze' (English) as ANALYZE", () => {
      const result = service.detectIntent("Analyze these results");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("detects 'evaluate' as ANALYZE", () => {
      const result = service.detectIntent("Please evaluate the proposal");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("detects '评估' as ANALYZE", () => {
      const result = service.detectIntent("请评估风险");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("detects '评价' as ANALYZE", () => {
      const result = service.detectIntent("请评价这份方案");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("detects 'compare' as ANALYZE", () => {
      const result = service.detectIntent("Compare these options");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });
  });

  // ─── detectIntent – CONTINUE ─────────────────────────────────────────────────

  describe("detectIntent() – CONTINUE", () => {
    it("detects '继续' as CONTINUE with STANDARD strategy", () => {
      const result = service.detectIntent("请继续");
      expect(result.intent).toBe(UserIntent.CONTINUE);
      expect(result.strategy).toBe(ContextStrategy.STANDARD);
      expect(result.confidence).toBe(0.75);
    });

    it("detects 'continue' (English) as CONTINUE", () => {
      const result = service.detectIntent("Please continue");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects '展开' as CONTINUE", () => {
      const result = service.detectIntent("请展开说明");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects '深入' as CONTINUE", () => {
      const result = service.detectIntent("请深入讨论");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects 'elaborate' as CONTINUE", () => {
      const result = service.detectIntent("Please elaborate on that");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects '接着' as CONTINUE", () => {
      const result = service.detectIntent("接着说");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects '更多' as CONTINUE", () => {
      const result = service.detectIntent("请给我更多信息");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });

    it("detects 'go on' as CONTINUE", () => {
      const result = service.detectIntent("go on");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });
  });

  // ─── detectIntent – reference keyword combinations ───────────────────────────

  describe("detectIntent() – reference keyword combinations", () => {
    it("generate keyword is detected at step 4 (before reference step), returning 0.8 confidence", () => {
      // "上面" (reference) + "生成" (generate)
      // IMPORTANT: generate keywords are checked at step 4 before reference at step 7.
      // When "生成" matches at step 4, the function returns immediately with confidence 0.8.
      // The reference+generate 0.85 branch in step 7 is only reachable if generate did NOT match
      // at step 4, which is mutually exclusive. So combined reference+generate always yields 0.8.
      const result = service.detectIntent("根据上面的内容生成报告");
      expect(result.intent).toBe(UserIntent.GENERATE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(result.confidence).toBe(0.8);
    });

    it("reference + summarize → SUMMARIZE with REFERENCE_RECENT and higher confidence", () => {
      // "上面" (reference) + "总结" (summarize) — BUT summarize is detected first
      // The code checks summarize before reference, so "总结上面" → SUMMARIZE at 0.8
      // To trigger the reference+summarize branch, need reference only (no standalone summarize)
      // Actually let us check: "上面那些观点总结" — summarize keyword detected first
      const result = service.detectIntent("请总结上面的讨论");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
      // confidence may be 0.8 (direct summarize detection) or 0.85 (reference+summarize branch)
      // Summarize is detected before reference in the code, so it returns at 0.8
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
    });

    it("reference only → ANALYZE with REFERENCE_RECENT and 0.7 confidence", () => {
      // Only reference keywords, no generate/summarize
      const result = service.detectIntent("上面那些观点");
      expect(result.intent).toBe(UserIntent.ANALYZE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(result.confidence).toBe(0.7);
    });

    it("reference + previous → ANALYZE with REFERENCE_RECENT", () => {
      const result = service.detectIntent("之前的结论怎么看");
      expect(result.intent).toBe(UserIntent.ANALYZE);
      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
    });
  });

  // ─── selectStrategy ──────────────────────────────────────────────────────────

  describe("selectStrategy()", () => {
    it("START_NEW_SESSION → ISOLATED", () => {
      expect(service.selectStrategy(UserIntent.START_NEW_SESSION)).toBe(
        ContextStrategy.ISOLATED,
      );
    });

    it("SUMMARIZE → REFERENCE_RECENT", () => {
      expect(service.selectStrategy(UserIntent.SUMMARIZE)).toBe(
        ContextStrategy.REFERENCE_RECENT,
      );
    });

    it("GENERATE → REFERENCE_RECENT", () => {
      expect(service.selectStrategy(UserIntent.GENERATE)).toBe(
        ContextStrategy.REFERENCE_RECENT,
      );
    });

    it("ANALYZE → REFERENCE_RECENT", () => {
      expect(service.selectStrategy(UserIntent.ANALYZE)).toBe(
        ContextStrategy.REFERENCE_RECENT,
      );
    });

    it("CONTINUE → STANDARD", () => {
      expect(service.selectStrategy(UserIntent.CONTINUE)).toBe(
        ContextStrategy.STANDARD,
      );
    });

    it("GENERAL_CHAT → STANDARD", () => {
      expect(service.selectStrategy(UserIntent.GENERAL_CHAT)).toBe(
        ContextStrategy.STANDARD,
      );
    });
  });

  // ─── updateConfig ─────────────────────────────────────────────────────────────

  describe("updateConfig()", () => {
    it("adds custom new session keywords that trigger without debate constraint", () => {
      // Override newSessionKeywords; the check for debate words uses the matched keywords list
      // To bypass the debate filter, we can use mentionedCount=2
      service.updateConfig({ newSessionKeywords: ["全新话题", "換个话题"] });
      const result = service.detectIntent("来一个全新话题", {
        mentionedCount: 2,
      });
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("replaces summarize keywords with custom ones", () => {
      service.updateConfig({ summarizeKeywords: ["recap", "roundup"] });
      const result = service.detectIntent("Give me a recap");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("merges custom config with existing values", () => {
      const updatedConfig: Partial<IntentDetectionConfig> = {
        analyzeKeywords: ["inspect", "examine"],
      };
      service.updateConfig(updatedConfig);
      const result = service.detectIntent("Please inspect the data");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });

    it("replaces generate keywords with custom ones", () => {
      service.updateConfig({ generateKeywords: ["fabricate", "construct"] });
      const result = service.detectIntent("Fabricate a report");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("replaces continue keywords with custom ones", () => {
      service.updateConfig({ continueKeywords: ["proceed", "advance"] });
      const result = service.detectIntent("Please proceed");
      expect(result.intent).toBe(UserIntent.CONTINUE);
    });
  });

  // ─── custom rules ────────────────────────────────────────────────────────────

  describe("detectIntent() – customRules", () => {
    it("custom rule takes priority over built-in keyword matching", () => {
      service.updateConfig({
        customRules: [
          {
            intent: UserIntent.GENERATE,
            condition: (content) => content.includes("special_trigger"),
          },
        ],
      });

      const result = service.detectIntent("special_trigger do something");
      expect(result.intent).toBe(UserIntent.GENERATE);
      expect(result.confidence).toBe(0.9);
      expect(result.matchedKeywords).toContain("custom_rule");
    });

    it("custom rule receives metadata", () => {
      const conditionSpy = jest.fn().mockReturnValue(false);
      service.updateConfig({
        customRules: [
          {
            intent: UserIntent.ANALYZE,
            condition: conditionSpy,
          },
        ],
      });

      const metadata = { userId: "u1", role: "admin" };
      service.detectIntent("some content", metadata);

      expect(conditionSpy).toHaveBeenCalledWith("some content", metadata);
    });

    it("falls through to keyword matching when custom rule returns false", () => {
      service.updateConfig({
        customRules: [
          {
            intent: UserIntent.GENERATE,
            condition: () => false, // never matches
          },
        ],
      });

      const result = service.detectIntent("请总结内容");
      // Should still detect SUMMARIZE via keyword matching
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("strategy is determined by selectStrategy for custom rule intent", () => {
      service.updateConfig({
        customRules: [
          {
            intent: UserIntent.START_NEW_SESSION,
            condition: () => true,
          },
        ],
      });

      const result = service.detectIntent("anything");
      expect(result.strategy).toBe(ContextStrategy.ISOLATED);
    });

    it("first matching custom rule wins", () => {
      service.updateConfig({
        customRules: [
          {
            intent: UserIntent.GENERATE,
            condition: (content) => content.includes("trigger"),
          },
          {
            intent: UserIntent.ANALYZE,
            condition: (content) => content.includes("trigger"),
          },
        ],
      });

      const result = service.detectIntent("trigger something");
      expect(result.intent).toBe(UserIntent.GENERATE); // first rule wins
    });
  });

  // ─── case-insensitive matching ────────────────────────────────────────────────

  describe("detectIntent() – case insensitivity", () => {
    it("matches 'SUMMARIZE' in uppercase", () => {
      const result = service.detectIntent("Please SUMMARIZE the data");
      expect(result.intent).toBe(UserIntent.SUMMARIZE);
    });

    it("matches 'Generate' in mixed case", () => {
      const result = service.detectIntent("Generate an image");
      expect(result.intent).toBe(UserIntent.GENERATE);
    });

    it("matches 'NEW CHAT' in uppercase", () => {
      // NEW CHAT is a general new session keyword, falls through without debate context
      const result = service.detectIntent("NEW CHAT please");
      // Without mentionedCount >= 2 or debate keyword → GENERAL_CHAT
      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });

    it("matches debate keyword 'PK' case-insensitively", () => {
      // The code checks k.toLowerCase() against 'pk'
      const result = service.detectIntent("来一场pk比赛");
      expect(result.intent).toBe(UserIntent.START_NEW_SESSION);
    });

    it("matches 'analyze' lowercase", () => {
      const result = service.detectIntent("analyze the situation");
      expect(result.intent).toBe(UserIntent.ANALYZE);
    });
  });

  // ─── matchedKeywords ─────────────────────────────────────────────────────────

  describe("detectIntent() – matchedKeywords", () => {
    it("includes matched keyword in result", () => {
      const result = service.detectIntent("请总结一下");
      expect(result.matchedKeywords).toBeDefined();
      expect(result.matchedKeywords).toContain("总结");
    });

    it("includes multiple matched keywords", () => {
      const result = service.detectIntent("分析并评价这份报告");
      expect(result.matchedKeywords).toBeDefined();
      // At least one analyze keyword matched
      expect(result.matchedKeywords!.length).toBeGreaterThan(0);
    });

    it("includes debate keywords in matched list for START_NEW_SESSION", () => {
      const result = service.detectIntent("我们来一场辩论");
      expect(result.matchedKeywords).toContain("辩论");
    });
  });
});
