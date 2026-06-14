import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";

/**
 * 去重服务（增强版）
 * 实现4层渐进式去重：
 * 1. URL哈希去重 - 最快（O(1)）
 * 2. 标题相似度去重 - 快速（O(n)）
 * 3. 内容指纹去重 - SimHash + 汉明距离
 * 4. 作者+时间去重 - 学术论文专用
 */
@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);

  /**
   * 生成 URL 的 MD5 哈希
   */
  generateUrlHash(url: string): string {
    return createHash("md5").update(url.trim().toLowerCase()).digest("hex");
  }

  /**
   * 生成内容指纹（标题 + 关键字段）
   */
  generateContentFingerprint(
    title: string,
    additionalFields?: string[],
  ): string {
    const content = [title, ...(additionalFields || [])]
      .join("|")
      .trim()
      .toLowerCase();
    return createHash("md5").update(content).digest("hex");
  }

  /**
   * 计算 Levenshtein 距离（字符串相似度）
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
   * 计算标题相似度（0-1，1 表示完全相同）
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
   * 判断两个标题是否相似（阈值 0.85）
   */
  areTitlesSimilar(title1: string, title2: string, threshold = 0.85): boolean {
    const similarity = this.calculateTitleSimilarity(title1, title2);
    return similarity >= threshold;
  }

  /**
   * 规范化 URL（移除无关 query 参数、hash、trailing slash，转换为小写）
   * 特殊处理：YouTube视频URL保留视频ID参数
   */
  normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // 转换为小写
      urlObj.protocol = urlObj.protocol.toLowerCase();
      urlObj.hostname = urlObj.hostname.toLowerCase();
      urlObj.pathname = urlObj.pathname.toLowerCase();

      // 特殊处理 YouTube URL - 保留视频ID
      if (
        urlObj.hostname.includes("youtube.com") ||
        urlObj.hostname.includes("youtu.be")
      ) {
        // 提取YouTube视频ID
        let videoId: string | null = null;

        if (urlObj.hostname.includes("youtu.be")) {
          // 短链接格式: https://youtu.be/VIDEO_ID
          videoId = urlObj.pathname.slice(1); // 移除开头的 /
        } else if (urlObj.pathname.includes("/watch")) {
          // 标准格式: https://www.youtube.com/watch?v=VIDEO_ID
          videoId = urlObj.searchParams.get("v");
        } else if (urlObj.pathname.includes("/shorts/")) {
          // Shorts格式: https://www.youtube.com/shorts/VIDEO_ID
          const match = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          videoId = match ? match[1] : null;
        } else if (urlObj.pathname.includes("/embed/")) {
          // 嵌入格式: https://www.youtube.com/embed/VIDEO_ID
          const match = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
          videoId = match ? match[1] : null;
        }

        if (videoId) {
          // 统一规范化为标准格式
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }

      // 其他URL：移除 query 参数和 hash
      urlObj.search = "";
      urlObj.hash = "";
      let normalized = urlObj.toString();
      // 移除所有 trailing slash（包括根路径）
      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch (error) {
      this.logger.warn(`Failed to normalize URL: ${url}`);
      return url.trim().toLowerCase();
    }
  }

  /**
   * 提取域名
   */
  extractDomain(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return null;
    }
  }

  /**
   * 批量检测重复（返回重复项的索引）
   * 检测基于：1) URL精确匹配  2) 标题相似度
   * 注意：批量检测使用较低的阈值（0.75）以提高召回率
   */
  detectDuplicatesInBatch(
    items: Array<{ url: string; title: string }>,
    titleSimilarityThreshold = 0.75,
  ): number[] {
    const duplicateIndices: number[] = [];
    const seen = new Map<string, number>();
    const processedItems: Array<{ url: string; title: string; index: number }> =
      [];

    items.forEach((item, index) => {
      const urlHash = this.generateUrlHash(this.normalizeUrl(item.url));
      let isDuplicate = false;

      // 检查URL重复
      if (seen.has(urlHash)) {
        duplicateIndices.push(index);
        isDuplicate = true;
        this.logger.debug(
          `URL duplicate detected: ${item.title} (index ${index})`,
        );
      } else {
        // 检查标题相似度重复
        for (const processed of processedItems) {
          if (
            this.areTitlesSimilar(
              item.title,
              processed.title,
              titleSimilarityThreshold,
            )
          ) {
            duplicateIndices.push(index);
            isDuplicate = true;
            this.logger.debug(
              `Title similarity duplicate detected: "${item.title}" similar to "${processed.title}" (index ${index})`,
            );
            break;
          }
        }
      }

      if (!isDuplicate) {
        seen.set(urlHash, index);
        processedItems.push({ ...item, index });
      }
    });

    return duplicateIndices;
  }

  /**
   * 清理文本（移除多余空格、换行等）
   */
  cleanText(text: string): string {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ") // 多个空格替换为单个
      .replace(/\n+/g, " ") // 换行替换为空格
      .trim();
  }

  // ============================================================================
  // 第3层：内容指纹去重（SimHash + 汉明距离）
  // ============================================================================

  /**
   * 生成内容的SimHash指纹（64位）
   * SimHash算法：将文本转换为固定长度的指纹，相似文本的指纹汉明距离小
   */
  generateSimHash(content: string): string {
    if (!content || content.length === 0) {
      return "0".repeat(16); // 空内容返回0
    }

    // 1. 分词（简单按空格和标点分词）
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // 移除标点
      .split(/\s+/)
      .filter((w) => w.length > 2); // 过滤短词

    if (words.length === 0) {
      return "0".repeat(16);
    }

    // 2. 初始化64位向量
    const vector = new Array(64).fill(0);

    // 3. 对每个词计算哈希并累加到向量
    for (const word of words) {
      const hash = createHash("md5").update(word).digest("hex");
      const hashBigInt = BigInt("0x" + hash.substring(0, 16));

      for (let i = 0; i < 64; i++) {
        const bit = (hashBigInt >> BigInt(i)) & BigInt(1);
        vector[i] += bit === BigInt(1) ? 1 : -1;
      }
    }

    // 4. 生成64位指纹
    let fingerprint = BigInt(0);
    for (let i = 0; i < 64; i++) {
      if (vector[i] > 0) {
        fingerprint |= BigInt(1) << BigInt(i);
      }
    }

    // 5. 转换为16进制字符串（16字符）
    return fingerprint.toString(16).padStart(16, "0");
  }

  /**
   * 计算两个SimHash指纹的汉明距离
   * 汉明距离：两个等长字符串对应位置不同字符的个数
   */
  calculateHammingDistance(fp1: string, fp2: string): number {
    try {
      const int1 = BigInt("0x" + fp1);
      const int2 = BigInt("0x" + fp2);
      let xor = int1 ^ int2;
      let distance = 0;

      // 计算1的个数
      while (xor > BigInt(0)) {
        distance += Number(xor & BigInt(1));
        xor >>= BigInt(1);
      }

      return distance;
    } catch (error) {
      this.logger.error(
        `Failed to calculate hamming distance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 64; // 返回最大距离
    }
  }

  /**
   * 判断两个内容是否相似（基于SimHash指纹）
   * @param fp1 第一个SimHash指纹
   * @param fp2 第二个SimHash指纹
   * @param threshold 汉明距离阈值（默认3，表示允许3位差异）
   * @returns 是否相似
   */
  areContentsSimilarByFingerprint(
    fp1: string,
    fp2: string,
    threshold = 3,
  ): boolean {
    const distance = this.calculateHammingDistance(fp1, fp2);
    return distance <= threshold;
  }

  /**
   * 生成内容指纹（包含归一化）
   * 这是对外的统一接口
   */
  generateSimHashFingerprint(content: string): string {
    const normalized = this.cleanText(content);
    return this.generateSimHash(normalized);
  }

  // ============================================================================
  // 第4层：作者+时间去重（学术论文专用）
  // ============================================================================

  /**
   * 生成作者-时间组合键
   * 用于学术论文去重：同一作者在同一天发布的论文很可能是重复的
   * @param authors 作者列表
   * @param date 发布日期
   * @returns MD5哈希的组合键
   */
  generateAuthorTimeKey(authors: string[], date: Date): string {
    if (!authors || authors.length === 0) {
      return ""; // 无作者返回空
    }

    // 1. 取前3个作者（避免作者列表过长）
    const topAuthors = authors
      .slice(0, 3)
      .map((a) => a.toLowerCase().trim())
      .sort(); // 排序保证顺序一致

    // 2. 提取日期（YYYY-MM-DD）
    const dateKey = date.toISOString().split("T")[0];

    // 3. 组合并生成哈希
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
   * 4层渐进式去重检测
   * 返回去重检测结果
   */
  checkAllDuplicationMethods(item: {
    url: string;
    title: string;
    content?: string;
    authors?: string[];
    publishedAt?: Date;
  }): {
    urlHash: string;
    titleHash: string;
    contentFingerprint: string | null;
    authorTimeKey: string | null;
  } {
    // 第1层：URL哈希
    const urlHash = this.generateUrlHash(this.normalizeUrl(item.url));

    // 第2层：标题哈希
    const titleHash = this.generateContentFingerprint(item.title, []); // 使用原有方法

    // 第3层：内容指纹（如果有内容）
    const contentFingerprint = item.content
      ? this.generateSimHashFingerprint(item.content)
      : null;

    // 第4层：作者+时间键（如果有作者和发布时间）
    const authorTimeKey =
      item.authors && item.publishedAt
        ? this.generateAuthorTimeKey(item.authors, item.publishedAt)
        : null;

    return {
      urlHash,
      titleHash,
      contentFingerprint,
      authorTimeKey,
    };
  }
}
