/**
 * 余弦相似度——纯函数，无依赖，便于单测。
 */

/**
 * 余弦相似度 ∈ [-1, 1]。维度不一致或零向量 → 0（安全降级，不抛错）。
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
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

/**
 * 把余弦相似度 [-1,1] 归一到 [0,1]，再缩放到给定满分。
 * 路由场景里 relevance 是主信号，满分应高于其它信号（默认 40）。
 */
export function relevanceScore(cosine: number, fullMark = 40): number {
  const normalized = (cosine + 1) / 2; // [-1,1] → [0,1]
  return Math.round(normalized * fullMark * 100) / 100;
}
