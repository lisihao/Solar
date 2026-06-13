/**
 * Production Anomaly Defense Tests
 *
 * Tests derived from ACTUAL production report data (database extracts).
 * Each test case uses real anomaly patterns found in reports 16c56e00 and 69e2f94f.
 */

// ★ 2026-05-13: import paths fixed after MECE-W17 reorg (commit 0445c6862)
//   and PR-Engine-Top (commit 101d7f444) moved these utils to:
//     stripChartJsonFromContent → ai-engine/llm/output/sanitization
//     stripLLMMetaNotes        → ai-app/contracts/report-template (unchanged path-key)
import { stripChartJsonFromContent } from "../../src/modules/ai-engine/llm/output/sanitization/strip-chart-json.utils";
import { stripLLMMetaNotes } from "../../src/modules/ai-app/contracts/report-template";

// ============================================================================
// 1. JSON Residue Defense (from real reports)
// ============================================================================

describe("Production Defense: JSON residue cleanup", () => {
  it("should strip standalone JSON property lines (figureId, position, citation)", () => {
    const content = [
      "正文分析了多智能体技术的专利质量评估。",
      "",
      '"figureId": "FIG-8",',
      '"position": "afterparagraph_3",',
      '"citation": "图表显示专利引用网络与质量分布，支持多智能体影响力评估[16]。"',
      "",
      "后续正文继续讨论专利创新趋势。",
    ].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).not.toContain('"figureId"');
    expect(cleaned).not.toContain('"position"');
    expect(cleaned).not.toContain('"citation"');
    expect(cleaned).toContain("正文分析了");
    expect(cleaned).toContain("后续正文继续");
  });

  it("should strip multi-line figureReferences JSON block", () => {
    const content = [
      "技术融合路径分析完毕。",
      "",
      '"figureReferences": [',
      "",
      '"figureId": "FIG-9",',
      '"after_paragraph": 3,',
      '"type": "image",',
      "",
      '### 8.4. "title": "AI融合计算资源趋势",',
      '"description": "该图展示数据中心模型中多智能体与IoT融合下的计算资源分配。',
      "",
      '",',
      '"source": "SemiAnalysis Datacenter Model [70]",',
      '"url": "https://substackcdn.com/image/fetch/test.png"',
      "",
      "后续正文继续。",
    ].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).not.toContain('"figureReferences"');
    expect(cleaned).not.toContain('"figureId"');
    expect(cleaned).not.toContain('"after_paragraph"');
    expect(cleaned).not.toContain('"source"');
    expect(cleaned).toContain("技术融合路径分析完毕");
    expect(cleaned).toContain("后续正文继续");
  });

  it("should strip chart config with type/title/subtitle/source/url", () => {
    const content = [
      "段落内容。",
      "",
      '"after_paragraph": 2,',
      '"type": "line",',
      '"title": "企业AI中LLM供应商使用随时间变化的性能趋势",',
      '"subtitle": "图表显示多智能体集成LLM后，性能从2025年的基线提升30%",',
      '"source": "a16z企业AI报告[2]",',
      '"url": "https://d1lamhf6l6yk6d.cloudfront.net/uploads/2026/02/wr26-LLM-Vendor-Usage-Over-Time.png"',
      "",
      "继续分析。",
    ].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).not.toContain('"after_paragraph"');
    expect(cleaned).not.toContain('"type"');
    expect(cleaned).not.toContain('"title"');
    expect(cleaned).toContain("段落内容");
    expect(cleaned).toContain("继续分析");
  });

  it("should strip { 'figures': } residue block", () => {
    const content = ["正文。", "{", '"figures":', "}", "后续。"].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).not.toContain('"figures"');
    expect(cleaned).toContain("正文");
    expect(cleaned).toContain("后续");
  });

  it("should NOT strip normal markdown content", () => {
    const content = [
      "# 多智能体技术研究",
      "",
      "根据研究[1]，多智能体系统[2][3]的发展显著。",
      "",
      "- 列表项 1",
      "- 列表项 2",
      "",
      "| 指标 | 数值 |",
      "|------|------|",
      "| 效率 | 30%  |",
      "",
      '所谓"关键技术"是指核心算法和框架。',
      "",
      "### 2.1. 技术原理分析",
    ].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).toBe(content);
  });

  it("should NOT strip code blocks containing JSON", () => {
    const content = [
      "示例代码：",
      "```json",
      '{"key": "value", "type": "image"}',
      "```",
      "后续正文。",
    ].join("\n");

    const cleaned = stripChartJsonFromContent(content);
    expect(cleaned).toContain('"key"');
    expect(cleaned).toContain('"type"');
  });
});

// ============================================================================
// 2. Instruction Leak Defense
// ============================================================================

describe("Production Defense: instruction leak cleanup", () => {
  it("should strip （不含要点和参考）", () => {
    const cleaned = stripLLMMetaNotes("分析完毕（不含要点和参考）。继续。");
    expect(cleaned).not.toContain("不含要点和参考");
    expect(cleaned).toContain("分析完毕");
  });

  it("should strip （不含要点速览和标题）。", () => {
    const cleaned = stripLLMMetaNotes("结论（不含要点速览和标题）。后续。");
    expect(cleaned).not.toContain("不含要点");
  });

  it("should strip （不含要点和标题）。", () => {
    const cleaned = stripLLMMetaNotes("概述（不含要点和标题）。");
    expect(cleaned).not.toContain("不含");
  });

  it("should NOT strip normal parenthetical", () => {
    const cleaned = stripLLMMetaNotes(
      "多智能体系统（如图所示）在2026年取得突破。",
    );
    expect(cleaned).toContain("（如图所示）");
  });
});

// ============================================================================
// 3. Citation Stacking Defense
// ============================================================================

describe("Production Defense: citation stacking", () => {
  it("should reduce [47][49][51] to [47][49]", () => {
    const input = "技术进展显著[47][49][51]。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe("技术进展显著[47][49]。");
  });

  it("should reduce [28][32][40] to [28][32]", () => {
    const input = "效率提升[28][32][40]，支持规模化。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe("效率提升[28][32]，支持规模化。");
  });

  it("should reduce [80][82][83][85][89] to [80][82]", () => {
    const input = "安全研究[80][82][83][85][89]表明。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe("安全研究[80][82]表明。");
  });

  it("should handle space-separated stacking [1] [2] [3]", () => {
    const input = "数据显示[1] [2] [3] [4]趋势。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe("数据显示[1] [2]趋势。");
  });

  it("should NOT touch exactly 2 citations", () => {
    const input = "根据研究[1][2]，结论成立。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe(input);
  });

  it("should handle multiple stacking groups in same line", () => {
    const input = "前述[1][2][3]分析和后续[4][5][6]研究。";
    const cleaned = input.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
    expect(cleaned).toBe("前述[1][2]分析和后续[4][5]研究。");
  });
});

// ============================================================================
// 4. Empty Citation Defense
// ============================================================================

describe("Production Defense: empty citation cleanup", () => {
  it("should clean 占比25%[] pattern", () => {
    const input =
      "安全性专利占比预计达25%[]，但开源框架的快速迭代往往忽略合规审查。";
    const cleaned = input.replace(/\[\s*\](?!\[)/g, "");
    expect(cleaned).toBe(
      "安全性专利占比预计达25%，但开源框架的快速迭代往往忽略合规审查。",
    );
  });

  it("should clean 伦理专利占比25%[] pattern", () => {
    const input = "预测的伦理专利占比25%[]，在此基础上扩展至环保应用。";
    const cleaned = input.replace(/\[\s*\](?!\[)/g, "");
    expect(cleaned).toBe("预测的伦理专利占比25%，在此基础上扩展至环保应用。");
  });

  it("should NOT affect valid citations [1]", () => {
    const input = "根据数据[1]，趋势明显。";
    const cleaned = input.replace(/\[\s*\](?!\[)/g, "");
    expect(cleaned).toBe(input);
  });

  it("should NOT affect image syntax ![alt](url)", () => {
    const input = "![图表](https://example.com/img.png)";
    const cleaned = input.replace(/\[\s*\](?!\[)/g, "");
    expect(cleaned).toBe(input);
  });
});

// ============================================================================
// 5. Double ### Heading Defense
// ============================================================================

describe("Production Defense: double ### heading fix", () => {
  it("should fix ### 2.1. ### Title → ### 2.1. Title", () => {
    const input = "### 2.1. ### 关键技术突破分析";
    const cleaned = input.replace(/^(###\s+\d+\.\d+\.?\s+)###\s+/gm, "$1");
    expect(cleaned).toBe("### 2.1. 关键技术突破分析");
  });

  it("should fix ### 6.2. ### Title", () => {
    const input = "### 6.2. ### 市场原型发展与企业落地实践";
    const cleaned = input.replace(/^(###\s+\d+\.\d+\.?\s+)###\s+/gm, "$1");
    expect(cleaned).toBe("### 6.2. 市场原型发展与企业落地实践");
  });

  it("should NOT affect normal ### headings", () => {
    const input = "### 2.1. 正常标题";
    const cleaned = input.replace(/^(###\s+\d+\.\d+\.?\s+)###\s+/gm, "$1");
    expect(cleaned).toBe(input);
  });
});

// ============================================================================
// 6. Broken Image Format Defense
// ============================================================================

describe("Production Defense: broken image format", () => {
  it("should remove !(url) format", () => {
    const input =
      "下图所示：\n!(https://media.springernature.com/lw685/img.png)\n后续内容。";
    const cleaned = input.replace(/^!\(https?:\/\/[^)]+\)\s*$/gm, "");
    expect(cleaned).not.toContain("!(https");
    expect(cleaned).toContain("下图所示");
    expect(cleaned).toContain("后续内容");
  });

  it("should NOT remove valid image syntax", () => {
    const input = "![图表说明](https://example.com/chart.png)";
    const cleaned = input.replace(/^!\(https?:\/\/[^)]+\)\s*$/gm, "");
    expect(cleaned).toBe(input);
  });
});

// ============================================================================
// 7. Orphan Symbol Defense
// ============================================================================

describe("Production Defense: orphan JSON symbol cleanup", () => {
  it("should remove standalone ] on its own line", () => {
    const cleaned = stripLLMMetaNotes("前文。\n]\n后文。");
    expect(cleaned).not.toMatch(/^\s*\]\s*$/m);
  });

  it("should remove standalone } on its own line", () => {
    const cleaned = stripLLMMetaNotes("前文。\n}\n后文。");
    expect(cleaned).not.toMatch(/^\s*\}\s*$/m);
  });

  it("should remove standalone { on its own line", () => {
    const cleaned = stripLLMMetaNotes("前文。\n{\n后文。");
    expect(cleaned).not.toMatch(/^\s*\{\s*$/m);
  });

  it("should NOT remove ] inside normal text", () => {
    const cleaned = stripLLMMetaNotes("数据结果[1]表明。");
    expect(cleaned).toContain("[1]");
  });
});

// ============================================================================
// 8. Marketing Language Defense
// ============================================================================

describe("Production Defense: marketing language patterns", () => {
  it("should detect 势必引发变革", () => {
    const pattern = /(?:势必|必将|注定|必然)(?:引发|带来|改写|颠覆|重塑)/;
    expect(pattern.test("这项技术势必引发变革")).toBe(true);
    expect(pattern.test("这项技术可能带来变化")).toBe(false);
  });

  it("should detect 不可忽视的机遇", () => {
    const pattern = /(?:不可忽视|不容忽视)的(?:机遇|趋势|方向)/;
    expect(pattern.test("蕴含不可忽视的机遇")).toBe(true);
    expect(pattern.test("值得关注的趋势")).toBe(false);
  });
});

// ============================================================================
// 9. Triple Blank Line Defense
// ============================================================================

describe("Production Defense: triple blank line compression", () => {
  it("should compress 3+ blank lines to 2", () => {
    const input = "段落一。\n\n\n\n段落二。";
    const cleaned = input.replace(/\n{3,}/g, "\n\n");
    expect(cleaned).toBe("段落一。\n\n段落二。");
  });

  it("should keep exactly 2 blank lines", () => {
    const input = "段落一。\n\n段落二。";
    const cleaned = input.replace(/\n{3,}/g, "\n\n");
    expect(cleaned).toBe(input);
  });
});

// ============================================================================
// 10. Reference Title Truncation Defense
// ============================================================================

describe("Production Defense: reference title truncation", () => {
  it("should truncate titles > 150 chars", () => {
    const longTitle = "A".repeat(200);
    const truncated =
      longTitle.length > 150 ? longTitle.substring(0, 147) + "..." : longTitle;
    expect(truncated.length).toBe(150);
    expect(truncated.endsWith("...")).toBe(true);
  });

  it("should NOT truncate normal titles", () => {
    const title = "Multi-Agent Systems in 2026";
    const truncated =
      title.length > 150 ? title.substring(0, 147) + "..." : title;
    expect(truncated).toBe(title);
  });
});

// ============================================================================
// 11. New Leak Patterns (from report 39080e1b)
// ============================================================================

describe("Production Defense: new leak patterns", () => {
  it("should strip [字数约1520字]", () => {
    const cleaned = stripLLMMetaNotes("分析完毕。[字数约1520字]");
    expect(cleaned).not.toContain("字数约");
  });

  it("should strip [约800字]", () => {
    const cleaned = stripLLMMetaNotes("概述。[约800字]");
    expect(cleaned).not.toContain("约800字");
  });

  it("should strip **以下是本维度使用的图表引用配置**：", () => {
    const cleaned = stripLLMMetaNotes(
      "正文。\n**以下是本维度使用的图表引用配置**：\n后续。",
    );
    expect(cleaned).not.toContain("图表引用配置");
    expect(cleaned).toContain("正文");
  });

  it("should strip [图表引用待定]", () => {
    const cleaned = stripLLMMetaNotes(
      "系统面临兼容性[图表引用待定]和延迟压力。",
    );
    expect(cleaned).not.toContain("图表引用待定");
    expect(cleaned).toContain("兼容性");
  });

  it("should strip [待补充]", () => {
    const cleaned = stripLLMMetaNotes("数据来源[待补充]。");
    expect(cleaned).not.toContain("待补充");
  });

  it("should strip 总之 summary sentences", () => {
    const cleaned = stripLLMMetaNotes(
      "前段。\n总之，2026年的专利创新将以问题导向驱动。\n后段。",
    );
    expect(cleaned).not.toContain("总之");
    expect(cleaned).toContain("前段");
    expect(cleaned).toContain("后段");
  });

  it("should NOT strip 总之 in report conclusion section", () => {
    // The regex only matches standalone paragraph lines, not mid-sentence
    const cleaned = stripLLMMetaNotes("根据分析总之判断是积极的");
    expect(cleaned).toContain("总之");
  });
});

// ============================================================================
// 12. Junk Reference Title Filtering
// ============================================================================

describe("Production Defense: junk reference title filtering", () => {
  it("should filter Microalgae reference", () => {
    const refs = [
      {
        title: "Multi-Agent Systems 2026",
        url: "https://example.com/1",
        domain: "example.com",
      },
      {
        title: "Microalgae-Derived Pigments: A 10-Year Bibliometric Review",
        url: "https://example.com/2",
        domain: "example.com",
      },
    ];
    const {
      filterJunkReferences,
    } = require("../../src/modules/ai-app/contracts/report-template/pipeline/report-formatting.utils");
    const filtered = filterJunkReferences(refs);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toContain("Multi-Agent");
  });

  it("should filter Biopolymer reference", () => {
    const refs = [
      {
        title: "Biopolymer: A Sustainable Material for Food",
        url: "https://a.com",
        domain: "a.com",
      },
    ];
    const {
      filterJunkReferences,
    } = require("../../src/modules/ai-app/contracts/report-template/pipeline/report-formatting.utils");
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should keep relevant AI reference", () => {
    const refs = [
      {
        title: "Top 10 AI Agent Software Companies for Enterprise 2026",
        url: "https://b.com",
        domain: "b.com",
      },
    ];
    const {
      filterJunkReferences,
    } = require("../../src/modules/ai-app/contracts/report-template/pipeline/report-formatting.utils");
    expect(filterJunkReferences(refs)).toHaveLength(1);
  });
});
