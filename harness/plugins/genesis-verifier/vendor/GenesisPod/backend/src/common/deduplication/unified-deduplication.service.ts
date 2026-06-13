import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";

/**
 * 去重结果
 */
export interface DeduplicationResult {
  isDuplicate: boolean;
  duplicateId?: string;
  similarity?: number;
  method?: string;
  action: "created" | "merged" | "skipped";
  reason?: string;
}

/**
 * 质量评估结果
 */
export interface QualityAssessment {
  sourceCredibility: number;
  contentCompleteness: number;
  freshnessScore: number;
  citationCount: number;
  overallScore: number;
}

/**
 * 去重检测项
 */
export interface DeduplicationItem {
  url: string;
  title: string;
  content?: string;
  authors?: string[];
  publishedAt?: Date;
}

/**
 * 去重指纹集
 */
export interface DeduplicationFingerprints {
  normalizedUrl: string;
  urlHash: string;
  titleHash: string;
  titleFingerprint: string;
  contentFingerprint: string | null;
  simHash: string | null;
  authorTimeKey: string | null;
}

/**
 * 统一去重服务
 *
 * 整合以下功能：
 * 1. URL 规范化 - 统一 URL 格式，移除追踪参数
 * 2. 内容哈希指纹 - SHA256/MD5 精确匹配
 * 3. SimHash 相似度检测 - 识别高度相似内容
 * 4. 标题相似度 - Levenshtein/Jaccard 距离
 * 5. 作者+时间去重 - 学术论文专用
 * 6. 质量评估 - 来源可信度、内容完整度评分
 *
 * 去重层次（渐进式）：
 * - 第1层：URL 精确匹配（最快）
 * - 第2层：标题相似度匹配
 * - 第3层：内容 SimHash 指纹匹配
 * - 第4层：作者+发布时间匹配（学术论文）
 */
@Injectable()
export class UnifiedDeduplicationService {
  private readonly logger = new Logger(UnifiedDeduplicationService.name);

  private readonly sourceCredibilityMap: Record<string, number> = {
    arxiv: 95,
    semantic_scholar: 90,
    ieee: 90,
    acm: 90,
    github: 85,
    hackernews: 70,
    techcrunch: 75,
    medium: 60,
    devto: 60,
    blog: 50,
    rss: 55,
    unknown: 30,
  };

  private readonly trackingParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "msclkid",
    "wbraid",
    "gbraid",
    "ref",
    "referrer",
    "source",
    "_ga",
  ];

  // ============================================================================
  // URL 规范化
  // ============================================================================

  /**
   * 规范化 URL
   * - 转换为小写
   * - 移除 www 子域
   * - 移除追踪参数
   * - 排序查询参数
   * - 移除 URL 片段
   * - 移除末尾斜杠
   * - 平台特定规范化（arXiv, GitHub, YouTube）
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // 转换为小写
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.pathname = parsed.pathname.toLowerCase();
      parsed.protocol = parsed.protocol.toLowerCase();

      // 移除 www 子域
      if (parsed.hostname.startsWith("www.")) {
        parsed.hostname = parsed.hostname.replace(/^www\./, "");
      }

      // 移除 URL 片段
      parsed.hash = "";

      // 平台特定处理
      const platformNormalized = this.normalizePlatformUrl(parsed);
      if (platformNormalized) {
        return platformNormalized;
      }

      // 移除追踪参数并排序
      const cleanParams = new URLSearchParams();
      const sortedParams: [string, string][] = [];

      for (const [key, value] of parsed.searchParams) {
        if (!this.trackingParams.includes(key.toLowerCase())) {
          sortedParams.push([key, value]);
        }
      }

      sortedParams.sort((a, b) => a[0].localeCompare(b[0]));
      sortedParams.forEach(([key, value]) => cleanParams.append(key, value));
      parsed.search = cleanParams.toString();

      let normalized = parsed.toString();

      // 移除末尾斜杠（除非是根路径）
      if (normalized.endsWith("/") && parsed.pathname !== "/") {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch (error) {
      this.logger.warn(`Failed to normalize URL ${url}: ${String(error)}`);
      return url.toLowerCase().trim();
    }
  }

  /**
   * 平台特定 URL 规范化
   */
  private normalizePlatformUrl(parsed: URL): string | null {
    const hostname = parsed.hostname;

    // arXiv
    if (hostname.includes("arxiv.org")) {
      const match = parsed.pathname.match(/(?:abs|pdf)\/(\d+\.\d+)/);
      if (match) {
        return `https://arxiv.org/abs/${match[1]}`;
      }
    }

    // GitHub - 规范化仓库 URL
    if (
      hostname.includes("github.com") &&
      !parsed.pathname.includes("/blob/") &&
      !parsed.pathname.includes("/issues/") &&
      !parsed.pathname.includes("/pull/")
    ) {
      const match = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
      if (match) {
        return `https://github.com/${match[1]}/${match[2]}`;
      }
    }

    // YouTube - 统一视频 URL 格式
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      let videoId: string | null = null;

      if (hostname.includes("youtu.be")) {
        videoId = parsed.pathname.slice(1);
      } else if (parsed.pathname.includes("/watch")) {
        videoId = parsed.searchParams.get("v");
      } else if (parsed.pathname.includes("/shorts/")) {
        const match = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        videoId = match ? match[1] : null;
      } else if (parsed.pathname.includes("/embed/")) {
        const match = parsed.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        videoId = match ? match[1] : null;
      }

      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    return null;
  }

  /**
   * 提取域名
   */
  extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }

  /**
   * 检测两个 URL 是否指向同一资源
   */
  isSameUrl(url1: string, url2: string): boolean {
    try {
      return this.normalizeUrl(url1) === this.normalizeUrl(url2);
    } catch {
      return false;
    }
  }

  // ============================================================================
  // 哈希与指纹计算
  // ============================================================================

  /**
   * 计算 URL 的 MD5 哈希
   */
  computeUrlHash(url: string): string {
    return createHash("md5").update(this.normalizeUrl(url)).digest("hex");
  }

  /**
   * 计算内容的 SHA256 哈希（精确匹配）
   */
  computeContentHash(content: string): string {
    return createHash("sha256").update(content, "utf-8").digest("hex");
  }

  /**
   * 计算标题指纹
   */
  computeTitleFingerprint(title: string): string {
    if (!title || title.length < 5) return "";
    const normalized = title
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, "")
      .trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  /**
   * 计算内容指纹（用于相似度匹配）
   */
  computeContentFingerprint(content: string): string {
    if (!content || content.length < 50) return "";
    const normalized = content
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .sort()
      .slice(0, 100)
      .join(" ");
    return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  }

  /**
   * 计算 SimHash 指纹（64位）
   * 用于检测相似内容
   */
  computeSimHash(content: string): string {
    if (!content || content.length === 0) {
      return "0".repeat(16);
    }

    // 分词
    const words = content
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) {
      return "0".repeat(16);
    }

    // 初始化64位向量
    const vector = new Array(64).fill(0);

    // 对每个词计算哈希并累加
    for (const word of words) {
      const hash = createHash("md5").update(word).digest("hex");
      const hashBigInt = BigInt("0x" + hash.substring(0, 16));

      for (let i = 0; i < 64; i++) {
        const bit = (hashBigInt >> BigInt(i)) & BigInt(1);
        vector[i] += bit === BigInt(1) ? 1 : -1;
      }
    }

    // 生成64位指纹
    let fingerprint = BigInt(0);
    for (let i = 0; i < 64; i++) {
      if (vector[i] > 0) {
        fingerprint |= BigInt(1) << BigInt(i);
      }
    }

    return fingerprint.toString(16).padStart(16, "0");
  }

  /**
   * 计算海明距离
   */
  calculateHammingDistance(fp1: string, fp2: string): number {
    try {
      const int1 = BigInt("0x" + fp1);
      const int2 = BigInt("0x" + fp2);
      let xor = int1 ^ int2;
      let distance = 0;

      while (xor > BigInt(0)) {
        distance += Number(xor & BigInt(1));
        xor >>= BigInt(1);
      }

      return distance;
    } catch (error) {
      this.logger.error(
        `Failed to calculate hamming distance: ${String(error)}`,
      );
      return 64;
    }
  }

  /**
   * 基于 SimHash 判断内容是否相似
   */
  areContentsSimilar(
    content1: string,
    content2: string,
    threshold = 3,
  ): boolean {
    const fp1 = this.computeSimHash(content1);
    const fp2 = this.computeSimHash(content2);
    return this.calculateHammingDistance(fp1, fp2) <= threshold;
  }

  /**
   * 基于指纹判断是否相似
   */
  areFingerprintsSimilar(fp1: string, fp2: string, threshold = 3): boolean {
    return this.calculateHammingDistance(fp1, fp2) <= threshold;
  }

  // ============================================================================
  // 标题相似度
  // ============================================================================

  /**
   * 计算 Levenshtein 距离
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
        }
      }
    }

    return dp[m][n];
  }

  /**
   * 计算标题相似度（Levenshtein，0-1）
   */
  calculateTitleSimilarity(title1: string, title2: string): number {
    const s1 = title1.toLowerCase().trim();
    const s2 = title2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return 1 - distance / maxLen;
  }

  /**
   * 计算 Jaccard 相似度
   */
  calculateJaccardSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const set1 = new Set(str1.toLowerCase().split(/\s+/));
    const set2 = new Set(str2.toLowerCase().split(/\s+/));

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 判断两个标题是否相似
   */
  areTitlesSimilar(title1: string, title2: string, threshold = 0.85): boolean {
    return this.calculateTitleSimilarity(title1, title2) >= threshold;
  }

  // ============================================================================
  // 作者+时间去重（学术论文专用）
  // ============================================================================

  /**
   * 生成作者-时间组合键
   */
  generateAuthorTimeKey(authors: string[], date: Date): string {
    if (!authors || authors.length === 0) return "";

    // 取前3个作者
    const topAuthors = authors
      .slice(0, 3)
      .map((a) => a.toLowerCase().trim())
      .sort();

    // 日期格式 YYYY-MM-DD
    const dateKey = date.toISOString().split("T")[0];

    const content = `${topAuthors.join("_")}:${dateKey}`;
    return createHash("md5").update(content).digest("hex");
  }

  /**
   * 判断是否是相同作者在同一天的论文
   */
  isSameAuthorAndDate(
    authors1: string[],
    date1: Date,
    authors2: string[],
    date2: Date,
  ): boolean {
    const key1 = this.generateAuthorTimeKey(authors1, date1);
    const key2 = this.generateAuthorTimeKey(authors2, date2);

    if (!key1 || !key2) return false;
    return key1 === key2;
  }

  // ============================================================================
  // 综合去重接口
  // ============================================================================

  /**
   * 生成完整的去重指纹集
   */
  generateFingerprints(item: DeduplicationItem): DeduplicationFingerprints {
    const normalizedUrl = this.normalizeUrl(item.url);

    return {
      normalizedUrl,
      urlHash: this.computeUrlHash(item.url),
      titleHash: createHash("md5")
        .update(item.title.toLowerCase().trim())
        .digest("hex"),
      titleFingerprint: this.computeTitleFingerprint(item.title),
      contentFingerprint: item.content
        ? this.computeContentFingerprint(item.content)
        : null,
      simHash: item.content ? this.computeSimHash(item.content) : null,
      authorTimeKey:
        item.authors && item.publishedAt
          ? this.generateAuthorTimeKey(item.authors, item.publishedAt)
          : null,
    };
  }

  /**
   * 批量检测重复项
   * 返回重复项的索引
   */
  detectDuplicatesInBatch(
    items: DeduplicationItem[],
    options: {
      titleSimilarityThreshold?: number;
      useSimHash?: boolean;
      simHashThreshold?: number;
    } = {},
  ): number[] {
    const {
      titleSimilarityThreshold = 0.75,
      useSimHash = true,
      simHashThreshold = 3,
    } = options;

    const duplicateIndices: number[] = [];
    const seenUrls = new Map<string, number>();
    const processedItems: Array<{
      item: DeduplicationItem;
      index: number;
      simHash?: string;
    }> = [];

    items.forEach((item, index) => {
      const urlHash = this.computeUrlHash(item.url);
      let isDuplicate = false;

      // 第1层：URL 精确匹配
      if (seenUrls.has(urlHash)) {
        duplicateIndices.push(index);
        isDuplicate = true;
        this.logger.debug(
          `URL duplicate detected: ${item.title} (index ${index})`,
        );
      } else {
        // 第2层：标题相似度
        for (const processed of processedItems) {
          if (
            this.areTitlesSimilar(
              item.title,
              processed.item.title,
              titleSimilarityThreshold,
            )
          ) {
            duplicateIndices.push(index);
            isDuplicate = true;
            this.logger.debug(
              `Title similarity duplicate: "${item.title}" ~ "${processed.item.title}"`,
            );
            break;
          }

          // 第3层：内容 SimHash
          if (useSimHash && item.content && processed.item.content) {
            const fp1 = this.computeSimHash(item.content);
            const fp2 =
              processed.simHash || this.computeSimHash(processed.item.content);
            if (this.calculateHammingDistance(fp1, fp2) <= simHashThreshold) {
              duplicateIndices.push(index);
              isDuplicate = true;
              this.logger.debug(
                `Content SimHash duplicate: "${item.title}" ~ "${processed.item.title}"`,
              );
              break;
            }
          }
        }
      }

      if (!isDuplicate) {
        seenUrls.set(urlHash, index);
        processedItems.push({
          item,
          index,
          simHash: item.content ? this.computeSimHash(item.content) : undefined,
        });
      }
    });

    return duplicateIndices;
  }

  // ============================================================================
  // 质量评估
  // ============================================================================

  /**
   * 评估资源质量
   */
  assessQuality(resource: {
    source: string;
    content?: string;
    abstract?: string;
    citationCount?: number;
    publishedAt?: Date;
    authors?: unknown[];
  }): QualityAssessment {
    // 来源可信度
    const sourceCredibility =
      this.sourceCredibilityMap[resource.source?.toLowerCase()] || 30;

    // 内容完整度
    let contentCompleteness = 0;
    if (resource.abstract && resource.abstract.length > 50)
      contentCompleteness += 25;
    if (resource.abstract && resource.abstract.length > 200)
      contentCompleteness += 10;
    if (resource.content && resource.content.length > 500)
      contentCompleteness += 25;
    if (resource.content && resource.content.length > 2000)
      contentCompleteness += 15;
    if (resource.authors?.length) contentCompleteness += 15;
    contentCompleteness = Math.min(contentCompleteness, 100);

    // 新鲜度评分
    let freshnessScore = 50;
    if (resource.publishedAt) {
      const days =
        (Date.now() - new Date(resource.publishedAt).getTime()) / 86400000;
      if (days <= 7) freshnessScore = 100;
      else if (days <= 30) freshnessScore = 90;
      else if (days <= 90) freshnessScore = 75;
      else if (days <= 365) freshnessScore = 50;
      else freshnessScore = 30;
    }

    // 引用数
    const citationCount = resource.citationCount || 0;

    // 综合评分
    const overallScore = Math.round(
      sourceCredibility * 0.3 +
        contentCompleteness * 0.3 +
        freshnessScore * 0.2 +
        Math.min(citationCount / 10, 100) * 0.2,
    );

    return {
      sourceCredibility,
      contentCompleteness,
      freshnessScore,
      citationCount,
      overallScore,
    };
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 清理文本
   */
  cleanText(text: string): string {
    if (!text) return "";
    return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
  }

  /**
   * 批量规范化 URL
   */
  normalizeUrls(
    urls: string[],
  ): Array<{ original: string; normalized: string }> {
    return urls.map((url) => ({
      original: url,
      normalized: this.normalizeUrl(url),
    }));
  }

  /**
   * 生成去重报告
   */
  generateDeduplicationReport(
    candidates: Array<{
      id: string;
      url?: string;
      title?: string;
      simHash?: string;
      source: string;
    }>,
  ): {
    totalCandidates: number;
    urlDuplicates: Map<string, string[]>;
    titleSimilarPairs: Array<{
      id1: string;
      id2: string;
      similarity: number;
    }>;
    simHashSimilarPairs: Array<{
      id1: string;
      id2: string;
      hammingDistance: number;
    }>;
  } {
    const urlDuplicates = new Map<string, string[]>();
    const titleSimilarPairs: Array<{
      id1: string;
      id2: string;
      similarity: number;
    }> = [];
    const simHashSimilarPairs: Array<{
      id1: string;
      id2: string;
      hammingDistance: number;
    }> = [];

    // 收集 URL 重复
    for (const candidate of candidates) {
      if (candidate.url) {
        const normalizedUrl = this.normalizeUrl(candidate.url);
        if (!urlDuplicates.has(normalizedUrl)) {
          urlDuplicates.set(normalizedUrl, []);
        }
        urlDuplicates.get(normalizedUrl)!.push(candidate.id);
      }
    }

    // 检测标题相似和 SimHash 相似
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const c1 = candidates[i];
        const c2 = candidates[j];

        // 标题相似度
        if (c1.title && c2.title) {
          const similarity = this.calculateTitleSimilarity(c1.title, c2.title);
          if (similarity >= 0.85) {
            titleSimilarPairs.push({
              id1: c1.id,
              id2: c2.id,
              similarity,
            });
          }
        }

        // SimHash 相似度
        if (c1.simHash && c2.simHash) {
          const distance = this.calculateHammingDistance(
            c1.simHash,
            c2.simHash,
          );
          if (distance <= 7) {
            simHashSimilarPairs.push({
              id1: c1.id,
              id2: c2.id,
              hammingDistance: distance,
            });
          }
        }
      }
    }

    return {
      totalCandidates: candidates.length,
      urlDuplicates,
      titleSimilarPairs,
      simHashSimilarPairs,
    };
  }
}
