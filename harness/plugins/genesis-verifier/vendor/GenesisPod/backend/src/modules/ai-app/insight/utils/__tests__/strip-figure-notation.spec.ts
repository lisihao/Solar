import { stripInternalFigureNotation } from "@/modules/ai-app/contracts/report-template";

describe("stripInternalFigureNotation", () => {
  it("should strip [证据[N] 图M] notation", () => {
    expect(stripInternalFigureNotation("高估大模型10-15%[证据[5] 图2]。")).toBe(
      "高估大模型10-15%。",
    );
  });

  it("should strip multiple [证据[N] 图M] in same text", () => {
    expect(
      stripInternalFigureNotation("数据A[证据[43] 图0]和数据B[证据[45] 图1]。"),
    ).toBe("数据A和数据B。");
  });

  it("should strip bare 证据[N] notation", () => {
    expect(stripInternalFigureNotation("根据证据[5]的分析结果。")).toBe(
      "根据的分析结果。",
    );
  });

  it("should NOT strip standard [N] citation brackets", () => {
    expect(stripInternalFigureNotation("根据研究[43]，性能提升显著。")).toBe(
      "根据研究[43]，性能提升显著。",
    );
  });

  it("should strip orphan figure sentence openers (图N展示了...)", () => {
    const input = "前文内容。\n图1展示了2026年基准排行榜。\n后续内容。";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("图1展示");
    expect(result).toContain("前文内容");
    expect(result).toContain("后续内容");
  });

  it("should strip orphan figure sentence openers (图N聚焦...)", () => {
    const input = "一些文本。\n图2聚焦Claude Sonnet 5性能。\n另一些文本。";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("图2聚焦");
  });

  it("should strip parenthesized figure refs （图N）", () => {
    expect(stripInternalFigureNotation("需要指数级投入的阶段（图2）。")).toBe(
      "需要指数级投入的阶段。",
    );
  });

  it("should strip parenthesized figure refs (图N)", () => {
    expect(stripInternalFigureNotation("详见数据(图3)。")).toBe("详见数据。");
  });

  it("should preserve 如图N所示 natural language refs", () => {
    expect(stripInternalFigureNotation("如图1所示，市场规模达100亿。")).toBe(
      "如图1所示，市场规模达100亿。",
    );
  });

  it("should strip 见图N / 参见图N inline refs", () => {
    expect(stripInternalFigureNotation("见图1，市场规模达100亿。")).toBe(
      "市场规模达100亿。",
    );
    expect(stripInternalFigureNotation("参见图2中的数据。")).toBe("的数据。");
  });

  it("should strip Leader 提供的 role leakage", () => {
    const input = 'Leader 提供的"数据集规模影响曲线图"直观显示';
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("Leader");
    expect(result).toContain("直观显示");
  });

  it("should NOT strip <!-- chart:xxx --> placeholders", () => {
    const input = "内容\n<!-- chart:d0-abc -->\n内容";
    expect(stripInternalFigureNotation(input)).toBe(input);
  });

  it("should clean up double punctuation from removed notation", () => {
    expect(stripInternalFigureNotation("数据，[证据[5] 图2]，显示")).toBe(
      "数据，显示",
    );
  });
});
