/**
 * Function Calling LLM Protocol — engine 层抽象（2026-04-30 抽出）
 *
 * 此文件原定义在 ai-harness/runner/executor/function-calling-executor.ts 中。
 * 由于 fc-executor 是 L2.5 runtime executor 应搬至 ai-harness，但 llm-adapter
 * 实现 ILLMAdapter 接口需留在 engine 层（避免反向依赖），故抽出共享协议接口
 * 留在 engine/llm/abstractions/，供：
 *   - ai-engine/llm/adapters/function-calling-llm.adapter.ts（实现端，留 engine）
 *   - ai-harness/runner/...（消费端，使用端）
 * 双向 import 而不引发反向依赖。
 */

import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import type { TaskProfile } from "../types";

/**
 * LLM 消息格式（function calling 协议）
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

/**
 * LLM 请求选项
 */
export interface LLMRequestOptions {
  messages: LLMMessage[];
  functions?: FunctionDefinition[];
  tools?: Array<{
    type: "function";
    function: FunctionDefinition;
  }>;
  function_call?: "auto" | "none" | { name: string };
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** TaskProfile for semantic parameter mapping */
  taskProfile?: TaskProfile;
}

/**
 * LLM 响应格式
 */
export interface LLMResponse {
  content: string | null;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  finishReason?: "stop" | "function_call" | "tool_calls" | "length";
}

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

/**
 * LLM 适配器接口（用于 fc-executor 与具体 LLM provider 解耦）
 */
export interface ILLMAdapter {
  readonly provider: string;
  formatTools(functions: FunctionDefinition[]): unknown;
  parseToolCalls(response: LLMResponse): ToolCallRequest[];
  buildToolResultMessage(
    toolCallId: string,
    toolName: string,
    result: unknown,
  ): LLMMessage;
  chat(options: LLMRequestOptions): Promise<LLMResponse>;
}

