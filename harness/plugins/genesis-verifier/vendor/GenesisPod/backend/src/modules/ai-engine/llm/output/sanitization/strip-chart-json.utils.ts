/**
 * Chart JSON Stripping Utilities — 沉淀自 ai-app, 2026-04-29
 *
 * 纯函数（0 DI，0 LLM）：从 markdown 正文中清理 LLM 泄漏的图表 JSON 块、
 * Figure References 元数据、裸 JSON 行。
 *
 * 单一源：所有 AI App 通过 ai-engine/facade 的 stripChartJsonFromContent / extractMarkdownFromJsonString import。
 *
 * 历史：
 *   2026-04-29 沉淀（标杆参考实现）
 *   2026-05-06 #81 chartjs/chart-data/chart fence 处理
 *   2026-05-08 PR-A1 合并业务层本地副本（消除双源）
 */

/**
 * Strip chart JSON blocks that were not properly separated by parseChartOutput.
 * Handles patterns like: ---CHARTS--- {...}, CHARTS--- {...}, ---CHARTS {...},
 * or bare "CHARTS" followed by JSON array/object on next line.
 * ★ Also strips "Figure References" metadata sections and ```chartjs / ```chart-data
 *   / ```chart fenced code blocks (LLM 输出 Chart.js 配置时常用 fence 包裹 JSON)。
 */
export function stripChartJsonFromContent(content: string): string {
  // ★ 2026-05-06 #81: chapter writer LLM 经常用 ```chartjs / ```chart-data /
  //   ```chart 等 fence 包 Chart.js JSON 配置（Mission 1520783d 实证 — dim 4
  //   "硬件基础设施" 第 4 章正文）。前端 markdown renderer 不识别这种 fence →
  //   当 code block 显示 raw JSON，用户看到一堆 {"type":"line","data":{"labels":...}}
  //   既不美观也无信息价值（图表数据本应由 figures[] 走 FigureRenderer 路径）。
  //   修法：sanitize 阶段直接删除整个 ```{chartjs|chart-data|chart} ... ``` fence。
  let result = content.replace(
    /```(?:chartjs|chart-data|chart)\b[^\n]*\n[\s\S]*?\n```\s*/gi,
    "",
  );

  // ★ Strip "Figure References" metadata sections (LLM leaks internal figure allocation data)
  // Pattern: "Figure References" header followed by non-empty lines until first blank line or heading.
  // Each continuation line must be non-empty and NOT a heading.
  result = result.replace(
    /(?:^|\n)\s*\*{0,2}Figure\s*References\*{0,2}\s*\n(?:(?!#{1,6}\s)[^\n]+\n)*/gim,
    "\n",
  );

  // ★ Handle bare "CHARTS" (no dashes) followed by JSON array on next line
  // Pattern: standalone "CHARTS" line + "[" on next line + JSON content + "]"
  result = result.replace(
    /(?:^|\n)\s*CHARTS\s*\n\s*\[[\s\S]*?\n\s*\]\s*(?:\n|$)/gi,
    "\n",
  );

  // Find all CHARTS separator occurrences - require at least one side to have dash
  const separatorPattern = /(?:-+\s*CHARTS\s*-*|CHARTS\s*-+)/gi;
  let match: RegExpExecArray | null;

  // Process from last occurrence to first (to preserve indices)
  const matches: { index: number; length: number }[] = [];
  while ((match = separatorPattern.exec(result)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    const sep = matches[i];
    // Find the opening { after the separator
    const afterSep = result.substring(sep.index + sep.length);
    const braceStart = afterSep.search(/\{/);
    if (braceStart === -1) continue;

    // Use brace counting to find matching closing }
    const jsonStart = sep.index + sep.length + braceStart;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;

    for (let j = jsonStart; j < result.length; j++) {
      const ch = result[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          jsonEnd = j + 1;
          break;
        }
      }
    }

    // Strip from separator start to end of JSON block (or end of content)
    // Also strip leading whitespace/newlines before the separator
    let stripStart = sep.index;
    while (stripStart > 0 && "\n\r \t".includes(result[stripStart - 1])) {
      stripStart--;
    }
    const stripEnd = jsonEnd > 0 ? jsonEnd : result.length;
    result = result.substring(0, stripStart) + result.substring(stripEnd);
  }

  // Fallback: bare JSON block at end of content (may contain nested braces)
  const bareJsonPattern =
    /\n\s*\{[\s\S]*"(?:generatedCharts|figureReferences|figures|data|FIG-\d+)"[\s\S]*\}[\s\n]*$/;
  const m2 = result.match(bareJsonPattern);
  if (m2?.index !== undefined) {
    const before = result.substring(0, m2.index).trim();
    if (before.length > 100) {
      result = before;
    }
  }

  // ★ v3.2: 通用 JSON 块清理 — 清理内容中间泄漏的 JSON 行
  result = stripAllJsonBlocks(result);

  // ★ 移除 AI 错误输出的 "图表数据" 章节标题
  result = result.replace(
    /\n*-{3,}\s*\n*#{0,3}\s*图表数据\s*\n*-{3,}\s*\n*/g,
    "\n\n",
  );
  result = result.replace(/\n#{1,3}\s*图表数据\s*\n/g, "\n");

  // ★ C1: 清理 H3 标题后跟 JSON 对象（如 `### 6.6. {"情景": ...`）
  result = result.replace(/^(#{1,4}\s+[\d.]*\s*)\{[^}]*\}.*$/gm, "");

  // ★ C1: 清理独立行的裸 JSON 对象（如 `{"情景": "乐观", "采用率 (%)": 60},`）
  // Skip lines inside fenced code blocks (```...```)
  {
    const codeBlockRanges: Array<[number, number]> = [];
    const cbRegex = /^```[^\n]*\n[\s\S]*?^```\s*$/gm;
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = cbRegex.exec(result)) !== null) {
      codeBlockRanges.push([cbMatch.index, cbMatch.index + cbMatch[0].length]);
    }
    const isInCodeBlock = (idx: number) =>
      codeBlockRanges.some(([s, e]) => idx >= s && idx < e);
    result = result.replace(
      /^\s*\{"[^"]+"\s*:\s*"[^"]*"(?:\s*,\s*"[^"]+"\s*:\s*[^}]*)?\}\s*,?\s*$/gm,
      (match, offset) => (isInCodeBlock(offset) ? match : ""),
    );
  }

  // ★ C1: 清理 position 指令泄露（如 `paragraph_4$（置于...）`）
  result = result.replace(/\b\w+_\d+\$\s*[（(][^）)]*[）)]/g, "");

  return result.trim();
}

/**
 * 通用 JSON 块清理 — 从 markdown 正文中移除所有泄漏的 JSON 内容
 *
 * Markdown 正文中不应出现 JSON。检测逻辑：
 * 1. 独立行以 `"key":` 开头 → JSON 属性泄漏
 * 2. `{` 或 `[` 开头后跟 `"key":` → JSON 对象/数组泄漏
 * 3. `"figureReferences":`、`"generatedCharts":` 等已知标签 + 后续多行
 *
 * 不处理 ``` 代码块内的内容。
 */
function stripAllJsonBlocks(content: string): string {
  const lines = content.split("\n");
  const cleaned: string[] = [];
  let inCodeBlock = false;

  // 判断一行是否是 JSON 属性行（或空行、孤立符号行）
  function looksLikeJson(line: string): boolean {
    const t = line.trim();
    if (t === "" || /^\s*[\]}{,]\s*$/.test(t) || /^\s*"\s*,?\s*$/.test(t))
      return true; // 空行、孤立符号
    return (
      // "key": value 格式（含 FIG-6 等连字符键名，含行首有编号的情况）
      (/"\s*[a-zA-Z_][\w-]*"\s*:/.test(line) &&
        /^\s*(?:#{0,4}\s*)?(?:\d+\.?\d*\.?\s*)?"\s*[a-zA-Z_]/.test(line)) ||
      // { 开头后跟 "key":
      /^\s*\{\s*"[a-zA-Z_]/.test(line) ||
      // [ 开头后跟 { 或 "key"
      (/^\s*\[\s*\{?\s*"?[a-zA-Z_]/.test(line) && /"\s*:/.test(line))
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块内不处理
    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      cleaned.push(line);
      continue;
    }
    if (inCodeBlock) {
      cleaned.push(line);
      continue;
    }

    // 检测当前行是否是 JSON — 如果是，连续跳过后续所有 JSON 行
    if (looksLikeJson(line) && trimmed !== "") {
      // 确认后续至少还有 1 行也是 JSON（防止误判单行正文）
      const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (nextNonEmpty && looksLikeJson(nextNonEmpty)) {
        // 跳过连续的 JSON 行
        while (
          i < lines.length &&
          (looksLikeJson(lines[i]) || lines[i].trim() === "")
        ) {
          i++;
        }
        i--; // for 循环会 i++
        continue;
      }
    }

    cleaned.push(line);
  }

  return cleaned.join("\n");
}

/**
 * If a string looks like raw JSON, try to extract fullText from it.
 */
export function extractMarkdownFromJsonString(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;

  try {
    const parsed = JSON.parse(trimmed);
    const ft =
      parsed.fullText ||
      parsed.executiveSummary?.fullText ||
      (typeof parsed.executiveSummary === "string"
        ? parsed.executiveSummary
        : null);
    if (ft && typeof ft === "string") return ft;
  } catch {
    // Try regex fallback
  }

  const match = trimmed.match(/"fullText"\s*:\s*"/);
  if (match?.index !== undefined) {
    const valueStart = match.index + match[0].length;
    let i = valueStart;
    while (i < trimmed.length) {
      if (trimmed[i] === "\\") {
        i += 2;
        continue;
      }
      if (trimmed[i] === '"') {
        const raw = trimmed.slice(valueStart, i);
        const unescaped = raw
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        if (unescaped.length > 50) return unescaped;
        break;
      }
      i++;
    }
  }

  return text;
}
