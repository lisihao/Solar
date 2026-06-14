import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  DiscussionRole,
  AgentState,
  AGENT_ICONS,
  DiscussionMessage,
  DiscussionPhase,
  DiscussionMessageType,
  ResearchDirection,
} from "./discussion-types";
import {
  ResearchLanguage,
  resolveLanguage,
  AGENT_NAMES,
  RESEARCHER_PERSPECTIVES,
  AGENT_PROMPTS,
} from "./prompt-locale";

/**
 * 讨论 Agent 服务
 * 管理多角色 LLM 调用，每个 Agent 独立对话历史
 */
@Injectable()
export class DiscussionAgentService {
  private readonly logger = new Logger(DiscussionAgentService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 初始化 Agent 团队
   */
  initializeTeam(query: string, language?: string): Map<string, AgentState> {
    const lang = resolveLanguage(language);
    const team = new Map<string, AgentState>();

    const agents: Array<{
      id: string;
      role: DiscussionRole;
      systemPrompt: string;
    }> = [
      {
        id: "director",
        role: "director",
        systemPrompt: this.buildDirectorPrompt(query, lang),
      },
      {
        id: "researcher-a",
        role: "researcher",
        systemPrompt: this.buildResearcherPrompt(
          query,
          "A",
          RESEARCHER_PERSPECTIVES[lang].A,
          lang,
        ),
      },
      {
        id: "researcher-b",
        role: "researcher",
        systemPrompt: this.buildResearcherPrompt(
          query,
          "B",
          RESEARCHER_PERSPECTIVES[lang].B,
          lang,
        ),
      },
      {
        id: "researcher-c",
        role: "researcher",
        systemPrompt: this.buildResearcherPrompt(
          query,
          "C",
          RESEARCHER_PERSPECTIVES[lang].C,
          lang,
        ),
      },
      {
        id: "analyst",
        role: "analyst",
        systemPrompt: this.buildAnalystPrompt(query, lang),
      },
      {
        id: "writer",
        role: "writer",
        systemPrompt: this.buildWriterPrompt(query, lang),
      },
      {
        id: "reviewer",
        role: "reviewer",
        systemPrompt: this.buildReviewerPrompt(query, lang),
      },
    ];

    for (const agent of agents) {
      team.set(agent.id, {
        config: {
          role: agent.role,
          name: AGENT_NAMES[lang][agent.id] || agent.id,
          icon: AGENT_ICONS[agent.role],
          systemPrompt: agent.systemPrompt,
        },
        conversationHistory: [{ role: "system", content: agent.systemPrompt }],
        status: "idle",
      });
    }

    return team;
  }

  /**
   * 让指定 Agent 发言
   *
   * ★ 升级：支持 additionalSkills 参数，自动走 chatWithSkills 路径
   */
  async speak(
    agentState: AgentState,
    context: string,
    options?: {
      creativity?: "deterministic" | "low" | "medium" | "high";
      outputLength?: "minimal" | "short" | "medium" | "long";
      modelType?: AIModelType;
      additionalSkills?: string[];
    },
  ): Promise<string> {
    // 添加上下文到对话历史
    agentState.conversationHistory.push({
      role: "user",
      content: context,
    });

    // 防止对话历史无限增长：保留 system prompt + 最近 10 条消息
    this.trimConversationHistory(agentState, 10);

    const messages = agentState.conversationHistory.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

    try {
      const hasSkills =
        options?.additionalSkills && options.additionalSkills.length > 0;

      const result = hasSkills
        ? await this.chatFacade.chatWithSkills({
            messages,
            modelType: options?.modelType || AIModelType.CHAT,
            taskProfile: {
              creativity: options?.creativity || "medium",
              outputLength: options?.outputLength || "short",
            },
            additionalSkills: options.additionalSkills,
            skipGuardrails: true,
          })
        : await this.chatFacade.chat({
            messages,
            modelType: options?.modelType || AIModelType.CHAT,
            taskProfile: {
              creativity: options?.creativity || "medium",
              outputLength: options?.outputLength || "short",
            },
            skipGuardrails: true,
          });

      const response = result.content;

      // 记录回复到对话历史
      agentState.conversationHistory.push({
        role: "assistant",
        content: response,
      });

      return response;
    } catch (error) {
      this.logger.error(
        `Agent ${agentState.config.name} speak failed: ${error}`,
      );
      throw error;
    }
  }

  /**
   * 创建讨论消息
   */
  createMessage(
    agentState: AgentState,
    content: string,
    phase: DiscussionPhase,
    messageType: DiscussionMessageType,
    metadata?: DiscussionMessage["metadata"],
  ): DiscussionMessage {
    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentRole: agentState.config.role,
      agentName: agentState.config.name,
      agentIcon: agentState.config.icon,
      content,
      phase,
      messageType,
      metadata,
      timestamp: new Date(),
    };
  }

  /**
   * 创建系统消息
   */
  createSystemMessage(
    content: string,
    phase: DiscussionPhase,
  ): DiscussionMessage {
    return {
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentRole: "director",
      agentName: "System",
      agentIcon: "info",
      content,
      phase,
      messageType: "system",
      timestamp: new Date(),
    };
  }

  /**
   * 从总监的综合发言中解析研究方向
   */
  parseDirections(
    directorResponse: string,
    language?: ResearchLanguage,
  ): ResearchDirection[] {
    const lang = language || "zh-CN";
    // 尝试 JSON 解析
    const jsonMatch =
      directorResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
      directorResponse.match(/\[\s*\{[\s\S]*"title"[\s\S]*\}\s*\]/);

    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          return parsed.map((d: Partial<ResearchDirection>, i: number) => ({
            title:
              d.title ||
              (lang === "en-US" ? `Direction ${i + 1}` : `方向 ${i + 1}`),
            description: d.description || "",
            assignedTo: d.assignedTo || "",
            searchQueries: d.searchQueries || [],
          }));
        }
      } catch {
        // JSON 解析失败，使用文本解析
      }
    }

    // 文本解析：提取编号列表项
    const lines = directorResponse.split("\n");
    const directions: ResearchDirection[] = [];
    for (const line of lines) {
      const match = line.match(/^\s*(?:\d+[\.\)、]|[-*])\s*(.+)/);
      if (match && match[1].trim().length > 5) {
        directions.push({
          title: match[1].trim().slice(0, 100),
          description: "",
          assignedTo: "",
          searchQueries: [match[1].trim()],
        });
      }
    }

    return directions.slice(0, 5);
  }

  /**
   * 限制对话历史长度，保留 system prompt + 最近 N 条消息
   */
  private trimConversationHistory(
    agentState: AgentState,
    maxMessages: number,
  ): void {
    const history = agentState.conversationHistory;
    // system prompt (index 0) + maxMessages
    if (history.length > maxMessages + 1) {
      const systemPrompt = history[0];
      const recent = history.slice(-maxMessages);
      history.length = 0;
      history.push(systemPrompt, ...recent);
    }
  }

  // ==================== Prompt 构建 ====================

  private buildDirectorPrompt(query: string, lang: ResearchLanguage): string {
    return AGENT_PROMPTS[lang].director(query);
  }

  private buildResearcherPrompt(
    query: string,
    label: string,
    perspective: string,
    lang: ResearchLanguage,
  ): string {
    return AGENT_PROMPTS[lang].researcher(query, label, perspective);
  }

  private buildAnalystPrompt(query: string, lang: ResearchLanguage): string {
    return AGENT_PROMPTS[lang].analyst(query);
  }

  private buildWriterPrompt(query: string, lang: ResearchLanguage): string {
    return AGENT_PROMPTS[lang].writer(query);
  }

  private buildReviewerPrompt(query: string, lang: ResearchLanguage): string {
    return AGENT_PROMPTS[lang].reviewer(query);
  }
}
