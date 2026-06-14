/**
 * Adapter Smoke Spec — 各 provider strategy 的 request/response 契约模拟
 *
 * 不打真 LLM（避免计费），用 mock LLM response 验证：
 *   1. adapt() 产生的 request body 符合该 provider 的 OpenAPI 契约
 *   2. postParse() 能从该 provider 典型 response 形态中提取 JSON
 *
 * 覆盖：OpenAI strict / Anthropic tool_use / Gemini / json_mode / GBNF / prompt /
 *       OpenAI o1 reasoning / DeepSeek-reasoner prompt-only
 */

import {
  AnthropicOutputConfigAdapter,
  AnthropicToolUseAdapter,
  GbnfGrammarAdapter,
  GeminiResponseSchemaAdapter,
  JsonModeAdapter,
  JsonSchemaAdapter,
  JsonSchemaStrictAdapter,
  PromptOnlyAdapter,
  NoneAdapter,
} from "../adapters";

const SAMPLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    score: { type: "number" },
  },
  required: ["title", "score"],
  additionalProperties: false,
};

const VALID_RESPONSE = `{"title":"hello","score":0.9}`;
const MARKDOWN_WRAPPED = "```json\n" + VALID_RESPONSE + "\n```";
const PROSE_PREFIX = `Sure, here is the result:\n${VALID_RESPONSE}\nLet me know if you need anything else.`;

describe("JsonSchemaStrictAdapter (OpenAI / Grok strict)", () => {
  const adapter = new JsonSchemaStrictAdapter();

  it("adapt() emits OpenAI strict json_schema format", () => {
    const out = adapter.adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "result",
      modelId: "gpt-4o",
    });
    expect(out.requestBodyPatch).toEqual({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "result",
          schema: SAMPLE_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it("postParse extracts JSON from clean response", () => {
    const out = adapter.postParse({ rawContent: VALID_RESPONSE });
    expect(out?.json).toEqual({ title: "hello", score: 0.9 });
  });

  it("postParse strips markdown wrapper", () => {
    const out = adapter.postParse({ rawContent: MARKDOWN_WRAPPED });
    expect(out?.json).toEqual({ title: "hello", score: 0.9 });
  });

  it("postParse extracts JSON from prose-prefixed response", () => {
    const out = adapter.postParse({ rawContent: PROSE_PREFIX });
    expect(out?.json).toEqual({ title: "hello", score: 0.9 });
  });

  it("postParse returns null on garbage", () => {
    expect(adapter.postParse({ rawContent: "not json at all" })).toBeNull();
  });
});

describe("JsonSchemaAdapter (non-strict)", () => {
  it("adapt() strict=false", () => {
    const out = new JsonSchemaAdapter().adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "result",
      modelId: "deepseek-chat",
    });
    const rf = out.requestBodyPatch.response_format as Record<string, unknown>;
    expect((rf.json_schema as Record<string, unknown>).strict).toBe(false);
  });
});

describe("AnthropicToolUseAdapter", () => {
  const adapter = new AnthropicToolUseAdapter();

  it("adapt() emits tool_use with input_schema and forced tool_choice", () => {
    const out = adapter.adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "extract_result",
      modelId: "claude-3.5-sonnet",
    });
    expect(out.requestBodyPatch).toMatchObject({
      tools: [
        {
          name: "extract_result",
          input_schema: SAMPLE_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "extract_result" },
    });
  });

  it("postParse prefers parsed tool_use block over rawContent", () => {
    const out = adapter.postParse({
      rawContent: "ignored",
      toolUseBlock: { name: "extract_result", input: { title: "x", score: 1 } },
    });
    expect(out?.json).toEqual({ title: "x", score: 1 });
  });

  it("postParse falls back to rawContent JSON when no tool_use block", () => {
    const out = adapter.postParse({ rawContent: VALID_RESPONSE });
    expect(out?.json).toEqual({ title: "hello", score: 0.9 });
  });
});

describe("AnthropicOutputConfigAdapter (native structured outputs, GA 2026)", () => {
  const adapter = new AnthropicOutputConfigAdapter();

  it("adapt() emits output_config.format with type=json_schema + schema", () => {
    const out = adapter.adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "result",
      modelId: "claude-opus-4-7",
    });
    expect(out.requestBodyPatch).toEqual({
      output_config: {
        format: {
          type: "json_schema",
          schema: SAMPLE_SCHEMA,
        },
      },
    });
    // native 模式不靠 system prompt 哄
    expect(out.systemPromptAddon).toBeUndefined();
  });

  it("postParse extracts JSON from text block (native JSON 直出)", () => {
    expect(adapter.postParse({ rawContent: VALID_RESPONSE })?.json).toEqual({
      title: "hello",
      score: 0.9,
    });
  });

  it("postParse strips markdown wrapper", () => {
    expect(adapter.postParse({ rawContent: MARKDOWN_WRAPPED })?.json).toEqual({
      title: "hello",
      score: 0.9,
    });
  });

  it("postParse returns null on garbage", () => {
    expect(adapter.postParse({ rawContent: "not json" })).toBeNull();
  });
});

describe("JsonModeAdapter", () => {
  it("adapt() emits json_object response_format + system addon", () => {
    const out = new JsonModeAdapter().adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "r",
      modelId: "gpt-4o-mini",
    });
    expect(out.requestBodyPatch).toEqual({
      response_format: { type: "json_object" },
    });
    expect(out.systemPromptAddon).toContain("JSON object");
  });
});

describe("GeminiResponseSchemaAdapter", () => {
  it("adapt() puts responseSchema under generationConfig", () => {
    const out = new GeminiResponseSchemaAdapter().adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "r",
      modelId: "gemini-2.5-pro",
    });
    expect(out.requestBodyPatch).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: expect.any(Object),
      },
    });
  });

  it("strips $schema / additionalProperties (Gemini reject 这些字段)", () => {
    const noisySchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { x: { type: "string", format: "email" } },
      additionalProperties: false,
    };
    const out = new GeminiResponseSchemaAdapter().adapt({
      jsonSchema: noisySchema,
      schemaName: "r",
      modelId: "gemini-2.5-pro",
    });
    const rs = (
      out.requestBodyPatch.generationConfig as Record<string, unknown>
    ).responseSchema as Record<string, unknown>;
    expect(rs.$schema).toBeUndefined();
    expect(rs.additionalProperties).toBeUndefined();
    expect(rs.type).toBe("object");
  });
});

describe("GbnfGrammarAdapter (Llama.cpp / vLLM)", () => {
  it("adapt() includes grammar string + json_object hint", () => {
    const out = new GbnfGrammarAdapter().adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "r",
      modelId: "qwen2.5-7b",
    });
    expect(out.requestBodyPatch).toMatchObject({
      response_format: { type: "json_object" },
      grammar: expect.stringContaining("root"),
    });
  });
});

describe("PromptOnlyAdapter (last resort)", () => {
  const adapter = new PromptOnlyAdapter();

  it("adapt() embeds schema text into systemPromptAddon", () => {
    const out = adapter.adapt({
      jsonSchema: SAMPLE_SCHEMA,
      schemaName: "r",
      modelId: "deepseek-reasoner",
    });
    expect(out.requestBodyPatch).toEqual({});
    expect(out.systemPromptAddon).toContain("CRITICAL OUTPUT FORMAT");
    expect(out.systemPromptAddon).toContain("score");
  });

  it("postParse marks sanitized=true so caller knows it's best-effort", () => {
    const out = adapter.postParse({ rawContent: PROSE_PREFIX });
    expect(out?.json).toEqual({ title: "hello", score: 0.9 });
    expect(out?.sanitized).toBe(true);
  });
});

describe("NoneAdapter (无 structured output)", () => {
  it("adapt() empty patch", () => {
    expect(new NoneAdapter().adapt()).toEqual({ requestBodyPatch: {} });
  });

  it("postParse returns rawContent verbatim", () => {
    expect(new NoneAdapter().postParse({ rawContent: "free text" })?.json).toBe(
      "free text",
    );
  });
});

// ============================================================
// AiApiCallerService integration: verify requestBody per provider
// ============================================================

import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiApiCallerService } from "../../../providers/ai-api-caller.service";
import { OpenaiCaller } from "../../../providers/openai-caller";
import { AnthropicCaller } from "../../../providers/anthropic-caller";
import { CohereCaller } from "../../../providers/cohere-caller";
import { GoogleCaller } from "../../../providers/google-caller";
import { XaiCaller } from "../../../providers/xai-caller";

function makeHttpService(mockFn: jest.Mock): HttpService {
  return { post: mockFn } as unknown as HttpService;
}

// split 后各 provider 的 requestBody 构建在对应 caller；用真 caller 构造
// AiApiCallerService(委派路由到真 caller),requestBody 形状与拆分前一致。
function buildCaller(http: HttpService): AiApiCallerService {
  return new AiApiCallerService(
    new OpenaiCaller(http),
    new AnthropicCaller(http),
    new CohereCaller(http),
    new GoogleCaller(http),
    new XaiCaller(http),
  );
}

const BASE_MESSAGES = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Hello" },
];

describe("AiApiCallerService — OpenAI json_schema_strict via router", () => {
  it("callOpenAICompatibleAPI sends response_format.type=json_schema strict=true", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          choices: [
            {
              message: { content: '{"title":"hi","score":1}' },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    await caller.callOpenAICompatibleAPI(
      "https://api.openai.com/v1/chat/completions",
      "sk-test",
      "gpt-4o",
      BASE_MESSAGES,
      1000,
      0.0,
      30000,
      "max_tokens",
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      "json_schema_strict",
      SAMPLE_SCHEMA,
      "result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    const rf = body.response_format as Record<string, unknown>;
    expect(rf.type).toBe("json_schema");
    const js = rf.json_schema as Record<string, unknown>;
    expect(js.strict).toBe(true);
    expect(js.name).toBe("result");
  });
});

describe("AiApiCallerService — Anthropic tool_use via router", () => {
  it("callAnthropicAPI sends tools + tool_choice for tool_use strategy", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          content: [
            {
              type: "tool_use",
              name: "extract_result",
              input: { title: "hi", score: 1 },
            },
          ],
          usage: { input_tokens: 5, output_tokens: 5 },
          stop_reason: "tool_use",
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    const result = await caller.callAnthropicAPI(
      "https://api.anthropic.com/v1/messages",
      "sk-ant-test",
      "claude-3-5-sonnet",
      BASE_MESSAGES,
      1000,
      0.0,
      30000,
      undefined,
      undefined,
      undefined,
      "tool_use",
      SAMPLE_SCHEMA,
      "extract_result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toMatchObject({
      type: "tool",
      name: "extract_result",
    });
    // postParse: content should be the tool_use input serialised as JSON
    expect(JSON.parse(result.content)).toEqual({ title: "hi", score: 1 });
  });
});

describe("AiApiCallerService — Anthropic native output_config via router", () => {
  it("callAnthropicAPI sends output_config.format + parses JSON from text block", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          content: [{ type: "text", text: '{"title":"hi","score":1}' }],
          usage: { input_tokens: 5, output_tokens: 5 },
          stop_reason: "end_turn",
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    const result = await caller.callAnthropicAPI(
      "https://api.anthropic.com/v1/messages",
      "sk-ant-test",
      "claude-opus-4-7",
      BASE_MESSAGES,
      1000,
      0.0,
      30000,
      undefined,
      undefined,
      undefined,
      "anthropic_output_config",
      SAMPLE_SCHEMA,
      "result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.output_config).toEqual({
      format: { type: "json_schema", schema: SAMPLE_SCHEMA },
    });
    // native 不写 tools/tool_choice
    expect(body.tools).toBeUndefined();
    // postParse: JSON 直出在 text block
    expect(JSON.parse(result.content)).toEqual({ title: "hi", score: 1 });
  });
});

describe("AiApiCallerService — Gemini responseSchema via router", () => {
  it("callGoogleAPI merges responseMimeType + responseSchema into generationConfig", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          candidates: [
            {
              content: { parts: [{ text: '{"title":"hi","score":1}' }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    await caller.callGoogleAPI(
      "https://generativelanguage.googleapis.com/v1beta",
      "goog-test",
      "gemini-2.0-flash",
      BASE_MESSAGES,
      1000,
      0.0,
      30000,
      undefined,
      undefined,
      "gemini_response_schema",
      SAMPLE_SCHEMA,
      "result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    const gc = body.generationConfig as Record<string, unknown>;
    expect(gc.responseMimeType).toBe("application/json");
    expect(gc.responseSchema).toBeDefined();
    expect((gc.responseSchema as Record<string, unknown>).type).toBe("object");
  });
});

describe("AiApiCallerService — xAI json_schema_strict via router", () => {
  it("callXAIAPI sends response_format.type=json_schema strict=true", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          choices: [
            {
              message: { content: '{"title":"hi","score":1}' },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    await caller.callXAIAPI(
      "https://api.x.ai/v1/chat/completions",
      "xai-test",
      "grok-3",
      BASE_MESSAGES,
      1000,
      0.0,
      30000,
      "max_tokens",
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      "json_schema_strict",
      SAMPLE_SCHEMA,
      "result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    const rf = body.response_format as Record<string, unknown>;
    expect(rf.type).toBe("json_schema");
    const js = rf.json_schema as Record<string, unknown>;
    expect(js.strict).toBe(true);
  });
});

describe("AiApiCallerService — prompt-only strategy injects system addon", () => {
  it("callOpenAICompatibleAPI prepends systemPromptAddon for prompt strategy", async () => {
    const mockPost = jest.fn().mockReturnValue(
      of({
        data: {
          choices: [
            {
              message: { content: '{"title":"hi","score":1}' },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        },
      }),
    );
    const caller = buildCaller(makeHttpService(mockPost));
    await caller.callOpenAICompatibleAPI(
      "https://api.openai.com/v1/chat/completions",
      "sk-test",
      "gpt-4o",
      BASE_MESSAGES,
      1000,
      undefined,
      30000,
      "max_tokens",
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      "prompt",
      SAMPLE_SCHEMA,
      "result",
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    const msgs = body.messages as Array<{ role: string; content: string }>;
    const sysMsg = msgs.find((m) => m.role === "system");
    expect(sysMsg?.content).toContain("CRITICAL OUTPUT FORMAT");
    expect(sysMsg?.content).toContain("score");
  });
});

describe("Cross-adapter: 多种 LLM 异常输出兜底", () => {
  const adapter = new JsonSchemaStrictAdapter();

  it("尾随逗号也能 parse（LLM 输出 bug）", () => {
    expect(
      adapter.postParse({ rawContent: '{"title":"x","score":1,}' })?.json,
    ).toEqual({ title: "x", score: 1 });
  });

  it("数组 root 也能 parse", () => {
    expect(adapter.postParse({ rawContent: '[{"a":1}]' })?.json).toEqual([
      { a: 1 },
    ]);
  });

  it("空对象", () => {
    expect(adapter.postParse({ rawContent: "{}" })?.json).toEqual({});
  });

  it("嵌套对象", () => {
    expect(
      adapter.postParse({ rawContent: '{"a":{"b":{"c":42}}}' })?.json,
    ).toEqual({ a: { b: { c: 42 } } });
  });
});
