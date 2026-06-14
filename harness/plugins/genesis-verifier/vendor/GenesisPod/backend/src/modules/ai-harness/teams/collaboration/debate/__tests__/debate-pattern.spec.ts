import { DebatePattern } from "../debate-pattern";
import type { IDebateAgent, DebateRole } from "../debate.types";

interface RecordedCall {
  systemPrompt: string;
  userMessage: string;
  historyLen: number;
  /** 评审修订（R2 重要）：捕获 pattern 是否真的把 signal 传入 chat() */
  signalReceived: boolean;
  signalAlreadyAborted: boolean;
}

class MockAgent implements IDebateAgent {
  readonly id: string;
  readonly displayName: string;
  readonly role: DebateRole;
  readonly stance: string;
  readonly metadata?: Record<string, unknown>;
  readonly calls: RecordedCall[] = [];
  private replies: string[];

  constructor(opts: {
    id: string;
    role: DebateRole;
    displayName: string;
    replies: string[];
    stance?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.id = opts.id;
    this.role = opts.role;
    this.displayName = opts.displayName;
    this.replies = [...opts.replies];
    this.stance = opts.stance ?? "";
    this.metadata = opts.metadata;
  }

  async chat(input: {
    systemPrompt: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; tokensUsed?: number }> {
    this.calls.push({
      systemPrompt: input.systemPrompt,
      userMessage: input.userMessage,
      historyLen: input.history.length,
      signalReceived: input.signal !== undefined,
      signalAlreadyAborted: input.signal?.aborted ?? false,
    });
    if (input.signal?.aborted) {
      throw new Error("MockAgent: signal aborted before chat completed");
    }
    const reply = this.replies.shift() ?? "(no reply queued)";
    return { content: reply, tokensUsed: 42 };
  }
}

describe("DebatePattern.runDebate", () => {
  const topic = "AGI 是否在 2030 年前实现";

  it("runs RED → BLUE in each round; histories grow per agent independently", async () => {
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "Alice",
      replies: ["R1", "R2", "R3"],
    });
    const blue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "Bob",
      replies: ["B1", "B2", "B3"],
    });
    const pattern = new DebatePattern();

    const results = await pattern.runDebate({
      topic,
      agents: [red, blue],
      config: { maxRounds: 3 },
    });

    expect(results).toHaveLength(6);
    expect(results.map((r) => r.role)).toEqual([
      "RED",
      "BLUE",
      "RED",
      "BLUE",
      "RED",
      "BLUE",
    ]);
    // RED round 1: no opponent message yet
    expect(red.calls[0].userMessage).toContain("第 1 轮");
    expect(red.calls[0].historyLen).toBe(0);
    // BLUE round 1: receives RED's R1
    expect(blue.calls[0].userMessage).toContain("R1");
    expect(blue.calls[0].historyLen).toBe(0);
    // RED round 2: history contains its own prior turn (2 entries: prior user + assistant)
    expect(red.calls[1].historyLen).toBe(2);
    // RED round 2 user message: opponent's BLUE R1 reply
    expect(red.calls[1].userMessage).toContain("B1");
    // BLUE round 2: history grew similarly
    expect(blue.calls[1].historyLen).toBe(2);
    expect(blue.calls[1].userMessage).toContain("R2");
  });

  it("with enableJudge=true, JUDGE summarizes after final round", async () => {
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "Alice",
      replies: ["R1", "R2"],
    });
    const blue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "Bob",
      replies: ["B1", "B2"],
    });
    const judge = new MockAgent({
      id: "j1",
      role: "JUDGE",
      displayName: "Carol",
      replies: ["JUDGEMENT"],
    });
    const pattern = new DebatePattern();

    const results = await pattern.runDebate({
      topic,
      agents: [red, blue, judge],
      config: { maxRounds: 2, enableJudge: true },
    });

    expect(results).toHaveLength(5); // 2 rounds × 2 + 1 judge
    expect(results[results.length - 1].role).toBe("JUDGE");
    expect(results[results.length - 1].content).toBe("JUDGEMENT");
    // JUDGE prompt contains both sides' speeches
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].userMessage).toContain("R1");
    expect(judge.calls[0].userMessage).toContain("R2");
    expect(judge.calls[0].userMessage).toContain("B1");
    expect(judge.calls[0].userMessage).toContain("B2");
  });

  it("throws if enableJudge=true but no JUDGE agent", async () => {
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "A",
      replies: ["R1"],
    });
    const blue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "B",
      replies: ["B1"],
    });
    const pattern = new DebatePattern();

    await expect(
      pattern.runDebate({
        topic,
        agents: [red, blue],
        config: { maxRounds: 1, enableJudge: true },
      }),
    ).rejects.toThrow(/JUDGE/);
  });

  it("throws if RED or BLUE missing", async () => {
    const onlyBlue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "B",
      replies: ["B1"],
    });
    const pattern = new DebatePattern();

    await expect(
      pattern.runDebate({
        topic,
        agents: [onlyBlue],
        config: { maxRounds: 1 },
      }),
    ).rejects.toThrow(/RED.*BLUE/);
  });

  it("propagates signal into chat() so adapters can honor it during streaming", async () => {
    const controller = new AbortController();
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "A",
      replies: ["R1"],
    });
    const blue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "B",
      replies: ["B1"],
    });
    const pattern = new DebatePattern();

    await pattern.runDebate({
      topic,
      agents: [red, blue],
      config: { maxRounds: 1, signal: controller.signal },
    });

    // Pattern 必须把同一 signal 传到每个 chat() 入参里
    expect(red.calls[0].signalReceived).toBe(true);
    expect(blue.calls[0].signalReceived).toBe(true);
    expect(red.calls[0].signalAlreadyAborted).toBe(false);
  });

  it("propagates IDebateAgent.metadata via closure (not via pattern)", async () => {
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "A",
      replies: ["R1"],
      metadata: { roomId: "rm-42", billingRef: "turn-7" },
    });
    const blue = new MockAgent({
      id: "b1",
      role: "BLUE",
      displayName: "B",
      replies: ["B1"],
    });
    const pattern = new DebatePattern();

    await pattern.runDebate({
      topic,
      agents: [red, blue],
      config: { maxRounds: 1 },
    });

    // metadata 是 IDebateAgent 自己的字段，pattern 不读不改
    expect(red.metadata).toEqual({ roomId: "rm-42", billingRef: "turn-7" });
  });

  it("aborts mid-debate when signal triggers", async () => {
    const controller = new AbortController();
    const red = new MockAgent({
      id: "r1",
      role: "RED",
      displayName: "A",
      replies: ["R1", "R2"],
    });
    const blue: IDebateAgent = {
      id: "b1",
      role: "BLUE",
      displayName: "B",
      stance: "",
      async chat() {
        // BLUE 在第一回合发言后用户取消
        controller.abort();
        return { content: "B1", tokensUsed: 5 };
      },
    };
    const pattern = new DebatePattern();

    await expect(
      pattern.runDebate({
        topic,
        agents: [red, blue],
        config: { maxRounds: 3, signal: controller.signal },
      }),
    ).rejects.toThrow(/aborted/);
  });
});
