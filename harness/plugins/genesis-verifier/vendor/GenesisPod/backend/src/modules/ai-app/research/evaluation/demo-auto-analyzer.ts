import { load as cheerioLoad } from "cheerio";

export interface DemoAutoMetrics {
  /** Has <!DOCTYPE html> and <html> tag */
  structureValid: boolean;
  /** No src/href pointing to external http(s):// URLs */
  noExternalDeps: boolean;
  /** Count of data-view, role="tabpanel", or distinct <section>/<main> blocks */
  viewCount: number;
  /** Interactive elements: buttons, inputs, selects, [onclick], [data-action] */
  interactiveElements: number;
  /** Numeric content in td/span/p that looks like real data (not placeholder) */
  dataPoints: number;
  /** Has <script> with let/const/var + addEventListener/onclick */
  hasStateManagement: boolean;
  /** Raw length of the HTML string */
  codeSize: number;
}

const PLACEHOLDER_PATTERN =
  /^(xxx|yyy|zzz|n\/a|tbd|placeholder|lorem|ipsum|null|undefined|-)$/i;
const NUMERIC_PATTERN = /^-?\d[\d,.'%$€¥₩\s]*[kKmMbBtT]?$/;

export function analyzeDemo(html: string): DemoAutoMetrics {
  const $ = cheerioLoad(html);

  // --- structureValid ---
  const hasDoctype = /<!DOCTYPE\s+html/i.test(html);
  const hasHtmlTag = $("html").length > 0;
  const structureValid = hasDoctype && hasHtmlTag;

  // --- noExternalDeps ---
  let noExternalDeps = true;
  $("[src],[href]").each((_i, el) => {
    const src = $(el).attr("src") ?? "";
    const href = $(el).attr("href") ?? "";
    if (/^https?:\/\//i.test(src) || /^https?:\/\//i.test(href)) {
      noExternalDeps = false;
    }
  });

  // --- viewCount ---
  const dataViewCount = $("[data-view]").length;
  const tabPanelCount = $('[role="tabpanel"]').length;
  // Count top-level section/main blocks (direct children of body or one level deeper)
  const sectionMainCount = $("section, main").length;
  const viewCount = Math.max(dataViewCount + tabPanelCount, sectionMainCount);

  // --- interactiveElements ---
  const buttonCount = $("button").length;
  const inputCount = $("input").length;
  const selectCount = $("select").length;
  const dataActionCount = $("[data-action]").length;
  // Deduplicate: [onclick] may overlap with buttons/inputs
  const interactiveElements =
    buttonCount +
    inputCount +
    selectCount +
    dataActionCount +
    // Count [onclick] elements that are NOT already counted as button/input/select
    $("[onclick]").not("button, input, select").length;

  // --- dataPoints ---
  let dataPoints = 0;
  $("td, span, p").each((_i, el) => {
    const text = $(el).text().trim();
    if (text && NUMERIC_PATTERN.test(text) && !PLACEHOLDER_PATTERN.test(text)) {
      dataPoints++;
    }
  });

  // --- hasStateManagement ---
  let hasStateManagement = false;
  $("script").each((_i, el) => {
    const scriptContent = $(el).html() ?? "";
    const hasVarDeclaration = /\b(let|const|var)\s+\w+/.test(scriptContent);
    const hasEventBinding =
      /addEventListener\s*\(/.test(scriptContent) ||
      /\.\s*onclick\s*=/.test(scriptContent);
    if (hasVarDeclaration && hasEventBinding) {
      hasStateManagement = true;
    }
  });

  return {
    structureValid,
    noExternalDeps,
    viewCount,
    interactiveElements,
    dataPoints,
    hasStateManagement,
    codeSize: html.length,
  };
}
