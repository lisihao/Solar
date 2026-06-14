/**
 * Tool Test Result Analyzer
 *
 * 把 testTool 内部的"工具执行结果深挖"逻辑抽出来，让 ai-admin.service.ts
 * 不再因 +80 行触发 god-class size guard。
 *
 * 关键判断：
 *  - 工具内部可能返 {success:false, error:"..."} 而非 throw（Serper credits
 *    耗尽 / Tavily 限流），原 testTool 只看是否 throw，会误报"测试通过"
 *  - 探测多种"0 结果"数组字段（results / papers / items / data / documents
 *    / matches），test query 是常用词理论应 ≥1 → 0 结果视为 degraded
 */

/** testTool 内部对工具 result 的结构化诊断结论 */
export interface ToolResultAnalysis {
  /** 工具内部显式 success=false */
  explicitFail: boolean;
  /** 从 result.error / result.errorMessage 提取的错误描述 */
  errorFromResult: string | undefined;
  /** 命中的"0 结果"字段描述，如 "results=[]" */
  emptyResultsHint: string | null;
  /** 实际返回的条目数（找到第一个数组字段返其长度，否则 1） */
  resultCount: number;
}

/** 探测的"返 0 条"数组字段顺序（按常见 search/academic API 约定） */
const ITEM_ARRAY_KEYS = [
  "results",
  "papers",
  "items",
  "data",
  "documents",
  "matches",
] as const;

/**
 * 深挖工具 execute 返回的对象，识别软失败 / degraded / 正常三态。
 * 纯函数，0 副作用，便于 spec 单测。
 */
export function analyzeToolResult(result: unknown): ToolResultAnalysis {
  const resultObj = (result ?? {}) as Record<string, unknown>;

  const explicitFail = resultObj.success === false;

  const errorFromResult =
    typeof resultObj.error === "string"
      ? resultObj.error
      : typeof resultObj.errorMessage === "string"
        ? resultObj.errorMessage
        : undefined;

  let emptyResultsHint: string | null = null;
  for (const k of ITEM_ARRAY_KEYS) {
    const v = resultObj[k];
    if (Array.isArray(v) && v.length === 0) {
      emptyResultsHint = `${k}=[]`;
      break;
    }
  }

  let resultCount = 1;
  for (const k of ITEM_ARRAY_KEYS) {
    const v = resultObj[k];
    if (Array.isArray(v)) {
      resultCount = v.length;
      break;
    }
  }
  if (resultCount === 1 && Array.isArray(result)) {
    resultCount = result.length;
  }

  return { explicitFail, errorFromResult, emptyResultsHint, resultCount };
}
