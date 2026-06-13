/**
 * 9 个 Structured Output Strategy 的 adapter 实现
 *
 * 每个 adapter 实现 IStructuredOutputAdapter，按 strategy 分支构造 LLM 请求 +
 * 解析响应。所有 adapter 都是纯函数（无 DI），由 StructuredOutputRouter 选用。
 *
 * 调研基线（2026-05-06 sub-agent 报告）：
 *   - OpenAI / xAI Grok：原生 json_schema strict（response_format.type=json_schema）
 *   - Anthropic Claude：无 native，靠 tool_use 约束（function calling）
 *   - Google Gemini：generationConfig.responseMimeType + responseSchema
 *   - DeepSeek-chat：兼容 OpenAI json_schema；deepseek-reasoner 不支持
 *   - 本地模型（Ollama / vLLM / Llama.cpp）：GBNF grammar 或 prompt 兜底
 */

import type {
  AdaptInput,
  AdaptOutput,
  IStructuredOutputAdapter,
  PostParseInput,
  PostParseOutput,
  StructuredOutputStrategy,
} from "./structured-output-strategy.types";

// ─────────── 共享：从 LLM 文本中提取 JSON ───────────
// markdown 包裹 / 行首 BOM / 尾随逗号 等常见 LLM 输出问题的兜底。
function extractJson(raw: string): unknown | null {
  if (!raw) return null;
  let text = raw.trim();
  // 1. 剥 markdown ``` json ``` 包裹
  const mdMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (mdMatch) text = mdMatch[1].trim();
  // 2. 找首个 { 或 [ 到末尾匹配 } 或 ] 的范围（防 LLM 加前后缀闲话）。
  //    取出现位置最早的开括号（避免数组根 `[{...}]` 被误识别为 object）。
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  const arrayRootEarlier =
    firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace);
  let candidate: string | null = null;
  if (arrayRootEarlier && lastBracket > firstBracket) {
    candidate = text.slice(firstBracket, lastBracket + 1);
  } else if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidate = text.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidate = text.slice(firstBracket, lastBracket + 1);
  }
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    // 3. 兜底：去尾随逗号再试
    try {
      return JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

// ============================================================================
// OpenAI / Grok / DeepSeek-chat: json_schema strict mode
// ============================================================================
export class JsonSchemaStrictAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "json_schema_strict";

  adapt(input: AdaptInput): AdaptOutput {
    return {
      requestBodyPatch: {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            schema: input.jsonSchema,
            strict: true,
          },
        },
      },
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

// ============================================================================
// json_schema 但非 strict（兼容 reasoning 模型，部分 provider 不支持 strict）
// ============================================================================
export class JsonSchemaAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "json_schema";

  adapt(input: AdaptInput): AdaptOutput {
    return {
      requestBodyPatch: {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            schema: input.jsonSchema,
            strict: false,
          },
        },
      },
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

// ============================================================================
// Anthropic Claude: tool_use（最可靠的 structured output 路径）
// ============================================================================
export class AnthropicToolUseAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "tool_use";

  adapt(input: AdaptInput): AdaptOutput {
    return {
      requestBodyPatch: {
        tools: [
          {
            name: input.schemaName,
            description: `Structured output for ${input.schemaName}. MUST be called exactly once with the JSON conforming to the input_schema.`,
            input_schema: input.jsonSchema,
          },
        ],
        tool_choice: { type: "tool", name: input.schemaName },
      },
    };
  }

  postParse({
    rawContent,
    toolUseBlock,
  }: PostParseInput): PostParseOutput | null {
    // 优先从 tool_use block 取（如果 caller 已经解析过 anthropic 响应）
    if (toolUseBlock?.input != null) {
      return { json: toolUseBlock.input };
    }
    // 否则尝试从 rawContent 兜底（caller 把 tool_use 序列化成 string 传过来）
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

// ============================================================================
// Anthropic Claude: native structured outputs（output_config.format，GA 2026-05）
// schema 编译成 grammar 约束 token 生成，保证首次即合规；JSON 直出在 text block。
// ============================================================================
export class AnthropicOutputConfigAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "anthropic_output_config";

  adapt(input: AdaptInput): AdaptOutput {
    return {
      requestBodyPatch: {
        output_config: {
          format: {
            type: "json_schema",
            schema: input.jsonSchema,
          },
        },
      },
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    // native 模式 JSON 直出在普通 text block，extractJson 兜底 markdown 包裹。
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

// ============================================================================
// json_mode: response_format: { type: "json_object" }
// ============================================================================
export class JsonModeAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "json_mode";

  adapt(): AdaptOutput {
    return {
      requestBodyPatch: {
        response_format: { type: "json_object" },
      },
      // json_mode 不带 schema，需要在 system prompt 提示返回什么字段
      systemPromptAddon:
        "\n\nReturn ONLY a JSON object that exactly matches the schema described above. No prose, no markdown.",
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

// ============================================================================
// Google Gemini: generationConfig.responseSchema + responseMimeType
// ============================================================================
export class GeminiResponseSchemaAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "gemini_response_schema";

  adapt(input: AdaptInput): AdaptOutput {
    return {
      requestBodyPatch: {
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: stripUnsupportedJsonSchemaFields(input.jsonSchema),
        },
      },
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

/**
 * Gemini responseSchema 不支持 JSON Schema 的某些字段（如 $schema, additionalProperties,
 * format 等）。strip 这些字段防 400 INVALID_ARGUMENT。
 */
function stripUnsupportedJsonSchemaFields(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const banned = new Set([
    "$schema",
    "additionalProperties",
    "$id",
    "$ref",
    "definitions",
  ]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (banned.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

// ============================================================================
// GBNF Grammar (Llama.cpp / vLLM / 本地模型) — 高层适配
// ============================================================================
export class GbnfGrammarAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "gbnf_grammar";

  adapt(input: AdaptInput): AdaptOutput {
    // GBNF grammar 要求 server 端支持。多数 OpenAI-compatible endpoint 用
    // `response_format: { type: "json_object", schema: ... }` 的非标准扩展，
    // 或专门的 `grammar` 字段。这里同时塞进两种字段，让 server 二选一。
    return {
      requestBodyPatch: {
        response_format: { type: "json_object" },
        grammar: gbnfFromJsonSchema(input.jsonSchema),
      },
      systemPromptAddon:
        "\n\nReturn ONLY a JSON object matching the schema. No prose.",
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json };
  }
}

/**
 * 极简 JSON Schema → GBNF 转换（仅基本类型 / object / array）。复杂 schema 退化
 * 为通用 JSON GBNF（不约束字段名），由 LLM 自己输出合法 JSON。
 */
function gbnfFromJsonSchema(_schema: Record<string, unknown>): string {
  return `root   ::= object
object ::= "{" ws ( pair ( ws "," ws pair )* )? ws "}"
pair   ::= string ws ":" ws value
array  ::= "[" ws ( value ( ws "," ws value )* )? ws "]"
value  ::= object | array | string | number | bool | null
string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""
number ::= "-"? ([0-9] | [1-9][0-9]+) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?
bool   ::= "true" | "false"
null   ::= "null"
ws     ::= [ \\t\\n\\r]*`;
}

// ============================================================================
// Prompt 兜底：任何 provider 都可用，但精度最差
// ============================================================================
export class PromptOnlyAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "prompt";

  adapt(input: AdaptInput): AdaptOutput {
    const schemaText = JSON.stringify(input.jsonSchema, null, 2);
    return {
      requestBodyPatch: {},
      systemPromptAddon:
        `\n\n[CRITICAL OUTPUT FORMAT]\n` +
        `You MUST output ONLY a valid JSON object that matches this schema (no prose, no markdown):\n` +
        `\n${schemaText}\n` +
        `\nReturn the JSON object directly without any wrapper text.`,
    };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    const json = extractJson(rawContent);
    return json == null ? null : { json, sanitized: true };
  }
}

// ============================================================================
// none: 禁用 structured output，直返文本（caller 自行处理）
// ============================================================================
export class NoneAdapter implements IStructuredOutputAdapter {
  readonly strategy: StructuredOutputStrategy = "none";

  adapt(): AdaptOutput {
    return { requestBodyPatch: {} };
  }

  postParse({ rawContent }: PostParseInput): PostParseOutput | null {
    return { json: rawContent };
  }
}
