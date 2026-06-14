/**
 * JSON Extraction Utilities
 *
 * Robust JSON extraction from AI responses that may be wrapped in
 * markdown code blocks or contain other formatting.
 */

/**
 * Options for JSON extraction
 */
export interface JsonExtractionOptions {
  /** Key that must exist in the extracted object for validation */
  requiredKey?: string;
  /** Maximum content length to log on error */
  errorPreviewLength?: number;
}

/**
 * Result of JSON extraction attempt
 */
export interface JsonExtractionResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  method?: string;
}

/**
 * Extract JSON from AI response content
 *
 * Tries multiple methods in order:
 * 1. Direct JSON.parse
 * 2. Extract from ```json code block
 * 3. Extract from ``` code block (no language marker)
 * 4. Find JSON object with required key
 * 5. Find any valid JSON object
 *
 * @param content - The AI response content
 * @param options - Extraction options
 * @returns Extraction result with parsed data or error
 */
export function extractJsonFromAIResponse<T = unknown>(
  rawContent: string,
  options: JsonExtractionOptions = {},
): JsonExtractionResult<T> {
  const { requiredKey, errorPreviewLength = 500 } = options;

  // ★ Preprocessing 1: strip reasoning-model chain-of-thought blocks
  // Reasoning models (Nemotron, DeepSeek-R1, QwQ, etc.) prefix structured output
  // with <think>…</think> or <thinking>…</thinking> blocks that break JSON.parse.
  const content = stripReasoningBlocks(rawContent);

  // ★ Preprocessing 2: deduplicate consecutive identical lines
  // Reasoning models sometimes output each JSON line twice
  const deduplicated = deduplicateConsecutiveLines(content);

  // Use deduplicated content for all subsequent methods
  const processedContent = deduplicated !== content ? deduplicated : content;

  // Method 1: Try direct JSON parse
  try {
    const parsed = JSON.parse(content) as T;
    if (!requiredKey || hasKey(parsed, requiredKey)) {
      return { success: true, data: parsed, method: "direct" };
    }
  } catch {
    // Continue to next method
  }

  // Method 1.5: If content starts with {, try brace-counting extraction
  // Handles cases where model appends text after valid JSON, or content has trailing noise
  const trimmedContent = content.trim();
  if (trimmedContent.startsWith("{")) {
    const extracted = extractJsonByBraceCounting(trimmedContent);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted) as T;
        if (!requiredKey || hasKey(parsed, requiredKey)) {
          return { success: true, data: parsed, method: "braceCounting" };
        }
      } catch {
        // Continue to next method
      }
    }
  }

  // Method 2: Extract from ```json code block using brace counting
  // ★ Non-greedy regex fails when fullText contains ``` (markdown code blocks in JSON string values)
  // Instead, find the ```json marker, locate the first {, then use brace counting
  const jsonBlockStart = content.indexOf("```json");
  if (jsonBlockStart !== -1) {
    const afterMarker = content.substring(jsonBlockStart + 7); // skip "```json"
    const bracePos = afterMarker.indexOf("{");
    if (bracePos !== -1) {
      const jsonObj = extractJsonByBraceCounting(
        afterMarker.substring(bracePos),
      );
      if (jsonObj) {
        try {
          const parsed = JSON.parse(jsonObj) as T;
          if (!requiredKey || hasKey(parsed, requiredKey)) {
            return { success: true, data: parsed, method: "jsonBlock" };
          }
        } catch {
          // Continue to next method
        }
      }
      // Fallback: try the unclosed/truncated content after ```json
      const jsonContent = afterMarker.trim();
      // Try direct parse first (complete JSON without closing ```)
      try {
        const trimmed = jsonContent.replace(/\s*```\s*$/, "").trim();
        const parsed = JSON.parse(trimmed) as T;
        if (!requiredKey || hasKey(parsed, requiredKey)) {
          return { success: true, data: parsed, method: "unclosedJsonBlock" };
        }
      } catch {
        // Try repair
        const repaired = tryRepairTruncatedJson(jsonContent);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired) as T;
            if (!requiredKey || hasKey(parsed, requiredKey)) {
              return {
                success: true,
                data: parsed,
                method: "unclosedJsonBlockRepaired",
              };
            }
          } catch {
            // Continue to next method
          }
        }
      }
    }
  }

  // Method 3: Extract from ``` code block (no language marker)
  const codeBlockMatch = content.match(/```\s*([\s\S]+?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]) as T;
      if (!requiredKey || hasKey(parsed, requiredKey)) {
        return { success: true, data: parsed, method: "codeBlock" };
      }
    } catch {
      // Continue to next method
    }
  }

  // Method 4: Find JSON object with required key
  if (requiredKey) {
    const keyPattern = new RegExp(
      `\\{[\\s\\S]*"${requiredKey}"[\\s\\S]*\\}`,
      "g",
    );
    const matches = content.match(keyPattern);
    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match) as T;
          if (hasKey(parsed, requiredKey)) {
            return { success: true, data: parsed, method: "keySearch" };
          }
        } catch {
          // Try next match
        }
      }
    }
  }

  // Method 5: Find any valid JSON object
  const anyJsonMatch = content.match(/\{[\s\S]*\}/);
  if (anyJsonMatch) {
    try {
      const parsed = JSON.parse(anyJsonMatch[0]) as T;
      if (!requiredKey || hasKey(parsed, requiredKey)) {
        return { success: true, data: parsed, method: "anyJson" };
      }
    } catch {
      // Continue
    }
  }

  // Method 6: Try to repair truncated JSON
  const repairedJson = tryRepairTruncatedJson(content);
  if (repairedJson) {
    try {
      const parsed = JSON.parse(repairedJson) as T;
      if (!requiredKey || hasKey(parsed, requiredKey)) {
        return { success: true, data: parsed, method: "repaired" };
      }
    } catch {
      // Continue
    }
  }

  // Method 7: If deduplication produced different content, retry all methods on it
  if (processedContent !== content) {
    const retryResult = extractJsonFromAIResponse<T>(processedContent, {
      ...options,
      // Use a marker to prevent infinite recursion
      requiredKey,
    });
    if (retryResult.success) {
      return {
        ...retryResult,
        method: `deduplicated+${retryResult.method}`,
      };
    }
  }

  // Method 8: JSON5-tolerant normalize — quote unquoted object keys, convert
  // single-quoted strings to double-quoted, strip trailing commas.
  // DeepSeek thinking models in json_object mode emit this dialect, e.g.
  //   {kind:"parallel_tool_call",calls:[{kind:"tool_call",toolId:"web-search"}]}
  // which every JSON.parse-based method above rejects (unquoted keys).
  // Only used as a last resort; the result is still JSON.parse + requiredKey
  // validated, so a wrong normalization simply fails to parse (no false positive).
  {
    const json5Candidates: string[] = [];
    const rawTrim = content.trim();
    if (rawTrim.startsWith("{") || rawTrim.startsWith("[")) {
      const bracedRaw = extractJsonByBraceCounting(rawTrim);
      if (bracedRaw) json5Candidates.push(bracedRaw);
    }
    const normalizedFull = normalizeJson5(content);
    const normTrim = normalizedFull.trim();
    if (normTrim.startsWith("{") || normTrim.startsWith("[")) {
      const bracedNorm = extractJsonByBraceCounting(normTrim);
      if (bracedNorm) json5Candidates.push(bracedNorm);
    }
    const normAny = normalizedFull.match(/[{[][\s\S]*[}\]]/);
    if (normAny) json5Candidates.push(normAny[0]);
    json5Candidates.push(normalizedFull);

    for (const cand of json5Candidates) {
      const normalized = normalizeJson5(cand);
      try {
        const parsed = JSON.parse(normalized) as T;
        if (!requiredKey || hasKey(parsed, requiredKey)) {
          return { success: true, data: parsed, method: "json5" };
        }
      } catch {
        // try repair below / next candidate
      }
      // JSON5 + truncation combo
      const repaired = tryRepairTruncatedJson(normalized);
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired) as T;
          if (!requiredKey || hasKey(parsed, requiredKey)) {
            return { success: true, data: parsed, method: "json5Repaired" };
          }
        } catch {
          // try next candidate
        }
      }
    }
  }

  // Method 9: repair unescaped inner double-quotes in string values.
  // Dominant LLM failure for long prose `body` fields (e.g. 不再只是"跑得快"的引擎).
  // Last resort — only reached when every structural method above already failed.
  {
    const quoteRepaired = repairUnescapedQuotesInStrings(content);
    if (quoteRepaired && quoteRepaired !== content) {
      // direct parse
      try {
        const parsed = JSON.parse(quoteRepaired) as T;
        if (!requiredKey || hasKey(parsed, requiredKey)) {
          return { success: true, data: parsed, method: "quoteRepair" };
        }
      } catch {
        // combine with truncation repair (body cut off mid-string)
        const repaired = tryRepairTruncatedJson(quoteRepaired);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired) as T;
            if (!requiredKey || hasKey(parsed, requiredKey)) {
              return {
                success: true,
                data: parsed,
                method: "quoteRepair+truncation",
              };
            }
          } catch {
            // fall through to failure
          }
        }
      }
    }
  }

  // All methods failed
  const preview = content.substring(0, errorPreviewLength);
  return {
    success: false,
    data: null,
    error: `Failed to extract JSON from content. Preview: ${preview}${content.length > errorPreviewLength ? "..." : ""}`,
  };
}

/**
 * Check if an object has a specific key
 */
function hasKey(obj: unknown, key: string): boolean {
  return typeof obj === "object" && obj !== null && key in obj;
}

/**
 * Normalize a JSON5-ish string into strict JSON parseable by `JSON.parse`.
 *
 * Some models — notably DeepSeek thinking models in `json_object` mode (which is
 * best-effort prompt guidance, NOT a grammar constraint) — emit a JS-object-literal
 * dialect that `JSON.parse` rejects:
 *   - unquoted object keys:     {kind:"x"}        → {"kind":"x"}
 *   - single-quoted strings:    {'k':'v'}         → {"k":"v"}
 *   - trailing commas:          [1,2,]  / {"a":1,} → [1,2] / {"a":1}
 *
 * The scan is quote-aware: only structural tokens are rewritten; string *contents*
 * (URLs, colons, commas, braces inside values) are preserved verbatim. Unquoted
 * identifiers are only quoted when in key position (immediately after `{` or `,`
 * and immediately followed by `:`), so value literals like `true`/`false`/`null`
 * and numbers are never touched.
 *
 * Exported for direct use + unit testing. Idempotent on already-strict JSON.
 */
export function normalizeJson5(input: string): string {
  let out = "";
  let inString: '"' | "'" | null = null;
  let escaped = false;
  let prevSignificant = ""; // last non-whitespace char emitted outside strings

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === inString) {
        out += '"'; // always close with a double quote
        inString = null;
        prevSignificant = '"';
        continue;
      }
      if (ch === '"' && inString === "'") {
        out += '\\"'; // escape a literal double quote inside a single-quoted string
        continue;
      }
      out += ch;
      continue;
    }

    // ── not inside a string ──
    if (ch === '"' || ch === "'") {
      out += '"';
      inString = ch as '"' | "'";
      continue;
    }

    // strip trailing commas: a comma whose next non-ws char closes an object/array
    if (ch === ",") {
      let k = i + 1;
      while (k < input.length && /\s/.test(input[k])) k++;
      if (input[k] === "}" || input[k] === "]") {
        continue; // drop the comma
      }
      out += ch;
      prevSignificant = ",";
      continue;
    }

    // unquoted key in key position → quote it
    if (
      /[A-Za-z_$]/.test(ch) &&
      (prevSignificant === "{" ||
        prevSignificant === "," ||
        prevSignificant === "")
    ) {
      let j = i;
      let ident = "";
      while (j < input.length && /[A-Za-z0-9_$.\-]/.test(input[j])) {
        ident += input[j];
        j++;
      }
      let k = j;
      while (k < input.length && /\s/.test(input[k])) k++;
      if (input[k] === ":") {
        out += `"${ident}"`;
        prevSignificant = ident.charAt(ident.length - 1);
        i = j - 1;
        continue;
      }
      // not a key (e.g. true/false/null value) → emit verbatim
      out += ident;
      prevSignificant = ident.charAt(ident.length - 1);
      i = j - 1;
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) prevSignificant = ch;
  }

  return out;
}

/**
 * Strip reasoning-model chain-of-thought blocks from text.
 *
 * Reasoning models (NVIDIA Nemotron, DeepSeek-R1, QwQ, OpenAI o-series with
 * raw reasoning leak, etc.) often prefix structured output with internal
 * reasoning wrapped in `<think>…</think>` or `<thinking>…</thinking>` tags.
 * These break direct `JSON.parse` and downstream Zod validation when the
 * model is asked to return structured JSON.
 *
 * This helper is the single source of truth — callers should NOT re-implement
 * `replace(/<think>…/gi, "")` inline. It also strips unclosed `<think>` blocks
 * that occur when output is truncated mid-reasoning.
 */
export function stripReasoningBlocks(content: string): string {
  if (!content) return content;
  let out = content;
  // Closed blocks: <think>…</think>, <thinking>…</thinking>, <reasoning>…</reasoning>
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  out = out.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  // Unclosed leading blocks: model started reasoning but output was truncated
  // before the closing tag, OR reasoning leaked into the answer with no close.
  out = out.replace(/^[\s\S]*?<\/think>/i, (m) =>
    /<think>/i.test(m) ? "" : m,
  );
  out = out.replace(/^[\s\S]*?<\/thinking>/i, (m) =>
    /<thinking>/i.test(m) ? "" : m,
  );
  out = out.replace(/^[\s\S]*?<\/reasoning>/i, (m) =>
    /<reasoning>/i.test(m) ? "" : m,
  );
  return out.trim();
}

/**
 * Remove consecutive duplicate lines from content.
 * Reasoning models sometimes output each line twice, producing invalid JSON
 * with duplicate keys and missing commas.
 */
function deduplicateConsecutiveLines(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= 1) return content;

  const result: string[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    // Skip if this line is identical to the previous (after trimming)
    if (lines[i].trim() === lines[i - 1].trim() && lines[i].trim().length > 0) {
      continue;
    }
    result.push(lines[i]);
  }

  return result.join("\n");
}

/**
 * Result of a truncated-JSON repair attempt.
 * `json` is the (possibly repaired) string; `repaired` is true when
 * the function had to add closing brackets or truncate partial values.
 */
export interface TryRepairTruncatedJsonResult {
  json: string;
  repaired: boolean;
}

/**
 * Like tryRepairTruncatedJson, but surfaces whether repair actually occurred.
 *
 * Returns `{ json, repaired: true }` when the input was truncated and had to
 * be patched (downstream can use `repaired` to signal partial data).
 * Returns `{ json: content, repaired: false }` when the JSON was already
 * balanced (no repair needed / not repairable).
 *
 * Existing callers of tryRepairTruncatedJson are NOT affected — they continue
 * to receive `string | null` from the original private wrapper below.
 */
export function tryRepairTruncatedJsonWithMeta(
  content: string,
): TryRepairTruncatedJsonResult {
  const repaired = tryRepairTruncatedJson(content);
  if (repaired !== null) {
    return { json: repaired, repaired: true };
  }
  return { json: content, repaired: false };
}

/**
 * Try to repair truncated JSON by adding missing closing brackets
 * Handles cases where JSON is truncated mid-string or mid-value
 */
function tryRepairTruncatedJson(content: string): string | null {
  // Extract potential JSON from code block first
  let jsonContent = content;

  // ★ 改进：优先使用贪婪匹配来处理没有结束 ``` 的情况
  const closedBlockMatch = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const unclosedBlockMatch = content.match(/```(?:json)?\s*([\s\S]+)$/);

  if (closedBlockMatch) {
    jsonContent = closedBlockMatch[1];
  } else if (unclosedBlockMatch) {
    // 没有结束的 ```，使用贪婪匹配获取全部内容
    jsonContent = unclosedBlockMatch[1];
  }

  // Find where JSON starts
  const jsonStart = jsonContent.indexOf("{");
  if (jsonStart === -1) return null;

  jsonContent = jsonContent.substring(jsonStart);

  // Count brackets and track string state
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidStringEnd = -1;

  for (let i = 0; i < jsonContent.length; i++) {
    const char = jsonContent[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      if (!inString) {
        lastValidStringEnd = i;
      }
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      if (char === "}") braceCount--;
      if (char === "[") bracketCount++;
      if (char === "]") bracketCount--;
    }
  }

  // If brackets are unbalanced or we're in an incomplete string, try to repair
  if (braceCount > 0 || bracketCount > 0 || inString) {
    let repaired = jsonContent;

    // If we're in the middle of a string, close it and truncate the incomplete value
    if (inString) {
      // Find the last complete property before the truncated string
      const lastCommaBeforeEnd = jsonContent.lastIndexOf(
        ",",
        lastValidStringEnd,
      );
      const truncatePoint = Math.max(lastCommaBeforeEnd, 0);

      if (truncatePoint > 0) {
        // Truncate to last complete property
        repaired = jsonContent.substring(0, truncatePoint);
      } else if (lastValidStringEnd > 0) {
        // Fall back to last valid string end
        repaired = jsonContent.substring(0, lastValidStringEnd + 1);
      }

      // Recount brackets after truncation
      braceCount = 0;
      bracketCount = 0;
      inString = false;
      escapeNext = false;

      for (const char of repaired) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (char === "\\") {
          escapeNext = true;
          continue;
        }
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === "{") braceCount++;
          if (char === "}") braceCount--;
          if (char === "[") bracketCount++;
          if (char === "]") bracketCount--;
        }
      }
    } else {
      // Not in string, find last complete property
      const lastComma = jsonContent.lastIndexOf(",");
      const lastBrace = Math.max(
        jsonContent.lastIndexOf("}"),
        jsonContent.lastIndexOf("]"),
      );

      if (lastBrace > lastComma && lastBrace > 0) {
        repaired = jsonContent.substring(0, lastBrace + 1);
      } else if (lastComma > 0) {
        repaired = jsonContent.substring(0, lastComma);
      }

      // Recount brackets after truncation
      braceCount = 0;
      bracketCount = 0;
      for (const char of repaired) {
        if (char === "{") braceCount++;
        if (char === "}") braceCount--;
        if (char === "[") bracketCount++;
        if (char === "]") bracketCount--;
      }
    }

    // Remove trailing comma if present
    repaired = repaired.replace(/,\s*$/, "");

    // Add closing brackets
    if (bracketCount > 0) repaired += "]".repeat(bracketCount);
    if (braceCount > 0) repaired += "}".repeat(braceCount);

    return repaired;
  }

  return null;
}

/**
 * Repair unescaped double-quotes that appear INSIDE JSON string values.
 *
 * LLMs (esp. reasoning models writing long prose into a `body` field) routinely
 * emit ASCII `"` for emphasis / quoted phrases inside a string value without
 * escaping them, e.g. `{"body":"不再只是"跑得快"的引擎"}` — which breaks
 * `JSON.parse` (the inner `"` prematurely closes the string). Every other method
 * in {@link extractJsonFromAIResponse} fails on this because the input IS valid-
 * looking JSON apart from the stray quotes.
 *
 * Heuristic (quote-aware single pass from the first `{`):
 *   - Track in-string state + brace/bracket depth (outside strings).
 *   - A `"` while in a string is treated as the CLOSING quote only if the next
 *     non-whitespace char is a structural token (`,` `}` `]` `:`) or EOF;
 *     otherwise it is an unescaped inner quote → escaped to `\"`.
 *   - Stops at the matching close of the top-level object (drops trailing chatter).
 *   - Already-escaped `\"` pairs are passed through verbatim.
 *
 * Returns the repaired substring (from the first `{`). Truncated input (string
 * never closes) is returned as-is so {@link tryRepairTruncatedJson} can finish it.
 * Exported for unit testing.
 */
export function repairUnescapedQuotesInStrings(content: string): string {
  const start = content.indexOf("{");
  if (start < 0) return content;
  const s = content.slice(start);
  const STRUCTURAL = new Set([",", "}", "]", ":"]);
  let out = "";
  let inString = false;
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (!inString) {
      out += ch;
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) break; // top-level object closed → drop trailing junk
      }
      continue;
    }

    // inside a string
    if (ch === "\\") {
      // escaped pair (\" \\ \n ...): emit both verbatim
      out += ch;
      if (i + 1 < s.length) {
        out += s[i + 1];
        i++;
      }
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const next = j < s.length ? s[j] : undefined;
      if (next === undefined || STRUCTURAL.has(next)) {
        out += '"'; // genuine closing quote
        inString = false;
      } else {
        out += '\\"'; // stray inner quote → escape it
      }
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Extract a complete JSON object from a string using brace counting.
 * Correctly handles nested braces inside JSON string values (e.g. markdown with ```)
 * Returns the complete JSON substring, or null if no balanced object found.
 */
function extractJsonByBraceCounting(content: string): string | null {
  if (!content.startsWith("{")) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
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
        return content.substring(0, i + 1);
      }
    }
  }

  return null; // Unbalanced — truncated JSON
}
