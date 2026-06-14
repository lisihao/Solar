import { Injectable, Logger } from "@nestjs/common";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";

/**
 * 论文元数据接口
 */
export interface PaperMetadata {
  title: string;
  authors: string[];
  abstract: string;
  publishedDate?: string;
  pdfUrl?: string;
  arxivId?: string;
  doi?: string;
  categories?: string[];
  source:
    | "alphaxiv"
    | "arxiv"
    | "ieee"
    | "acm"
    | "springer"
    | "sciencedirect"
    | "nature"
    | "doi"
    | "unknown";
}

/**
 * 论文元数据提取服务
 * 支持 alphaxiv.org、arxiv.org 等论文网站
 */
@Injectable()
export class PaperMetadataExtractorService {
  private readonly logger = new Logger(PaperMetadataExtractorService.name);

  /**
   * 从 URL 提取论文元数据
   */
  async extractPaperMetadata(url: string): Promise<PaperMetadata | null> {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname || "";

      // 首先尝试从PDF URL中提取论文ID并转换处理
      // 支持 https://arxiv.org/pdf/2511.15534.pdf 格式的URL
      if (
        (domain.includes("arxiv.org") || domain.includes("alphaxiv.org")) &&
        url.includes("/pdf/")
      ) {
        const paperId = this.extractPaperIdFromPdfUrl(url);
        if (paperId) {
          // 优先处理arXiv论文
          try {
            const metadata = await this.fetchFromArxivApi(paperId);
            return {
              ...metadata,
              source: domain.includes("alphaxiv.org") ? "alphaxiv" : "arxiv",
              pdfUrl: `https://arxiv.org/pdf/${paperId}.pdf`,
            };
          } catch (error) {
            this.logger.warn(
              `Failed to extract from arXiv PDF URL: ${getErrorMessage(error)}`,
            );
          }
        }
      }

      // 识别论文来源
      if (domain.includes("alphaxiv.org")) {
        return await this.extractFromAlphaxiv(url);
      } else if (domain.includes("arxiv.org")) {
        return await this.extractFromArxiv(url);
      } else if (domain.includes("ieeexplore.ieee.org")) {
        return await this.extractFromIEEE(url);
      } else if (domain.includes("acm.org") || domain.includes("dl.acm.org")) {
        return await this.extractFromACM(url);
      } else if (
        domain.includes("springer.com") ||
        domain.includes("link.springer.com")
      ) {
        return await this.extractFromSpringer(url);
      } else if (domain.includes("sciencedirect.com")) {
        return await this.extractFromScienceDirect(url);
      } else if (domain.includes("nature.com")) {
        return await this.extractFromNature(url);
      } else if (domain.includes("doi.org") || url.includes("doi.org")) {
        return await this.extractFromDOI(url);
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to extract paper metadata from ${url}: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * 从 arXiv PDF URL 提取论文 ID
   * 处理如 https://arxiv.org/pdf/2511.15534.pdf 的 URL
   */
  extractPaperIdFromPdfUrl(url: string): string | null {
    try {
      // 匹配 PDF 路径中的论文 ID
      const match = url.match(/\/pdf\/(\d+\.\d+(?:v\d+)?)/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * 从 alphaxiv.org 提取论文元数据
   * alphaxiv 是 ArXiv 的可视化界面
   */
  private async extractFromAlphaxiv(url: string): Promise<PaperMetadata> {
    try {
      // 提取论文 ID (e.g., 2511.10395 from /abs/2511.10395)
      const idMatch = url.match(/\/abs\/(\d+\.\d+(?:v\d+)?)/i);
      if (!idMatch) {
        throw new Error("Could not extract paper ID from alphaxiv URL");
      }

      const paperId = idMatch[1];

      // 从 alphaxiv API 获取数据（如果可用）
      // 否则使用 ArXiv API
      const arxivMetadata = await this.fetchFromArxivApi(paperId);

      return {
        ...arxivMetadata,
        source: "alphaxiv",
        pdfUrl: `https://arxiv.org/pdf/${paperId}.pdf`,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from alphaxiv: ${getErrorMessage(error)}`,
      );

      // 降级方案：至少返回 ID
      const idMatch = url.match(/\/abs\/(\d+\.\d+(?:v\d+)?)/i);
      if (idMatch) {
        return {
          title: `Paper ${idMatch[1]}`,
          authors: [],
          abstract: "Metadata extraction failed",
          pdfUrl: `https://arxiv.org/pdf/${idMatch[1]}.pdf`,
          arxivId: idMatch[1],
          source: "alphaxiv",
        };
      }

      throw new Error("Could not extract any metadata from alphaxiv URL");
    }
  }

  /**
   * 从 arxiv.org 提取论文元数据
   * 支持 /abs/ 和 /pdf/ 路径
   */
  private async extractFromArxiv(url: string): Promise<PaperMetadata> {
    try {
      // 提取论文 ID - 支持 /abs/ 和 /pdf/ 路径
      let idMatch = url.match(/\/abs\/(\d+\.\d+(?:v\d+)?)/i);
      if (!idMatch) {
        idMatch = url.match(/\/pdf\/(\d+\.\d+(?:v\d+)?)/i);
      }

      if (!idMatch) {
        throw new Error("Could not extract paper ID from arxiv URL");
      }

      const paperId = idMatch[1];
      const metadata = await this.fetchFromArxivApi(paperId);

      return {
        ...metadata,
        source: "arxiv",
        pdfUrl: `https://arxiv.org/pdf/${paperId}.pdf`,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from arxiv: ${getErrorMessage(error)}`,
      );

      // 降级方案
      let idMatch = url.match(/\/abs\/(\d+\.\d+(?:v\d+)?)/i);
      if (!idMatch) {
        idMatch = url.match(/\/pdf\/(\d+\.\d+(?:v\d+)?)/i);
      }

      if (idMatch) {
        return {
          title: `Paper ${idMatch[1]}`,
          authors: [],
          abstract: "Metadata extraction failed",
          pdfUrl: `https://arxiv.org/pdf/${idMatch[1]}.pdf`,
          arxivId: idMatch[1],
          source: "arxiv",
        };
      }

      throw new Error("Could not extract any metadata from arxiv URL");
    }
  }

  /**
   * 从 ArXiv API 获取论文信息
   * API 文档: https://arxiv.org/help/api/user-manual
   */
  private async fetchFromArxivApi(paperId: string): Promise<PaperMetadata> {
    try {
      const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}&start=0&max_results=1`;

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`ArXiv API returned status ${response.status}`);
      }

      const xmlText = await response.text();

      // 简单的 XML 解析（避免依赖 XML 库）
      // 注意：arXiv API 返回的 XML 中 <entry> 标签内包含实际的论文数据
      // 需要从 <entry> 内的 <title> 中提取，而不是 feed 级别的 <title>

      // 提取 entry 块
      const entryMatch = xmlText.match(/<entry>[\s\S]*?<\/entry>/);
      if (!entryMatch) {
        throw new Error("No entry found in arXiv API response");
      }
      const entryText = entryMatch[0];

      // 从 entry 中提取标题、摘要等
      const titleMatch = entryText.match(/<title>([^<]+)<\/title>/i);
      const summaryMatch = entryText.match(/<summary>([^<]+)<\/summary>/i);
      const publishedMatch = entryText.match(
        /<published>([^<]+)<\/published>/i,
      );

      // 提取作者（所有 author 标签在 entry 内）
      const authorMatches = entryText.match(/<name>([^<]+)<\/name>/g) || [];
      const authors = authorMatches.map((match) =>
        match.replace(/<\/?name>/g, "").trim(),
      );

      // 提取分类
      const categoryMatches =
        entryText.match(/<arxiv:primary_category term="([^"]+)"/g) || [];
      const categories = categoryMatches.map(
        (match) => match.match(/term="([^"]+)"/)?.[1] || "",
      );

      const title = titleMatch ? titleMatch[1].trim() : `Paper ${paperId}`;
      const abstract = summaryMatch ? summaryMatch[1].trim() : "";
      const publishedDate = publishedMatch ? publishedMatch[1] : undefined;

      return {
        title,
        authors,
        abstract,
        publishedDate,
        arxivId: paperId,
        categories,
        source: "arxiv",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch from ArXiv API for ${paperId}: ${getErrorMessage(error)}`,
      );

      throw error;
    }
  }

  /**
   * 从 IEEE Xplore 提取论文元数据
   */
  private async extractFromIEEE(url: string): Promise<PaperMetadata> {
    try {
      // IEEE URLs typically contain document number like /document/9876543
      const docMatch = url.match(/\/document\/(\d+)/);
      const docNumber = docMatch ? docMatch[1] : null;

      // 使用 Crossref API 获取元数据（通过 DOI）
      // IEEE 论文也通常有 DOI
      const doiMatch = url.match(/(?:doi|DOI)[\s:]*([^\s&\)]+)/);
      if (doiMatch) {
        return await this.extractFromDOI(doiMatch[1]);
      }

      // 降级方案：从 HTML 页面提取基本信息
      const html = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      }).then((r) => r.text());

      const titleMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
      const abstractMatch = html.match(/"description"\s*:\s*"([^"]+)"/);

      return {
        title: titleMatch
          ? this.cleanHtmlContent(titleMatch[1])
          : `IEEE Paper ${docNumber || "Unknown"}`,
        authors: [],
        abstract: abstractMatch ? this.cleanHtmlContent(abstractMatch[1]) : "",
        source: "ieee",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from IEEE: ${getErrorMessage(error)}`,
      );
      return {
        title: "IEEE Paper",
        authors: [],
        abstract: "Failed to extract metadata",
        source: "ieee",
      };
    }
  }

  /**
   * 从 ACM Digital Library 提取论文元数据
   */
  private async extractFromACM(url: string): Promise<PaperMetadata> {
    try {
      // ACM URLs typically contain /doi/10.1145/xxxx or /doi/abs/10.1145/xxxx
      const doiMatch = url.match(/(10\.1145\/[^\s&\)]+)/);
      if (doiMatch) {
        return await this.extractFromDOI(doiMatch[1]);
      }

      // 降级方案
      return {
        title: "ACM Paper",
        authors: [],
        abstract: "Metadata extraction not yet supported for this ACM URL",
        source: "acm",
      };
    } catch (error) {
      this.logger.warn(`Failed to extract from ACM: ${getErrorMessage(error)}`);
      return {
        title: "ACM Paper",
        authors: [],
        abstract: "Failed to extract metadata",
        source: "acm",
      };
    }
  }

  /**
   * 从 Springer 提取论文元数据
   */
  private async extractFromSpringer(url: string): Promise<PaperMetadata> {
    try {
      // Springer URLs typically contain /article/10.1007/xxxx or doi information
      const doiMatch = url.match(/(10\.1007\/[^\s&\)]+)/);
      if (doiMatch) {
        return await this.extractFromDOI(doiMatch[1]);
      }

      // 降级方案
      return {
        title: "Springer Paper",
        authors: [],
        abstract: "Metadata extraction not yet supported for this Springer URL",
        source: "springer",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from Springer: ${getErrorMessage(error)}`,
      );
      return {
        title: "Springer Paper",
        authors: [],
        abstract: "Failed to extract metadata",
        source: "springer",
      };
    }
  }

  /**
   * 从 Science Direct 提取论文元数据
   */
  private async extractFromScienceDirect(url: string): Promise<PaperMetadata> {
    try {
      // Science Direct URLs typically contain /science/article/pii/xxxx or DOI
      const doiMatch = url.match(/(10\.1016\/[^\s&\)]+)/);
      if (doiMatch) {
        return await this.extractFromDOI(doiMatch[1]);
      }

      // 降级方案
      return {
        title: "Science Direct Paper",
        authors: [],
        abstract:
          "Metadata extraction not yet supported for this Science Direct URL",
        source: "sciencedirect",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from Science Direct: ${getErrorMessage(error)}`,
      );
      return {
        title: "Science Direct Paper",
        authors: [],
        abstract: "Failed to extract metadata",
        source: "sciencedirect",
      };
    }
  }

  /**
   * 从 Nature 提取论文元数据
   */
  private async extractFromNature(url: string): Promise<PaperMetadata> {
    try {
      // Nature URLs typically contain /articles/xxxx or DOI
      const doiMatch = url.match(/(10\.1038\/[^\s&\)]+)/);
      if (doiMatch) {
        return await this.extractFromDOI(doiMatch[1]);
      }

      // 降级方案
      return {
        title: "Nature Paper",
        authors: [],
        abstract: "Metadata extraction not yet supported for this Nature URL",
        source: "nature",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract from Nature: ${getErrorMessage(error)}`,
      );
      return {
        title: "Nature Paper",
        authors: [],
        abstract: "Failed to extract metadata",
        source: "nature",
      };
    }
  }

  /**
   * 通过 DOI 从 Crossref API 提取论文元数据
   * API 文档: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
   */
  private async extractFromDOI(doi: string): Promise<PaperMetadata> {
    try {
      // 清理 DOI（移除前缀如果有的话）
      const cleanDoi = doi
        .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//, "")
        .trim();

      const apiUrl = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

      const response = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!response.ok) {
        throw new Error(`Crossref API returned status ${response.status}`);
      }

      const data = await response.json();

      if (!data.message) {
        throw new Error("No message in Crossref response");
      }

      const work = data.message;
      const title = work.title?.[0] || `Paper with DOI ${cleanDoi}`;
      const authors = (work.author || []).map((a: Record<string, unknown>) => {
        const name = [];
        if (a.family) name.push(a.family);
        if (a.given) name.push(a.given);
        return name.join(", ");
      });

      const publishedDate = work.published?.["date-parts"]?.[0];
      const publishedStr = publishedDate
        ? new Date(
            publishedDate[0],
            (publishedDate[1] || 1) - 1,
            publishedDate[2] || 1,
          ).toISOString()
        : undefined;

      // 生成 PDF URL (如果可用)
      let pdfUrl: string | undefined;
      if (work.URL) {
        pdfUrl = work.URL;
      }

      return {
        title: this.cleanHtmlContent(title),
        authors,
        abstract: work.abstract ? this.cleanHtmlContent(work.abstract) : "",
        publishedDate: publishedStr,
        pdfUrl,
        doi: cleanDoi,
        source: "doi",
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch from Crossref API for DOI ${doi}: ${getErrorMessage(error)}`,
      );

      // 降级方案：至少返回 DOI
      return {
        title: `Paper with DOI ${doi}`,
        authors: [],
        abstract: "Metadata extraction failed",
        doi,
        source: "doi",
      };
    }
  }

  /**
   * 清理 HTML 内容（移除 HTML 标签和实体）
   */
  private cleanHtmlContent(content: string): string {
    return content
      .replace(/<[^>]*>/g, "") // 移除 HTML 标签
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
