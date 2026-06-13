/**
 * Context Initialization Service
 * 上下文初始化服务（世界观设定生成）
 *
 * AI Engine 核心能力：
 * - 在任务执行前生成核心设定（时代、人物、阵营等）
 * - 将设定转换为硬性约束，注入所有执行 Agent
 * - 解决多 Agent 并行创作时的设定不一致问题
 *
 * 与 ContextEvolutionService 互补：
 * - ContextInitializationService（本服务）：任务执行前生成初始设定
 * - ContextEvolutionService：任务完成后提取演进的事实
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IContextInitializationService,
  WorldSettings,
  WorldSettingsEra,
  WorldSettingsCharacter,
  WorldSettingsFaction,
  ContentType,
  HardConstraint,
  CoreEntity,
  WorldBuildingResult,
} from "./world-building.types";
import type { AiCallerFn } from "@/modules/ai-engine/llm/types/ai-caller.types";

@Injectable()
export class ContextInitializationService implements IContextInitializationService {
  private readonly logger = new Logger(ContextInitializationService.name);

  /**
   * 检测任务是否需要世界观设定
   */
  detectContentType(
    title: string,
    description: string,
  ): { needed: boolean; contentType: ContentType } {
    const fullText = `${title} ${description}`.toLowerCase();

    // 小说类关键词
    const novelKeywords = [
      "小说",
      "故事",
      "创作",
      "写作",
      "章节",
      "剧情",
      "人物",
      "情节",
      "穿越",
      "宫廷",
      "武侠",
      "玄幻",
      "言情",
      "悬疑",
      "科幻",
      "历史",
      "男主",
      "女主",
      "主角",
      "反派",
      "番外",
      "连载",
      "长篇",
    ];

    // 技术文档类关键词
    const documentKeywords = [
      "文档",
      "手册",
      "指南",
      "教程",
      "api",
      "接口",
      "规范",
      "协议",
      "架构",
      "设计",
    ];

    // 研究报告类关键词
    const researchKeywords = [
      "报告",
      "分析",
      "研究",
      "调研",
      "洞察",
      "趋势",
      "市场",
      "行业",
    ];

    // 检测小说类
    const novelMatches = novelKeywords.filter((kw) => fullText.includes(kw));
    if (novelMatches.length >= 2) {
      this.logger.log(
        `[detectContentType] Detected novel content, matches: ${novelMatches.join(", ")}`,
      );
      return { needed: true, contentType: "novel" };
    }

    // 检测技术文档类
    const docMatches = documentKeywords.filter((kw) => fullText.includes(kw));
    if (docMatches.length >= 2) {
      this.logger.log(
        `[detectContentType] Detected document content, matches: ${docMatches.join(", ")}`,
      );
      return { needed: true, contentType: "document" };
    }

    // 检测研究报告类
    const researchMatches = researchKeywords.filter((kw) =>
      fullText.includes(kw),
    );
    if (researchMatches.length >= 2) {
      this.logger.log(
        `[detectContentType] Detected research content, matches: ${researchMatches.join(", ")}`,
      );
      return { needed: true, contentType: "research" };
    }

    // 其他类型不需要世界观设定
    return { needed: false, contentType: "other" };
  }

  /**
   * 生成世界观设定
   */
  async generateWorldSettings(
    title: string,
    description: string,
    contentType: ContentType,
    aiCaller: AiCallerFn,
    aiModel: string,
  ): Promise<{ settings: WorldSettings; tokensUsed: number }> {
    const prompt = this.buildWorldBuildingPrompt(
      title,
      description,
      contentType,
    );

    // ★ 增加 maxTokens 到 8000，支持 Reasoning 模型（如 o1/gpt-5.1）
    // 这些模型需要大量 token 用于内部思考，4000 远远不够
    const response = await aiCaller(
      aiModel,
      [
        {
          role: "system",
          content:
            "你是一个专业的世界观架构师。请根据任务描述，设计一套完整、一致的世界观设定。输出 JSON 格式。",
        },
        { role: "user", content: prompt },
      ],
      {
        taskProfile: {
          creativity: "medium",
          outputLength: "long",
        },
      },
    );

    const settings = this.parseWorldSettings(response.content, contentType);

    this.logger.log(
      `[generateWorldSettings] Generated world settings: ${settings.characters.length} characters, ${settings.factions.length} factions, ${settings.coreRules.length} rules`,
    );

    return { settings, tokensUsed: response.tokensUsed };
  }

  /**
   * 将世界观设定转换为硬性约束
   */
  settingsToConstraints(settings: WorldSettings): HardConstraint[] {
    const constraints: HardConstraint[] = [];
    let index = 0;

    // 时代约束（最高优先级）
    constraints.push({
      id: `WB-ERA-${++index}`,
      rule: `时代背景：${settings.era.period}${settings.era.year ? `，具体时间：${settings.era.year}` : ""}`,
      reason: "确保所有内容在同一时代背景下",
      severity: "MUST",
    });

    // 人物约束
    for (const char of settings.characters) {
      constraints.push({
        id: `WB-CHAR-${++index}`,
        rule: `人物「${char.name}」的身份是「${char.identity}」，角色定位是「${char.role}」`,
        reason: "确保人物身份一致性",
        severity: "MUST",
      });

      // 人物特殊约束（如：哑巴、残疾等）
      for (const constraint of char.constraints) {
        constraints.push({
          id: `WB-CHAR-C-${++index}`,
          rule: `人物「${char.name}」：${constraint}`,
          reason: "人物设定约束",
          severity: "MUST",
        });
      }
    }

    // 阵营约束
    for (const faction of settings.factions) {
      constraints.push({
        id: `WB-FACTION-${++index}`,
        rule: `阵营「${faction.name}」：${faction.description}，核心成员包括：${faction.keyMembers.join("、")}`,
        reason: "确保阵营设定一致性",
        severity: "MUST",
      });
    }

    // 核心规则
    for (const rule of settings.coreRules) {
      constraints.push({
        id: `WB-RULE-${++index}`,
        rule,
        reason: "核心世界观规则",
        severity: "MUST",
      });
    }

    // 禁止事项
    for (const prohibition of settings.prohibitions) {
      constraints.push({
        id: `WB-PROHIBIT-${++index}`,
        rule: `禁止：${prohibition}`,
        reason: "世界观禁止事项",
        severity: "MUST",
      });
    }

    return constraints;
  }

  /**
   * 将世界观设定转换为核心实体
   */
  settingsToEntities(settings: WorldSettings): CoreEntity[] {
    const entities: CoreEntity[] = [];

    // 人物实体
    for (const char of settings.characters) {
      entities.push({
        name: char.name,
        type: "人物",
        definition: `${char.role}，身份为${char.identity}`,
        attributes: {
          role: char.role,
          identity: char.identity,
          traits: char.traits.join("、"),
        },
      });
    }

    // 阵营实体
    for (const faction of settings.factions) {
      entities.push({
        name: faction.name,
        type: "组织/阵营",
        definition: faction.description,
        attributes: {
          keyMembers: faction.keyMembers.join("、"),
        },
      });
    }

    return entities;
  }

  /**
   * 完整的世界观构建流程
   */
  async buildWorldContext(
    title: string,
    description: string,
    aiCaller: AiCallerFn,
    aiModel: string,
  ): Promise<WorldBuildingResult> {
    // 1. 检测是否需要世界观设定
    const { needed, contentType } = this.detectContentType(title, description);

    if (!needed) {
      this.logger.log(
        `[buildWorldContext] World building not needed for content type: ${contentType}`,
      );
      return { needed: false, contentType, tokensUsed: 0 };
    }

    try {
      // 2. 生成世界观设定
      const { settings, tokensUsed } = await this.generateWorldSettings(
        title,
        description,
        contentType,
        aiCaller,
        aiModel,
      );

      // 3. 转换为约束和实体
      const hardConstraints = this.settingsToConstraints(settings);
      const entities = this.settingsToEntities(settings);

      this.logger.log(
        `[buildWorldContext] World building completed: ${hardConstraints.length} constraints, ${entities.length} entities`,
      );

      return {
        needed: true,
        contentType,
        settings,
        hardConstraints,
        entities,
        tokensUsed,
      };
    } catch (error) {
      this.logger.error(
        `[buildWorldContext] Failed to build world context: ${error}`,
      );
      return { needed: true, contentType, tokensUsed: 0 };
    }
  }

  /**
   * 格式化世界观设定为可读消息
   */
  formatWorldSettingsMessage(settings: WorldSettings): string {
    const sections: string[] = [];

    sections.push(`📚 **世界观设定已确立**\n`);

    // 时代背景
    sections.push(`### 时代背景`);
    sections.push(`- **时期**: ${settings.era.period}`);
    if (settings.era.year) {
      sections.push(`- **年份**: ${settings.era.year}`);
    }
    if (settings.era.description) {
      sections.push(`- **特征**: ${settings.era.description}`);
    }

    // 核心人物
    if (settings.characters.length > 0) {
      sections.push(`\n### 核心人物`);
      for (const char of settings.characters) {
        sections.push(`- **${char.name}** (${char.role}): ${char.identity}`);
        if (char.constraints.length > 0) {
          sections.push(`  - 特殊设定: ${char.constraints.join("、")}`);
        }
      }
    }

    // 阵营
    if (settings.factions.length > 0) {
      sections.push(`\n### 阵营势力`);
      for (const faction of settings.factions) {
        sections.push(`- **${faction.name}**: ${faction.description}`);
        if (faction.keyMembers.length > 0) {
          sections.push(`  - 核心成员: ${faction.keyMembers.join("、")}`);
        }
      }
    }

    // 核心规则
    if (settings.coreRules.length > 0) {
      sections.push(`\n### 核心规则`);
      for (const rule of settings.coreRules) {
        sections.push(`- ${rule}`);
      }
    }

    // 禁止事项
    if (settings.prohibitions.length > 0) {
      sections.push(`\n### 禁止事项`);
      for (const prohibition of settings.prohibitions) {
        sections.push(`- ⚠️ ${prohibition}`);
      }
    }

    sections.push(
      `\n---\n*以上设定将作为硬性约束注入到所有任务执行中，确保内容一致性。*`,
    );

    return sections.join("\n");
  }

  // ==================== 私有方法 ====================

  /**
   * 构建世界观生成提示词
   */
  private buildWorldBuildingPrompt(
    title: string,
    description: string,
    contentType: ContentType,
  ): string {
    const basePrompt = `请根据以下任务描述，设计一套完整的世界观设定。

【任务标题】
${title}

【任务描述】
${description}

【输出格式】
请输出 JSON 格式的世界观设定：

\`\`\`json
{
  "era": {
    "period": "时代背景（如：明朝天启年间）",
    "year": "具体年份（可选，如：天启六年）",
    "description": "时代特征简述"
  },
  "characters": [
    {
      "name": "人物名",
      "role": "角色定位（如：女主、男主、反派）",
      "identity": "身份（如：宫女、太子、大太监）",
      "traits": ["性格特征1", "性格特征2"],
      "constraints": ["特殊约束，如：不能说话", "身体特征"]
    }
  ],
  "factions": [
    {
      "name": "阵营名",
      "description": "阵营描述",
      "keyMembers": ["成员1", "成员2"]
    }
  ],
  "coreRules": [
    "核心规则1",
    "核心规则2"
  ],
  "prohibitions": [
    "禁止事项1（如：不能出现现代元素）"
  ]
}
\`\`\`
`;

    if (contentType === "novel") {
      return (
        basePrompt +
        `
【小说类特别要求】
1. 时代背景要具体到年份或年号，避免模糊
2. 人物命名要符合时代特征
3. 阵营要有明确的对立关系
4. 特别注意：如果描述中提到了特定历史事件或人物（如东林党），时代必须与之匹配
5. 人物的 constraints 要具体可验证（如：左手有胎记、不能说话）`
      );
    }

    if (contentType === "document") {
      return (
        basePrompt +
        `
【技术文档特别要求】
1. era 改为「技术版本」（如：React 18.x）
2. characters 改为「核心概念/组件」
3. factions 改为「模块/层级」
4. coreRules 为「设计原则」
5. prohibitions 为「反模式/禁止做法」`
      );
    }

    return basePrompt;
  }

  /**
   * 解析世界观设定 JSON
   */
  private parseWorldSettings(
    content: string,
    contentType: ContentType,
  ): WorldSettings {
    // 提取 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : content;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      this.logger.warn(
        `[parseWorldSettings] Failed to parse JSON, using default settings`,
      );
      return this.getDefaultSettings(contentType);
    }

    // 验证和转换
    return {
      era: this.parseEra(parsed.era),
      characters: this.parseCharacters(parsed.characters),
      factions: this.parseFactions(parsed.factions),
      coreRules: this.parseStringArray(parsed.coreRules),
      prohibitions: this.parseStringArray(parsed.prohibitions),
    };
  }

  private parseEra(era: unknown): WorldSettingsEra {
    if (!era || typeof era !== "object") {
      return { period: "未指定", description: "" };
    }
    const e = era as Record<string, unknown>;
    return {
      period: typeof e.period === "string" ? e.period : "未指定",
      year: typeof e.year === "string" ? e.year : undefined,
      description: typeof e.description === "string" ? e.description : "",
    };
  }

  private parseCharacters(characters: unknown): WorldSettingsCharacter[] {
    if (!Array.isArray(characters)) return [];
    return characters
      .filter(
        (c): c is Record<string, unknown> =>
          c !== null && typeof c === "object",
      )
      .map((c) => ({
        name: typeof c.name === "string" ? c.name : "未命名",
        role: typeof c.role === "string" ? c.role : "未知",
        identity: typeof c.identity === "string" ? c.identity : "未知",
        traits: Array.isArray(c.traits)
          ? c.traits.filter((t): t is string => typeof t === "string")
          : [],
        constraints: Array.isArray(c.constraints)
          ? c.constraints.filter((t): t is string => typeof t === "string")
          : [],
      }));
  }

  private parseFactions(factions: unknown): WorldSettingsFaction[] {
    if (!Array.isArray(factions)) return [];
    return factions
      .filter(
        (f): f is Record<string, unknown> =>
          f !== null && typeof f === "object",
      )
      .map((f) => ({
        name: typeof f.name === "string" ? f.name : "未命名",
        description: typeof f.description === "string" ? f.description : "",
        keyMembers: Array.isArray(f.keyMembers)
          ? f.keyMembers.filter((m): m is string => typeof m === "string")
          : [],
      }));
  }

  private parseStringArray(arr: unknown): string[] {
    if (!Array.isArray(arr)) return [];
    return arr.filter((item): item is string => typeof item === "string");
  }

  private getDefaultSettings(contentType: ContentType): WorldSettings {
    return {
      era: {
        period: contentType === "novel" ? "架空时代" : "当前版本",
        description: "",
      },
      characters: [],
      factions: [],
      coreRules: [],
      prohibitions: [],
    };
  }
}
