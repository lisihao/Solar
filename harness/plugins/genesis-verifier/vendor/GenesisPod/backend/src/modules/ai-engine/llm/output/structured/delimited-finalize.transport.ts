/**
 * Delimited finalize transport (P1a/P1b, 2026-05-25)
 *
 * 问题：best-effort 结构化输出的模型（DeepSeek json_object / nativeMode='none' 等
 * 只把 JSON 当 prompt 提示、非 grammar 强约束）被要求把**长篇散文**（章节 body /
 * finding evidence）塞进 JSON 字符串字段时，极易产出非法 JSON —— 未转义的内层引号、
 * 裸换行、被 max_tokens 截断 —— 一个坏字符就让整轮 finalize 解析失败、findings 全丢。
 *
 * 方案：对这类模型，**长文不进 JSON**。finalize 输出拆成三段独立可解析的载体：
 *   1) 短 JSON 信封：{thinking, action:{kind:"finalize", output:{<短字段>}}}（无长文 → 稳）
 *   2) 长文字段：`<<<FIELD:body>>> … <<<END:body>>>` 纯文本块（无需任何转义）
 *   3) 数组字段：`<<<NDJSON:findings>>>` 每行一个 JSON 对象（一行坏只丢一条，不丢整批）
 *
 * 这是“输出载体随模型能力自适应”：grammar 强约束模型走原生 JSON（provider 保证合法），
 * best-effort 模型走本 transport。纯函数、无副作用、与 react-loop 解耦，便于单测。
 */

/** 决定某能力档位是否该用 delimited transport（best-effort 才用；强约束走原生 JSON）。 */
export function shouldUseDelimitedTransport(
  nativeMode: string | null | undefined,
): boolean {
  return nativeMode === "json_mode" || nativeMode === "none";
}

const fieldOpen = (f: string): string => `<<<FIELD:${f}>>>`;
const fieldClose = (f: string): string => `<<<END:${f}>>>`;
const ndjsonOpen = (f: string): string => `<<<NDJSON:${f}>>>`;
const ndjsonClose = (f: string): string => `<<<END:${f}>>>`;

export interface DelimitedFinalizeShape {
  /** 走纯文本块的长文字段名（如 ["body"] / ["summary"]）。 */
  proseFields?: string[];
  /** 走 NDJSON 的数组字段名（如 "findings"）。 */
  ndjsonArrayField?: string;
}

/**
 * 生成追加到 system prompt 的 delimited finalize 说明。
 * 仅在调用方判定（best-effort 模型 + 有长文/数组字段）时拼接。
 */
export function buildDelimitedFinalizeInstructions(
  shape: DelimitedFinalizeShape,
): string {
  const proseFields = shape.proseFields ?? [];
  const arrayField = shape.ndjsonArrayField;
  if (proseFields.length === 0 && !arrayField) return "";

  const lines: string[] = [
    "",
    "## Finalize Output Transport (IMPORTANT — avoids broken JSON)",
    "When your action is `finalize`, DO NOT put long text or arrays inside the JSON.",
    "Emit the JSON envelope with ONLY the short scalar fields, then put long / array",
    "fields AFTER the JSON using the delimited blocks below. Long text needs NO escaping.",
    "",
  ];

  for (const f of proseFields) {
    lines.push(
      `For the long text field "${f}", emit a block:`,
      `${fieldOpen(f)}`,
      `...the full ${f} text verbatim (markdown ok, quotes ok, newlines ok, no escaping)...`,
      `${fieldClose(f)}`,
      "",
    );
  }

  if (arrayField) {
    lines.push(
      `For the array field "${arrayField}", emit one JSON object PER LINE between:`,
      `${ndjsonOpen(arrayField)}`,
      `{"...one item as compact JSON..."}`,
      `{"...next item..."}`,
      `${ndjsonClose(arrayField)}`,
      "",
    );
  }

  const omit = [...proseFields, ...(arrayField ? [arrayField] : [])]
    .map((f) => `"${f}"`)
    .join(", ");
  lines.push(
    `So the JSON \`output\` must OMIT ${omit} (those go in the blocks above).`,
    'Example: {"thinking":"...","action":{"kind":"finalize","output":{<short fields only>}}}',
    "",
  );

  return lines.join("\n");
}

/** raw 文本里是否带有本 transport 的分隔标记（决定是否走 delimited 解析）。 */
export function hasDelimitedFinalizeMarkers(
  raw: string,
  shape: DelimitedFinalizeShape,
): boolean {
  if (!raw) return false;
  const proseFields = shape.proseFields ?? [];
  for (const f of proseFields) {
    if (raw.includes(fieldOpen(f))) return true;
  }
  if (
    shape.ndjsonArrayField &&
    raw.includes(ndjsonOpen(shape.ndjsonArrayField))
  ) {
    return true;
  }
  return false;
}

function extractBlock(
  raw: string,
  openTag: string,
  closeTag: string,
): string | null {
  const start = raw.indexOf(openTag);
  if (start < 0) return null;
  const contentStart = start + openTag.length;
  const end = raw.indexOf(closeTag, contentStart);
  // close 标记缺失（被截断）→ 取到文本结尾（best-effort，保住已有内容）
  const slice =
    end < 0 ? raw.slice(contentStart) : raw.slice(contentStart, end);
  return slice.replace(/^\r?\n/, "").replace(/\s+$/, "");
}

/**
 * 解析 NDJSON 块：每行一个 JSON 对象，逐行 parse；坏行跳过（只丢该行不丢整批）。
 * 行内允许 ```/前后空白；空行忽略。
 */
export function parseNdjsonItems(block: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (!line || line === "```" || line.startsWith("```")) continue;
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj && typeof obj === "object") items.push(obj);
    } catch {
      // 坏行：丢这一条，继续下一行
    }
  }
  return items;
}

export interface ParsedDelimitedFinalize {
  /** 重建出的 finalize output 对象（短字段 + 注入的长文/数组字段）。 */
  output: Record<string, unknown>;
  /** 信封里的 thinking（若有）。 */
  thinking?: string;
}

/**
 * 把 delimited finalize 原文重建成 finalize output 对象。
 *
 * 步骤：
 *   1) 取第一个 JSON 信封（此时不含长文 → 短小可靠），拿 output 短字段 + thinking。
 *      信封解析失败也不致命：output 退化为 {}，仍把长文/数组块灌进去。
 *   2) 每个 prose 字段：从 <<<FIELD:x>>> 块取原文，赋给 output[x]。
 *   3) NDJSON 字段：逐行 parse 成数组，赋给 output[arrayField]。
 *
 * @returns null 表示没有任何分隔标记（调用方回退到既有 JSON 解析路径）。
 */
export function parseDelimitedFinalize(
  raw: string,
  shape: DelimitedFinalizeShape,
): ParsedDelimitedFinalize | null {
  if (!hasDelimitedFinalizeMarkers(raw, shape)) return null;

  // 1) 信封：取标记之前的第一个 { ... }，逐字符配平括号（容忍信封内仍有引号问题时降级为空对象）
  let output: Record<string, unknown> = {};
  let thinking: string | undefined;
  const firstMarker = raw.search(/<<<(FIELD|NDJSON):/);
  const envelopeText = firstMarker > 0 ? raw.slice(0, firstMarker) : raw;
  const braceStart = envelopeText.indexOf("{");
  if (braceStart >= 0) {
    try {
      const enveloped = JSON.parse(
        balancedObject(envelopeText.slice(braceStart)),
      ) as {
        thinking?: unknown;
        action?: { output?: unknown };
        output?: unknown;
      };
      if (typeof enveloped.thinking === "string") thinking = enveloped.thinking;
      const out = enveloped.action?.output ?? enveloped.output;
      if (out && typeof out === "object") {
        output = { ...(out as Record<string, unknown>) };
      }
    } catch {
      // 信封不可解析 → 留空对象，靠下方块补全
    }
  }

  // 2) prose 字段
  for (const f of shape.proseFields ?? []) {
    const block = extractBlock(raw, fieldOpen(f), fieldClose(f));
    if (block !== null) output[f] = block;
  }

  // 3) NDJSON 数组字段
  if (shape.ndjsonArrayField) {
    const block = extractBlock(
      raw,
      ndjsonOpen(shape.ndjsonArrayField),
      ndjsonClose(shape.ndjsonArrayField),
    );
    if (block !== null) {
      output[shape.ndjsonArrayField] = parseNdjsonItems(block);
    }
  }

  return { output, thinking };
}

/** 从以 '{' 开头的文本里用括号配平截出第一个完整对象（忽略字符串内的括号）。 */
function balancedObject(s: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return s; // 未配平（截断）→ 原样返回，交给上层 try/catch
}
