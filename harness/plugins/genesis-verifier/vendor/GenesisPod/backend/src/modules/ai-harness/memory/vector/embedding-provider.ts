/**
 * IEmbeddingProvider —— Harness 内向量化抽象
 *
 * 业务方注入实现：
 *   - OpenAI text-embedding-3-small (1536d)
 *   - Cohere embed-v3 (1024d)
 *   - Sentence-transformer 本地（384d）
 *
 * 默认实现 NoopEmbeddingProvider 返回零向量（兼容测试 / 不接 RAG 的轻量场景）。
 */

export interface IEmbeddingProvider {
  readonly id: string;
  readonly dim: number;
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export class NoopEmbeddingProvider implements IEmbeddingProvider {
  readonly id = "noop";
  readonly dim: number;

  constructor(dim = 8) {
    this.dim = dim;
  }

  async embed(text: string): Promise<readonly number[]> {
    // 简易 hash → 伪向量（仅用于测试 / 占位；非真实语义相似）
    const v = new Array(this.dim).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      v[i % this.dim] = (v[i % this.dim] + text.charCodeAt(i)) % 1000;
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / norm);
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
