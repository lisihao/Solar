import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";

/**
 * 全局去重服务
 *
 * 功能：
 * 1. URL规范化 - 统一 URL 格式，移除冗余参数
 * 2. 内容哈希指纹 - 基于内容计算唯一指纹
 * 3. 相似度检测 - 识别高度相似但非完全相同的内容
 * 4. 跨源去重 - 检测同一内容来自不同数据源的情况
 *
 * 使用场景：
 * - arXiv 论文通过多个新闻网站转载
 * - GitHub 项目被多个聚合网站索引
 * - 技术文章在不同平台发布
 */
@Injectable()
export class GlobalDeduplicationService {
  private readonly logger = new Logger(GlobalDeduplicationService.name);

  /**
   * 规范化 URL - 使 URL 格式统一，便于去重
   *
   * 规范化规则：
   * 1. 转换为小写
   * 2. 移除末尾斜杠
   * 3. 移除 utm_* 追踪参数
   * 4. 移除 ref= 和 fbclid 等跟踪参数
   * 5. 排序查询参数（确保顺序一致）
   * 6. 移除 URL 片段（#之后的内容）
   * 7. 移除 www 子域（可选，用于主机名）
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // 规则 1: 转换为小写
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.pathname = parsed.pathname.toLowerCase();

      // 规则 7: 移除 www 子域
      if (parsed.hostname.startsWith("www.")) {
        parsed.hostname = parsed.hostname.replace(/^www\./, "");
      }

      // 规则 6: 移除 URL 片段（#）
      parsed.hash = "";

      // 规则 2: 移除末尾斜杠（仅针对根路径）
      if (parsed.pathname === "/" && parsed.search === "") {
        // 保持根路径的单斜杠
      } else if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
        parsed.pathname = parsed.pathname.replace(/\/$/, "");
      }

      // 规则 3-5: 处理查询参数
      const params = new URLSearchParams(parsed.search);
      const cleanParams = new URLSearchParams();

      // 移除追踪参数
      const trackingParams = [
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
      ];

      // 收集非追踪参数并排序
      const sortedParams: [string, string][] = [];
      for (const [key, value] of params) {
        if (!trackingParams.includes(key.toLowerCase())) {
          sortedParams.push([key, value]);
        }
      }

      // 按键排序参数
      sortedParams.sort((a, b) => a[0].localeCompare(b[0]));

      // 重新构建查询字符串
      sortedParams.forEach(([key, value]) => {
        cleanParams.append(key, value);
      });

      parsed.search = cleanParams.toString();

      return parsed.toString();
    } catch (error) {
      this.logger.warn(`Failed to normalize URL ${url}: ${String(error)}`);
      // 归一化失败时返回原 URL 的小写版本
      return url.toLowerCase();
    }
  }

  /**
   * 计算内容的 SHA256 指纹
   *
   * 用于精确去重和快速比对
   * 即使内容的格式略有不同（例如空格、换行符），哈希值也会完全不同
   * 因此这个方法适合用于检测完全相同的内容
   *
   * @param content 原始内容
   * @returns SHA256 哈希值（十六进制字符串）
   */
  computeContentHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  }

  /**
   * 计算文本的 Simhash 指纹
   *
   * 用于检测相似内容（例如转载文章）
   * Simhash 可以识别高度相似但不完全相同的内容
   * 相似度通过海明距离（Hamming Distance）衡量
   *
   * 算法步骤：
   * 1. 将文本分割为 k-gram（这里使用单词）
   * 2. 计算每个单词的哈希值
   * 3. 如果哈希值的第 i 位为 1，则第 i 个计数器加 1
   * 4. 最后，如果计数器 >= 阈值，该位设为 1，否则设为 0
   *
   * @param content 文本内容
   * @param keywordNum 使用的 bit 数（通常是 64）
   * @returns Simhash 值（十进制字符串）
   */
  computeSimhash(content: string, keywordNum: number = 64): string {
    // 预处理：清理文本，分割为词
    const words = content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "") // 移除非字母数字字符
      .split(/\s+/)
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      return "0";
    }

    // 初始化计数器数组
    const counters = new Array(keywordNum).fill(0);

    // 处理每个单词
    for (const word of words) {
      const hash = crypto.createHash("sha256").update(word).digest("hex");

      // 将哈希值的每一位与计数器对应
      for (let i = 0; i < keywordNum; i++) {
        // 从哈希的十六进制获取第 i 位（每 4 位十六进制对应 4 位二进制）
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8);
        const byte = parseInt(
          hash.substring(byteIndex * 2, byteIndex * 2 + 2),
          16,
        );
        const bit = (byte >> bitIndex) & 1;

        // 如果位为 1，计数器加 1
        if (bit === 1) {
          counters[i]++;
        }
      }
    }

    // 计算 Simhash：如果计数器 >= 单词总数一半，则该位为 1
    const threshold = words.length / 2;
    let simhash = "";
    for (let i = 0; i < keywordNum; i++) {
      simhash += counters[i] >= threshold ? "1" : "0";
    }

    // 转换为十进制便于存储
    return BigInt("0b" + simhash).toString(10);
  }

  /**
   * 计算两个 Simhash 值的海明距离
   *
   * 海明距离：两个等长字符串中对应位置不同的位数
   * 海明距离越小，内容越相似
   *
   * 经验数值：
   * - 海明距离 0-3：内容基本相同（>95% 相似）
   * - 海明距离 4-7：内容高度相似（85-95% 相似）
   * - 海明距离 8-15：内容有一定相似性（50-85% 相似）
   * - 海明距离 >15：内容差异较大（<50% 相似）
   *
   * @param hash1 第一个 Simhash（64位二进制字符串）
   * @param hash2 第二个 Simhash（64位二进制字符串）
   * @returns 海明距离（0-64）
   */
  hammingDistance(hash1: string, hash2: string): number {
    // 将十进制或十六进制转换回二进制
    // 如果是十六进制字符串，添加 0x 前缀
    const isHex = /^[0-9a-fA-F]+$/.test(hash1) && hash1.length <= 16;
    const prefix = isHex ? "0x" : "";

    const bin1 = BigInt(prefix + hash1)
      .toString(2)
      .padStart(64, "0");
    const bin2 = BigInt(prefix + hash2)
      .toString(2)
      .padStart(64, "0");

    let distance = 0;
    const maxLen = Math.max(bin1.length, bin2.length);

    for (let i = 0; i < maxLen; i++) {
      const bit1 = i < bin1.length ? bin1[i] : "0";
      const bit2 = i < bin2.length ? bin2[i] : "0";
      if (bit1 !== bit2) {
        distance++;
      }
    }

    return distance;
  }

  /**
   * 检测两个内容是否高度相似
   *
   * @param content1 第一个内容
   * @param content2 第二个内容
   * @param threshold 海明距离阈值（默认 3，表示 >95% 相似）
   * @returns true 如果相似，false 否则
   */
  isSimilarContent(
    content1: string,
    content2: string,
    threshold: number = 3,
  ): boolean {
    const simhash1 = this.computeSimhash(content1);
    const simhash2 = this.computeSimhash(content2);
    const distance = this.hammingDistance(simhash1, simhash2);
    return distance <= threshold;
  }

  /**
   * 检测两个 URL 是否指向同一资源
   *
   * 规则：
   * 1. 规范化两个 URL
   * 2. 如果规范化后完全相同，则认为是同一资源
   * 3. 否则，检查它们是否来自同一域名且路径高度相似
   *
   * @param url1 第一个 URL
   * @param url2 第二个 URL
   * @returns true 如果指向同一资源，false 否则
   */
  isSameUrl(url1: string, url2: string): boolean {
    try {
      const normalized1 = this.normalizeUrl(url1);
      const normalized2 = this.normalizeUrl(url2);

      // 精确匹配
      if (normalized1 === normalized2) {
        return true;
      }

      // 检查域名
      const parsed1 = new URL(url1);
      const parsed2 = new URL(url2);

      // 移除 www 后比较域名
      const domain1 = parsed1.hostname.replace(/^www\./, "");
      const domain2 = parsed2.hostname.replace(/^www\./, "");

      if (domain1 !== domain2) {
        return false;
      }

      // 同一域名下，检查路径和查询参数
      // 如果路径相同（规范化后），则认为是同一资源
      const path1 = parsed1.pathname.toLowerCase();
      const path2 = parsed2.pathname.toLowerCase();

      return path1 === path2 && normalized1 === normalized2;
    } catch (error) {
      this.logger.warn(`Failed to compare URLs: ${String(error)}`);
      return false;
    }
  }

  /**
   * 从 MongoDB 查询结果提取可比较的指纹信息
   *
   * 返回用于去重检查的关键字段
   */
  extractDeduplicationKey(rawData: {
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }): {
    url: string | null;
    contentHash: string | null;
    simhash: string | null;
    externalId: string | null;
  } {
    const d = rawData.data;
    const url =
      (d?.url as string) ||
      (d?.sourceUrl as string) ||
      (d?.htmlUrl as string) ||
      (d?.abstractUrl as string) ||
      null;

    const content =
      (d?.content as string) ||
      (d?.text as string) ||
      (d?.summary as string) ||
      (d?.description as string) ||
      "";

    const contentHash = content ? this.computeContentHash(content) : null;
    const simhash = content ? this.computeSimhash(content) : null;
    const externalId = (d?.externalId as string) || null;

    return {
      url,
      contentHash,
      simhash,
      externalId,
    };
  }

  /**
   * 批量规范化 URL 列表
   */
  normalizeUrls(urls: string[]): { original: string; normalized: string }[] {
    return urls.map((url) => ({
      original: url,
      normalized: this.normalizeUrl(url),
    }));
  }

  /**
   * 生成去重报告
   *
   * 用于诊断和监控去重效果
   */
  generateDeduplicationReport(
    candidates: Array<{
      id: string;
      url?: string;
      contentHash?: string;
      simhash?: string;
      source: string;
    }>,
  ): {
    totalCandidates: number;
    exactMatches: Map<string, string[]>; // 哈希值 -> [ID 列表]
    similarMatches: Array<{
      candidate1: string;
      candidate2: string;
      hammingDistance: number;
      similarity: string;
    }>;
    urlNormalizations: Map<string, string>; // 原始 URL -> 规范化后 URL
  } {
    const exactMatches = new Map<string, string[]>();
    const similarMatches: Array<{
      candidate1: string;
      candidate2: string;
      hammingDistance: number;
      similarity: string;
    }> = [];
    const urlNormalizations = new Map<string, string>();

    // 收集精确匹配（基于内容哈希）
    for (const candidate of candidates) {
      if (candidate.contentHash) {
        if (!exactMatches.has(candidate.contentHash)) {
          exactMatches.set(candidate.contentHash, []);
        }
        exactMatches.get(candidate.contentHash)!.push(candidate.id);
      }

      // 收集 URL 规范化信息
      if (candidate.url) {
        const normalized = this.normalizeUrl(candidate.url);
        urlNormalizations.set(candidate.url, normalized);
      }
    }

    // 检测相似内容（基于 Simhash）
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const c1 = candidates[i];
        const c2 = candidates[j];

        if (c1.simhash && c2.simhash) {
          const distance = this.hammingDistance(c1.simhash, c2.simhash);
          if (distance <= 7) {
            // 海明距离 <= 7 认为相似
            const similarity =
              distance <= 3 ? "Very High (>95%)" : "High (85-95%)";
            similarMatches.push({
              candidate1: c1.id,
              candidate2: c2.id,
              hammingDistance: distance,
              similarity,
            });
          }
        }
      }
    }

    return {
      totalCandidates: candidates.length,
      exactMatches,
      similarMatches,
      urlNormalizations,
    };
  }
}
