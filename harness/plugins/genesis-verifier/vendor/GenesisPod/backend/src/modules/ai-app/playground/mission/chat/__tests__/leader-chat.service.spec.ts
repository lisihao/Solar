/**
 * leader-decision-parser — LLM 输出 → 结构化决策解析（PR-10a 拆出，
 * 原 LeaderChatService.parseDecisionResponse 私有方法已抽到独立模块）
 *
 * 这个 parser 是 LLM 输出 → 结构化决策的唯一入口；LLM 经常不严格按
 * 系统提示返回 JSON，所以容错路径必须健壮。
 */

import { parseLeaderDecisionResponse } from "../leader-decision-parser.util";

type ParseFn = (raw: string) => {
  response: string;
  decision: {
    type: string;
    understanding?: string;
    todo?: unknown;
    clarifyOptions?: unknown;
  } | null;
};

describe("LeaderChatService.parseDecisionResponse", () => {
  let parse: ParseFn;
  beforeAll(() => {
    parse = parseLeaderDecisionResponse as unknown as ParseFn;
  });

  it("plain text → DIRECT_ANSWER with raw as response", () => {
    const r = parse("好的，已收到。");
    expect(r.decision?.type).toBe("DIRECT_ANSWER");
    expect(r.response).toBe("好的，已收到。");
  });

  it("JSON in ```json fence → parses all fields", () => {
    const raw =
      '```json\n{"decisionType":"CREATE_TODO","response":"已加入","understanding":"补充政策维度","todo":[{"name":"政策对比","rationale":"补缺"}]}\n```';
    const r = parse(raw);
    expect(r.decision?.type).toBe("CREATE_TODO");
    expect(r.response).toBe("已加入");
    expect(r.decision?.understanding).toBe("补充政策维度");
    expect(r.decision?.todo).toEqual([{ name: "政策对比", rationale: "补缺" }]);
  });

  it("bare JSON without fence → parses", () => {
    const raw = '{"decisionType":"ACKNOWLEDGE","response":"明白"}';
    const r = parse(raw);
    expect(r.decision?.type).toBe("ACKNOWLEDGE");
    expect(r.response).toBe("明白");
  });

  it("invalid JSON in fence → falls back to raw text as DIRECT_ANSWER", () => {
    const raw = "```json\n{ broken json !!! }\n```";
    const r = parse(raw);
    expect(r.decision?.type).toBe("DIRECT_ANSWER");
    expect(r.response).toBe(raw);
  });

  it("unknown decisionType → coerces to DIRECT_ANSWER", () => {
    const raw = '```json\n{"decisionType":"WEIRD","response":"hi"}\n```';
    const r = parse(raw);
    expect(r.decision?.type).toBe("DIRECT_ANSWER");
    expect(r.response).toBe("hi");
  });

  it("missing response field → falls back to message → understanding → outside-fence text", () => {
    // 1. message field present
    const r1 = parse(
      '{"decisionType":"DIRECT_ANSWER","message":"from-message"}',
    );
    expect(r1.response).toBe("from-message");

    // 2. only understanding present
    const r2 = parse(
      '{"decisionType":"CLARIFY","understanding":"我不确定你想要什么"}',
    );
    expect(r2.response).toBe("我不确定你想要什么");

    // 3. text outside fence
    const r3 = parse(
      '我先解释下：\n\n```json\n{"decisionType":"DIRECT_ANSWER"}\n```',
    );
    expect(r3.response).toBe("我先解释下：");
  });

  it("clarifyOptions[] preserved", () => {
    const raw =
      '```json\n{"decisionType":"CLARIFY","response":"哪个","clarifyOptions":["A","B","C"]}\n```';
    const r = parse(raw);
    expect(r.decision?.type).toBe("CLARIFY");
    expect(r.decision?.clarifyOptions).toEqual(["A", "B", "C"]);
  });

  it("todo entry without rationale → fills (no rationale)", () => {
    const raw =
      '{"decisionType":"CREATE_TODO","response":"x","todo":[{"name":"X"}]}';
    const r = parse(raw);
    const todo = r.decision?.todo as { name: string; rationale: string }[];
    expect(todo[0].name).toBe("X");
    expect(todo[0].rationale).toBe("(no rationale)");
  });

  it("todo entry without name → filtered out", () => {
    const raw =
      '{"decisionType":"CREATE_TODO","response":"x","todo":[{"name":"OK","rationale":"r"},{"rationale":"orphan"}]}';
    const r = parse(raw);
    const todo = r.decision?.todo as { name: string }[];
    expect(todo.length).toBe(1);
    expect(todo[0].name).toBe("OK");
  });

  it("alias 'type' instead of 'decisionType' works", () => {
    const r = parse('{"type":"ACKNOWLEDGE","response":"ok"}');
    expect(r.decision?.type).toBe("ACKNOWLEDGE");
  });

  it("alias 'tasks' instead of 'todo' works", () => {
    const r = parse(
      '{"decisionType":"CREATE_TODO","response":"x","tasks":[{"name":"A","rationale":"r"}]}',
    );
    expect(r.decision?.todo as unknown[]).toHaveLength(1);
  });

  it("non-JSON, non-fenced text → DIRECT_ANSWER passthrough", () => {
    const raw = "Hi there, here's my answer about your question...";
    const r = parse(raw);
    expect(r.decision?.type).toBe("DIRECT_ANSWER");
    expect(r.response).toBe(raw);
  });
});
