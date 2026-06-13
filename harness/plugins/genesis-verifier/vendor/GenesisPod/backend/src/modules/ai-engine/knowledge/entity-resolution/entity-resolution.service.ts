/**
 * AI Engine - Entity Resolution Service
 * 实体消歧 / 去重服务（通用基元，零 agent/mission 状态）
 *
 * 用途：把一批原始实体名（可能含同义、跨语言、缩写、法律后缀差异）归并为
 * canonical 实体簇。典型：把 "NVIDIA" / "英伟达" / "Nvidia Corp" 识别为同一公司。
 *
 * 设计：
 *   1. 先做归一化精确去重（lowercase + trim + 折叠空白）——零成本短路。
 *   2. 用 EmbeddingService（taskType='similarity'）取向量，服务内自实现 cosine。
 *   3. 贪心聚类：每个名字与已有簇质心比较，cosine >= threshold 则并入，否则新建簇。
 *
 * 阈值 0.85 为初始值，需按所用 embedding 模型的实际分布校准（留 options.threshold 调参入口）。
 *
 * 多消费方：research / insight / library knowledge-graph 均可复用，
 * 故下沉 ai-engine/knowledge（非任一 app 模块）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { EmbeddingService } from "../../rag/embedding";

export interface EntityResolutionOptions {
  /** cosine 相似度合并阈值，默认 0.85（初始值，需按 embedding 模型校准） */
  threshold?: number;
}

export interface EntityCluster {
  /** 簇的代表名（取最长成员，保留最完整法律名） */
  canonical: string;
  /** 簇内全部原始名（去重后） */
  members: string[];
}

export interface EntityResolutionResult {
  clusters: EntityCluster[];
  /** 原始名（原样）→ canonical 的映射，供调用方把抽取的实体名解析为代表名 */
  canonicalOf: Record<string, string>;
}

const DEFAULT_THRESHOLD = 0.85;

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(private readonly embeddingService: EmbeddingService) {}

  /**
   * 把一批实体名归并为 canonical 簇。
   * @param names 原始实体名（可重复、可含同义/跨语言）
   */
  async resolve(
    names: string[],
    options?: EntityResolutionOptions,
  ): Promise<EntityResolutionResult> {
    const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

    // ── 0. 收集原始名 + 归一化精确去重 ──────────────────────────────────────
    const originals = names.filter((n) => typeof n === "string" && n.trim());
    if (originals.length === 0) {
      return { clusters: [], canonicalOf: {} };
    }

    // 归一化 key → 该 key 下出现过的原始名集合（保序去重）
    const normToOriginals = new Map<string, string[]>();
    for (const name of originals) {
      const key = this.normalize(name);
      const arr = normToOriginals.get(key) ?? [];
      if (!arr.includes(name)) arr.push(name);
      normToOriginals.set(key, arr);
    }
    const uniqueKeys = Array.from(normToOriginals.keys());

    // 单一实体短路：无需调用 embedding
    if (uniqueKeys.length === 1) {
      const members = normToOriginals.get(uniqueKeys[0]) ?? [];
      return this.buildResult([members]);
    }

    // ── 1. 取向量（similarity 编码空间）──────────────────────────────────────
    // 用归一化后的 key 作为 embedding 文本（同一 key 已合并，省 token）
    const batch = await this.embeddingService.generateEmbeddings(uniqueKeys, {
      taskType: "similarity",
    });
    const embeddings = batch.embeddings;
    if (!embeddings || embeddings.length !== uniqueKeys.length) {
      // embedding 不可用 → 退化为仅精确去重（不误并）
      this.logger.warn("[resolve] embedding 缺失/数量不匹配，退化为仅精确去重");
      return this.buildResult(uniqueKeys.map((k) => normToOriginals.get(k)!));
    }

    // ── 2. 贪心聚类（与簇质心比较）─────────────────────────────────────────
    interface Cluster {
      keyIndices: number[];
      centroid: number[];
    }
    const clusters: Cluster[] = [];

    for (let i = 0; i < uniqueKeys.length; i++) {
      const vec = embeddings[i];
      let bestCluster: Cluster | null = null;
      let bestSim = -1;
      for (const c of clusters) {
        const sim = EntityResolutionService.cosineSimilarity(vec, c.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      if (bestCluster && bestSim >= threshold) {
        bestCluster.keyIndices.push(i);
        this.updateCentroid(
          bestCluster.centroid,
          vec,
          bestCluster.keyIndices.length,
        );
      } else {
        clusters.push({ keyIndices: [i], centroid: [...vec] });
      }
    }

    // ── 3. 组装结果（簇内 key → 原始名展开）────────────────────────────────
    const memberGroups = clusters.map((c) =>
      c.keyIndices.flatMap((idx) => normToOriginals.get(uniqueKeys[idx]) ?? []),
    );
    return this.buildResult(memberGroups);
  }

  /** 归一化：小写 + trim + 折叠内部空白（不剥离后缀，避免误并）。 */
  private normalize(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /** 增量更新质心（在线均值）。 */
  private updateCentroid(
    centroid: number[],
    vec: number[],
    count: number,
  ): void {
    for (let d = 0; d < centroid.length; d++) {
      centroid[d] += (vec[d] - centroid[d]) / count;
    }
  }

  /** 由成员分组组装最终结果（canonical = 最长成员）。 */
  private buildResult(memberGroups: string[][]): EntityResolutionResult {
    const clusters: EntityCluster[] = [];
    const canonicalOf: Record<string, string> = {};
    for (const members of memberGroups) {
      if (members.length === 0) continue;
      const canonical = members.reduce((a, b) => (b.length > a.length ? b : a));
      clusters.push({ canonical, members });
      for (const m of members) canonicalOf[m] = canonical;
    }
    return { clusters, canonicalOf };
  }

  /** 余弦相似度（自实现；EmbeddingService 只产向量，不提供比较）。 */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
