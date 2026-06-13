/**
 * Congress.gov Tool
 * 国会立法搜索工具 - 搜索法案、决议、投票记录等
 *
 * API 文档: https://api.congress.gov/
 * 需要 API Key（免费申请）: https://api.congress.gov/sign-up/
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "./policy-data.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 法案类型
 */
export type BillType =
  | "hr" // House Bill (众议院法案)
  | "s" // Senate Bill (参议院法案)
  | "hjres" // House Joint Resolution (众议院联合决议)
  | "sjres" // Senate Joint Resolution (参议院联合决议)
  | "hconres" // House Concurrent Resolution
  | "sconres" // Senate Concurrent Resolution
  | "hres" // House Simple Resolution
  | "sres"; // Senate Simple Resolution

/**
 * 输入参数
 */
export interface CongressGovInput {
  /** 搜索关键词 */
  query?: string;
  /** 国会届数（如 118 代表第 118 届国会） */
  congress?: number;
  /** 法案类型 */
  billType?: BillType | BillType[];
  /** 特定法案编号（如 hr1234） */
  billNumber?: string;
  /** 主题/政策领域 */
  subject?: string;
  /** 最大结果数 */
  limit?: number;
  /** 偏移量（分页） */
  offset?: number;
}

/**
 * 法案信息
 */
export interface CongressBill {
  /** 法案编号（如 H.R.1234） */
  number: string;
  /** 法案类型 */
  type: string;
  /** 国会届数 */
  congress: number;
  /** 标题 */
  title: string;
  /** 简短标题 */
  shortTitle?: string;
  /** 最新状态 */
  latestAction?: {
    actionDate: string;
    text: string;
  };
  /** 提出日期 */
  introducedDate: string;
  /** 提案人 */
  sponsors?: string[];
  /** 原始链接 */
  url: string;
  /** 政策领域 */
  policyArea?: string;
  /** 委员会 */
  committees?: string[];
}

/**
 * 输出结果
 */
export interface CongressGovOutput {
  /** 是否成功 */
  success: boolean;
  /** 法案列表 */
  bills: CongressBill[];
  /** 结果总数 */
  totalCount: number;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

interface CongressApiResponse {
  bills?: CongressApiBill[];
  pagination?: {
    count: number;
    next?: string;
  };
}

interface CongressApiBill {
  number: string;
  type: string;
  congress: number;
  title: string;
  shortTitle?: string;
  latestAction?: {
    actionDate: string;
    text: string;
  };
  introducedDate: string;
  sponsors?: Array<{ fullName: string }>;
  url: string;
  policyArea?: {
    name: string;
  };
  committees?: {
    item?: Array<{ name: string }>;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class CongressGovTool extends BaseTool<
  CongressGovInput,
  CongressGovOutput
> {
  private readonly logger = new Logger(CongressGovTool.name);

  readonly id = "congress-gov";
  readonly sideEffect = "none" as const;
  readonly name = "Congress Legislation Search";
  readonly description =
    "搜索美国国会法案、决议、立法进程。数据来源：Congress.gov API，需要 API Key（免费申请）。";
  readonly category: ToolCategory = "information";
  readonly tags = ["policy", "legislation", "congress", "bills"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      congress: {
        type: "number",
        description: "国会届数，如 118（当前为第 118 届国会，2023-2025）",
      },
      billType: {
        oneOf: [
          {
            type: "string",
            enum: [
              "hr",
              "s",
              "hjres",
              "sjres",
              "hconres",
              "sconres",
              "hres",
              "sres",
            ],
          },
          {
            type: "array",
            items: {
              type: "string",
              enum: [
                "hr",
                "s",
                "hjres",
                "sjres",
                "hconres",
                "sconres",
                "hres",
                "sres",
              ],
            },
          },
        ],
        description:
          "法案类型：hr=众议院法案，s=参议院法案，hjres/sjres=联合决议",
      },
      billNumber: {
        type: "string",
        description: "特定法案编号，如 hr1234 或 s567",
      },
      subject: {
        type: "string",
        description: "政策主题/领域",
      },
      limit: {
        type: "number",
        description: "最大结果数，默认 20",
        default: 20,
      },
      offset: {
        type: "number",
        description: "结果偏移量（用于分页）",
        default: 0,
      },
    },
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      bills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: { type: "string" },
            type: { type: "string" },
            congress: { type: "number" },
            title: { type: "string" },
            shortTitle: { type: "string" },
            latestAction: {
              type: "object",
              properties: {
                actionDate: { type: "string" },
                text: { type: "string" },
              },
            },
            introducedDate: { type: "string" },
            sponsors: { type: "array", items: { type: "string" } },
            url: { type: "string" },
            policyArea: { type: "string" },
            committees: { type: "array", items: { type: "string" } },
          },
        },
      },
      totalCount: { type: "number" },
      error: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: CongressGovInput,
    _context: ToolContext,
  ): Promise<CongressGovOutput> {
    const {
      query,
      congress,
      billType,
      billNumber,
      subject,
      limit = 20,
      offset = 0,
    } = input;

    // Default to current congress if not specified
    const effectiveCongress = congress ?? this.getCurrentCongress();

    this.logger.log(
      `[doExecute] Searching Congress.gov: query="${query}", congress=${effectiveCongress}`,
    );

    // 获取 API Key (hoisted for catch block access)
    const apiKey = await this.policyDataService.getApiKey(this.id);

    try {
      if (!apiKey) {
        return {
          success: false,
          bills: [],
          totalCount: 0,
          error:
            "Congress.gov API Key 未配置。请在 Admin > Tools Manager 中配置 API Key。申请地址: https://api.congress.gov/sign-up/",
        };
      }

      // 构建 API URL
      let url = "https://api.congress.gov/v3";

      // 如果查询特定法案
      if (billNumber && effectiveCongress) {
        const match = billNumber.match(/^([a-z]+)(\d+)$/i);
        if (match && match[1] && match[2]) {
          const type = match[1];
          const num = match[2];
          url += `/bill/${effectiveCongress}/${type.toLowerCase()}/${num}`;
        } else {
          this.logger.warn(
            `[doExecute] Invalid bill number format: ${billNumber}`,
          );
          return {
            success: false,
            bills: [],
            totalCount: 0,
            error: `无效的法案编号格式: ${billNumber}。期望格式: hr1234 或 s567`,
          };
        }
      } else {
        url += "/bill";
      }

      // 构建参数
      const params: Record<string, string | number | boolean | undefined> = {
        api_key: apiKey,
        limit: Math.min(limit, 250),
        offset,
        format: "json",
      };

      // 添加过滤条件
      if (effectiveCongress && !billNumber) {
        url += `/${effectiveCongress}`;
      }

      if (billType && !billNumber) {
        const types = Array.isArray(billType) ? billType : [billType];
        if (types.length === 1) {
          url += `/${types[0]}`;
        }
      }

      // 搜索关键词需要使用 search endpoint
      if (query) {
        params.q = this.sanitizeQuery(query);
      }

      if (subject) {
        params.subject = subject;
      }

      // 发送请求
      const response =
        await this.policyDataService.httpGet<CongressApiResponse>(url, params);

      // 转换结果
      const billsData = response.bills || [];
      const bills: CongressBill[] = billsData.map((bill) => ({
        number: `${bill.type.toUpperCase()}.${bill.number}`,
        type: bill.type,
        congress: bill.congress,
        title: bill.title,
        shortTitle: bill.shortTitle,
        latestAction: bill.latestAction,
        introducedDate: bill.introducedDate,
        sponsors: bill.sponsors?.map((s) => s.fullName),
        url:
          bill.url ||
          `https://www.congress.gov/bill/${bill.congress}th-congress/${this.getBillTypeSlug(bill.type)}/${bill.number}`,
        policyArea: bill.policyArea?.name,
        committees: bill.committees?.item?.map((c) => c.name),
      }));

      const totalCount = response.pagination?.count || bills.length;

      this.logger.log(
        `[doExecute] Found ${bills.length} bills (total: ${totalCount})`,
      );

      // Mark key as healthy on success
      this.policyDataService.clearKeyFailure(this.id, apiKey);

      return {
        success: true,
        bills,
        totalCount,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] Congress.gov API error: ${error}`);

      // Track key failure for multi-key rotation
      if (apiKey) {
        const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
        this.policyDataService.markKeyFailed(this.id, apiKey, statusCode);
      }

      return {
        success: false,
        bills: [],
        totalCount: 0,
        error: `Congress.gov 搜索失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 计算当前国会届次
   * 美国国会每 2 年一届，第 1 届始于 1789 年
   */
  private getCurrentCongress(): number {
    const year = new Date().getFullYear();
    return Math.floor((year - 1789) / 2) + 1;
  }

  /**
   * 清理查询字符串：移除中文字符，保留英文和数字
   * Congress.gov API 不支持中文查询
   */
  private sanitizeQuery(query: string): string {
    // Remove Chinese characters (CJK Unified Ideographs range)
    const sanitized = query
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return sanitized || ""; // return empty string if all chars removed
  }

  /**
   * 将法案类型转换为 URL slug
   */
  private getBillTypeSlug(type: string): string {
    const typeMap: Record<string, string> = {
      hr: "house-bill",
      s: "senate-bill",
      hjres: "house-joint-resolution",
      sjres: "senate-joint-resolution",
      hconres: "house-concurrent-resolution",
      sconres: "senate-concurrent-resolution",
      hres: "house-resolution",
      sres: "senate-resolution",
    };
    return typeMap[type.toLowerCase()] || type;
  }

  validateInput(input: CongressGovInput): boolean {
    // 至少需要一个搜索条件
    return !!(
      input.query ||
      input.congress ||
      input.billType ||
      input.billNumber ||
      input.subject
    );
  }
}
