#!/usr/bin/env node
/**
 * One-time migration: preprocess all detailedContent in dimension analyses.
 *
 * Applies the same transformations as preprocessDimensionContent() from
 * report-formatting.utils.ts to historical data stored before the
 * save-time preprocessing was added.
 *
 * Also triggers fullReport reprocessing via the report assembler pipeline.
 *
 * Usage:
 *   cd backend && node ../scripts/migrate-preprocess-detailedcontent.js [reportId]
 *
 * If reportId is omitted, processes the most recently generated report.
 */

const { PrismaClient } = require("@prisma/client");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("  export DATABASE_URL=postgresql://...");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ── Inline preprocessing functions ──────────────────────────────────────
// These mirror the backend preprocessDimensionContent pipeline.
// We inline them here because this script runs standalone without TS compilation.

function sanitizeHeadingLevels(content) {
  return content.replace(/^(#{1,2})\s+/gm, () => "### ");
}

function deduplicateHeadings(content) {
  const lines = content.split("\n");
  const seen = new Set();
  return lines
    .filter((line) => {
      const m = line.match(/^#{3,6}\s+(.+)/);
      if (!m) return true;
      const normalized = m[1]
        .replace(/^(?:\d+\.)+\s*/, "")
        .replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
        .replace(/\s+/g, "")
        .trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join("\n");
}

function convertChineseNumeralHeadings(content) {
  return content.replace(
    /^([一二三四五六七八九十百]+)[、．.]\s*(.+)$/gm,
    (_match, _num, title) => {
      const trimmed = title.trim();
      if (trimmed.length < 2 || trimmed.length > 60) return _match;
      return `### ${trimmed}`;
    },
  );
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
    .replace(/独立洞察[：:]/g, "");
}

function stripLeakedHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, (match) => {
    if (/chart:|figure:/.test(match)) return match;
    return "";
  });
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

// Remove hallucinated images
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

function removeEmptyHeadings(content) {
  const lines = content.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) {
      // Never remove ## headings (dimension/chapter titles)
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
      if (!hasContent) continue; // skip empty heading
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
    // If this line looks like a table header row (starts with |, has multiple |)
    if (/^\|(.+\|){2,}/.test(line.trim())) {
      // Check if next line is NOT a separator
      const next = lines[i + 1] ? lines[i + 1].trim() : "";
      if (next && /^\|/.test(next) && !/^\|[\s\-:|]+\|$/.test(next)) {
        // Check if the line before was NOT a table row (this is the header)
        const prev = result.length >= 2 ? result[result.length - 2].trim() : "";
        if (!prev || !/^\|/.test(prev)) {
          // Insert separator
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
      if (/^\s*[-*>|#]/.test(line)) return line; // skip list/blockquote/table/heading
      if (/^\s*\|/.test(line)) return line; // skip table rows
      // Split at Chinese sentence boundaries
      const parts = line.split(/(?<=[。！？])/);
      if (parts.length <= 1) return line;
      // Group into chunks of ~200 chars
      const chunks = [];
      let current = "";
      for (const part of parts) {
        if (current.length + part.length > 250 && current.length > 0) {
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

function preprocessDimensionContent(content) {
  let processed = content;
  processed = normalizeChapterHighlights(processed);
  processed = convertChineseNumeralHeadings(processed);
  processed = sanitizeHeadingLevels(processed);
  processed = deduplicateHeadings(processed);
  processed = convertDescriptiveListsToBullets(processed);
  processed = stripLLMMetaNotes(processed);
  processed = stripLeakedHtmlComments(processed);
  processed = stripInternalFigureNotation(processed);
  processed = normalizeArrowNotation(processed);
  processed = deduplicateAdjacentCitations(processed);
  processed = decodeHtmlEntities(processed);
  processed = fixDoubleSourceLabels(processed);
  processed = removeHorizontalRules(processed);
  processed = repairBrokenBoldMarkers(processed);
  processed = stripFigureComments(processed);
  processed = removeHallucinatedImages(processed);
  processed = repairMarkdownTables(processed);
  processed = splitWallOfText(processed);
  processed = removeEmptyHeadings(processed);
  processed = processed.replace(/\n{3,}/g, "\n\n");
  return processed;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const reportId = process.argv[2];

  let report;
  if (reportId) {
    report = await prisma.topicReport.findUnique({ where: { id: reportId } });
  } else {
    report = await prisma.topicReport.findFirst({
      orderBy: { generatedAt: "desc" },
    });
  }

  if (!report) {
    console.error("No report found");
    process.exit(1);
  }

  console.log(`\nProcessing report: ${report.id}`);
  console.log(`Topic: ${report.topicId}\n`);

  // 1. Update all dimension analyses' detailedContent
  const analyses = await prisma.dimensionAnalysis.findMany({
    where: { reportId: report.id },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${analyses.length} dimension analyses\n`);

  let updatedCount = 0;
  for (const analysis of analyses) {
    const dataPoints = analysis.dataPoints;
    if (!dataPoints || !dataPoints.detailedContent) continue;

    const original = dataPoints.detailedContent;
    const processed = preprocessDimensionContent(original);

    if (processed === original) {
      console.log(`  [skip] Dimension ${analysis.dimensionId} — no changes`);
      continue;
    }

    const charDiff = original.length - processed.length;
    console.log(
      `  [update] Dimension ${analysis.dimensionId} — ${original.length} → ${processed.length} chars (removed ${charDiff})`,
    );

    await prisma.dimensionAnalysis.update({
      where: { id: analysis.id },
      data: {
        dataPoints: {
          ...dataPoints,
          detailedContent: processed,
        },
      },
    });
    updatedCount++;
  }

  console.log(
    `\nUpdated ${updatedCount}/${analyses.length} dimension analyses\n`,
  );

  // 2. Re-assemble fullReport from updated detailedContent
  // We can't run the full NestJS pipeline here, but we CAN update the
  // detailedContent. The fullReport will be rebuilt on next regeneration
  // or reprocess call via the API.
  console.log("✓ detailedContent preprocessing complete");
  console.log("  To rebuild fullReport, call the reprocess API:");
  console.log(
    `  POST /api/v1/topic-insights/topics/{topicId}/reports/${report.id}/reprocess`,
  );
  console.log("\nOr run the audit script to verify:");
  console.log("  node ../scripts/audit-report-quality.js\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
