#!/usr/bin/env node
/**
 * Report Quality Audit Script v2.0
 *
 * Comprehensive quality audit aligned with backend rendering pipeline rules:
 *   - report-formatting.utils.ts (26 functions)
 *   - report-assembler.service.ts (processDimensionContent + postProcessFinalReport)
 *   - frontend preprocessLatex.ts (6 stages)
 *
 * Checks 30+ rules across 6 categories:
 *   A. Structure (headings, numbering, sections)
 *   B. Chapter Highlights (本章要点 format)
 *   C. LaTeX & Math (display, inline, subscripts, HTML bugs)
 *   D. Citations & References
 *   E. Content Quality (dedup, language, meta notes, wall-of-text)
 *   F. Formatting (bold, blockquotes, tables, lists, HR)
 *
 * Usage:
 *   cd backend && node ../scripts/audit-report-quality.js [reportId]
 *
 * If reportId is omitted, audits the most recently generated report.
 *
 * Environment:
 *   DATABASE_URL — Prisma connection string (falls back to Railway URL)
 */

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("  export DATABASE_URL=postgresql://...");
  process.exit(1);
}

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: DB_URL } },
  });

  try {
    const reportId = process.argv[2];
    const report = reportId
      ? await prisma.topicReport.findUnique({
          where: { id: reportId },
          select: { id: true, fullReport: true, generatedAt: true },
        })
      : await prisma.topicReport.findFirst({
          orderBy: { generatedAt: "desc" },
          select: { id: true, fullReport: true, generatedAt: true },
        });

    if (!report) {
      console.error("No report found.");
      process.exit(1);
    }

    console.log(`Auditing report: ${report.id}`);
    console.log(`Generated at: ${report.generatedAt}`);
    console.log("");

    // ==================== Full Report (连续视图) ====================
    const fr = report.fullReport || "";
    console.log("=".repeat(60));
    console.log("FULL REPORT (连续视图)");
    console.log("=".repeat(60));
    console.log(`Total length: ${fr.length} chars`);

    const fullReportIssues = auditMarkdown(fr, "fullReport");
    printIssues(fullReportIssues);

    // ==================== Dimension Analyses (章节视图) ====================
    const dims = await prisma.dimensionAnalysis.findMany({
      where: { reportId: report.id },
      orderBy: { createdAt: "asc" },
      select: { dataPoints: true, dimension: { select: { name: true } } },
    });

    console.log("\n" + "=".repeat(60));
    console.log("CHAPTER VIEW (章节视图)");
    console.log("=".repeat(60));
    console.log(`Total dimensions: ${dims.length}`);

    const chapterIssues = [];
    dims.forEach((d, i) => {
      const name = (d.dimension && d.dimension.name) || `Dim ${i + 1}`;
      const c = (d.dataPoints && d.dataPoints.detailedContent) || "";
      console.log(`\n--- ${i + 1}. ${name} (${c.length} chars) ---`);
      const issues = auditMarkdown(c, `chapter-${i + 1}`);
      printIssues(issues);
      chapterIssues.push({ chapter: i + 1, name, issues });
    });

    // ==================== Summary ====================
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY BY SEVERITY");
    console.log("=".repeat(60));

    const allIssues = [
      ...fullReportIssues.map((iss) => ({ ...iss, scope: "fullReport" })),
      ...chapterIssues.flatMap((ch) =>
        ch.issues.map((iss) => ({ ...iss, scope: `ch${ch.chapter}` })),
      ),
    ];

    // Group by severity then category
    const bySeverity = {
      CRITICAL: [],
      HIGH: [],
      MEDIUM: [],
      LOW: [],
      INFO: [],
    };
    allIssues.forEach((iss) => {
      if (!bySeverity[iss.severity]) bySeverity[iss.severity] = [];
      bySeverity[iss.severity].push(iss);
    });

    let totalNonInfo = 0;
    ["CRITICAL", "HIGH", "MEDIUM", "LOW"].forEach((sev) => {
      const items = bySeverity[sev] || [];
      if (items.length === 0) return;
      // Group by category within severity
      const byCategory = {};
      items.forEach((iss) => {
        if (!byCategory[iss.category]) byCategory[iss.category] = [];
        byCategory[iss.category].push(iss);
      });
      console.log(`\n[${sev}]`);
      Object.keys(byCategory)
        .sort()
        .forEach((cat) => {
          const catItems = byCategory[cat];
          const total = catItems.reduce((s, i) => s + i.count, 0);
          totalNonInfo += total;
          const scopes = catItems
            .map((i) => `${i.scope}=${i.count}`)
            .join(", ");
          console.log(`  ${cat}: ${total} (${scopes})`);
        });
    });

    console.log(`\nTotal issues (excl. INFO): ${totalNonInfo}`);

    // INFO summary
    const infoItems = bySeverity["INFO"] || [];
    if (infoItems.length > 0) {
      console.log("\n[INFO]");
      const byCategory = {};
      infoItems.forEach((iss) => {
        if (!byCategory[iss.category]) byCategory[iss.category] = [];
        byCategory[iss.category].push(iss);
      });
      Object.keys(byCategory)
        .sort()
        .forEach((cat) => {
          const catItems = byCategory[cat];
          const total = catItems.reduce((s, i) => s + i.count, 0);
          console.log(`  ${cat}: ${total}`);
        });
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ================================================================
// Audit Engine — 30+ checks across 6 categories
// ================================================================

function auditMarkdown(content, scope) {
  if (!content) return [];
  const issues = [];
  const lines = content.split("\n");

  function add(category, severity, matches, samples) {
    if (matches.length > 0) {
      issues.push({
        category,
        severity,
        count: matches.length,
        samples: (samples || matches)
          .slice(0, 3)
          .map((s) => (typeof s === "string" ? s.substring(0, 120) : s)),
      });
    }
  }

  // ================================================================
  // A. STRUCTURE — Headings, numbering, sections
  // Rules: sanitizeHeadingLevels, numberSubHeadings, deduplicateHeadings,
  //        removeEmptyHeadings, collapseExcessSubHeadings, collapsePseudoCodeHeadings
  // ================================================================

  // A1. H1 headings in dimension content (should have been demoted to ### by sanitizeHeadingLevels)
  if (scope !== "fullReport") {
    add(
      "A1-h1-in-dimension",
      "HIGH",
      lines.filter((l) => /^#\s+[^#]/.test(l)),
    );
    add(
      "A2-h2-in-dimension",
      "HIGH",
      lines.filter((l) => /^##\s+[^#]/.test(l)),
    );
  }

  // A3. H2 chapter headings completeness (fullReport only)
  if (scope === "fullReport") {
    const h2s = lines.filter((l) => /^##\s+/.test(l)).map((l) => l.trim());
    add("A3-h2-chapter-headings", "INFO", h2s);
    // Check numbered chapters: ## 1. through ## 8.
    const numberedH2s = h2s.filter((h) => /^##\s+\d+\./.test(h));
    const expectedChapterCount = 8; // typical
    if (numberedH2s.length < expectedChapterCount) {
      add("A3-missing-chapter-h2", "HIGH", [
        `Expected ~${expectedChapterCount} numbered ## N. chapters, found ${numberedH2s.length}`,
      ]);
    }
  }

  // A4. H3 numbering format (should be ### N.M. Title after numberSubHeadings)
  if (scope === "fullReport") {
    const h3s = lines.filter((l) => /^###\s+[^#]/.test(l));
    const badH3 = h3s.filter((l) => !/^###\s+\d+\.\d+\.?\s+/.test(l));
    // Exclude supplementary sections (intro, summary, conclusion, etc.)
    const nonStructural = badH3.filter(
      (l) =>
        !/跨维度|风险|战略|结语|前言|执行摘要|目录|参考|附录|研究范围|方法论|阅读指引|研究背景|报告概述|核心发现|关键发现|研究方法|总结|关键指标|行动建议|反馈回路|情景分析|政策建议|实施路径|维度对比|投资者|政策研究者|企业决策者|研究人员|技术从业者|普通读者|短期|中期|长期/.test(
          l,
        ),
    );
    add("A4-h3-bad-numbering", "MEDIUM", nonStructural);
  }

  // A5. H4 numbering format (should be #### N.M.K. Title)
  if (scope === "fullReport") {
    const h4s = lines.filter((l) => /^####\s+[^#]/.test(l));
    const badH4 = h4s.filter((l) => !/^####\s+\d+\.\d+\.\d+\.?\s+/.test(l));
    add("A5-h4-bad-numbering", "MEDIUM", badH4);
  }

  // A6. Deep headings H5/H6 (should be 0)
  add(
    "A6-deep-headings-h5h6",
    "MEDIUM",
    lines.filter((l) => /^#{5,6}\s+/.test(l)),
  );

  // A7. Duplicate headings (same normalized text)
  const headingSeen = new Set();
  const dupHeadings = [];
  lines.forEach((l) => {
    const m = l.match(/^#{2,6}\s+(.+)/);
    if (!m) return;
    const norm = m[1]
      .replace(/^(?:\d+\.)+\s*/, "")
      .replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
      .replace(/\s+/g, "")
      .trim();
    if (headingSeen.has(norm)) dupHeadings.push(l);
    headingSeen.add(norm);
  });
  add("A7-duplicate-headings", "MEDIUM", dupHeadings);

  // A8. Empty headings (heading followed by another heading with no body)
  const emptyHeadings = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^#{1,4}\s/.test(lines[i])) {
      const next = lines[i + 1] ? lines[i + 1].trim() : "";
      const nextNext = lines[i + 2] ? lines[i + 2].trim() : "";
      if (
        (next === "" && /^#{1,4}\s/.test(nextNext)) ||
        /^#{1,4}\s/.test(next)
      ) {
        emptyHeadings.push(lines[i]);
      }
    }
  }
  add("A8-empty-headings", "MEDIUM", emptyHeadings);

  // A9. Sub-headings per dimension > 8 (collapseExcessSubHeadings threshold)
  if (scope === "fullReport") {
    // Count H3 headings per chapter (between H2s)
    let currentChapter = "";
    let h3Count = 0;
    const excessChapters = [];
    lines.forEach((l) => {
      if (/^##\s+\d+\./.test(l)) {
        if (currentChapter && h3Count > 8) {
          excessChapters.push(
            `${currentChapter}: ${h3Count} sub-headings (limit 8)`,
          );
        }
        currentChapter = l.trim().substring(0, 40);
        h3Count = 0;
      } else if (/^###\s+/.test(l)) {
        h3Count++;
      }
    });
    if (currentChapter && h3Count > 8) {
      excessChapters.push(
        `${currentChapter}: ${h3Count} sub-headings (limit 8)`,
      );
    }
    add("A9-excess-subheadings", "MEDIUM", excessChapters);
  }

  // A10. Pseudocode headings (### if mask is not None)
  add(
    "A10-pseudocode-headings",
    "LOW",
    lines.filter(
      (l) =>
        /^#{3,4}\s+/.test(l) &&
        /\b(if|for|while|def|return|import|class)\b/.test(l) &&
        !/\b(如果|如何|if.*then|For.*use|Return|Class)\b/i.test(l),
    ),
  );

  // ================================================================
  // B. CHAPTER HIGHLIGHTS — 本章要点 format
  // Rule: normalizeChapterHighlights
  // Spec: > **本章要点** header + > - bullet items
  // ================================================================

  // B1. 本章要点 header format
  const hlHeaders = content.match(/.*本章要点.*/g) || [];
  const badHlHeaders = hlHeaders.filter(
    (h) => !/^>\s*\*\*本章要点\*\*/.test(h),
  );
  add("B1-highlights-bad-header", "MEDIUM", badHlHeaders);

  // B2. 本章要点 bullets without > prefix
  let inHl = false;
  const badBullets = [];
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].indexOf("本章要点") >= 0) {
      inHl = true;
      continue;
    }
    if (inHl) {
      if (lines[j].trim() === "" || /^###/.test(lines[j])) {
        inHl = false;
        continue;
      }
      if (/^\s*[-*]/.test(lines[j]) && !/^>\s*[-*]/.test(lines[j])) {
        badBullets.push(lines[j]);
      }
    }
  }
  add("B2-highlights-bullets-no-blockquote", "MEDIUM", badBullets);

  // B3. 本章要点 count (each chapter should have exactly 1)
  const hlCount = hlHeaders.length;
  if (scope.startsWith("chapter") && hlCount === 0 && content.length > 500) {
    add("B3-highlights-missing", "MEDIUM", ["No 本章要点 found in chapter"]);
  }
  if (scope === "fullReport" && hlCount > 12) {
    // In full report, each chapter has 1 block (10 chapters = 10 expected)
    add("B3-highlights-duplicate", "MEDIUM", [
      `Found ${hlCount} 本章要点 blocks (expected ~10 for full report)`,
    ]);
  } else if (scope.startsWith("chapter") && hlCount > 1) {
    add("B3-highlights-duplicate", "MEDIUM", [
      `Found ${hlCount} 本章要点 blocks (expected 1)`,
    ]);
  }

  // ================================================================
  // C. LATEX & MATH
  // Rules: convertDisplayMath, fixLatexSubscripts, fixSpuriousDollarSigns,
  //        wrapInlineLatex, simplifyLatexNotation, mergeAdjacentMathBlocks
  // ================================================================

  // C1. Display math \[...\] not converted to $$...$$
  add(
    "C1-display-math-bracket",
    "HIGH",
    content.match(/\\\[\s*\\[a-zA-Z]/g) || [],
  );

  // C2. $$...$$ display math present (informational)
  add("C2-display-math-dollar", "INFO", content.match(/\$\$[^$]/g) || []);

  // C3. Inline $...$ math (informational)
  add("C3-inline-math", "INFO", content.match(/\$[^$\n]{1,200}\$/g) || []);

  // C4. LaTeX _{<t} parsed as HTML tag (CRITICAL)
  add("C4-latex-lt-html-bug", "CRITICAL", content.match(/_{<[a-zA-Z]/g) || []);

  // C5. Bare LaTeX after CJK without $ delimiter
  add(
    "C5-bare-latex-after-cjk",
    "MEDIUM",
    content.match(/[\u4e00-\u9fff][^$\n]{0,5}\\[a-zA-Z]/g) || [],
  );

  // C6. Missing subscript underscore: letter{n} without _
  add(
    "C6-missing-subscript",
    "MEDIUM",
    content.match(/(?<![a-zA-Z\\_{])[a-zA-Z]\{[a-z0-9,: ]{1,10}\}/g) || [],
  );

  // C7. Spurious $ signs: (...$)$
  add("C7-spurious-dollar", "LOW", content.match(/\([^)$\n]*\$\)\$/g) || []);

  // C8. LaTeX degraded to Unicode (simplifyLatexNotation residue)
  // Detects patterns like α, β, γ next to math-like notation (^, _, {, })
  // which suggests LaTeX was converted to Unicode instead of rendered
  const unicodeMathChars =
    content.match(/[αβγδεζηθλμσωπρφψΣ∫∈∞≤≥≈∇][_^{]/g) || [];
  add("C8-latex-degraded-to-unicode", "MEDIUM", unicodeMathChars);

  // C9. Fragmented adjacent math blocks: $a$ $b$ should be $a b$
  add(
    "C9-fragmented-math",
    "LOW",
    content.match(/\$[^$]+\$\s*\$[^$]+\$/g) || [],
  );

  // ================================================================
  // D. CITATIONS & REFERENCES
  // Rules: linkifyCitations, anchorReferences, deduplicateAdjacentCitations
  // ================================================================

  // D1. Citation format consistency
  const citHtml = content.match(/<a href="#ref-\d+"/g) || [];
  const citPlain = content.match(/\[\d+\](?![\(])/g) || [];
  if (scope === "fullReport" && citHtml.length > 0 && citPlain.length > 0) {
    add("D1-citation-format-mixed", "MEDIUM", [
      `HTML <a>: ${citHtml.length}, Plain [N]: ${citPlain.length}`,
    ]);
  }
  if (
    scope.startsWith("chapter") &&
    citPlain.length > 0 &&
    citHtml.length === 0
  ) {
    add("D1-citation-not-linked", "LOW", [
      `${citPlain.length} plain [N] citations, 0 clickable <a> links`,
    ]);
  }

  // D2. Adjacent duplicate citations [5][5]
  add(
    "D2-adjacent-dup-citations",
    "LOW",
    content.match(/\[(\d+)\]\s*\[\1\]/g) || [],
  );

  // D3. Reference section (fullReport only)
  if (scope === "fullReport" && content.length > 10000) {
    if (!/^##\s.*参考|^##\s.*References/m.test(content)) {
      add("D3-missing-reference-section", "HIGH", ["No ## 参考文献 found"]);
    }
  }

  // D4. Reference anchors (each reference should have id="ref-N")
  if (scope === "fullReport") {
    const refSection = content.match(/^##\s.*参考[\s\S]*$/m);
    if (refSection) {
      const refs = refSection[0].match(/^\d+\.\s/gm) || [];
      const anchors = refSection[0].match(/id="ref-\d+"/g) || [];
      if (refs.length > 0 && anchors.length === 0) {
        add("D4-references-no-anchors", "MEDIUM", [
          `${refs.length} references found but 0 have id="ref-N" anchors`,
        ]);
      }
    }
  }

  // ================================================================
  // E. CONTENT QUALITY
  // Rules: deduplicateParagraphs, detectForeignLanguageBlocks,
  //        stripLLMMetaNotes, splitWallOfText, stripLeakedHtmlComments
  // ================================================================

  // E1. Duplicate paragraphs (first 120 chars match)
  const paragraphs = content.split("\n\n");
  const paraKeys = new Set();
  const dupParas = [];
  paragraphs.forEach((p) => {
    const t = p.trim();
    if (t.length < 60) return;
    if (/^(#|<!--|[-*>|]|\d+\.)/.test(t)) return;
    const key = t.substring(0, 120);
    if (paraKeys.has(key)) dupParas.push(key);
    paraKeys.add(key);
  });
  add("E1-duplicate-paragraphs", "MEDIUM", dupParas);

  // E2. Foreign language blocks (long Latin runs in Chinese report)
  // Strip references section and HTML links before checking for foreign language
  const stripped = content
    .replace(/## 参考文献[\s\S]*$/m, "") // exclude references section
    .replace(/<a[^>]*>.*?<\/a>/g, "") // exclude HTML links
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\[[\d,\s]+\]/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, ""); // exclude markdown links
  const foreignBlocks =
    stripped.match(/[A-Za-z][A-Za-z\s,.:;'"!?()\-]{79,}/g) || [];
  const realForeign = foreignBlocks.filter((b) => b.split(/\s+/).length >= 5);
  add("E2-foreign-language-blocks", "MEDIUM", realForeign);

  // E3. LLM meta notes (word counts, agent leaks)
  // Strip table rows before checking to avoid false positives on "字数：128" in table cells
  const nonTableContent = content
    .split("\n")
    .filter((l) => !/^\|/.test(l.trim()))
    .join("\n");
  const metaPatterns = [
    /（[约共]?\d+字）/g,
    /\(word\s+count[:\s]*\d+\)/gi,
    /字数[：:]\s*[约共]?\d+/g,
    /当前字数\s*[：:]\s*\d+/g,
    /Leader\s*(?:分配|提供|生成)/g,
    /Agent\s*(?:分配|指派|生成)/g,
    /独立洞察[：:]/g,
    /数据支撑总结[：:]/g,
  ];
  const metaNotes = [];
  metaPatterns.forEach((pat) => {
    const m = nonTableContent.match(pat);
    if (m) metaNotes.push(...m);
  });
  add("E3-llm-meta-notes", "MEDIUM", metaNotes);

  // E4. Wall-of-text paragraphs (single long line > 400 chars, or multi-line > 600)
  const wallParas = paragraphs.filter((p) => {
    const t = p.trim();
    if (/^(#|>|\||[-*]\s|\d+\.)/.test(t)) return false;
    // Exclude reference entries (long URLs)
    if (/^<a\s+id="ref-/.test(t)) return false;
    const lineCount = t.split("\n").length;
    // Single-line paragraphs: flag at 400 chars
    // Multi-line paragraphs: flag at 600 chars (natural line wraps are okay)
    const threshold = lineCount === 1 ? 400 : 600;
    return t.length > threshold;
  });
  add(
    "E4-wall-of-text",
    "LOW",
    wallParas.map((p) => `(${p.length} chars) ${p.substring(0, 80)}...`),
  );

  // E5. Leaked HTML comments (excluding chart/figure placeholders)
  const htmlComments =
    content.match(/<!--(?!\s*(?:chart|figure):)[^>]*-->/g) || [];
  add("E5-leaked-html-comments", "LOW", htmlComments);

  // E6. Unresolved figure placeholders
  add(
    "E6-unresolved-figure",
    "MEDIUM",
    content.match(/<!--\s*figure:\d+:\d+\s*-->/g) || [],
  );

  // E7. Chart placeholders (informational)
  add(
    "E7-chart-placeholders",
    "INFO",
    content.match(/<!--\s*chart:[^\s]+\s*-->/g) || [],
  );

  // ================================================================
  // F. FORMATTING
  // Rules: limitBoldFormatting, limitBlockquotes, removeHorizontalRules,
  //        repairMarkdownTables, hierarchicalNumberBoldListItems,
  //        convertDescriptiveListsToBullets, repairOrderedListContinuity
  // ================================================================

  // F1. Excessive bold per section (limit 2 per ### section, structural bold exempt)
  if (scope === "fullReport") {
    const sections = content.split(/(?=^###\s)/m);
    const excessBoldSections = [];
    sections.forEach((section) => {
      let count = 0;
      const sectionTitle = (section.match(/^###\s+.+/m) || [
        "(untitled)",
      ])[0].substring(0, 50);
      section.replace(/\*\*([^*]+)\*\*/g, (_m, _inner, offset) => {
        const before = section.substring(
          Math.max(0, section.lastIndexOf("\n", offset) + 1),
          offset,
        );
        // Skip structural bold (hierarchical numbered items)
        if (/^\d+(\.\d+)*\.\s*$/.test(before.trim())) return _m;
        count++;
        return _m;
      });
      if (count > 5) {
        excessBoldSections.push(`${sectionTitle}: ${count} bold marks`);
      }
    });
    add("F1-excessive-bold", "LOW", excessBoldSections);
  }

  // F2. Broken bold (unclosed **) — lines with odd number of ** markers
  // Skip table rows (start with |) as they have complex ** patterns
  const brokenBoldLines = lines.filter((l) => {
    if (/^\|/.test(l.trim())) return false; // skip table rows
    const count = (l.match(/\*\*/g) || []).length;
    return count > 0 && count % 2 !== 0;
  });
  add("F2-broken-bold", "LOW", brokenBoldLines);

  // F3. Excessive blockquotes (> 8)
  const bqLines = lines.filter((l) => /^>\s/.test(l));
  // Count blockquote blocks (consecutive > lines = 1 block)
  let bqBlocks = 0;
  let inBq = false;
  lines.forEach((l) => {
    if (/^>\s/.test(l)) {
      if (!inBq) {
        bqBlocks++;
        inBq = true;
      }
    } else {
      inBq = false;
    }
  });
  // In fullReport, 10+ chapters each have a highlights blockquote; threshold is higher
  const bqLimit = scope === "fullReport" ? 15 : 8;
  if (bqBlocks > bqLimit) {
    add("F3-excessive-blockquotes", "LOW", [
      `${bqBlocks} blockquote blocks (limit ${bqLimit})`,
    ]);
  }

  // F4. Overlong blockquote items (> 120 chars), exclude highlights bullets
  const longBq = bqLines.filter((l) => {
    const text = l.replace(/^>\s*/, "");
    if (/^[-*]\s/.test(text)) return false; // highlights bullets are expected to be long
    return text.length > 120;
  });
  add("F4-overlong-blockquote", "LOW", longBq);

  // F5. Horizontal rules (not allowed in formal reports)
  add(
    "F5-horizontal-rules",
    "MEDIUM",
    lines.filter((l) => /^\s*[-*]{3,}\s*$/.test(l)),
  );

  // F6. Table rows (informational)
  add("F6-table-rows", "INFO", content.match(/^\|.+\|$/gm) || []);

  // F7. Tables missing separator row (| --- | --- |)
  // Find table blocks: sequences of consecutive | rows. Check if second row is separator.
  const tableStartBad = [];
  {
    const allLines = content.split("\n");
    for (let ti = 0; ti < allLines.length; ti++) {
      const cur = allLines[ti].trim();
      if (!/^\|.+\|$/.test(cur)) continue;
      // Check if previous line was also a table row (skip — not a header)
      if (ti > 0 && /^\|.+\|$/.test(allLines[ti - 1].trim())) continue;
      // This is the first row of a table block — check if next is separator
      const next = allLines[ti + 1] ? allLines[ti + 1].trim() : "";
      if (/^\|.+\|$/.test(next) && !/^\|[\s\-:|]+\|$/.test(next)) {
        tableStartBad.push(cur + "\n" + next);
      }
    }
  }
  add("F7-table-missing-separator", "MEDIUM", tableStartBad);

  // F8. Ordered list items (informational + context check)
  const olItems = content.match(/^\d+\.\s/gm) || [];
  add("F8-ordered-list-items", "INFO", olItems);

  // F9. Ordered lists under #### that should be bullets
  // (convertDescriptiveListsToBullets rule)
  let underH4 = false;
  const olUnderH4 = [];
  lines.forEach((l) => {
    if (/^####\s+/.test(l)) underH4 = true;
    else if (/^###\s+[^#]/.test(l)) underH4 = false;
    if (underH4 && /^\d+\.\s+[^*]/.test(l)) olUnderH4.push(l);
  });
  add("F9-ordered-list-under-h4", "MEDIUM", olUnderH4);

  // F10. Unexpected HTML tags (not <a>, </a>, <!--, <br>, <span>)
  add(
    "F10-unexpected-html",
    "MEDIUM",
    content.match(/<(?!a[\s>]|\/a|!--|br|span|\/span)[a-zA-Z][^>]*>/g) || [],
  );

  // F11. H4 headings count (informational)
  add(
    "F11-h4-count",
    "INFO",
    lines.filter((l) => /^####\s/.test(l)),
  );

  // F12. H3 headings count (informational)
  add(
    "F12-h3-count",
    "INFO",
    lines.filter((l) => /^###\s+[^#]/.test(l)),
  );

  return issues;
}

function printIssues(issues) {
  issues.forEach((iss) => {
    if (iss.severity === "INFO" || iss.count === 0) return;
    console.log(`  [${iss.severity}] ${iss.category}: ${iss.count}`);
    if (iss.samples && iss.samples.length > 0) {
      iss.samples.forEach((s) => console.log(`    → ${s}`));
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
