/**
 * ★ Claude Code P0-2 借鉴：判断 assistant content 是否含未执行的 tool_use block
 *
 * 来源：Claude Code query.ts:553-557 注释明文：
 *   "stop_reason === 'tool_use' is unreliable — check content for unexecuted
 *    tool_use blocks instead."
 *
 * 适用场景：
 *   1. 原生 tool_use blocks（Anthropic Messages API 格式）
 *   2. 我们 ReAct JSON 协议：rawContent 含 tool_call/parallel_tool_call 意图但
 *      parseDecision 因 JSON 解析失败而 fallback 到 finalize —— 避免过早退出
 *
 * 纯函数，无副作用，无依赖注入。
 */

/**
 * Anthropic / OpenAI 原生 content block 的最小类型定义。
 *
 * 兼容两种协议：
 *   - Anthropic Messages API：type='tool_use', id='tool_use_xxx'
 *   - OpenAI function-calling：type='tool_use' with tool_call_id 或 id 字段
 */
export interface AssistantContentBlock {
  /** Block 类型 */
  type: "text" | "tool_use" | "tool_result" | "thinking" | string;
  /** tool_use block 的唯一 ID（Anthropic 格式）*/
  id?: string;
  /** tool_use block 的工具名称（诊断用） */
  name?: string;
  /** tool_use block 的输入（诊断用） */
  input?: Record<string, unknown>;
  /** tool_result block 对应的 tool_use_id */
  tool_use_id?: string;
  /** 文本内容（text / thinking block）*/
  content?: string | unknown;
}

/**
 * 判断给定的 assistant content block 列表中是否存在未执行的 tool_use block。
 *
 * 这是 Claude Code P0-2 借鉴的核心函数，对应 query.ts:553-557 的检测逻辑。
 * 在我们的系统中主要用于原生 tool_use block 格式（如 function-calling adapter）。
 *
 * @param assistantContent        - assistant 消息的 content blocks
 * @param executedToolResultIds   - 已执行完毕并返回 tool_result 的 tool_use_id 集合
 *
 * @returns true  = 存在至少一个未执行的 tool_use block → loop 应继续
 * @returns false = 所有 tool_use block 都已执行（或没有 tool_use block）
 *
 * @example
 * // LLM 返回 stop_reason='end_turn' 但 content 里仍有未执行 tool_use block
 * const blocks: AssistantContentBlock[] = [
 *   { type: 'text', content: 'Let me search.' },
 *   { type: 'tool_use', id: 'toolu_123', name: 'web_search', input: { q: 'foo' } },
 * ];
 * hasUnexecutedToolUse(blocks, []);           // → true（toolu_123 尚未执行）
 * hasUnexecutedToolUse(blocks, ['toolu_123']); // → false（已执行）
 */
export function hasUnexecutedToolUse(
  assistantContent: readonly AssistantContentBlock[],
  executedToolResultIds: readonly string[],
): boolean {
  if (!Array.isArray(assistantContent) || assistantContent.length === 0) {
    return false;
  }

  const executedSet = new Set<string>(executedToolResultIds);

  for (const block of assistantContent) {
    if (block.type === "tool_use") {
      const id = block.id;
      // tool_use block without id: conservative → treat as unexecuted
      if (!id || !executedSet.has(id)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * ★ ReAct JSON 协议专用：检测 rawContent（LLM 吐出的字符串）是否含工具调用意图，
 * 但 parseDecision 因 JSON 解析失败而 fallback 到了 finalize。
 *
 * 场景（对应 Claude Code query.ts "stop_reason unreliable" 的 JSON 协议版本）：
 *   - LLM 本意是 {"thinking":"...","action":{"kind":"tool_call","toolId":"..."}}
 *   - 但 JSON 截断 / markdown 围栏嵌套 / 多余字符 导致 extractJsonFromAIResponse 抽取失败
 *   - parseDecision catch 分支把 rawContent 当 finalize.output 塞入，loop 就此终止
 *   - 这是假终止：LLM 实际上想调工具，不想 finalize
 *
 * 判定规则（宽松匹配，宁可误判继续也不错过工具调用意图）：
 *   hasParseError = true          → parseDecision 出现了兜底
 *   rawContent 含 "tool_call"/"toolId"/"parallel_tool_call" 关键词  → LLM 想调工具
 *   两者同时成立  → 真正的"误判为 finalize"
 *
 * @param rawContent   - LLM 原始 content 字符串（reason() 返回的 rawContent）
 * @param hadParseError - parseDecision 是否返回了 parseError（≠ undefined）
 *
 * @returns true = 本次 finalize 是 parseDecision fallback 造成的假终止，loop 应重试
 * @returns false = LLM 是真正主动 finalize，可以退出
 */
export function rawContentHasUnexecutedToolIntent(
  rawContent: string,
  hadParseError: boolean,
): boolean {
  if (!hadParseError) {
    // parseDecision 成功（无兜底），遵从 LLM 的 finalize 决定
    return false;
  }

  if (!rawContent || rawContent.trim().length === 0) {
    return false;
  }

  // 宽松关键词检测：LLM 在 rawContent 里声明了工具调用意图
  const toolCallPatterns = [
    /"kind"\s*:\s*"tool_call"/,
    /"kind"\s*:\s*"parallel_tool_call"/,
    /"toolId"\s*:/,
    /"tool_use"/,
    // Anthropic 原生格式（通过 function-calling adapter 时）
    /"type"\s*:\s*"tool_use"/,
  ];

  return toolCallPatterns.some((pattern) => pattern.test(rawContent));
}

/**
 * 从 envelope messages 中提取 assistant 消息里的 tool_use block IDs
 * 以及所有 tool_result block 里已返回的 tool_use_id（原生格式支持）。
 *
 * @param messages - IContextMessage 数组（来自 envelope.messages）
 */
export function extractToolUseState(
  messages: ReadonlyArray<{
    role: string;
    content: string | readonly AssistantContentBlock[] | unknown;
  }>,
): {
  /** assistant 消息中出现过的所有 tool_use IDs */
  pendingToolUseIds: string[];
  /** tool / tool_result 消息中出现过的所有 tool_use_id（已返回结果） */
  executedToolResultIds: string[];
} {
  const pendingToolUseIds: string[] = [];
  const executedToolResultIds: string[] = [];

  for (const msg of messages) {
    const content = msg.content;

    // content 是 block 数组（Anthropic 原生格式）
    if (Array.isArray(content)) {
      for (const block of content as AssistantContentBlock[]) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "tool_use" && typeof block.id === "string") {
          if (msg.role === "assistant") {
            pendingToolUseIds.push(block.id);
          }
        }
        if (
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          executedToolResultIds.push(block.tool_use_id);
        }
      }
    }
    // 字符串 content：我们的 ReAct 协议用 JSON 字符串，工具调用追踪通过
    // rawContentHasUnexecutedToolIntent() 处理，不在此处理。
  }

  return { pendingToolUseIds, executedToolResultIds };
}

/**
 * 便捷函数：给定 envelope messages，判断是否有待执行的原生 tool_use block。
 *
 * 主要用于 function-calling adapter 路径（原生 tool_use blocks 格式）。
 *
 * @param messages - envelope.messages
 * @returns true = 有未执行的 tool_use，loop 应继续；false = 可以退出
 */
export function envelopeHasUnexecutedToolUse(
  messages: ReadonlyArray<{
    role: string;
    content: string | readonly AssistantContentBlock[] | unknown;
  }>,
): boolean {
  const { pendingToolUseIds, executedToolResultIds } =
    extractToolUseState(messages);

  if (pendingToolUseIds.length === 0) return false;

  const executedSet = new Set(executedToolResultIds);
  return pendingToolUseIds.some((id) => !executedSet.has(id));
}
