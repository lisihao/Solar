/**
 * StartupHub Tool
 * AI 创投库（StartupHub.ai）——按公司名查初创/未上市公司档案：总融资、员工数、成立日期、
 * 赛道、总部、是否 stealth。免费 API（需 key，policyDataService 统一管理）。
 *
 * API 文档: https://www.startuphub.ai/api-docs
 *   - GET /startups?q=...      搜索（返回 slug 等基础字段，1 credit）
 *   - GET /startups/{slug}     完整档案（含 total_funding / employee_count，1 credit）
 * 鉴权: Authorization: Bearer <key>
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";

const BASE_URL = "https://www.startuphub.ai/api/v1";

export interface StartupHubInput {
  /** 公司名称（搜索关键词） */
  query: string;
}

export interface StartupHubOutput {
  found: boolean;
  name?: string;
  oneLiner?: string;
  website?: string;
  hq?: string;
  foundedDate?: string;
  totalFunding?: number;
  employeeCount?: number;
  sectors?: string[];
  operatingStatus?: string;
  stealth?: boolean;
  profileUrl?: string;
  error?: string;
}

interface ShStartup {
  name?: string;
  slug?: string;
  one_liner?: string;
  website?: string;
  hq_city?: string;
  hq_country?: string;
  founded_date?: string;
  total_funding?: number;
  employee_count?: number;
  sectors?: string[];
  operating_status?: string;
  stealth_mode?: boolean;
}

@Injectable()
export class StartupHubTool extends BaseTool<
  StartupHubInput,
  StartupHubOutput
> {
  private readonly logger = new Logger(StartupHubTool.name);

  readonly id = "startuphub-startup";
  readonly sideEffect = "none" as const;
  readonly name = "StartupHub Startup Lookup";
  readonly description =
    "查 AI 初创 / 未上市公司档案（总融资、员工数、成立日期、赛道、总部、stealth 状态）。数据来源：StartupHub.ai（AI 创投库，需 API Key）。适合产业链里非上市公司的画像。";
  readonly category: ToolCategory = "information";
  readonly tags = ["startup", "funding", "venture", "company", "ai"];
  readonly defaultTimeout = 20000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "公司名称（如 OpenAI / Anthropic / Mistral）",
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      found: { type: "boolean" },
      name: { type: "string" },
      oneLiner: { type: "string" },
      website: { type: "string" },
      hq: { type: "string" },
      foundedDate: { type: "string" },
      totalFunding: { type: "number" },
      employeeCount: { type: "number" },
      sectors: { type: "array", items: { type: "string" } },
      operatingStatus: { type: "string" },
      stealth: { type: "boolean" },
      profileUrl: { type: "string" },
      error: { type: "string" },
    },
    required: ["found"],
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: StartupHubInput,
    _context: ToolContext,
  ): Promise<StartupHubOutput> {
    const query = (input.query ?? "").trim();
    if (!query) return { found: false, error: "query 不能为空" };

    const apiKey = await this.policyDataService.getApiKey("startuphub-startup");
    if (!apiKey) {
      this.logger.warn("[doExecute] No API key for startuphub-startup");
      return { found: false, error: "未配置 StartupHub API key" };
    }
    const headers = { Authorization: `Bearer ${apiKey}` };

    try {
      const search = await this.policyDataService.httpGet<{
        data?: ShStartup[];
      }>(`${BASE_URL}/startups`, { q: query, limit: 5 }, headers);
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      const qn = norm(query);
      // 名称大致吻合的最佳命中，避免模糊匹配到无关公司
      const hit = (search?.data ?? []).find((s) => {
        const n = norm(s.name ?? "");
        return n && (n.includes(qn) || qn.includes(n));
      });
      if (!hit?.slug) {
        this.policyDataService.clearKeyFailure("startuphub-startup", apiKey);
        return { found: false };
      }

      const profile = await this.policyDataService
        .httpGet<{
          data?: ShStartup;
        }>(
          `${BASE_URL}/startups/${encodeURIComponent(hit.slug)}`,
          undefined,
          headers,
        )
        .catch(() => null);
      const d: ShStartup = profile?.data ?? hit;
      this.policyDataService.clearKeyFailure("startuphub-startup", apiKey);

      return {
        found: true,
        name: d.name,
        oneLiner: d.one_liner,
        website: d.website,
        hq: [d.hq_city, d.hq_country].filter(Boolean).join(", ") || undefined,
        foundedDate: d.founded_date,
        totalFunding:
          typeof d.total_funding === "number" ? d.total_funding : undefined,
        employeeCount:
          typeof d.employee_count === "number" ? d.employee_count : undefined,
        sectors: Array.isArray(d.sectors) ? d.sectors : undefined,
        operatingStatus: d.operating_status,
        stealth: !!d.stealth_mode,
        profileUrl: `https://www.startuphub.ai/startups/${hit.slug}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const statusMatch = msg.match(/\b(4\d{2}|5\d{2})\b/);
      this.policyDataService.markKeyFailed(
        "startuphub-startup",
        apiKey,
        statusMatch ? parseInt(statusMatch[1], 10) : 500,
      );
      this.logger.warn(`[doExecute] StartupHub query failed: ${msg}`);
      return { found: false, error: msg };
    }
  }
}
