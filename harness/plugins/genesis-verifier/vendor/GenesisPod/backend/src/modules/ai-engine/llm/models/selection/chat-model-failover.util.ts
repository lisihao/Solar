/**
 * chat-model-failover.util — AiChatService.chat() 的 BYOK 模型级 failover 逻辑
 *
 * 从 ai-chat.service.ts 抽出（god-class 不再膨胀）。当 caller 未显式指定 model 且
 * 有 userId 时，默认模型所属 provider 失败（无 key / key 失效 / quota / 5xx / 超时 /
 * 模型不存在）则自动改用用户下一个可用模型重试。loop 层显式传 model 的调用不进这里
 * （ai-chat.service.chat() 已短路），故与 loop 层 failover 不重复。
 */

import { AIModelType } from "@prisma/client";
import {
  isModelLevelFailoverError,
  MAX_MODEL_FAILOVERS,
} from "./model-failover.classifier";
import type { AiModelConfigService } from "../config/ai-model-config.service";
// 仅类型导入（运行时擦除）→ 不与 ai-chat.service 形成运行时循环依赖。
import type { ChatOptions, ChatResult } from "../../chat/ai-chat.service";

/**
 * 从错误消息抽 provider 名累积到 failedProviders。失败的 provider 会让
 * listUserEnabledModelsByType 一次跳过它名下全部模型，避免在失效 provider 上逐个试。
 * 形如 `No API Key available for provider "xai"` / `provider xai` 均可匹配。
 */
export function accumulateFailedProvider(
  message: string,
  failedProviders: string[],
): void {
  const m = /provider\s+"?([a-z0-9_-]+)"?/i.exec(message);
  const provider = m?.[1]?.toLowerCase();
  if (provider && !failedProviders.includes(provider)) {
    failedProviders.push(provider);
  }
}

/**
 * 软失败（chatOnce 返回 isError 而非 throw）是否属于模型级、应触发 failover。
 * guardrail 拦截（content 以安全提示开头）不算模型问题，原样返回不 failover。
 */
export function isModelLevelSoftError(content: string | undefined): boolean {
  const text = content ?? "";
  if (
    text.startsWith("Request blocked by content safety guardrail") ||
    text.startsWith("Response filtered by content safety guardrail")
  ) {
    return false;
  }
  return isModelLevelFailoverError(new Error(text));
}

export interface ChatFailoverDeps {
  /** 单次 chat 执行（AiChatService.chatOnce 的绑定）。 */
  readonly chatOnce: (options: ChatOptions) => Promise<ChatResult>;
  readonly modelConfigService: Pick<
    AiModelConfigService,
    "listUserEnabledModelsByType"
  >;
}

/**
 * 带 BYOK 模型级 failover 的 chat 执行。调用方（AiChatService.chat）已确保
 * userId 存在且未显式指定 model。
 */
export async function runChatWithModelFailover(
  options: ChatOptions,
  userId: string,
  deps: ChatFailoverDeps,
): Promise<ChatResult> {
  const modelType = options.modelType ?? AIModelType.CHAT;
  const failedModels: string[] = [];
  const failedProviders: string[] = [];
  // 首次让 chatOnce 自己解析用户默认模型（currentModel 为空）。
  let currentModel: string | undefined = undefined;
  let lastError: unknown;

  const advanceModel = async (failedModel?: string): Promise<boolean> => {
    if (failedModel) failedModels.push(failedModel);
    const next = await deps.modelConfigService.listUserEnabledModelsByType(
      userId,
      modelType,
      failedModels,
      failedProviders,
    );
    const candidate = next[0];
    if (candidate && candidate.modelId !== currentModel) {
      currentModel = candidate.modelId;
      return true;
    }
    return false;
  };

  for (let attempt = 0; attempt <= MAX_MODEL_FAILOVERS; attempt++) {
    try {
      const result = await deps.chatOnce(
        currentModel ? { ...options, model: currentModel } : options,
      );
      // chatOnce 没抛但可能返回 isError 软失败（非严格模式）。
      if (
        result.isError &&
        attempt < MAX_MODEL_FAILOVERS &&
        isModelLevelSoftError(result.content)
      ) {
        accumulateFailedProvider(result.content, failedProviders);
        if (await advanceModel(currentModel)) continue;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_MODEL_FAILOVERS && isModelLevelFailoverError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        accumulateFailedProvider(msg, failedProviders);
        if (await advanceModel(currentModel)) continue;
      }
      throw err;
    }
  }

  // 兜底：循环耗尽（理论上不可达，continue 才进入下一轮）。
  if (lastError) throw lastError;
  return deps.chatOnce(options);
}
