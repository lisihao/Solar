'use client';

/**
 * StructuredOutputCapabilitySection
 *
 * Admin AI Model 编辑表单中"Structured Output Capability"折叠区。从
 * AIModelSettings.tsx 抽出独立组件，避免 god-class size 越线。
 *
 * 字段：structuredOutputStrategy / fallbackStrategies / 5 个 supports* boolean。
 * 留空 strategy = 运行时按 provider slug 自动推断（StructuredOutputRouter）。
 */

export interface StructuredOutputCapabilityValue {
  structuredOutputStrategy?: string | null;
  fallbackStrategies?: string[];
  supportsJsonSchemaStrict?: boolean;
  supportsJsonSchema?: boolean;
  supportsToolUse?: boolean;
  supportsJsonMode?: boolean;
  supportsGbnfGrammar?: boolean;
}

interface Props {
  value: StructuredOutputCapabilityValue;
  onChange: (patch: Partial<StructuredOutputCapabilityValue>) => void;
}

const STRATEGY_OPTIONS: Array<[string, string]> = [
  ['', 'auto（按 provider 推断，留空）'],
  ['json_schema_strict', 'json_schema_strict（OpenAI / xAI strict mode）'],
  ['json_schema', 'json_schema（OpenAI / xAI，非 strict）'],
  ['tool_use', 'tool_use（Anthropic Tools API）'],
  ['json_mode', 'json_mode（response_format: json_object）'],
  ['gemini_response_schema', 'gemini_response_schema（Gemini responseSchema）'],
  ['gbnf_grammar', 'gbnf_grammar（Llama.cpp / vLLM GBNF）'],
  ['prompt', 'prompt（system prompt + post-parse 兜底）'],
  ['none', 'none（禁用，直返文本）'],
];

const SUPPORTS_FIELDS: Array<
  [
    keyof Pick<
      StructuredOutputCapabilityValue,
      | 'supportsJsonSchemaStrict'
      | 'supportsJsonSchema'
      | 'supportsToolUse'
      | 'supportsJsonMode'
      | 'supportsGbnfGrammar'
    >,
    string,
    string,
  ]
> = [
  [
    'supportsJsonSchemaStrict',
    'JSON Schema Strict',
    'OpenAI / xAI strict mode',
  ],
  ['supportsJsonSchema', 'JSON Schema', 'OpenAI / xAI / DeepSeek'],
  ['supportsToolUse', 'Tool Use', 'Anthropic Tools API'],
  ['supportsJsonMode', 'JSON Mode', 'response_format: json_object'],
  ['supportsGbnfGrammar', 'GBNF Grammar', 'Llama.cpp / vLLM'],
];

export function StructuredOutputCapabilitySection({ value, onChange }: Props) {
  return (
    <details className="rounded-lg border border-violet-200 bg-violet-50">
      <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100">
        Structured Output Capability
      </summary>
      <div className="space-y-3 border-t border-violet-200 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            主策略 (structuredOutputStrategy)
          </label>
          <select
            value={value.structuredOutputStrategy ?? ''}
            onChange={(e) =>
              onChange({ structuredOutputStrategy: e.target.value || null })
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {STRATEGY_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            留空则运行时按 provider 自动推断；精确控制请显式选择。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            降级链 (fallbackStrategies)
          </label>
          <input
            type="text"
            value={(value.fallbackStrategies ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                fallbackStrategies: e.target.value
                  ? e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : [],
              })
            }
            placeholder="例: json_schema_strict, json_schema, json_mode, prompt"
            className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            逗号分隔，主策略失败时按顺序降级尝试。
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-gray-600">
            支持的格式（勾选即表示模型原生支持）
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTS_FIELDS.map(([field, label, hint]) => (
              <label
                key={field}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={value[field] === true}
                  onChange={(e) => onChange({ [field]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-gray-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
