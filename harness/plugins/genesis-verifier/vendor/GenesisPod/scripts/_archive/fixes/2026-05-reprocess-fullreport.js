#!/usr/bin/env node
/**
 * Reprocess fullReport: apply all post-processing transforms to the stored
 * fullReport markdown, fixing rendering issues without re-assembling.
 *
 * Usage:
 *   cd backend && node ../scripts/reprocess-fullreport.js [reportId]
 */

const { PrismaClient } = require("@prisma/client");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("  export DATABASE_URL=postgresql://...");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ── Inline transforms (mirrors backend postProcessFinalReport pipeline) ──

function stripLLMMetaNotes(content) {
  return content
    .replace(/（精简字数[^）]*）/g, "")
    .replace(/（原\d+[^）]*）/g, "")
    .replace(/（[约共]\d+字）/g, "")
    .replace(/（\d+字）/g, "")
    .replace(/[（(]字数[：:]?\s*[约共]?\d+[字词][)）]/g, "")
    .replace(/[（(]当前字数[：:]?\s*\d+[)）]/g, "")
    .replace(/\[当前字数[：:]\s*\d+\]/g, "")
    .replace(/\(字数[^)]{0,30}\)/g, "")
    .replace(/（字数[^）]{0,30}）/g, "")
    .replace(/\*{2}字数[约共]?\d+字[^*]*\*{2}/g, "")
    .replace(/\*{2}字数统计\*{2}[：:]\s*[约共]?\d+字\s*/g, "")
    .replace(/[（(【\[]?\s*当前字数\s*[：:]\s*\d+\s*[)）】\]]?/g, "")
    .replace(/^\s*字数[：:]\s*[约共]?\d+[字词]?\s*$/gm, "")
    .replace(/[。.，,]?\s*字数[：:]\s*\d+(?=[)）])/g, "")
    .replace(/\(\s*word\s+count[:\s]*\d+\s*\)/gi, "")
    .replace(/\(\s*approximately\s+\d+\s+words?\s*\)/gi, "")
    .replace(/Leader\s*(?:分配|提供|生成|指派)的/g, "")
    .replace(/(?:研究|分析)?Agent\s*(?:分配|指派|生成|提供)的/g, "")
    .replace(/独立洞察[：:]/g, "")
    .replace(/需补充\d{4}\s*Q\d\s*企业报告验证/g, "")
    .replace(/(?:需|应)补充.*?(?:验证|数据|报告)/g, "")
    .replace(/^数据支撑总结[：:].+$/gm, "")
    .replace(/从学习路线图可见[，,]?/g, "")
    .replace(/(?:多模态)?课程常将/g, "研究表明")
    .replace(/数据与课程实践表明/g, "数据与实践表明")
    .replace(/在安全与对齐学习路线中/g, "在安全与对齐研究中")
    .replace(/\*{2}分析判断[：:]\*{2}\s*/g, "")
    .replace(/\*{2}总结[：:]\*{2}\s*/g, "")
    .replace(/\*{2}小结[：:]\*{2}\s*/g, "")
    .replace(/\*{2}结论[：:]\*{2}\s*/g, "")
    .replace(/\*{2}综合分析[：:]\*{2}\s*/g, "")
    .replace(/\*{2}综合判断[：:]\*{2}\s*/g, "")
    .replace(/\*{2}综上所述[：:]\*{2}\s*/g, "")
    .replace(/\*{2}要点[：:]\*{2}\s*/g, "")
    .replace(
      /<strong>(?:分析判断|总结|小结|结论|综合分析|综合判断|综上所述|要点)[：:]<\/strong>\s*/g,
      "",
    )
    .replace(/\[前文\]/g, "")
    .replace(/\[上文\]/g, "")
    .replace(/\[前述\]/g, "")
    .replace(/\[详见前文\]/g, "")
    .replace(/\[见前文\]/g, "")
    .replace(/<\\\/?(span|strong|em|p|div|li|ul|ol|a|h[1-6])>/gi, (m) =>
      m.replace(/\\/g, ""),
    )
    .replace(
      /(?:^|\n)\s*(?:综合来看|总体来看|综上所述|值得注意的是|值得警惕的是|需要指出的是|不可忽视的是|毋庸置疑)[，,：:]\s*/g,
      (m) => (m.startsWith("\n") ? "\n" : ""),
    )
    .replace(/代理ic\s*/g, "代理")
    .replace(/模型el\s*/g, "模型")
    .replace(/训练ing\s*/g, "训练")
    .replace(/推理ence\s*/g, "推理")
    .replace(/注意力tion\s*/g, "注意力")
    .replace(/嵌入ding\s*/g, "嵌入")
    .replace(/在学习路线中[，,]?/g, "")
    .replace(/多模态课程[中内]?[，,]?/g, "")
    .replace(/从教程中可以看到[，,]?/g, "")
    .replace(/如教材所述[，,]?/g, "")
    .replace(
      /^\s*(?:图片没有|没有图片|图片缺失|无图片|图片不可用)[：:].+$/gm,
      "",
    )
    .replace(/^\s*\[?(?:图片没有|没有图片|图片缺失|无图片)\]?\s*$/gm, "")
    .replace(/^\s*\.(?:avif|webp|png|jpg|jpeg|gif|svg)\)\s*$/gm, "")
    .replace(/^```(?:json|markdown|md|text|plain)?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function stripLeakedHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, (match) => {
    if (/chart:|figure:/.test(match)) return match;
    return "";
  });
}

function stripInternalFigureNotation(content) {
  return content
    .replace(/\[证据\s*\[[\d,\s]+\]\s*图\d+\]/g, "")
    .replace(/(?<!\[)证据\s*\[[\d,\s]+\]/g, "")
    .replace(/Leader\s*提供的[""「]?/g, "")
    .replace(/(?:研究员?|分析员?)\s*提供的[""「]?/g, "")
    .replace(/^\s*(?:图片没有|没有图片|图片缺失|无图片)[：:][^\n]*$/gm, "")
    .replace(
      /图\d+:\d+(?:直观|确认|展示了?|描绘了?|呈现了?|显示了?|聚焦|说明了?|对比了?|可[见知])/g,
      "",
    )
    .replace(
      /(?:^|\n)\s*图\d+(?:展示了?|聚焦|显示了?|呈现了?|直观呈现)[^\n]*(?:\n|$)/g,
      "\n",
    )
    .replace(/[（(]图\d+[)）]/g, "")
    .replace(
      /(?:见|参见|详见)(?:下)?图\d+(?:所示|中|可知)?[，,。.；;]?\s*/g,
      "",
    )
    .replace(/^[ \t]*图\s*\d+[.．。]\s*[^\n]+$/gm, "")
    .replace(/图\d+:\d+[^\n]{0,50}/g, "")
    .replace(/^[ \t]*来源[：:]\s*证据\s*\[\d+\]\s*$/gm, "")
    .replace(/([，,。.；;])\s*\1/g, "$1")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeArrowNotation(content) {
  return content.replace(/(?<=[，。；：、])→(?=[^\s])/g, "，");
}

function deduplicateAdjacentCitations(content) {
  return content.replace(/(\[\d+\])\1+/g, "$1");
}

function decodeHtmlEntities(content) {
  return content
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function fixDoubleSourceLabels(content) {
  return content.replace(/来源[：:]\s*来源[：:]/g, "来源：");
}

function removeHorizontalRules(content) {
  return content.replace(/^\s*[-*]{3,}\s*$/gm, "");
}

function repairBrokenBoldMarkers(content) {
  return content
    .split("\n")
    .map((line) => {
      const boldCount = (line.match(/\*\*/g) || []).length;
      if (boldCount === 0 || boldCount % 2 === 0) return line;
      let repaired = line.replace(/^\*\*([，,。.；;：:\s\[])/g, "$1");
      repaired = repaired.replace(/([。.！!？?\]）)])\*\*\s*$/g, "$1");
      if ((repaired.match(/\*\*/g) || []).length % 2 !== 0) {
        let firstRemoved = false;
        repaired = repaired.replace(/\*\*/g, (match) => {
          if (!firstRemoved) {
            firstRemoved = true;
            return "";
          }
          return match;
        });
      }
      return repaired;
    })
    .join("\n");
}

function stripFigureComments(content) {
  let result = content;
  result = result.replace(/<!--\s*figure:\d+:\d+\s*-->/g, "");
  result = result.replace(/&lt;!--\s*figure:\d+:\d+\s*--&gt;/g, "");
  return result;
}

function removeHallucinatedImages(content) {
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, _alt, url) => {
    const lower = url.toLowerCase();
    if (lower.startsWith("data:")) return "";
    if (
      lower.includes("placeholder.com") ||
      lower.includes("example.com") ||
      lower.includes("via.placeholder")
    )
      return "";
    if (lower.includes("image-not-found") || lower.includes("no-image"))
      return "";
    if (!lower.startsWith("http") && !lower.startsWith("/")) return "";
    return _match;
  });
}

const CHAPTER_HIGHLIGHTS_RE =
  /^(?:>\s*)?[-*]*\s*\**(?:本章要点|Chapter Highlights)\**[：:]*\**\s*$/i;

function normalizeChapterHighlights(content) {
  const lines = content.split("\n");
  let firstBlockLines = null;
  let currentBlockLines = [];
  let insideBlock = false;
  const bodyLines = [];

  const flushBlock = () => {
    if (currentBlockLines.length > 0 && firstBlockLines === null) {
      firstBlockLines = currentBlockLines;
    }
    currentBlockLines = [];
    insideBlock = false;
  };

  for (const line of lines) {
    if (CHAPTER_HIGHLIGHTS_RE.test(line)) {
      if (insideBlock) flushBlock();
      insideBlock = true;
      const isEn = /Chapter Highlights/i.test(line);
      const label = isEn ? "Chapter Highlights" : "本章要点";
      currentBlockLines = [`> **${label}**`];
      continue;
    }
    if (insideBlock) {
      const trimmed = line.replace(/^>\s*/, "").trim();
      if (/^>\s*[-*]/.test(line) || /^\s*[-*]\s/.test(line)) {
        const pointText = trimmed.replace(/^[-*]\s*/, "").trim();
        if (pointText) currentBlockLines.push(`> - ${pointText}`);
        continue;
      }
      if (line.trim() === "" || line.trim() === ">") {
        flushBlock();
        bodyLines.push(line);
        continue;
      }
      if (!/^>/.test(line)) {
        flushBlock();
        bodyLines.push(line);
        continue;
      }
      if (trimmed) {
        currentBlockLines.push(`> - ${trimmed}`);
        continue;
      }
    }
    bodyLines.push(line);
  }
  flushBlock();

  if (firstBlockLines === null) return content;
  const blockText = firstBlockLines.join("\n");
  const bodyText = bodyLines.join("\n").replace(/^\n+/, "");
  return `${blockText}\n\n${bodyText}`;
}

/**
 * In-place normalization of highlights blocks in fullReport.
 * Unlike normalizeChapterHighlights (which moves block to top),
 * this fixes formatting in place — suitable for fullReport context.
 */
function normalizeHighlightsInPlace(content) {
  const lines = content.split("\n");
  const result = [];
  let insideBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (CHAPTER_HIGHLIGHTS_RE.test(line)) {
      insideBlock = true;
      const isEn = /Chapter Highlights/i.test(line);
      const label = isEn ? "Chapter Highlights" : "本章要点";
      result.push(`> **${label}**`);
      continue;
    }

    if (insideBlock) {
      const trimmed = line.replace(/^>\s*/, "").trim();

      // Bullet line (with or without blockquote prefix)
      if (/^>\s*[-*]/.test(line) || /^\s*[-*]\s/.test(line)) {
        const pointText = trimmed.replace(/^[-*]\s*/, "").trim();
        if (pointText) result.push(`> - ${pointText}`);
        continue;
      }

      // Empty line or bare > ends the block
      if (line.trim() === "" || line.trim() === ">") {
        insideBlock = false;
        result.push(line);
        continue;
      }

      // Non-blockquote, non-list line ends block
      if (!/^>/.test(line) && !/^\s*[-*]\s/.test(line)) {
        insideBlock = false;
        result.push(line);
        continue;
      }

      // Blockquote continuation without bullet
      if (trimmed) {
        result.push(`> - ${trimmed}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

function removeEmptyHeadings(content) {
  const lines = content.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) {
      if (/^##\s+[^#]/.test(line)) {
        result.push(line);
        continue;
      }
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine === "") continue;
        if (/^#{1,6}\s+/.test(nextLine)) break;
        hasContent = true;
        break;
      }
      if (!hasContent) continue;
    }
    result.push(line);
  }
  return result.join("\n");
}

function repairMarkdownTables(content) {
  const lines = content.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);
    if (/^\|(.+\|){2,}/.test(line.trim())) {
      const next = lines[i + 1] ? lines[i + 1].trim() : "";
      if (next && /^\|/.test(next) && !/^\|[\s\-:|]+\|$/.test(next)) {
        const prev = result.length >= 2 ? result[result.length - 2].trim() : "";
        if (!prev || !/^\|/.test(prev)) {
          const colCount = (line.match(/\|/g) || []).length - 1;
          const sep = "|" + " --- |".repeat(colCount);
          result.push(sep);
        }
      }
    }
  }
  return result.join("\n");
}

function splitWallOfText(content) {
  return content
    .split("\n")
    .map((line) => {
      if (line.trim().length <= 400) return line;
      // Skip list items (- item, * item), blockquotes (>), headings (#), tables (|)
      // But NOT bold text (**text**) — those should be split
      if (/^\s*[-*]\s/.test(line)) return line; // list marker + space
      if (/^\s*[>|#]/.test(line)) return line;
      // Skip reference entries
      if (/^<a\s+id="ref-/.test(line.trim())) return line;
      // Split on Chinese sentence boundaries (。！？) AND semicolons (；)
      const parts = line.split(/(?<=[。！？；])/);
      if (parts.length <= 1) return line;
      const chunks = [];
      let current = "";
      for (const part of parts) {
        if (current.length + part.length > 200 && current.length > 0) {
          chunks.push(current);
          current = part;
        } else {
          current += part;
        }
      }
      if (current) chunks.push(current);
      return chunks.join("\n\n");
    })
    .join("\n");
}

/**
 * Ensure blank line after table blocks so following text isn't parsed as table rows.
 */
function ensureBlankLineAfterTables(content) {
  const lines = content.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (/^\|/.test(lines[i].trim())) {
      const next = lines[i + 1];
      if (
        next !== undefined &&
        next.trim() !== "" &&
        !/^\|/.test(next.trim())
      ) {
        result.push("");
      }
    }
  }
  return result.join("\n");
}

function renumberHeadings(content) {
  const lines = content.split("\n");
  let currentDim = 0;
  let h3Count = 0;
  let h4Count = 0;
  let boldListCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dimMatch = line.match(/^##\s+(\d+)\.\s+/);
    if (dimMatch) {
      currentDim = parseInt(dimMatch[1]);
      h3Count = 0;
      h4Count = 0;
      boldListCounter = 0;
      continue;
    }
    if (currentDim === 0) continue;

    // ### N.M. headings
    const h3Match = line.match(/^###\s+\d+\.\d+\.?\s+(.+)$/);
    if (h3Match) {
      h3Count++;
      h4Count = 0;
      boldListCounter = 0;
      lines[i] = `### ${currentDim}.${h3Count}. ${h3Match[1]}`;
      continue;
    }

    // #### N.M.K. (three-part — check BEFORE two-part)
    const h4ThreePartMatch = line.match(/^####\s+\d+\.\d+\.\d+\.?\s+(.+)$/);
    if (h4ThreePartMatch) {
      h4Count++;
      boldListCounter = 0;
      lines[i] =
        `#### ${currentDim}.${h3Count}.${h4Count}. ${h4ThreePartMatch[1]}`;
      continue;
    }

    // #### N.M. (two-part — demoted from ### by collapseExcessSubHeadings)
    const h4TwoPartMatch = line.match(/^####\s+\d+\.\d+\.?\s+(.+)$/);
    if (h4TwoPartMatch) {
      h3Count++;
      h4Count = 0;
      boldListCounter = 0;
      lines[i] = `#### ${currentDim}.${h3Count}. ${h4TwoPartMatch[1]}`;
      continue;
    }

    // Bold list items — re-align ALL to current parent heading number.
    // Matches both plain "1. **text**" and already-numbered "N.M.K. **text**"
    if (currentDim > 0 && h3Count > 0 && /^(?:\d+\.)+\s+\*\*/.test(line)) {
      boldListCounter++;
      lines[i] = line.replace(
        /^(?:\d+\.)+/,
        `${currentDim}.${h3Count}.${boldListCounter}.`,
      );
      continue;
    }

    // Convert plain (non-bold) numbered items to bullets to avoid confusion
    // with hierarchical heading numbers (e.g., "1." under "1.10." heading)
    if (currentDim > 0 && h3Count > 0 && /^\d+\.\s+[^*|]/.test(line)) {
      lines[i] = line.replace(/^\d+\.\s+/, "- ");
      continue;
    }

    // Any heading resets bold list tracking
    if (/^#{2,6}\s+/.test(line)) {
      boldListCounter = 0;
      if (/^##\s+[^#]/.test(line)) {
        currentDim = 0;
        h3Count = 0;
        h4Count = 0;
      }
    }
  }
  return lines.join("\n");
}

function stripHtmlCitationLinks(content) {
  let result = content;
  result = result.replace(
    /<a\s+href="#ref-\d+"\s+class="citation-link">\[(\d+)\]<\/a>/g,
    "[$1]",
  );
  result = result.replace(/<a\s+id="ref-\d+"><\/a>/g, "");
  return result;
}

function stripCitationsFromHeadings(content) {
  return content.replace(/^(#{2,6}\s+.+?)(?:\s*\[\d+\])+\s*$/gm, "$1");
}

function wrapBareDisplayMath(content) {
  const lines = content.split("\n");
  const result = [];
  let inCodeBlock = false;
  let inMathBlock = false;
  const LATEX_CMD =
    /\\(?:mathrm|frac|sum|prod|int|alpha|beta|gamma|delta|theta|phi|psi|sigma|omega|pi|lambda|mu|epsilon|log|exp|sqrt|mathbb|mathcal|text|left|right|quad|cdot|dots|ldots|cdots|operatorname|mid|leq|geq|neq|approx|infty|forall|exists|partial|nabla|times|begin|end)\b/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }
    if (trimmed === "$$") {
      inMathBlock = !inMathBlock;
      result.push(line);
      continue;
    }
    if (inMathBlock) {
      result.push(line);
      continue;
    }
    const hasCmd = LATEX_CMD.test(trimmed);
    const skip =
      trimmed.startsWith("$") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("|") ||
      /^[>|\-*\d]/.test(trimmed);
    if (hasCmd && !skip) {
      const prevBlank =
        i === 0 || lines[i - 1].trim() === "" || lines[i - 1].trim() === "$$";
      const nextBlank =
        i === lines.length - 1 ||
        lines[i + 1].trim() === "" ||
        lines[i + 1].trim() === "$$";
      const cjkCount = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
      if (prevBlank && nextBlank && cjkCount < 5) {
        result.push(`$$${trimmed}$$`);
        continue;
      }
    }
    result.push(line);
  }
  return result.join("\n");
}

function deduplicateTerminalSections(content) {
  const lines = content.split("\n");
  const result = [];
  const crossDimSubSections = new Set();
  let inCrossDim = false;
  for (const line of lines) {
    if (/^##\s+跨维度关联分析/.test(line)) {
      inCrossDim = true;
      continue;
    }
    if (/^##\s+[^#]/.test(line) && inCrossDim) {
      inCrossDim = false;
    }
    if (inCrossDim) {
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match) crossDimSubSections.add(h3Match[1].trim());
    }
  }
  if (crossDimSubSections.size === 0) return content;
  let inConclusion = false;
  let skipBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+结语/.test(line)) {
      inConclusion = true;
      result.push(line);
      continue;
    }
    if (/^##\s+[^#]/.test(line) && inConclusion) {
      inConclusion = false;
      skipBlock = false;
    }
    if (inConclusion) {
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match && crossDimSubSections.has(h3Match[1].trim())) {
        skipBlock = true;
        continue;
      }
      if (skipBlock) {
        if (/^##/.test(line)) {
          skipBlock = false;
        } else {
          continue;
        }
      }
    }
    result.push(line);
  }
  return result.join("\n");
}

function convertDescriptiveListsToBullets(content) {
  const lines = content.split("\n");
  let underH4 = false;
  return lines
    .map((line) => {
      if (/^####\s+/.test(line)) {
        underH4 = true;
        return line;
      }
      if (/^###\s+[^#]/.test(line)) {
        underH4 = false;
        return line;
      }
      if (underH4 && /^\d+\.\s+[^*]/.test(line)) {
        return line.replace(/^\d+\.\s+/, "- ");
      }
      return line;
    })
    .join("\n");
}

function deduplicateSections(content) {
  const lines = content.split("\n");
  const result = [];
  const seenSections = new Map(); // heading+firstLine → line index

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^###\s+[^#]/.test(line)) {
      // Find first non-empty line after heading
      let firstContent = "";
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        if (lines[j].trim()) {
          firstContent = lines[j].trim().substring(0, 80);
          break;
        }
      }
      const key = line.trim() + "|" + firstContent;
      if (seenSections.has(key)) {
        // Skip this heading and its content until next heading or ## section
        let j = i + 1;
        while (j < lines.length) {
          if (/^#{1,3}\s+[^#]/.test(lines[j]) && lines[j] !== line) break;
          if (lines[j].trim() === "") {
            j++;
            continue;
          }
          j++;
        }
        i = j - 1; // will be incremented by for loop
        continue;
      }
      seenSections.set(key, i);
    }
    result.push(line);
  }
  return result.join("\n");
}

// ── Main ──

async function main() {
  const reportId = process.argv[2] || "0446da49-a3eb-44d1-921b-ce4ea336de68";

  const report = await prisma.topicReport.findUnique({
    where: { id: reportId },
  });

  if (!report || !report.fullReport) {
    console.error("Report not found or empty");
    process.exit(1);
  }

  console.log(`\nReprocessing fullReport: ${reportId}`);
  console.log(`Original length: ${report.fullReport.length} chars\n`);

  let content = report.fullReport;

  // Fix # 参考文献 to ## 参考文献 (H1 should be H2)
  content = content.replace(/^# 参考文献\s*$/m, "## 参考文献");
  content = content.replace(/^# References\s*$/m, "## References");

  // Remove duplicate sections (exact H3 heading + content repeated)
  content = deduplicateSections(content);

  // Apply all post-processing transforms
  content = normalizeHighlightsInPlace(content);
  content = stripLLMMetaNotes(content);
  content = stripInternalFigureNotation(content);
  content = stripLeakedHtmlComments(content);
  content = normalizeArrowNotation(content);
  content = deduplicateAdjacentCitations(content);
  content = decodeHtmlEntities(content);
  content = fixDoubleSourceLabels(content);
  content = removeHallucinatedImages(content);
  content = removeHorizontalRules(content);
  content = repairBrokenBoldMarkers(content);
  content = stripFigureComments(content);
  content = repairMarkdownTables(content);
  content = ensureBlankLineAfterTables(content);
  content = splitWallOfText(content);
  content = repairBrokenBoldMarkers(content); // fix bold markers broken by splitWallOfText
  content = convertDescriptiveListsToBullets(content);
  content = removeEmptyHeadings(content);
  content = renumberHeadings(content);
  content = stripHtmlCitationLinks(content);
  content = stripCitationsFromHeadings(content);
  content = wrapBareDisplayMath(content);
  content = deduplicateTerminalSections(content);
  content = content.replace(/\n{3,}/g, "\n\n");

  const diff = report.fullReport.length - content.length;
  console.log(`Processed length: ${content.length} chars (diff: ${diff})`);

  if (diff === 0) {
    console.log("No changes needed.");
    await prisma.$disconnect();
    return;
  }

  await prisma.topicReport.update({
    where: { id: reportId },
    data: { fullReport: content },
  });

  console.log("✓ fullReport updated in database\n");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
