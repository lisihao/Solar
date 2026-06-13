import type { FigureReference, GeneratedChart } from "../types/research.types";

/**
 * Returns true if the figure reference URL is a garbage/non-chart image
 * (QR codes, logos, favicons, app icons scraped from web pages).
 * These external reference images are unreliable and should be suppressed.
 */
export function isGarbageFigureUrl(url: string | undefined): boolean {
  if (!url) return true;
  // ★ LLM placeholder leak: "[base64-image:chart]" or "base64-image:chart" (without brackets)
  if (url.startsWith("[base64-image") || url.startsWith("base64-image"))
    return true;
  const lower = url.toLowerCase();
  // QR code and app-code images (common on Chinese tech sites)
  if (lower.includes("appcode") || lower.includes("aicode")) return true;
  if (
    lower.includes("qrcode") ||
    lower.includes("qr_code") ||
    lower.includes("qr-code")
  )
    return true;
  // Favicons, logos, and icon assets
  if (lower.includes("favicon")) return true;
  if (
    /(?:logo|icon|sprite|badge|avatar|banner|ads?)[-_]?\w*\.(?:png|jpg|gif|svg|webp)/i.test(
      lower,
    )
  )
    return true;
  // Stock photo and placeholder image domains (aligned with FigureExtractorService)
  const garbageDomains = [
    "unsplash.com",
    "pexels.com",
    "shutterstock.com",
    "istockphoto.com",
    "gettyimages.com",
    "placeholder.com",
    "via.placeholder",
    "placeholdit.imgix",
    "placehold.co",
  ];
  if (garbageDomains.some((d) => lower.includes(d))) return true;
  // Tracking pixels and very small images (1x1, 2x2)
  if (/[?&](?:w|width|h|height)=[12]\b/.test(url)) return true;
  // ★ data: URIs are legitimate — FigureExtractorService produces base64 images
  // from source pages whose images cannot be directly hotlinked. These have
  // already passed Vision LLM / type-based screening in FigureRelevanceService.
  // Do NOT filter them here.
  // Corrupted CDN URLs with encoding artifacts (Substack $s! pattern)
  if (/\$s!|%24s!/i.test(url)) return true;
  // Excessively long URLs (likely corrupted srcset concatenation)
  // ★ Skip length check for data: URIs — base64 images are legitimately 100K+ chars
  if (!lower.startsWith("data:") && url.length > 2048) return true;
  return false;
}

/**
 * Resolves chart placeholders in dimension content:
 *   1. Converts <!-- figure:N:M --> to <!-- chart:dX-id --> via figureReferences
 *   2. Strips unresolved <!-- figure:N:M --> placeholders
 *   3. Deduplicates chart placeholders by chartId
 *
 * Note: generatedCharts injection is disabled in v4 (AI-fabricated charts disabled).
 */
export function resolveChartPlaceholders(
  content: string,
  dimIndex: number,
  figureReferences?: FigureReference[],
  _generatedCharts?: GeneratedChart[],
): string {
  let result = content;
  const dimPrefix = `d${dimIndex}-`;

  // 1. Convert <!-- figure:... --> placeholders to <!-- chart:chartId -->
  // Filter out garbage figure URLs (QR codes, logos, icons) before resolving
  const validFigureReferences = figureReferences?.filter(
    (r) => !isGarbageFigureUrl(r.imageUrl),
  );

  if (validFigureReferences && validFigureReferences.length > 0) {
    // Check for new-format placeholders: <!-- figure:FIG-N -->
    const newFormatPlaceholders = (
      result.match(/<!--\s*figure:(FIG-\d+)\s*-->/g) ?? []
    ).length;

    // Check for old-format placeholders: <!-- figure:N:M -->
    const oldFormatPlaceholders = (
      result.match(/<!--\s*figure:\d+:\d+\s*-->/g) ?? []
    ).length;

    const existingPlaceholders = newFormatPlaceholders + oldFormatPlaceholders;

    if (newFormatPlaceholders > 0) {
      // New path: AI wrote <!-- figure:FIG-N --> placeholders — resolve by figureId
      result = result.replace(
        /<!--\s*figure:(FIG-\d+)\s*-->/g,
        (_match, figId) => {
          const ref = validFigureReferences.find((r) => r.figureId === figId);
          return ref ? `<!-- chart:${dimPrefix}${ref.id} -->` : _match;
        },
      );
    }

    if (oldFormatPlaceholders > 0) {
      // Legacy path: AI wrote <!-- figure:N:M --> placeholders — resolve by evidenceCitationIndex
      result = result.replace(
        /<!--\s*figure:(\d+):(\d+)\s*-->/g,
        (_match, evidenceIdx, figIdx) => {
          const ref = validFigureReferences.find(
            (r) =>
              r.evidenceCitationIndex === Number(evidenceIdx) &&
              r.figureIndex === Number(figIdx),
          );
          return ref ? `<!-- chart:${dimPrefix}${ref.id} -->` : _match;
        },
      );
    }

    if (existingPlaceholders === 0) {
      // Fallback path: AI did NOT write any placeholders.
      // Inject <!-- chart:ID --> directly into the content based on the
      // position hints stored in each figureReference.position ("after_paragraph_N").
      result = injectChartsByPosition(result, validFigureReferences, dimPrefix);
    }
  }

  // 2. Skip generatedCharts injection (v4: AI-fabricated charts disabled)

  // 3. Strip unresolved figure placeholders (no matching figureReference found)
  // Handle both new format (FIG-N) and old format (N:M) for backward compat
  result = result.replace(/<!--\s*figure:(FIG-\d+)\s*-->/g, "");
  result = result.replace(/<!--\s*figure:\d+:\d+\s*-->/g, "");

  // 4. Deduplicate chart placeholders: same chartId only appears once
  const seenChartIds = new Set<string>();
  result = result.replace(/<!-- chart:([^\s]+?) -->/g, (match, chartId) => {
    if (seenChartIds.has(chartId)) return "";
    seenChartIds.add(chartId);
    return match;
  });

  return result;
}

/**
 * Injects <!-- chart:ID --> placeholders into content based on position hints.
 *
 * The `position` field from figureReferences follows the pattern "after_paragraph_N"
 * (1-based). When no explicit position is given, figures are distributed evenly
 * across the content paragraphs.
 *
 * A "paragraph boundary" is defined as the end of a non-empty line that is
 * followed by a blank line (standard Markdown paragraph break). Headings, list
 * items, blockquote lines, and table rows are also treated as valid insertion
 * points to avoid injecting mid-block.
 */
function injectChartsByPosition(
  content: string,
  refs: FigureReference[],
  dimPrefix: string,
): string {
  // Split into lines so we can find paragraph boundaries
  const lines = content.split("\n");

  // Identify paragraph-end line indices: a line that is non-empty AND is
  // followed by a blank line (or is the last line). Headings, table
  // separator rows, and code fence lines are excluded as insertion points
  // because injecting after them breaks structure.
  const insertionPoints: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Skip blank lines themselves
    if (!trimmed) continue;
    // Skip code fence boundaries
    if (trimmed.startsWith("```")) continue;
    // Skip table separator rows (---|--- patterns)
    if (/^[\|\s\-:]+$/.test(trimmed) && trimmed.includes("-")) continue;
    // Line is a valid insertion point if the next line is blank or it is the last line
    const nextLine = lines[i + 1];
    if (nextLine === undefined || nextLine.trim() === "") {
      insertionPoints.push(i);
    }
  }

  if (insertionPoints.length === 0) {
    // Edge case: no paragraph breaks found — append all charts at the end
    const chartTags = refs
      .map((r) => `<!-- chart:${dimPrefix}${r.id} -->`)
      .join("\n\n");
    return content + "\n\n" + chartTags;
  }

  // Build a map: insertion line index → chart tags to inject after it
  const injectionMap = new Map<number, string[]>();

  for (const ref of refs) {
    // Parse "after_paragraph_N" (1-based). Fall back to evenly distributed index.
    let paragraphHint: number | null = null;
    const match = /after_paragraph_(\d+)/i.exec(ref.position ?? "");
    if (match) {
      paragraphHint = parseInt(match[1], 10); // 1-based paragraph number
    }

    let targetLineIdx: number;
    if (
      paragraphHint !== null &&
      paragraphHint >= 1 &&
      paragraphHint <= insertionPoints.length
    ) {
      // Map 1-based paragraph hint to the corresponding insertion point
      targetLineIdx = insertionPoints[paragraphHint - 1];
    } else {
      // No valid hint: spread figures evenly across insertion points
      const refIdx = refs.indexOf(ref);
      const step = Math.max(
        1,
        Math.floor(insertionPoints.length / refs.length),
      );
      const pointIdx = Math.min(
        (refIdx + 1) * step - 1,
        insertionPoints.length - 1,
      );
      targetLineIdx = insertionPoints[pointIdx];
    }

    const tag = `<!-- chart:${dimPrefix}${ref.id} -->`;
    const existing = injectionMap.get(targetLineIdx) ?? [];
    existing.push(tag);
    injectionMap.set(targetLineIdx, existing);
  }

  // Rebuild content by inserting chart tags after their target lines
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    output.push(lines[i]);
    if (injectionMap.has(i)) {
      const tags = injectionMap.get(i)!;
      // Blank line before and after each chart tag for Markdown separation
      output.push("");
      output.push(...tags.flatMap((t) => [t, ""]));
    }
  }

  return output.join("\n");
}
