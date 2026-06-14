import { NoopSandboxReplayer, LlmSelfCheckReplayer } from "../sandbox-replayer";

describe("NoopSandboxReplayer", () => {
  it("sample() returns empty array", async () => {
    const replayer = new NoopSandboxReplayer();
    const samples = await replayer.sample("any-role", 5);
    expect(samples).toEqual([]);
  });

  it("replay() always returns 80", async () => {
    const replayer = new NoopSandboxReplayer();
    const result = await replayer.replay("# skill markdown", {
      id: "t1",
      input: {},
    });
    expect(result.score).toBe(80);
    expect(result.note).toContain("noop");
  });
});

describe("LlmSelfCheckReplayer", () => {
  function makeChat(content: string) {
    return { chat: jest.fn().mockResolvedValue({ content }) };
  }

  it("sample() delegates to sampleProvider", async () => {
    const provider = jest
      .fn()
      .mockResolvedValue([{ id: "t1", input: { query: "test" } }]);
    const replayer = new LlmSelfCheckReplayer(
      makeChat("{}") as never,
      provider,
    );
    const result = await replayer.sample("researcher", 3);
    expect(provider).toHaveBeenCalledWith("researcher", 3);
    expect(result).toHaveLength(1);
  });

  it("replay() parses LLM JSON response", async () => {
    const chat = makeChat(
      JSON.stringify({ score: 85, note: "Good skill match" }),
    );
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", {
      id: "t1",
      input: { q: "test" },
    });
    expect(result.score).toBe(85);
    expect(result.note).toBe("Good skill match");
  });

  it("replay() strips code fences from LLM response", async () => {
    const content = '```json\n{"score": 72, "note": "OK"}\n```';
    const chat = makeChat(content);
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(72);
  });

  it("replay() clamps score to 0-100", async () => {
    const chat = makeChat(JSON.stringify({ score: 150, note: "Too high" }));
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(100);
  });

  it("replay() returns 50 on LLM failure", async () => {
    const chat = { chat: jest.fn().mockRejectedValue(new Error("LLM down")) };
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(50);
    expect(result.note).toContain("LlmSelfCheckReplayer failed");
  });

  it("replay() returns 50 on invalid JSON", async () => {
    const chat = makeChat("not valid json at all");
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(50);
  });

  it("replay() handles missing score field (defaults to 50)", async () => {
    const chat = makeChat(JSON.stringify({ note: "No score provided" }));
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(50);
  });

  it("replay() strips ```-only fence without json label", async () => {
    const content = '```\n{"score": 60, "note": "plain fence"}\n```';
    const chat = makeChat(content);
    const replayer = new LlmSelfCheckReplayer(chat as never, jest.fn());
    const result = await replayer.replay("# skill", { id: "t1", input: {} });
    expect(result.score).toBe(60);
  });
});
