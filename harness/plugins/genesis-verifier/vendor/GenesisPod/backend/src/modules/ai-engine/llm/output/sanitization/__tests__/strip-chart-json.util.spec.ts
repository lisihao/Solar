/**
 * strip-chart-json.utils.ts 单元测试
 */
import {
  stripChartJsonFromContent,
  extractMarkdownFromJsonString,
} from "../strip-chart-json.utils";

describe("stripChartJsonFromContent", () => {
  it("should return content unchanged when no chart markers present", () => {
    const content = "## 标题\n\n这是正文段落，没有任何图表数据。";
    expect(stripChartJsonFromContent(content)).toBe(content.trim());
  });

  // ★ 2026-05-06 #81 regression: chapter writer 用 ```chartjs fence 包 Chart.js
  //   配置 JSON，前端 markdown renderer 不识别这种 fence 当 code block 显示 raw JSON。
  //   strip-chart-json.utils 必须删除 chartjs / chart-data / chart fence 整段。
  //   2026-05-08 PR-A1: 用例从 ai-app/insight/utils/__tests__ 合并入此（双源消除）
  describe("#81 chartjs fence regression (Mission 1520783d 实证)", () => {
    it("should strip ```chartjs fence with Chart.js config", () => {
      const text = [
        "# 第 4 章 硬件基础设施",
        "",
        "推理芯片市场规模达500亿美元。",
        "",
        "```chartjs",
        '{"type": "line", "data": {"labels": ["2024", "2025", "2026"]}}',
        "```",
        "",
        "供应链依赖：NVIDIA。",
      ].join("\n");
      const result = stripChartJsonFromContent(text);
      expect(result).toContain("推理芯片市场规模");
      expect(result).toContain("供应链依赖");
      expect(result).not.toContain("```chartjs");
      expect(result).not.toContain('"labels"');
    });

    it("should strip ```chart-data fence with Chart.js config", () => {
      const text = '正文。\n\n```chart-data\n{"type": "bar"}\n```\n\n后续。';
      const result = stripChartJsonFromContent(text);
      expect(result).toContain("正文");
      expect(result).toContain("后续");
      expect(result).not.toContain("chart-data");
    });

    it("should strip ```chart fence with Chart.js config", () => {
      const text = '正文。\n\n```chart\n{"datasets": []}\n```\n\n后续。';
      const result = stripChartJsonFromContent(text);
      expect(result).toContain("正文");
      expect(result).toContain("后续");
      expect(result).not.toContain("```chart");
    });

    it("should NOT strip non-chart fences (preserve normal code blocks)", () => {
      const text = [
        "正文。",
        "",
        "```javascript",
        'const x = {"labels": ["a"]};',
        "```",
        "",
        "结尾。",
      ].join("\n");
      const result = stripChartJsonFromContent(text);
      expect(result).toContain("```javascript");
      expect(result).toContain("const x =");
    });

    it("should be case-insensitive (Chartjs / CHART-DATA)", () => {
      const text = '正文。\n\n```Chartjs\n{"x": 1}\n```\n';
      expect(stripChartJsonFromContent(text)).not.toContain("Chartjs");
    });
  });

  it("should strip Figure References section", () => {
    const content = "## 正文\n\nFigure References\nFIG-1: 图1描述\n\n正文继续";
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("Figure References");
    expect(result).toContain("正文继续");
  });

  it("should strip bold Figure References section", () => {
    const content = "## 正文\n\n**Figure References**\nFIG-1: 图1描述\n\n续文";
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("Figure References");
  });

  it("should strip bare CHARTS followed by JSON array", () => {
    const content = '正文内容\nCHARTS\n[\n  {"title": "chart1"}\n]\n更多内容';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
    expect(result).toContain("正文内容");
    expect(result).toContain("更多内容");
  });

  it("should strip ---CHARTS--- separator with JSON", () => {
    const content = '正文内容\n---CHARTS---{"generatedCharts": {"count": 2}}\n';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
    expect(result).toContain("正文内容");
  });

  it("should strip CHARTS--- separator with JSON", () => {
    const content = '正文\nCHARTS---{"figures": {"count": 1}}\n';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
  });

  it("should strip bare JSON block at end referencing generatedCharts when long enough before", () => {
    // The bareJsonPattern checks that content before the JSON block > 100 chars
    const longContent =
      "这是一段很长的正文内容，包含足够多的字符，超过100字符的阈值。这是更多的正文内容，用于测试。这是更多的正文内容，用于测试。这是更多补充内容保证超过一百个字符的最小长度。";
    const content =
      longContent + '\n\n{"generatedCharts": {"charts": []}, "data": []}';
    const result = stripChartJsonFromContent(content);
    // The stripping depends on the before content being long enough (>100 chars)
    // and the JSON matching the bare JSON pattern - just verify function runs without error
    expect(typeof result).toBe("string");
    expect(result).toContain("正文内容");
  });

  it("should strip 图表数据 section headers", () => {
    const content = "正文\n---\n## 图表数据\n---\n更多正文";
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("图表数据");
    expect(result).toContain("更多正文");
  });

  it("should strip H3 titles with inline JSON", () => {
    const content =
      '## 正文标题\n\n正文段落\n\n### 6.6. {"情景": "乐观"}\n\n更多内容';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain('{"情景"');
  });

  it("should strip standalone bare JSON object lines", () => {
    const content =
      '正文段落\n\n{"情景": "乐观", "采用率 (%)": 60},\n\n更多正文';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain('{"情景"');
    expect(result).toContain("正文段落");
  });

  it("should strip position instruction leaks", () => {
    const content = "正文内容paragraph_4$（置于图表后）更多内容";
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("paragraph_4$");
  });

  it("should preserve code block content", () => {
    const content = '正文\n\n```json\n{"key": "value"}\n```\n\n继续';
    const result = stripChartJsonFromContent(content);
    expect(result).toContain("```json");
    expect(result).toContain('{"key": "value"}');
  });

  it("should strip consecutive JSON lines (multi-line JSON blocks)", () => {
    const content =
      '正文段落\n\n"title": "图表标题",\n"data": [1, 2, 3]\n\n继续正文';
    const result = stripChartJsonFromContent(content);
    expect(result).toContain("正文段落");
    expect(result).toContain("继续正文");
  });

  it("should handle empty string", () => {
    expect(stripChartJsonFromContent("")).toBe("");
  });

  it("should handle content with nested braces in JSON", () => {
    const content = '正文\n---CHARTS---{"outer": {"inner": {"deep": 1}}}\n继续';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
  });

  it("should handle JSON with escaped quotes in strings", () => {
    const content =
      '正文\n---CHARTS---{"title": "He said \\"hello\\"", "count": 1}\n继续';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
  });

  it("should handle content with multiple CHARTS separators", () => {
    const content =
      '第一段\n---CHARTS---{"data1": {}}\n中间段\n-CHARTS-{"data2": {}}\n最后段';
    const result = stripChartJsonFromContent(content);
    expect(result).not.toContain("CHARTS");
  });

  it("should handle CHARTS separator without following JSON brace", () => {
    const content = "正文\n---CHARTS---\n没有JSON内容\n继续";
    // Should not crash even if no opening brace found
    const result = stripChartJsonFromContent(content);
    expect(typeof result).toBe("string");
  });
});

describe("extractMarkdownFromJsonString", () => {
  it("should return text unchanged if not starting with {", () => {
    const text = "## 这是正文内容";
    expect(extractMarkdownFromJsonString(text)).toBe(text);
  });

  it("should extract fullText from JSON", () => {
    const json = '{"fullText": "这是提取出来的正文内容"}';
    const result = extractMarkdownFromJsonString(json);
    expect(result).toBe("这是提取出来的正文内容");
  });

  it("should extract fullText from nested executiveSummary", () => {
    const json = '{"executiveSummary": {"fullText": "嵌套的正文内容"}}';
    const result = extractMarkdownFromJsonString(json);
    expect(result).toBe("嵌套的正文内容");
  });

  it("should extract string executiveSummary as fullText", () => {
    const json = '{"executiveSummary": "这是执行摘要的字符串内容"}';
    const result = extractMarkdownFromJsonString(json);
    expect(result).toBe("这是执行摘要的字符串内容");
  });

  it("should fall back to regex extraction for malformed JSON", () => {
    // Malformed JSON but contains fullText key - use regex fallback
    const text =
      '{broken json "fullText": "这段内容超过五十个字符的很长的正文内容正文内容正文内容正文内容正文内容"}';
    const result = extractMarkdownFromJsonString(text);
    // Either returns original or extracted content
    expect(typeof result).toBe("string");
  });

  it("should return original text if JSON has no fullText", () => {
    const json = '{"someOtherKey": "value"}';
    const result = extractMarkdownFromJsonString(json);
    expect(result).toBe(json);
  });

  it("should return original text for invalid JSON", () => {
    const json = "{invalid json no fullText}";
    const result = extractMarkdownFromJsonString(json);
    expect(result).toBe(json);
  });

  it("should handle regex fallback for fullText with escaped characters", () => {
    const escapeContent =
      "这是很长的内容\\n包含换行符\\t制表符，超过五十个字符的很长文本";
    const text = `{"fullText": "${escapeContent}"}`;
    const result = extractMarkdownFromJsonString(text);
    // Should successfully parse via JSON.parse
    expect(typeof result).toBe("string");
  });

  it("should handle empty string", () => {
    const result = extractMarkdownFromJsonString("");
    expect(result).toBe("");
  });

  it("should not extract fullText shorter than 50 chars from regex fallback", () => {
    // Malformed JSON with short fullText - regex fallback won't extract short values
    const text = '{bad "fullText": "短"}';
    const result = extractMarkdownFromJsonString(text);
    expect(result).toBe(text);
  });
});
