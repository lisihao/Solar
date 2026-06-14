import {
  buildAgentSystemPrompt,
  composeJudgeUserMessage,
  composeRoundUserMessage,
} from "../debate-prompts";

describe("debate-prompts (pure builders)", () => {
  describe("buildAgentSystemPrompt", () => {
    it("RED: identity + topic + opponent + format", () => {
      const out = buildAgentSystemPrompt({
        role: "RED",
        topic: "AGI 是否在 2030 年前实现",
        myDisplayName: "Alice",
        opponentDisplayName: "Bob",
      });
      expect(out).toContain("正方/红方辩手");
      expect(out).toContain("Alice");
      expect(out).toContain("Bob");
      expect(out).toContain("AGI 是否在 2030 年前实现");
      expect(out).toContain("@Bob");
    });

    it("BLUE: identity + topic + opponent + counter format", () => {
      const out = buildAgentSystemPrompt({
        role: "BLUE",
        topic: "AGI 是否在 2030 年前实现",
        myDisplayName: "Bob",
        opponentDisplayName: "Alice",
      });
      expect(out).toContain("反方/蓝方辩手");
      expect(out).toContain("Bob");
      expect(out).toContain("Alice");
      expect(out).toContain("@Alice");
      expect(out).toContain("我方反驳");
    });

    it("JUDGE: no opponent, judge format only", () => {
      const out = buildAgentSystemPrompt({
        role: "JUDGE",
        topic: "AGI 是否在 2030 年前实现",
        myDisplayName: "Carol",
        opponentDisplayName: "",
      });
      expect(out).toContain("综合评判");
      expect(out).toContain("AGI 是否在 2030 年前实现");
      // JUDGE 无对手块
      expect(out).not.toContain("@");
    });
  });

  describe("composeRoundUserMessage", () => {
    it("first round without opponent message: opening directive", () => {
      const out = composeRoundUserMessage(1, undefined);
      expect(out).toContain("第 1 轮");
      expect(out).toContain("阐述你的观点");
    });

    it("subsequent round: includes opponent message verbatim", () => {
      const out = composeRoundUserMessage(2, "对手论点：技术路线已收敛");
      expect(out).toContain("对手发言");
      expect(out).toContain("对手论点：技术路线已收敛");
      expect(out).toContain("请针对上述观点进行回应");
    });

    it("empty opponent string treated as first-round opener", () => {
      const out = composeRoundUserMessage(3, "   ");
      expect(out).toContain("第 3 轮");
      expect(out).not.toContain("对手发言");
    });
  });

  describe("composeJudgeUserMessage", () => {
    it("packs both sides' speeches with display names and round labels", () => {
      const out = composeJudgeUserMessage({
        topic: "AGI 是否在 2030 年前实现",
        redDisplayName: "Alice",
        blueDisplayName: "Bob",
        redSpeeches: ["red R1 speech", "red R2 speech"],
        blueSpeeches: ["blue R1 speech", "blue R2 speech"],
      });
      expect(out).toContain("AGI 是否在 2030 年前实现");
      expect(out).toContain("Alice - 第 1 轮");
      expect(out).toContain("red R1 speech");
      expect(out).toContain("Bob - 第 2 轮");
      expect(out).toContain("blue R2 speech");
    });

    it("empty speeches degrade gracefully", () => {
      const out = composeJudgeUserMessage({
        topic: "测试",
        redDisplayName: "Alice",
        blueDisplayName: "Bob",
        redSpeeches: [],
        blueSpeeches: [],
      });
      expect(out).toContain("（无）");
    });

    it("custom labels override the default 正方/反方 wording", () => {
      const out = composeJudgeUserMessage({
        topic: "AGI timeline",
        redDisplayName: "Alice",
        blueDisplayName: "Bob",
        redSpeeches: ["R1"],
        blueSpeeches: ["B1"],
        redLabel: "Pro",
        blueLabel: "Con",
        judgeInstruction: "Render your verdict in English.",
      });
      expect(out).toContain("【Pro发言记录】");
      expect(out).toContain("【Con发言记录】");
      expect(out).toContain("Render your verdict in English.");
      expect(out).not.toContain("正方发言记录");
      expect(out).not.toContain("反方发言记录");
    });
  });
});
