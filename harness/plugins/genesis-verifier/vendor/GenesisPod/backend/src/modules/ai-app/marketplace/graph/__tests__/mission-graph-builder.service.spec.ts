/**
 * MissionGraphBuilderService.build 单测 —— 锁住「报告正文 → 图谱」核心 pipeline 行为，
 * 防止后续重构（含从 playground 抽到本共享层）悄悄退化：
 *   1. happy-path：extract → resolve → 组装 → analyses → summaries，产出 {graph, analyses}。
 *   2. 去重 / self-loop / dangling：canonical 合并节点、丢自环、丢悬挂边。
 *   3. 空报告 → null（不调 LLM）。
 *   4. 抽取两次都失败 → null（不伪造图）。
 *   5. entity resolution 抛错 → identity 兜底，仍出图（不拖死）。
 *   6. operationPrefix 透传到 chat.operationName（各 app 遥测命名空间不漂移）。
 */
import { MissionGraphBuilderService } from "../mission-graph-builder.service";

type AnyFn = jest.Mock;

function makeBuilder() {
  const chat = { chat: jest.fn() as AnyFn };
  const entityResolution = { resolve: jest.fn() as AnyFn };
  const search = { search: jest.fn() as AnyFn };
  const builder = new MissionGraphBuilderService(
    chat as never,
    entityResolution as never,
    search as never,
  );
  return { builder, chat, entityResolution, search };
}

/** 标准 extract 产物：Alpha/Beta/Alpha Inc + 2 关系（含一条 canonical 后自环 + 一条悬挂）。 */
const EXTRACT_JSON = JSON.stringify({
  entities: [
    { name: "Alpha", type: "ORGANIZATION" },
    { name: "Beta", type: "ORGANIZATION" },
    { name: "Alpha Inc", type: "ORGANIZATION" },
  ],
  relations: [
    { source: "Alpha", target: "Beta", type: "COMPETES_WITH" },
    // canonical 后 Alpha Inc→Alpha，与 source Alpha 成自环 → 丢弃
    { source: "Alpha", target: "Alpha Inc", type: "PARTNERS_WITH" },
    // Ghost 不在实体集 → 悬挂 → 丢弃
    { source: "Alpha", target: "Ghost", type: "USES" },
  ],
});

/** Alpha Inc 归并到 Alpha 的 canonical 映射。 */
const CANONICAL_OF = {
  Alpha: "Alpha",
  Beta: "Beta",
  "Alpha Inc": "Alpha",
};

const SUMMARY_JSON = JSON.stringify({
  keyNodes: "kn",
  relatedness: "rl",
  competitive: "cp",
  community: "cm",
  supplyChain: "sc",
  supplyChainLayers: [],
});

describe("MissionGraphBuilderService.build", () => {
  it("happy-path：组装图谱 + 注入 LLM 摘要", async () => {
    const { builder, chat, entityResolution } = makeBuilder();
    chat.chat
      .mockResolvedValueOnce({ content: EXTRACT_JSON }) // extract
      .mockResolvedValueOnce({ content: SUMMARY_JSON }); // summarize
    entityResolution.resolve.mockResolvedValue({ canonicalOf: CANONICAL_OF });

    const result = await builder.build("user-1", "some report text");

    expect(result).not.toBeNull();
    // Alpha + Alpha Inc 归并 → Alpha；Beta → 共 2 节点
    expect(result!.graph.stats.totalNodes).toBe(2);
    // 仅 Alpha→Beta 一条有效边（自环 + 悬挂均丢弃）
    expect(result!.graph.stats.totalEdges).toBe(1);
    expect(result!.graph.edges[0]).toMatchObject({ type: "COMPETES_WITH" });
    // LLM 摘要注入到 analyses
    expect(result!.analyses.keyNodes.summary).toBe("kn");
    expect(result!.analyses.competitive.summary).toBe("cp");
    // 两次 LLM：extract + summarize
    expect(chat.chat).toHaveBeenCalledTimes(2);
  });

  it("空报告 → null，且不调用任何 LLM", async () => {
    const { builder, chat, entityResolution } = makeBuilder();
    const result = await builder.build("user-1", "   ");
    expect(result).toBeNull();
    expect(chat.chat).not.toHaveBeenCalled();
    expect(entityResolution.resolve).not.toHaveBeenCalled();
  });

  it("抽取两次都失败 → null（不伪造图）", async () => {
    const { builder, chat } = makeBuilder();
    chat.chat.mockResolvedValue({ content: "not json at all" });
    const result = await builder.build("user-1", "report");
    expect(result).toBeNull();
    // extract 重试一次 = 2 次；summarize 不应被调用
    expect(chat.chat).toHaveBeenCalledTimes(2);
  });

  it("entity resolution 抛错 → identity 兜底，仍出图", async () => {
    const { builder, chat, entityResolution } = makeBuilder();
    chat.chat
      .mockResolvedValueOnce({ content: EXTRACT_JSON })
      .mockResolvedValueOnce({ content: SUMMARY_JSON });
    entityResolution.resolve.mockRejectedValue(new Error("resolver down"));

    const result = await builder.build("user-1", "report");

    expect(result).not.toBeNull();
    // identity 映射下 Alpha Inc 不再归并 → Alpha / Beta / Alpha Inc 共 3 节点
    expect(result!.graph.stats.totalNodes).toBe(3);
    // Alpha→Beta（有效）+ Alpha→Alpha Inc（identity 下非自环、两端都在）= 2；Ghost 悬挂丢弃
    expect(result!.graph.stats.totalEdges).toBe(2);
  });

  it("operationPrefix 透传到 chat.operationName", async () => {
    const { builder, chat, entityResolution } = makeBuilder();
    chat.chat
      .mockResolvedValueOnce({ content: EXTRACT_JSON })
      .mockResolvedValueOnce({ content: SUMMARY_JSON });
    entityResolution.resolve.mockResolvedValue({ canonicalOf: CANONICAL_OF });

    await builder.build("user-1", "report", {
      operationPrefix: "playground.mission-graph",
    });

    const extractCall = chat.chat.mock.calls[0][0] as { operationName: string };
    const summarizeCall = chat.chat.mock.calls[1][0] as {
      operationName: string;
    };
    expect(extractCall.operationName).toBe("playground.mission-graph.extract");
    expect(summarizeCall.operationName).toBe(
      "playground.mission-graph.summarize",
    );
  });

  it("summarize LLM 失败 → 用 fallback 摘要，图仍产出", async () => {
    const { builder, chat, entityResolution } = makeBuilder();
    chat.chat
      .mockResolvedValueOnce({ content: EXTRACT_JSON }) // extract ok
      .mockRejectedValueOnce(new Error("summarize llm down")); // summarize 抛错
    entityResolution.resolve.mockResolvedValue({ canonicalOf: CANONICAL_OF });

    const result = await builder.build("user-1", "report");

    expect(result).not.toBeNull();
    expect(result!.graph.stats.totalNodes).toBe(2);
    // fallback 摘要为非空兜底文案，而非崩溃或空串
    expect(result!.analyses.keyNodes.summary.length).toBeGreaterThan(0);
  });
});
