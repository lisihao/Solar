/**
 * IResultFusion —— 多源 tool 结果融合
 *
 * Topic Insights 多数据源场景：
 *   parallel call [google, bing, duckduckgo] → 合并去重 → 按 source 权重排序
 *   → 取 top-K → 喂给 LLM
 *
 * 本接口让融合逻辑可插拔。Harness 在 ToolInvoker.invokeMany 后调用 fusion。
 */

export interface FusionInput {
  /** key = toolId, value = 该 tool 的输出（任意 shape） */
  readonly results: ReadonlyMap<string, unknown>;
  /** 业务自定义 hint（语言 / 时间窗口 / 信任源 ...） */
  readonly hints?: Record<string, unknown>;
}

export interface FusionOutput<T = unknown> {
  /** 融合后的统一结果 */
  readonly merged: readonly T[];
  /** 总贡献条目数（去重前） */
  readonly totalRaw: number;
  /** 去重后保留条目数 */
  readonly totalDeduped: number;
  /** 每个 source 的贡献统计 */
  readonly bySource?: ReadonlyMap<string, number>;
}

export interface IResultFusion<T = unknown> {
  readonly id: string;
  fuse(input: FusionInput): Promise<FusionOutput<T>> | FusionOutput<T>;
}

/**
 * SimpleConcatFusion —— 默认实现：直接 flatten + dedup-by-JSON-string。
 *
 * **已知局限**（业务方注意）：
 *   - dedup 用 JSON.stringify 当 key，字段顺序敏感：
 *     `{a:1,b:2}` 与 `{b:2,a:1}` 被视为不同条目，不会去重
 *   - 不感知"语义等价"（同 URL 不同协议 / 同名不同 case）
 *
 * 真实搜索 / 检索场景请实现自己的 IResultFusion，按 URL / id / hash 字段 dedup。
 * 本实现仅适合"所有 source 用相同 schema"的最简场景。
 */
export class SimpleConcatFusion implements IResultFusion {
  readonly id = "concat";
  fuse(input: FusionInput): FusionOutput {
    let totalRaw = 0;
    const seen = new Set<string>();
    const merged: unknown[] = [];
    const bySource = new Map<string, number>();
    for (const [source, raw] of input.results) {
      if (raw == null) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      let kept = 0;
      for (const item of list) {
        totalRaw += 1;
        let key: string;
        try {
          key = JSON.stringify(item);
        } catch {
          key = String(item);
        }
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        kept += 1;
      }
      bySource.set(source, kept);
    }
    return {
      merged,
      totalRaw,
      totalDeduped: merged.length,
      bySource,
    };
  }
}
