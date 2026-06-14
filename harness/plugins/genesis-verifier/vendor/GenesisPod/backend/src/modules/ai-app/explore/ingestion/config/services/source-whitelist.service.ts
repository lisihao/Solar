import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ResourceType } from "@prisma/client";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";

interface CreateWhitelistDto {
  resourceType: ResourceType;
  allowedDomains: string[]; // 完整域名或通配符模式
  description?: string;
}

interface UpdateWhitelistDto {
  allowedDomains?: string[];
  description?: string;
  isActive?: boolean;
}

/**
 * Source Whitelist Service
 * 负责管理各资源类型允许的数据源白名单
 */
@Injectable()
export class SourceWhitelistService {
  private readonly logger = new Logger(SourceWhitelistService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 为资源类型创建白名单
   */
  async createWhitelist(dto: CreateWhitelistDto) {
    try {
      // 检查是否已存在
      const existing = await this.prisma.sourceWhitelist.findFirst({
        where: { resourceType: dto.resourceType },
      });

      if (existing) {
        this.logger.warn(
          `Whitelist for ${dto.resourceType} already exists, updating instead`,
        );
        return this.updateWhitelist(dto.resourceType, {
          allowedDomains: dto.allowedDomains,
          description: dto.description,
        });
      }

      const whitelist = await this.prisma.sourceWhitelist.create({
        data: {
          resourceType: dto.resourceType,
          allowedDomains: dto.allowedDomains,
          description: dto.description,
          isActive: true,
        },
      });

      this.logger.log(
        `Created whitelist for ${dto.resourceType} with ${dto.allowedDomains.length} domains`,
      );
      return whitelist;
    } catch (error) {
      this.logger.error(
        `Failed to create whitelist: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取特定资源类型的白名单
   */
  async getWhitelist(resourceType: ResourceType) {
    try {
      // Use findFirst instead of findUnique to avoid PostgreSQL type casting issues
      const whitelist = await this.prisma.sourceWhitelist.findFirst({
        where: { resourceType: resourceType },
      });

      if (!whitelist) {
        this.logger.warn(`Whitelist not found for ${resourceType}`);
        return null;
      }

      return whitelist;
    } catch (error) {
      this.logger.error(`Failed to get whitelist: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * 获取所有白名单
   */
  async getAllWhitelists() {
    try {
      const whitelists = await this.prisma.sourceWhitelist.findMany({
        orderBy: { createdAt: "asc" },
      });

      return whitelists;
    } catch (error) {
      this.logger.error(
        `Failed to get all whitelists: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新白名单
   */
  async updateWhitelist(resourceType: ResourceType, dto: UpdateWhitelistDto) {
    try {
      const whitelist = await this.prisma.sourceWhitelist.updateMany({
        where: { resourceType: resourceType },
        data: {
          ...(dto.allowedDomains && { allowedDomains: dto.allowedDomains }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated whitelist for ${resourceType}`);
      return whitelist;
    } catch (error) {
      this.logger.error(
        `Failed to update whitelist: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 删除白名单
   */
  async deleteWhitelist(resourceType: ResourceType) {
    try {
      await this.prisma.sourceWhitelist.deleteMany({
        where: { resourceType: resourceType },
      });

      this.logger.log(`Deleted whitelist for ${resourceType}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete whitelist: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 验证URL是否在白名单中
   * 支持完整域名和通配符模式 (e.g., *.ieee.org)
   */
  async validateUrl(
    resourceType: ResourceType,
    url: string,
  ): Promise<{
    isValid: boolean;
    matchedDomain?: string;
    reason?: string;
  }> {
    try {
      const whitelist = await this.getWhitelist(resourceType);

      if (!whitelist || !whitelist.isActive) {
        return {
          isValid: false,
          reason: `No active whitelist found for ${resourceType}`,
        };
      }

      // 从URL提取域名
      const domain = this.extractDomain(url);
      if (!domain) {
        return {
          isValid: false,
          reason: "Invalid URL format",
        };
      }

      // 检查域名是否在白名单中
      const allowedDomains = whitelist.allowedDomains as string[];
      const isMatched = this.isDomainAllowed(domain, allowedDomains);

      if (isMatched) {
        // 更新验证统计
        await this.prisma.sourceWhitelist.updateMany({
          where: { resourceType: resourceType },
          data: {
            totalValidated: { increment: 1 },
            lastValidatedAt: new Date(),
          },
        });

        return {
          isValid: true,
          matchedDomain: domain,
        };
      } else {
        // 更新被拒绝的统计
        await this.prisma.sourceWhitelist.updateMany({
          where: { resourceType: resourceType },
          data: {
            totalRejected: { increment: 1 },
            lastValidatedAt: new Date(),
          },
        });

        return {
          isValid: false,
          reason: `Domain ${domain} is not in the whitelist for ${resourceType}`,
        };
      }
    } catch (error) {
      this.logger.error(`Failed to validate URL: ${getErrorMessage(error)}`);
      return {
        isValid: false,
        reason: `Validation error: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * 批量验证URL
   */
  async validateUrls(
    resourceType: ResourceType,
    urls: string[],
  ): Promise<
    Array<{
      url: string;
      isValid: boolean;
      matchedDomain?: string;
      reason?: string;
    }>
  > {
    const results = [];

    for (const url of urls) {
      const result = await this.validateUrl(resourceType, url);
      results.push({
        url,
        ...result,
      });
    }

    return results;
  }

  /**
   * 添加允许的域名
   */
  async addAllowedDomain(resourceType: ResourceType, domain: string) {
    try {
      const whitelist = await this.getWhitelist(resourceType);

      if (!whitelist) {
        throw new Error(`Whitelist not found for ${resourceType}`);
      }

      const allowedDomains = (whitelist.allowedDomains as string[]) || [];

      // 检查是否已存在
      if (allowedDomains.includes(domain)) {
        this.logger.warn(
          `Domain ${domain} already exists in whitelist for ${resourceType}`,
        );
        return whitelist;
      }

      // Use findFirst + updateMany to avoid enum type casting issues
      const updated = await this.prisma.sourceWhitelist.findFirst({
        where: { resourceType: resourceType },
      });

      if (updated) {
        await this.prisma.sourceWhitelist.updateMany({
          where: { resourceType: resourceType },
          data: {
            allowedDomains: [...allowedDomains, domain],
            updatedAt: new Date(),
          },
        });
      }

      this.logger.log(
        `Added domain ${domain} to whitelist for ${resourceType}`,
      );
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to add allowed domain: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 移除允许的域名
   */
  async removeAllowedDomain(resourceType: ResourceType, domain: string) {
    try {
      const whitelist = await this.getWhitelist(resourceType);

      if (!whitelist) {
        throw new Error(`Whitelist not found for ${resourceType}`);
      }

      const allowedDomains = (whitelist.allowedDomains as string[]) || [];
      const filtered = allowedDomains.filter((d) => d !== domain);

      await this.prisma.sourceWhitelist.updateMany({
        where: { resourceType: resourceType },
        data: {
          allowedDomains: filtered,
          updatedAt: new Date(),
        },
      });

      this.logger.log(
        `Removed domain ${domain} from whitelist for ${resourceType}`,
      );
      return whitelist;
    } catch (error) {
      this.logger.error(
        `Failed to remove allowed domain: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 从URL提取域名
   */
  private extractDomain(url: string): string | null {
    try {
      // 处理没有 scheme 的 URL
      let urlStr = url;
      if (!url.match(/^https?:\/\//i)) {
        urlStr = "https://" + url;
      }

      const urlObj = new URL(urlStr);
      return urlObj.hostname || null;
    } catch (error) {
      this.logger.warn(`Failed to extract domain from URL: ${url}`);
      return null;
    }
  }

  /**
   * 检查域名是否被允许
   * 支持通配符模式: *.ieee.org 会匹配 example.ieee.org
   */
  private isDomainAllowed(domain: string, allowedPatterns: string[]): boolean {
    for (const pattern of allowedPatterns) {
      if (this.matchDomain(domain, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 匹配域名与模式
   * 支持：
   * 1. 精确匹配：domain.com 匹配 domain.com
   * 2. 通配符匹配：*.domain.com 匹配 sub.domain.com
   * 3. 子域名匹配：domain.com 也匹配 sub.domain.com（隐含的通配符）
   */
  private matchDomain(domain: string, pattern: string): boolean {
    // 1. 精确匹配：domain.com 匹配 domain.com
    if (domain === pattern) {
      return true;
    }

    // 2. 通配符匹配：*.example.com 匹配 sub.example.com
    if (pattern.startsWith("*.")) {
      const baseDomain = pattern.slice(2); // 移除 *.
      // 检查域名是否以 baseDomain 结尾且有一个子域名
      if (domain.endsWith("." + baseDomain)) {
        return true;
      }
    }

    // 3. 双通配符匹配：*.domain.* 匹配 sub.domain.com、sub.domain.org 等
    if (pattern.startsWith("*.") && pattern.endsWith(".*")) {
      const middle = pattern.slice(2, -2); // 提取中间部分，如 "alphaviv"
      // 检查域名是否包含该中间部分，如 "www.alphaviv.org"
      if (domain.includes("." + middle + ".")) {
        return true;
      }
      // 也支持 "alphaviv.org" 这样不带 www 的情况
      if (domain.startsWith(middle + ".")) {
        return true;
      }
    }

    // 4. 隐含的通配符：example.com 也应该匹配 sub.example.com
    // 这是常见的用法，用户通常期望父域名覆盖子域名
    if (!pattern.startsWith("*.") && !pattern.startsWith("/")) {
      if (domain.endsWith("." + pattern)) {
        return true;
      }
    }

    // 5. 正则表达式匹配：/^pattern$/ 支持正则表达式
    try {
      if (pattern.startsWith("/") && pattern.endsWith("/")) {
        const regexPattern = pattern.slice(1, -1);
        const regex = new RegExp(regexPattern);
        return regex.test(domain);
      }
    } catch (error) {
      // 忽略无效的正则表达式
    }

    return false;
  }

  /**
   * 初始化默认白名单
   * 这个方法可以在应用启动时调用，以创建基本的白名单
   */
  async initializeDefaultWhitelists() {
    try {
      const defaults: CreateWhitelistDto[] = [
        {
          resourceType: "PAPER" as ResourceType,
          allowedDomains: [
            // 学术库
            "arxiv.org",
            "*.arxiv.org",
            "alphaxiv.org",
            "*.alphaxiv.org",
            "openreview.net",
            "papers.nips.cc",
            "proceedings.mlr.press",
            "openaccess.thecvf.com",
            // IEEE
            "ieee.org",
            "*.ieee.org",
            "ieeexplore.ieee.org",
            "*.ieeexplore.ieee.org",
            // ACM
            "acm.org",
            "*.acm.org",
            "dl.acm.org",
            "*.dl.acm.org",
            // Springer
            "springer.com",
            "*.springer.com",
            "link.springer.com",
            // ScienceDirect
            "sciencedirect.com",
            "*.sciencedirect.com",
            "scienceopen.com",
            // Google Scholar
            "scholar.google.com",
            "scholar.google.*",
            // ResearchGate
            "researchgate.net",
            "*.researchgate.net",
            // PLOS
            "plos.org",
            "*.plos.org",
            // Nature
            "nature.com",
            "*.nature.com",
            // Cell
            "cell.com",
            "*.cell.com",
          ],
          description:
            "Academic papers: arXiv, IEEE, ACM, Springer, ScienceDirect, Google Scholar, etc.",
        },
        {
          resourceType: "BLOG" as ResourceType,
          allowedDomains: [
            // Google
            "google.com",
            "googleblog.com",
            "*.googleblog.com",
            "ai.googleblog.com",
            "blog.google",
            "developers.googleblog.com",
            // Microsoft
            "microsoft.com",
            "blogs.microsoft.com",
            "*.blogs.microsoft.com",
            "research.microsoft.com",
            // NVIDIA
            "nvidia.com",
            "*.nvidia.com",
            "nvidiablog.com",
            "blog.nvidia.com",
            // Intel
            "intel.com",
            "*.intel.com",
            "newsroom.intel.com",
            // AMD
            "amd.com",
            "*.amd.com",
            // Cisco
            "cisco.com",
            "*.cisco.com",
            "blogs.cisco.com",
            // Fortinet
            "fortinet.com",
            "*.fortinet.com",
            "blog.fortinet.com",
            // Broadcom
            "broadcom.com",
            "*.broadcom.com",
            // Meta/Facebook
            "meta.com",
            "research.facebook.com",
            "ai.facebook.com",
            "engineering.fb.com",
            // OpenAI
            "openai.com",
            "*.openai.com",
            "blog.openai.com",
            // DeepMind
            "deepmind.com",
            "*.deepmind.com",
            // Anthropic
            "anthropic.com",
            "*.anthropic.com",
            // Medium
            "medium.com",
            "towardsdatascience.com",
            // Hugging Face
            "huggingface.co",
            "*.huggingface.co",
            // Amazon
            "amazon.com",
            "aws.amazon.com",
            "*.aws.amazon.com",
            // Apple
            "apple.com",
            "machinelearning.apple.com",
            // WeChat Official Accounts (微信公众号)
            "mp.weixin.qq.com",
          ],
          description:
            "Research blogs from: Google, Microsoft, NVIDIA, Intel, AMD, Cisco, Meta, OpenAI, DeepMind, Anthropic, WeChat Official Accounts, etc.",
        },
        {
          resourceType: "NEWS" as ResourceType,
          allowedDomains: [
            // 科技新闻
            "techcrunch.com",
            "theverge.com",
            "arstechnica.com",
            "wired.com",
            "engadget.com",
            "anandtech.com",
            "tomshardware.com",
            "pcgamer.com",
            "gamingonlinux.com",
            // 通用新闻
            "cnbc.com",
            "reuters.com",
            "bbc.com",
            "bbc.co.uk",
            "theguardian.com",
            "forbes.com",
            "bloomberg.com",
            "wsj.com",
            // 商业新闻
            "venturebeat.com",
            "crunchbase.com",
            "siliconvalley.com",
            // 安全新闻
            "bleepingcomputer.com",
            "krebsonsecurity.com",
            "thehackernews.com",
            // AI/ML新闻
            "aiweekly.com",
            "syntehtica.com",
            "labellerr.com",
          ],
          description:
            "Tech news: TechCrunch, The Verge, Ars Technica, Wired, CNN, Bloomberg, WSJ, etc.",
        },
        {
          resourceType: "YOUTUBE_VIDEO" as ResourceType,
          allowedDomains: [
            "youtube.com",
            "youtu.be",
            "www.youtube.com",
            "m.youtube.com",
            "youtube-nocookie.com",
            "*.youtube.com",
          ],
          description: "YouTube video platform",
        },
        {
          resourceType: "RSS" as ResourceType,
          allowedDomains: ["*"], // RSS 可以来自任何地方
          description: "RSS feed sources (unrestricted)",
        },
        {
          resourceType: "REPORT" as ResourceType,
          allowedDomains: [
            // Gartner
            "gartner.com",
            "*.gartner.com",
            // Forrester
            "forrester.com",
            "*.forrester.com",
            // IDC
            "idc.com",
            "*.idc.com",
            // McKinsey
            "mckinsey.com",
            "*.mckinsey.com",
            // Boston Consulting Group
            "bcg.com",
            "*.bcg.com",
            // Bain
            "bain.com",
            "*.bain.com",
            // Accenture
            "accenture.com",
            "*.accenture.com",
            // Deloitte
            "deloitte.com",
            "*.deloitte.com",
            // PwC
            "pwc.com",
            "*.pwc.com",
            // EY
            "ey.com",
            "*.ey.com",
            // Morgan Stanley
            "morganstanley.com",
            "*.morganstanley.com",
            // Goldman Sachs
            "goldmansachs.com",
            "*.goldmansachs.com",
            // Analyst firms
            "jpm.com",
            "*.jpm.com",
            "barclays.com",
            "*.barclays.com",
            // 技术分析
            "semianalysis.com",
            "newsletter.semianalysis.com",
            "stratechery.com",
            // 芯片分析
            "semiwiki.com",
            "eenewseurope.com",
            "eejournal.com",
            "edn.com",
            // 行业报告
            "statista.com",
            "markets.businessinsider.com",
            "technavio.com",
            "grandviewresearch.com",
            "marketsandmarkets.com",
            "mrfresearch.com",
            // 数据中心和基础设施报告
            "epoch.ai",
            "*.epoch.ai",
          ],
          description:
            "Industry reports: Gartner, Forrester, IDC, McKinsey, BCG, Bain, Accenture, Deloitte, PwC, EY, Morgan Stanley, Goldman Sachs, SemiAnalysis, Epoch.ai, etc.",
        },
        {
          resourceType: "EVENT" as ResourceType,
          allowedDomains: [
            "eventbrite.com",
            "meetup.com",
            "conference.com",
            // 大型科技公司活动
            "nvidia.com",
            "intel.com",
            "amd.com",
            "*.nvidia.com",
            "*.intel.com",
            "*.amd.com",
            "microsoft.com",
            "*.microsoft.com",
            "google.com",
            "*.google.com",
            "apple.com",
            "*.apple.com",
            // 学术会议
            "nips.cc",
            "icml.cc",
            "iclr.cc",
            "acl-ijcnlp.org",
            "cvpr2024.thecvf.com",
            "iccv2023.thecvf.com",
            // 行业会议
            "ces.tech",
            "gdc.com",
            "sxsw.com",
          ],
          description:
            "Events and conferences: Eventbrite, Meetup, NeurIPS, ICML, ICLR, CES, GDC, SXSW, etc.",
        },
        {
          resourceType: "POLICY" as ResourceType,
          allowedDomains: [
            // 美国政府机构
            "whitehouse.gov",
            "*.whitehouse.gov",
            "congress.gov",
            "senate.gov",
            "house.gov",
            "federalregister.gov", // 联邦公报
            "*.federalregister.gov",
            "gao.gov", // 政府问责办公室
            "*.gao.gov",
            "cbo.gov", // 国会预算办公室
            "crsreports.congress.gov", // 国会研究服务
            // 联邦机构
            "commerce.gov",
            "*.commerce.gov",
            "bis.doc.gov",
            "ustr.gov",
            "treasury.gov",
            "state.gov",
            "defense.gov",
            "*.defense.gov",
            "darpa.mil", // DARPA
            "*.darpa.mil",
            "ai.mil", // DOD AI Office
            "energy.gov",
            "*.energy.gov",
            "nist.gov",
            "*.nist.gov",
            "nsf.gov", // 国家科学基金会
            "*.nsf.gov",
            "ai.gov", // 国家AI倡议
            "ftc.gov", // 联邦贸易委员会
            "*.ftc.gov",
            // 智库和研究机构
            "brookings.edu",
            "*.brookings.edu",
            "cfr.org",
            "*.cfr.org",
            "csis.org",
            "*.csis.org",
            "rand.org",
            "*.rand.org",
            "cnas.org",
            "*.cnas.org",
            "heritage.org",
            "*.heritage.org",
            "aei.org",
            "*.aei.org",
            "carnegieendowment.org",
            "*.carnegieendowment.org",
            // 科技政策研究
            "itif.org",
            "*.itif.org",
            "cset.georgetown.edu",
            "*.georgetown.edu",
            "ash.harvard.edu",
            "*.harvard.edu",
            "cyber.harvard.edu",
            "law.stanford.edu",
            "*.stanford.edu",
            // 新闻和分析
            "politico.com",
            "*.politico.com",
            "axios.com",
            "*.axios.com",
            "thehill.com",
            "rollcall.com",
            // 国际组织
            "oecd.org",
            "*.oecd.org",
            "wto.org",
            "*.wto.org",
            "europa.eu",
            "*.europa.eu",
            // 行业组织
            "semiconductors.org",
            "*.semiconductors.org",
            "itif.org",
            "*.itif.org",
          ],
          description:
            "US Tech Policy: White House, Congress, Commerce, State Dept, Think tanks (Brookings, CFR, CSIS, RAND), Universities (Georgetown, Harvard, Stanford), etc.",
        },
      ];

      for (const defaultWhitelist of defaults) {
        const existing = await this.prisma.sourceWhitelist.findFirst({
          where: { resourceType: defaultWhitelist.resourceType },
        });

        if (!existing) {
          await this.createWhitelist(defaultWhitelist);
          this.logger.log(
            `Initialized default whitelist for ${defaultWhitelist.resourceType}`,
          );
        }
      }

      this.logger.log("Default whitelists initialization completed");
    } catch (error) {
      this.logger.error(
        `Failed to initialize default whitelists: ${getErrorMessage(error)}`,
      );
      // 不要抛出错误，因为这可能在初始化时发生
    }
  }
}
