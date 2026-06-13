import {
  extractJsonFenceContent,
  parseJsonFence,
} from "../json-fence-parser.util";

describe("parseJsonFence", () => {
  it("plain text → jsonObj=null, response=raw", () => {
    const r = parseJsonFence("Hello world.");
    expect(r.jsonObj).toBeNull();
    expect(r.response).toBe("Hello world.");
    expect(r.outsideFenceText).toBe("");
  });

  it("```json fence with full object → parses, response from .response field", () => {
    const r = parseJsonFence<{ response: string; type: string }>(
      '```json\n{"type":"GO","response":"sure"}\n```',
    );
    expect(r.jsonObj).toEqual({ type: "GO", response: "sure" });
    expect(r.response).toBe("sure");
  });

  it("bare JSON without fence → parses", () => {
    const r = parseJsonFence<{ kind: string }>('{"kind":"x"}');
    expect(r.jsonObj).toEqual({ kind: "x" });
  });

  it("invalid JSON in fence → jsonObj=null, response=raw", () => {
    const raw = "```json\n{not valid\n```";
    const r = parseJsonFence(raw);
    expect(r.jsonObj).toBeNull();
    expect(r.response).toBe(raw);
  });

  it("response field chain fallback (response → message → understanding)", () => {
    const r1 = parseJsonFence<{ message: string }>('{"message":"m"}');
    expect(r1.response).toBe("m");
    const r2 = parseJsonFence<{ understanding: string }>(
      '{"understanding":"u"}',
    );
    expect(r2.response).toBe("u");
  });

  it("custom field chain", () => {
    const r = parseJsonFence('{"reply":"hi"}', ["reply"]);
    expect(r.response).toBe("hi");
  });

  it("outside-fence text used when no field matches", () => {
    const raw = '开场白\n```json\n{"x":1}\n```';
    const r = parseJsonFence<{ x: number }>(raw);
    expect(r.jsonObj).toEqual({ x: 1 });
    expect(r.outsideFenceText).toBe("开场白");
    expect(r.response).toBe("开场白");
  });

  it("empty input → response empty raw, jsonObj=null", () => {
    const r = parseJsonFence("");
    expect(r.jsonObj).toBeNull();
    expect(r.response).toBe("");
  });
});

describe("extractJsonFenceContent", () => {
  it("returns content of ```json fence", () => {
    expect(extractJsonFenceContent('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns content of ``` fence (no language tag)", () => {
    expect(extractJsonFenceContent("```\nfoo\n```")).toBe("foo");
  });

  it("returns null when no fence", () => {
    expect(extractJsonFenceContent("just text")).toBeNull();
  });
});
