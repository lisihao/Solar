/**
 * Leader JSON 提取工具
 *
 * 从 AI 响应中提取 JSON，带诊断日志。
 * 供所有 Leader 子服务共用，消除代码重复。
 */

import { Logger } from "@nestjs/common";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";

/**
 * 从 AI 响应中提取 JSON
 * 使用增强的 extractJsonFromAIResponse 工具，支持截断响应修复
 */
export function extractJsonFromResponse<T>(
  response: string,
  logger: Logger,
  requiredKey?: string,
): T | null {
  // 处理空响应
  if (!response || response.trim().length === 0) {
    logger.warn("[extractJsonFromResponse] Empty response received");
    return null;
  }

  // ★ 诊断：先尝试直接 JSON.parse，记录具体错误
  try {
    JSON.parse(response);
  } catch (directError) {
    logger.warn(
      `[extractJsonFromResponse] Direct JSON.parse error (len=${response.length}): ${directError instanceof SyntaxError ? directError.message : "unknown"}`,
    );
  }

  const result = extractJsonFromAIResponse<T>(response, { requiredKey });

  if (result.success && result.data) {
    logger.debug(
      `[extractJsonFromResponse] Extracted via method: ${result.method}`,
    );
    return result.data;
  }

  logger.error(
    `[extractJsonFromResponse] Could not extract JSON: ${result.error || "unknown error"}`,
  );
  return null;
}
