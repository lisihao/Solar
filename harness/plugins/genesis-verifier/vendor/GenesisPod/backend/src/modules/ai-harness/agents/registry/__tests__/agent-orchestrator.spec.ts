import { AgentOrchestrator } from "../agent-orchestrator";
import { PlanBasedAgentRegistry } from "../plan-based-agent-registry";
import { AgentId } from "@/modules/ai-harness/agents/abstractions/agent.types";

// Create mock agent factory
function createMockAgent(id: string, keywords: string[]) {
  return {
    id,
    name: `Agent ${id}`,
    description: `Mock agent ${id}`,
    capabilities: [],
    requiredTools: [],
    getConfig: () => ({
      id,
      name: `Agent ${id}`,
      description: `Mock agent ${id}`,
      icon: "",
      color: "",
      capabilities: [],
      templates: [],
      selectionKeywords: keywords,
    }),
    plan: jest.fn(),
    execute: jest.fn(),
  };
}

describe("AgentOrchestrator - selectAgent scoring", () => {
  let orchestrator: AgentOrchestrator;
  let registry: PlanBasedAgentRegistry;

  beforeEach(() => {
    registry = new PlanBasedAgentRegistry();
    orchestrator = new AgentOrchestrator(registry);
  });

  const callSelectAgent = async (prompt: string): Promise<AgentId | null> => {
    return (orchestrator as any).selectAgent({ prompt });
  };

  it("should select exact matching agent with single keyword", async () => {
    registry.register(createMockAgent("agent-a", ["代码", "code"]) as any);
    registry.register(createMockAgent("agent-b", ["研究", "research"]) as any);

    const result = await callSelectAgent("帮我写代码");
    expect(result).toBe("agent-a");
  });

  it("should select highest-scoring agent when multiple match", async () => {
    // agent-a matches "设计" (1 keyword)
    registry.register(createMockAgent("agent-a", ["设计", "design"]) as any);
    // agent-b matches "设计" + "图片" (2 keywords)
    registry.register(
      createMockAgent("agent-b", ["设计", "图片", "infographic"]) as any,
    );

    const result = await callSelectAgent("帮我设计一张图片");
    expect(result).toBe("agent-b");
  });

  it("should return first registered agent when no keywords match", async () => {
    registry.register(createMockAgent("agent-a", ["代码"]) as any);
    registry.register(createMockAgent("agent-b", ["研究"]) as any);

    const result = await callSelectAgent("完全无关的话题");
    expect(result).toBe("agent-a");
  });

  it("should return null when no agents registered", async () => {
    const result = await callSelectAgent("任何内容");
    expect(result).toBeNull();
  });

  it("should favor agent with more keyword matches over single match", async () => {
    // agent-a: matches "图" + "画" (2 matches, ratio 2/2=1.0, total=3.0)
    registry.register(createMockAgent("agent-a", ["图", "画"]) as any);
    // agent-b: matches "infographic" (1 match, ratio 1/1=1.0, total=2.0)
    registry.register(createMockAgent("agent-b", ["infographic"]) as any);

    const result = await callSelectAgent("create an infographic 画图");
    expect(result).toBe("agent-a");
  });

  it("should favor agent with most keyword matches for multi-intent prompts", async () => {
    registry.register(createMockAgent("agent-a", ["代码", "编程"]) as any);
    registry.register(
      createMockAgent("agent-b", ["代码", "测试", "调试"]) as any,
    );

    // "代码" matches both, but agent-b also matches "测试"
    const result = await callSelectAgent("帮我测试代码");
    expect(result).toBe("agent-b");
  });

  it("should skip agents with no selectionKeywords", async () => {
    registry.register(createMockAgent("agent-a", []) as any);
    registry.register(createMockAgent("agent-b", ["代码"]) as any);

    const result = await callSelectAgent("写代码");
    expect(result).toBe("agent-b");
  });

  it("should match keywords case-insensitively", async () => {
    // Keywords have mixed case, prompt is lowered internally
    registry.register(createMockAgent("agent-a", ["Code", "Python"]) as any);
    registry.register(createMockAgent("agent-b", ["研究"]) as any);

    const result = await callSelectAgent("help me write python code");
    expect(result).toBe("agent-a");
  });

  it("should correctly calculate match ratio bonus", async () => {
    // agent-a: 2/2 keywords match = 100% match rate → score = 2 + 1.0 = 3.0
    registry.register(createMockAgent("agent-a", ["代码", "测试"]) as any);
    // agent-b: 2/5 keywords match = 40% match rate → score = 2 + 0.4 = 2.4
    registry.register(
      createMockAgent("agent-b", [
        "代码",
        "测试",
        "部署",
        "监控",
        "运维",
      ]) as any,
    );

    const result = await callSelectAgent("代码测试");
    expect(result).toBe("agent-a");
  });

  it("should handle prompts with no matching keywords", async () => {
    registry.register(createMockAgent("agent-a", ["代码"]) as any);
    registry.register(createMockAgent("agent-b", ["研究"]) as any);

    const result = await callSelectAgent("天气如何");
    expect(result).toBe("agent-a");
  });

  it("should handle empty prompt gracefully", async () => {
    registry.register(createMockAgent("agent-a", ["代码"]) as any);

    const result = await callSelectAgent("");
    expect(result).toBe("agent-a");
  });

  it("should select first agent on tie (registration order)", async () => {
    // Both match 1 keyword with same ratio → first registered wins
    registry.register(createMockAgent("agent-a", ["代码"]) as any);
    registry.register(createMockAgent("agent-b", ["代码"]) as any);

    const result = await callSelectAgent("写代码");
    expect(result).toBe("agent-a");
  });

  it("should treat Chinese and English keywords equally (no length bias)", async () => {
    // "代码" (2 chars) should score the same as "coding" (6 chars) per match
    registry.register(createMockAgent("agent-cn", ["代码"]) as any);
    registry.register(createMockAgent("agent-en", ["coding"]) as any);

    const cnResult = await callSelectAgent("代码");
    const enResult = await callSelectAgent("coding");
    // Both should score 1 (base) + 1/1 (ratio) = 2.0
    expect(cnResult).toBe("agent-cn");
    expect(enResult).toBe("agent-en");
  });
});
