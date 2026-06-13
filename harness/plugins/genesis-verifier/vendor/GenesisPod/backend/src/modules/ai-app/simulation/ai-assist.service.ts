import { Injectable, Logger } from "@nestjs/common";
import { ExternalDataService } from "./external-data.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ChatMessage } from "@/modules/ai-harness/facade";

export interface IndustryAnalysis {
  companies: Array<{
    name: string;
    type: string;
    market: string;
    reason: string;
  }>;
  agents: Array<{
    role: string;
    team: "BLUE" | "RED" | "GREEN" | "WHITE" | "CHAOS";
    reason: string;
  }>;
  goals: {
    targetShare: string;
    risk: string;
    growth: string;
  };
  insights: string[];
}

// 公司类型说明（用于理解 AI 返回的结果）：
// - benchmark: 行业标杆（用户选择自己的公司时通常是这类）
// - competitor: 直接竞争对手（会被分配给RED队）
// - challenger: 挑战者（也是竞争对手，会被分配给RED队）
// - startup: 初创公司（视情况分配给RED或GREEN）
// - customer: 客户（分配给GREEN队）
// - supplier: 供应商（分配给GREEN队）
// - regional: 区域玩家（根据用户选择决定是竞争对手还是自己）

// 公司指标生成模板 - 基于公司类型（仅用于 LLM fallback）
interface CompanyMetricsTemplate {
  cash: { min: number; max: number }; // 万美元
  share: { min: number; max: number }; // %
  margin: { min: number; max: number }; // %
  debt: { min: number; max: number }; // 万美元
  capacity: { min: number; max: number };
  inventory: { min: number; max: number };
  priceBand: string;
  delivery: string;
  patents: { min: number; max: number };
  channels: string;
  brand: string;
}

const COMPANY_METRICS_BY_TYPE: Record<string, CompanyMetricsTemplate> = {
  benchmark: {
    cash: { min: 50000, max: 200000 },
    share: { min: 25, max: 60 },
    margin: { min: 35, max: 55 },
    debt: { min: 10000, max: 50000 },
    capacity: { min: 5000, max: 20000 },
    inventory: { min: 500, max: 2000 },
    priceBand: "高端",
    delivery: "2-4周",
    patents: { min: 500, max: 5000 },
    channels: "直销+代理",
    brand: "global_leader",
  },
  challenger: {
    cash: { min: 20000, max: 80000 },
    share: { min: 10, max: 25 },
    margin: { min: 25, max: 40 },
    debt: { min: 5000, max: 30000 },
    capacity: { min: 2000, max: 8000 },
    inventory: { min: 300, max: 1000 },
    priceBand: "中高端",
    delivery: "3-6周",
    patents: { min: 100, max: 1000 },
    channels: "直销+电商",
    brand: "strong",
  },
  regional: {
    cash: { min: 10000, max: 50000 },
    share: { min: 5, max: 20 },
    margin: { min: 20, max: 35 },
    debt: { min: 3000, max: 20000 },
    capacity: { min: 1000, max: 5000 },
    inventory: { min: 200, max: 800 },
    priceBand: "中端",
    delivery: "2-4周",
    patents: { min: 50, max: 500 },
    channels: "区域代理",
    brand: "growing",
  },
  startup: {
    cash: { min: 1000, max: 20000 },
    share: { min: 1, max: 10 },
    margin: { min: 15, max: 30 },
    debt: { min: 500, max: 10000 },
    capacity: { min: 100, max: 1000 },
    inventory: { min: 50, max: 300 },
    priceBand: "中低端",
    delivery: "4-8周",
    patents: { min: 10, max: 100 },
    channels: "电商+直销",
    brand: "emerging",
  },
};

// 行业特定调整系数
const INDUSTRY_MODIFIERS: Record<
  string,
  Partial<{
    cashMultiplier: number;
    marginBonus: number;
    patentMultiplier: number;
    deliveryFast: boolean;
  }>
> = {
  "AI Compute Infrastructure": {
    cashMultiplier: 2,
    marginBonus: 10,
    patentMultiplier: 3,
  },
  Semiconductor: { cashMultiplier: 3, marginBonus: 15, patentMultiplier: 5 },
  "Cloud Services": { cashMultiplier: 2, marginBonus: 5, deliveryFast: true },
  Fintech: { cashMultiplier: 1.5, marginBonus: -5 },
  "E-commerce": { cashMultiplier: 1.2, deliveryFast: true },
  SaaS: { marginBonus: 20, deliveryFast: true },
  Gaming: { marginBonus: 10, patentMultiplier: 0.5 },
  Healthcare: { cashMultiplier: 2.5, patentMultiplier: 4 },
  "Electric Vehicles": { cashMultiplier: 3, patentMultiplier: 2 },
};

@Injectable()
export class AIAssistService {
  private readonly logger = new Logger(AIAssistService.name);

  constructor(
    private readonly externalData: ExternalDataService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 根据行业和区域分析竞争格局，使用 LLM 动态推荐公司和角色配置
   * 不使用任何硬编码知识库，完全依赖 AI 分析
   */
  async analyzeIndustry(params: {
    industry: string;
    region?: string;
    existingCompanies?: string[];
  }): Promise<IndustryAnalysis> {
    const { industry, region = "Global", existingCompanies = [] } = params;

    this.logger.log(
      `AI Assist analyzing industry with LLM: ${industry}, region: ${region}`,
    );

    // 使用 LLM 动态分析行业竞争格局
    try {
      const analysis = await this.analyzeIndustryWithLLM({
        industry,
        region,
        existingCompanies,
      });

      if (analysis) {
        this.logger.log(
          `LLM analysis successful: ${analysis.companies.length} companies, ${analysis.agents.length} agents`,
        );
        return analysis;
      }
    } catch (err) {
      this.logger.warn(`LLM industry analysis failed: ${err}`);
    }

    // 如果 LLM 分析失败，返回默认模板
    this.logger.warn("Falling back to default analysis template");
    return {
      companies: [
        {
          name: "行业领导者A",
          type: "competitor",
          market: region,
          reason: "市场份额第一的头部企业",
        },
        {
          name: "挑战者B",
          type: "competitor",
          market: region,
          reason: "快速增长的第二梯队企业",
        },
        {
          name: "新兴力量C",
          type: "competitor",
          market: region,
          reason: "创新型初创企业",
        },
      ],
      agents: [
        { role: "CEO", team: "BLUE", reason: "战略决策者" },
        { role: "监管机构", team: "WHITE", reason: "政策合规审查" },
        { role: "行业分析师", team: "WHITE", reason: "市场舆情分析" },
        { role: "黑天鹅事件", team: "CHAOS", reason: "不可预测的外部冲击" },
      ],
      goals: {
        targetShare: "提升市场份额",
        risk: "控制经营风险",
        growth: "实现可持续增长",
      },
      insights: [
        `AI分析暂时不可用，请稍后重试`,
        `您可以手动添加${industry}行业的主要竞争对手`,
      ],
    };
  }

  /**
   * 使用 LLM 动态分析行业竞争格局
   */
  private async analyzeIndustryWithLLM(params: {
    industry: string;
    region: string;
    existingCompanies: string[];
  }): Promise<IndustryAnalysis | null> {
    const { industry, region, existingCompanies } = params;

    const systemPrompt = `你是一位资深的行业分析师和商业情报专家。请根据用户提供的行业和区域信息，分析该行业的竞争格局。

你的分析必须基于真实的市场数据和行业知识，包括：
1. 识别该行业的主要参与者（至少5-8家真实公司）
2. 分析每家公司的市场定位和竞争优势
3. 推荐适合商业模拟的关键角色
4. 提供行业洞察和趋势分析

公司类型说明：
- competitor: 直接竞争对手（用于RED队，模拟竞争压力）
- customer: 主要客户/采购方（用于GREEN队，模拟市场需求）
- supplier: 关键供应商（用于GREEN队，模拟供应链）
- benchmark: 行业标杆（通常是用户自己选择的公司）

注意：
- 不要返回用户已经选择的公司
- 优先推荐真实存在的知名公司
- 根据区域筛选相关公司

请以 JSON 格式返回，不要包含任何其他文字：
{
  "companies": [
    { "name": "公司名称", "type": "competitor/customer/supplier", "market": "Global/China/US/等", "reason": "推荐理由" }
  ],
  "agents": [
    { "role": "角色名称", "team": "WHITE/CHAOS", "reason": "角色作用" }
  ],
  "goals": {
    "targetShare": "市场份额目标建议",
    "risk": "风险控制建议",
    "growth": "增长策略建议"
  },
  "insights": ["行业洞察1", "行业洞察2", "行业洞察3"]
}`;

    const userPrompt = `请分析以下行业的竞争格局：

行业：${industry}
目标区域：${region}
${existingCompanies.length > 0 ? `用户已选择的公司（请不要重复推荐）：${existingCompanies.join("、")}` : ""}

请推荐：
1. 5-8家该行业的主要竞争对手公司（type为competitor）
2. 2-3家主要客户或采购方（type为customer）
3. 1-2家关键供应商（type为supplier）
4. 适合WHITE队（监管/分析师）和CHAOS队（黑天鹅事件）的角色
5. 战略目标建议和行业洞察

所有公司必须是真实存在的知名企业。`;

    // 从数据库获取已配置 API Key 的可用模型
    const availableModels = await this.chatFacade.getAvailableModels();
    this.logger.log(
      `Available models for industry analysis: ${availableModels.map((m) => `${m.name}(${m.provider})`).join(", ")}`,
    );

    if (availableModels.length === 0) {
      this.logger.warn("No AI models with API keys configured in database");
      return null;
    }

    let result = null;

    for (const model of availableModels) {
      try {
        this.logger.log(
          `Trying model: ${model.name} (${model.id}) for industry analysis`,
        );
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];
        result = await this.chatFacade.chat({
          messages,
          model: model.id,
          taskProfile: {
            creativity: "medium",
            outputLength: "medium",
          },
        });

        // 检查是否是 API 错误消息
        if (
          result.content &&
          !result.content.includes("**API Key 未配置**") &&
          !result.content.includes("**") &&
          !result.content.includes("API 调用失败") &&
          !result.content.includes("API Error")
        ) {
          this.logger.log(`Model ${model.name} returned valid response`);
          break;
        } else {
          this.logger.warn(
            `Model ${model.name} returned error or invalid response, trying next...`,
          );
          result = null;
        }
      } catch (modelErr) {
        this.logger.warn(`Model ${model.name} failed: ${modelErr}`);
      }
    }

    try {
      if (!result?.content) {
        this.logger.warn("All LLM models failed for industry analysis");
        return null;
      }

      // 解析 JSON 响应
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          `LLM response is not valid JSON: ${result.content.substring(0, 200)}`,
        );
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证必要字段
      if (!parsed.companies || !Array.isArray(parsed.companies)) {
        this.logger.warn("LLM response missing companies array");
        return null;
      }

      // 确保每个公司有正确的type
      const validatedCompanies = parsed.companies.map(
        (c: {
          name: string;
          type?: string;
          market?: string;
          reason?: string;
        }) => ({
          name: c.name,
          type: c.type || "competitor",
          market: c.market || region,
          reason: c.reason || "",
        }),
      );

      return {
        companies: validatedCompanies,
        agents: parsed.agents || [
          { role: "监管官员", team: "WHITE", reason: "政策合规审查" },
          { role: "行业分析师", team: "WHITE", reason: "市场舆情分析" },
          { role: "黑天鹅事件", team: "CHAOS", reason: "不可预测的外部冲击" },
        ],
        goals: parsed.goals || {
          targetShare: "提升市场份额",
          risk: "控制经营风险",
          growth: "实现可持续增长",
        },
        insights: parsed.insights || [`${industry}行业AI分析完成`],
      };
    } catch (err) {
      this.logger.error(`Failed to parse LLM industry analysis: ${err}`);
      return null;
    }
  }

  /**
   * 根据已有配置推荐补充的角色
   * 关键逻辑：
   * 1. 蓝军绑定用户选择的公司
   * 2. 红军为每个竞争对手公司各生成1-2个角色（CEO为必须，可选销售VP等）
   * 3. 绿军绑定客户/供应商公司
   * 4. 白军/CHAOS不绑定公司
   */
  async suggestAgents(params: {
    industry: string;
    companies: Array<{ name: string; type: string }>;
    existingAgents?: Array<{
      role: string;
      team: string;
      companyName?: string;
    }>;
  }): Promise<
    Array<{
      role: string;
      team: "BLUE" | "RED" | "GREEN" | "WHITE" | "CHAOS";
      companyName?: string;
      reason: string;
    }>
  > {
    const { industry, companies, existingAgents = [] } = params;

    const analysis = await this.analyzeIndustry({ industry });

    // 识别已被蓝军占用的公司
    const blueCompanyNames = new Set(
      existingAgents
        .filter((a) => a.team === "BLUE" && a.companyName)
        .map((a) => a.companyName!.toLowerCase()),
    );

    // 识别所有已存在的角色（团队-角色-公司）
    const existingAgentKeys = new Set(
      existingAgents.map((a) =>
        `${a.team}-${a.role}-${a.companyName || ""}`.toLowerCase(),
      ),
    );

    // 获取可用于红军的公司（非蓝军公司，优先竞争对手类型）
    const redCompanies = companies.filter(
      (c) =>
        !blueCompanyNames.has(c.name.toLowerCase()) &&
        ["competitor", "challenger", "startup", "benchmark"].includes(c.type),
    );

    // 获取可用于绿军的公司（客户/供应商/区域类型）
    const greenCompanies = companies.filter(
      (c) =>
        !blueCompanyNames.has(c.name.toLowerCase()) &&
        ["customer", "supplier", "regional"].includes(c.type),
    );

    this.logger.log(
      `AI Suggest Agents: Blue companies: ${[...blueCompanyNames].join(", ")}`,
    );
    this.logger.log(
      `  Available for RED (${redCompanies.length}): ${redCompanies.map((c) => c.name).join(", ")}`,
    );
    this.logger.log(
      `  Available for GREEN (${greenCompanies.length}): ${greenCompanies.map((c) => c.name).join(", ")}`,
    );

    const suggestions: Array<{
      role: string;
      team: "BLUE" | "RED" | "GREEN" | "WHITE" | "CHAOS";
      companyName?: string;
      reason: string;
    }> = [];

    // === 核心逻辑：为每个RED公司生成角色 ===
    // 每个竞争对手公司至少一个CEO
    for (const company of redCompanies) {
      const ceoKey = `red-ceo-${company.name}`.toLowerCase();
      if (!existingAgentKeys.has(ceoKey)) {
        suggestions.push({
          role: "CEO",
          team: "RED",
          companyName: company.name,
          reason: `${company.name}的战略决策者，代表竞争对手核心利益`,
        });
      }
    }

    // 如果有多个竞争对手，给最强的（benchmark/challenger）加销售VP
    const strongRedCompanies = redCompanies.filter(
      (c) => c.type === "benchmark" || c.type === "challenger",
    );
    for (const company of strongRedCompanies.slice(0, 2)) {
      // 最多2个销售VP
      const vpKey = `red-销售vp-${company.name}`.toLowerCase();
      if (!existingAgentKeys.has(vpKey)) {
        suggestions.push({
          role: "销售VP",
          team: "RED",
          companyName: company.name,
          reason: `${company.name}的市场抢夺执行者`,
        });
      }
    }

    // === 绿军：为每个客户/供应商公司生成代表 ===
    for (const company of greenCompanies) {
      const repKey = `green-客户代表-${company.name}`.toLowerCase();
      if (!existingAgentKeys.has(repKey)) {
        const role = company.type === "supplier" ? "供应商代表" : "客户代表";
        suggestions.push({
          role,
          team: "GREEN",
          companyName: company.name,
          reason: `${company.name}的${company.type === "supplier" ? "供应链" : "采购"}决策者`,
        });
      }
    }

    // === 白军和CHAOS：从模板中取，不绑定公司 ===
    const whiteAndChaosAgents = analysis.agents.filter(
      (a) => a.team === "WHITE" || a.team === "CHAOS",
    );
    for (const agent of whiteAndChaosAgents) {
      const agentKey = `${agent.team}-${agent.role}-`.toLowerCase();
      if (!existingAgentKeys.has(agentKey)) {
        suggestions.push({
          role: agent.role,
          team: agent.team,
          companyName: undefined,
          reason: agent.reason,
        });
      }
    }

    this.logger.log(
      `AI Suggest Agents: Generated ${suggestions.length} suggestions`,
    );

    return suggestions;
  }

  /**
   * 生成推演场景的智能建议
   */
  async generateScenarioSuggestions(params: {
    industry: string;
    region?: string;
    goals?: string;
  }): Promise<{
    name: string;
    description: string;
    recommendedRounds: number;
    chaosProb: number;
    humanBreakEvery: number;
    keyRisks: string[];
  }> {
    const { industry, region = "Global" } = params;

    const analysis = await this.analyzeIndustry({ industry, region });

    // 根据行业特点推荐参数
    const isHighRisk = ["Semiconductor", "AI Compute Infrastructure"].includes(
      industry,
    );
    const isRegulationHeavy = ["Fintech", "Healthcare"].includes(industry);

    return {
      name: `${industry} 战略推演 - ${region}`,
      description: `${industry}行业${region}市场竞争格局推演，涵盖${analysis.companies.length}家主要参与者`,
      recommendedRounds: isHighRisk ? 6 : 4,
      chaosProb: isHighRisk ? 0.35 : isRegulationHeavy ? 0.25 : 0.2,
      humanBreakEvery: isRegulationHeavy ? 1 : 2,
      keyRisks: analysis.insights.slice(0, 3),
    };
  }

  /**
   * 生成公司量化指标建议
   * 策略: 1. 先尝试从外部API获取真实数据 2. 用LLM结合外部数据生成 3. 回退到本地模板
   */
  async generateCompanyMetrics(params: {
    companyName: string;
    companyType: string;
    industry: string;
    market?: string;
  }): Promise<{
    metrics: {
      cash: number;
      share: number;
      margin: number;
      debt: number;
      capacity: number;
      inventory: number;
      priceBand: string;
      delivery: string;
      patents: number;
      channels: string;
      brand: string;
    };
    reasoning: string;
    dataSource?: string; // 数据来源标识
  }> {
    const { companyName, companyType, industry } = params;

    this.logger.log(
      `AI Assist generating metrics for: ${companyName} (${companyType}) in ${industry}`,
    );

    // Step 1: 尝试从外部API获取公司真实数据
    let externalData: unknown = null;
    try {
      const financeResult = await this.externalData.fetchFromProvider(
        "finance",
        undefined,
        { query: companyName },
      );

      if (financeResult.ok && financeResult.data) {
        this.logger.log(
          `[AI Assist] Found external data for ${companyName} from provider: ${financeResult.providerId}`,
        );
        externalData = financeResult.data;
      }
    } catch (err) {
      this.logger.warn(`[AI Assist] External data fetch failed: ${err}`);
    }

    // Step 2: 使用LLM结合外部数据生成指标
    try {
      const llmResult = await this.generateMetricsWithLLM({
        ...params,
        externalData,
      });
      if (llmResult) {
        return {
          ...llmResult,
          dataSource: externalData
            ? "LLM + External API"
            : "LLM (AI Generated)",
        };
      }
    } catch (err) {
      this.logger.warn(
        `LLM metrics generation failed, falling back to template: ${err}`,
      );
    }

    // Step 3: 回退到本地模板生成
    const templateResult = this.generateMetricsFromTemplate(params);
    return {
      ...templateResult,
      dataSource: "Local Template (Fallback)",
    };
  }

  /**
   * 使用 LLM 动态生成公司指标
   * 支持结合外部API数据进行更准确的生成
   */
  private async generateMetricsWithLLM(params: {
    companyName: string;
    companyType: string;
    industry: string;
    market?: string;
    externalData?: unknown;
  }): Promise<{
    metrics: {
      cash: number;
      share: number;
      margin: number;
      debt: number;
      capacity: number;
      inventory: number;
      priceBand: string;
      delivery: string;
      patents: number;
      channels: string;
      brand: string;
    };
    reasoning: string;
  } | null> {
    const {
      companyName,
      companyType,
      industry,
      market = "Global",
      externalData,
    } = params;

    const typeLabels: Record<string, string> = {
      benchmark: "行业标杆/龙头企业",
      challenger: "挑战者/第二梯队",
      regional: "区域龙头",
      startup: "初创公司/新兴企业",
    };

    // 构建系统提示，根据是否有外部数据调整
    let systemPrompt = `你是一位资深的行业分析师和商业情报专家。请根据公司名称、类型、所属行业和市场，生成合理的公司量化指标。

注意事项：
1. 数据应该基于该行业的实际情况和公司类型进行合理估算
2. 如果是知名公司，尽量贴近其公开财务数据的量级
3. 如果是虚构或不知名公司，根据行业和类型给出合理假设
4. 所有数值应该保持内部一致性（如初创公司不应有过高的现金储备）`;

    if (externalData) {
      systemPrompt += `
5. 重要：用户提供了外部API获取的真实数据，请优先参考这些数据，并据此调整生成的指标
6. 如果外部数据中包含财务数据、市场数据，请直接使用或合理换算`;
    }

    systemPrompt += `

请以 JSON 格式返回，不要包含任何其他文字：
{
  "metrics": {
    "cash": <现金储备，万美元>,
    "share": <市场份额，百分比数值如15表示15%>,
    "margin": <毛利率，百分比数值>,
    "debt": <负债，万美元>,
    "capacity": <产能单位数>,
    "inventory": <库存单位数>,
    "priceBand": "<定位：高端/中高端/中端/中低端/低端>",
    "delivery": "<交付周期如：2-4周>",
    "patents": <专利数量>,
    "channels": "<渠道：如直销+代理>",
    "brand": "<品牌力：global_leader/strong/growing/niche/emerging>"
  },
  "reasoning": "<简要说明生成依据，如果使用了外部数据请注明>"
}`;

    // 构建用户提示
    let userPrompt = `公司名称：${companyName}
公司类型：${typeLabels[companyType] || companyType}
所属行业：${industry}
目标市场：${market}`;

    // 如果有外部数据，将其格式化后添加到提示中
    if (externalData) {
      const externalDataStr =
        typeof externalData === "string"
          ? externalData
          : JSON.stringify(externalData, null, 2);

      userPrompt += `

=== 外部API获取的真实数据 ===
${externalDataStr.slice(0, 3000)}${externalDataStr.length > 3000 ? "\n...(数据已截断)" : ""}
===========================`;
    }

    userPrompt += `

请生成该公司的量化指标。`;

    // 从数据库获取可用模型
    const availableModels = await this.chatFacade.getAvailableModels();
    if (availableModels.length === 0) {
      this.logger.warn("No AI models available for metrics generation");
      return null;
    }

    // 使用第一个可用模型（优先默认模型）
    const model = availableModels[0];
    this.logger.log(
      `Using model ${model.name} (${model.id}) for company metrics generation`,
    );

    try {
      const metricsMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const result = await this.chatFacade.chat({
        messages: metricsMessages,
        model: model.id,
        taskProfile: {
          creativity: "medium",
          outputLength: "short",
        },
      });

      if (!result.content) {
        return null;
      }

      // 检查是否是 API 错误
      if (
        result.content.includes("**API Key 未配置**") ||
        result.content.includes("API Error")
      ) {
        this.logger.warn("Model returned API error for metrics generation");
        return null;
      }

      // 解析 JSON 响应
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("LLM response is not valid JSON");
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证必要字段
      if (!parsed.metrics || typeof parsed.metrics.cash !== "number") {
        this.logger.warn("LLM response missing required metrics fields");
        return null;
      }

      return {
        metrics: {
          cash: parsed.metrics.cash || 0,
          share: parsed.metrics.share || 0,
          margin: parsed.metrics.margin || 0,
          debt: parsed.metrics.debt || 0,
          capacity: parsed.metrics.capacity || 0,
          inventory: parsed.metrics.inventory || 0,
          priceBand: parsed.metrics.priceBand || "中端",
          delivery: parsed.metrics.delivery || "2-4周",
          patents: parsed.metrics.patents || 0,
          channels: parsed.metrics.channels || "直销",
          brand: parsed.metrics.brand || "growing",
        },
        reasoning:
          parsed.reasoning || `基于${industry}行业${companyType}类型生成`,
      };
    } catch (err) {
      this.logger.error(`Failed to parse LLM response: ${err}`);
      return null;
    }
  }

  /**
   * 使用本地模板生成公司指标（回退方案）
   */
  private generateMetricsFromTemplate(params: {
    companyName: string;
    companyType: string;
    industry: string;
    market?: string;
  }): {
    metrics: {
      cash: number;
      share: number;
      margin: number;
      debt: number;
      capacity: number;
      inventory: number;
      priceBand: string;
      delivery: string;
      patents: number;
      channels: string;
      brand: string;
    };
    reasoning: string;
  } {
    const { companyName, companyType, industry, market = "Global" } = params;

    // 1. 获取公司类型基础模板
    const template =
      COMPANY_METRICS_BY_TYPE[companyType] ||
      COMPANY_METRICS_BY_TYPE["startup"];

    // 2. 获取行业调整系数
    let modifier = INDUSTRY_MODIFIERS[industry] || {};

    // 尝试模糊匹配行业
    if (!INDUSTRY_MODIFIERS[industry]) {
      const lowerIndustry = industry.toLowerCase();
      for (const [key, value] of Object.entries(INDUSTRY_MODIFIERS)) {
        if (
          key.toLowerCase().includes(lowerIndustry) ||
          lowerIndustry.includes(key.toLowerCase())
        ) {
          modifier = value;
          break;
        }
      }
    }

    // 3. 生成随机值的辅助函数
    const randomBetween = (min: number, max: number) =>
      Math.round(min + Math.random() * (max - min));

    // 4. 应用模板和行业调整
    const cashMultiplier = modifier.cashMultiplier || 1;
    const marginBonus = modifier.marginBonus || 0;
    const patentMultiplier = modifier.patentMultiplier || 1;

    const metrics = {
      cash: randomBetween(
        template.cash.min * cashMultiplier,
        template.cash.max * cashMultiplier,
      ),
      share: randomBetween(template.share.min, template.share.max),
      margin: Math.min(
        70,
        randomBetween(template.margin.min, template.margin.max) + marginBonus,
      ),
      debt: randomBetween(template.debt.min, template.debt.max),
      capacity: randomBetween(template.capacity.min, template.capacity.max),
      inventory: randomBetween(template.inventory.min, template.inventory.max),
      priceBand: template.priceBand,
      delivery: modifier.deliveryFast
        ? this.shortenDelivery(template.delivery)
        : template.delivery,
      patents: Math.round(
        randomBetween(template.patents.min, template.patents.max) *
          patentMultiplier,
      ),
      channels: template.channels,
      brand: template.brand,
    };

    // 5. 区域调整
    if (market === "China" || market === "Asia") {
      metrics.share = Math.min(metrics.share * 1.2, 80); // 区域市场份额可能更高
    }

    // 6. 生成推理说明
    const typeLabels: Record<string, string> = {
      benchmark: "行业标杆",
      challenger: "挑战者",
      regional: "区域龙头",
      startup: "初创公司",
    };

    const reasoning = `基于${companyName}作为${industry}行业的${typeLabels[companyType] || companyType}，结合${market}市场特点生成（本地模板）。`;

    return { metrics, reasoning };
  }

  /**
   * 缩短交付周期
   */
  private shortenDelivery(delivery: string): string {
    const match = delivery.match(/(\d+)-(\d+)/);
    if (match) {
      const min = Math.max(1, parseInt(match[1]) - 1);
      const max = Math.max(2, parseInt(match[2]) - 1);
      return `${min}-${max}周`;
    }
    return delivery;
  }

  /**
   * 根据行业和场景配置，AI推荐最优推演参数
   */
  async suggestParams(params: {
    industry: string;
    region?: string;
    companyCount?: number;
    agentCount?: number;
    goals?: {
      targetShare?: string;
      risk?: string;
      growth?: string;
    };
  }): Promise<{
    blindMove: boolean;
    cot: boolean;
    chaosProb: number;
    irrationalProb: number;
    humanBreakEvery: number;
    rounds: number;
    enabledEvents: string[];
    reasoning: string;
  }> {
    const {
      industry,
      region = "Global",
      companyCount = 2,
      agentCount = 3,
      goals,
    } = params;

    this.logger.log(
      `AI Assist suggesting params for: ${industry}, region: ${region}, companies: ${companyCount}, agents: ${agentCount}`,
    );

    // 行业特征判断
    const isHighVolatility = [
      "AI Compute Infrastructure",
      "Semiconductor",
      "Electric Vehicles",
    ].includes(industry);

    const isHighRegulation = [
      "Fintech",
      "Healthcare",
      "Semiconductor",
    ].includes(industry);

    const isFastPaced = [
      "E-commerce",
      "SaaS",
      "Cloud Services",
      "Gaming",
    ].includes(industry);

    const isGeopolitical = [
      "AI Compute Infrastructure",
      "Semiconductor",
    ].includes(industry);

    // 根据行业特征推荐参数
    let blindMove = true; // 默认开启盲注，更真实
    const cot = true; // 默认开启CoT，提高透明度
    let chaosProb = 0.2; // 基础黑天鹅概率
    let irrationalProb = 0.15; // 基础非理性概率
    let humanBreakEvery = 2; // 默认每2轮人工介入
    let rounds = 4; // 默认4轮

    // 高波动性行业
    if (isHighVolatility) {
      chaosProb = 0.35;
      irrationalProb = 0.25;
      rounds = 6;
    }

    // 高监管行业
    if (isHighRegulation) {
      humanBreakEvery = 1; // 每轮都需要人工审核
      irrationalProb = 0.1; // 监管压力下更理性
    }

    // 快节奏行业
    if (isFastPaced) {
      blindMove = true;
      chaosProb = 0.25;
    }

    // 地缘政治敏感行业
    if (isGeopolitical) {
      chaosProb = Math.min(0.5, chaosProb + 0.15);
    }

    // 根据参与者数量调整
    if (companyCount > 3) {
      rounds = Math.min(8, rounds + 2); // 更多公司需要更多轮次
      humanBreakEvery = Math.min(3, humanBreakEvery + 1);
    }

    if (agentCount > 6) {
      humanBreakEvery = Math.max(1, humanBreakEvery - 1); // 更多角色需要更频繁审核
    }

    // 根据区域调整
    if (region === "China") {
      chaosProb = Math.min(0.5, chaosProb + 0.1); // 政策不确定性
    }

    // 根据目标调整
    if (goals?.risk?.includes("高") || goals?.risk?.includes("控制")) {
      humanBreakEvery = Math.max(1, humanBreakEvery - 1);
    }

    // 推荐启用的事件类型
    const enabledEvents: string[] = [
      "supply_chain",
      "regulation",
      "competitor",
    ];

    if (isHighVolatility) {
      enabledEvents.push("tech", "finance");
    }

    if (isHighRegulation) {
      enabledEvents.push("media", "customer");
    }

    if (isGeopolitical) {
      enabledEvents.push("disaster", "talent");
    }

    // 生成推理说明
    const reasoningParts: string[] = [];

    if (isHighVolatility) {
      reasoningParts.push("高波动性行业，建议较高的黑天鹅概率和更多轮次");
    }
    if (isHighRegulation) {
      reasoningParts.push("高监管行业，建议每轮人工审核，降低非理性决策");
    }
    if (isFastPaced) {
      reasoningParts.push("快节奏行业，适合盲注模式模拟同时决策");
    }
    if (isGeopolitical) {
      reasoningParts.push("地缘政治敏感，增加不确定性参数");
    }
    if (companyCount > 3) {
      reasoningParts.push(`${companyCount}家公司参与，建议增加推演轮数`);
    }

    const reasoning =
      reasoningParts.length > 0
        ? `基于${industry}行业特征：${reasoningParts.join("；")}`
        : `基于${industry}行业的通用配置，建议适度的不确定性和人工介入`;

    return {
      blindMove,
      cot,
      chaosProb: Math.round(chaosProb * 100) / 100,
      irrationalProb: Math.round(irrationalProb * 100) / 100,
      humanBreakEvery,
      rounds,
      enabledEvents,
      reasoning,
    };
  }
}
