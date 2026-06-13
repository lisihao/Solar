import {
  Injectable,
  NotFoundException,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { MessageContentType } from "@prisma/client";
import {
  ChatFacade,
  ToolFacade,
  type ChatMessage,
} from "@/modules/ai-harness/facade";
import {
  MissionContext,
  MissionExecutorService,
  ToolRegistry,
  type ToolContext,
  type BuiltinToolId,
} from "@/modules/ai-harness/facade";
import {
  ContextRouterService,
  ContextStrategy,
} from "./context-router.service";
import { TopicContextRetrievalService } from "./topic-context-retrieval.service";
import { ParsedUrl } from "../../../../../common/content-processing";
import { TeamMemberAgent } from "../../agents";
import { LruMap } from "@/common/utils/lru-map";
// AgentEvent type matches the executor's emitted events (tool field, not toolId)
import type {
  FunctionCallingAgentEvent as AgentEvent,
  AICapabilityContext,
} from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../events";
import {
  CreditsService,
  InsufficientCreditsException,
  BillingContext,
} from "../../../../platform/facade";
import { MetricsService, Trace } from "@/modules/platform/monitoring";
import { AuditService } from "../../../../../common/audit";

/**
 * Service responsible for generating AI responses in topics
 * Extracted from AiTeamsService to reduce file size and improve maintainability
 */
@Injectable()
export class AiResponseService {
  private readonly logger = new Logger(AiResponseService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    private toolFacade: ToolFacade,
    // ★ 架构重构：通过 ToolRegistry 调用工具
    private toolRegistry: ToolRegistry,
    private contextRouter: ContextRouterService,
    private teamMemberAgent: TeamMemberAgent,
    private topicEventEmitter: TopicEventEmitterService,
    @Optional() private contextRetrievalService: TopicContextRetrievalService,
    @Optional() private creditsService: CreditsService,
    @Optional() private metricsService: MetricsService,
    @Optional() private auditService: AuditService,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {
    // 保留重试方法引用供未来集成
    void this.generateWithToolsWithRetry;
  }

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 从文本中提取 URL
   */
  private extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const matches = text.match(urlRegex) || [];
    return [...new Set(matches)];
  }

  /**
   * 智能上下文管理器 - 对消息进行重要性评分和筛选
   * 确保AI能理解关键对话脉络，而不只是简单取最近N条
   *
   * 【重要】上下文隔离策略：
   * - 任务消息（[任务分解]、[工作汇报]等）会被过滤，不作为对话上下文
   * - 每次只取最近的相关消息，避免上下文累积超过模型限制
   *
   * @param topicId Topic ID
   * @param aiMemberId 当前AI成员ID
   * @param maxMessages 最大消息数（默认10，更激进的限制）
   * @param debateOpponentId 辩论对手ID（如果有）- 用于优先包含对手的最新发言
   */
  @Trace({ operationName: "AiResponseService.buildSmartContext" })
  async buildSmartContext(
    topicId: string,
    aiMemberId: string,
    maxMessages: number = 10, // 从15改为10，更激进的默认限制
    debateOpponentId?: string,
  ): Promise<{
    messages: Array<{
      id: string;
      content: string;
      senderId: string | null;
      aiMemberId: string | null;
      sender: { username: string | null; fullName: string | null } | null;
      aiMember: { displayName: string } | null;
      createdAt: Date;
      score: number;
      parsedUrls?: ParsedUrl[] | null;
      replyTo?: {
        id: string;
        senderId: string | null;
        aiMemberId: string | null;
        content: string;
        sender: { username: string | null; fullName: string | null } | null;
        aiMember: { displayName: string } | null;
      } | null;
    }>;
    summary: string | null;
    parsedUrlsContext: string;
  }> {
    // 【关键】任务系统消息的标识模式 - 这些消息不应该作为普通对话上下文
    const missionMessagePatterns = [
      /^\[任务规划\]/,
      /^\[任务分解\]/,
      /^\[任务分配\]/,
      /^\[任务进度\]/,
      /^\[开始工作\]/,
      /^\[工作汇报\]/,
      /^\[任务修改\]/,
      /^\[结果整合\]/,
      /^\[最终交付\]/,
      /^\[Leader反馈\]/,
      /^\[Mission\]/i,
      /^\[AgentTask\]/i,
      /^🚀\s*\*\*团队任务已创建\*\*/,
      /^📋\s*\[任务分配\]/,
      /^❌\s*任务.*失败/,
      /^❌\s*任务执行出错/,
    ];

    const isMissionMessage = (content: string): boolean => {
      const trimmed = content.trim();
      return (
        missionMessagePatterns.some((pattern) => pattern.test(trimmed)) ||
        trimmed.includes("[任务分解]") ||
        trimmed.includes("[工作汇报]") ||
        trimmed.includes("[最终交付]") ||
        trimmed.includes("[Leader反馈]") ||
        trimmed.includes("[结果整合]")
      );
    };

    // 1. 获取最近30条消息（减少从50条，降低初始数据量）
    const recentMessages = await this.prisma.topicMessage.findMany({
      where: {
        topicId,
        deletedAt: null,
      },
      include: {
        sender: { select: { username: true, fullName: true } },
        aiMember: { select: { displayName: true } },
        mentions: {
          select: { aiMemberId: true, userId: true, mentionType: true },
        },
        replyTo: {
          select: {
            id: true,
            senderId: true,
            aiMemberId: true,
            content: true,
            sender: { select: { username: true, fullName: true } },
            aiMember: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30, // 从50减少到30
    });

    // 【关键】立即过滤掉任务系统消息，不让它们进入上下文评分
    const filteredMessages = recentMessages.filter(
      (msg) => !isMissionMessage(msg.content),
    );

    this.logger.log(
      `[SmartContext] Initial messages: ${recentMessages.length}, after mission filter: ${filteredMessages.length}`,
    );

    if (filteredMessages.length === 0) {
      return { messages: [], summary: null, parsedUrlsContext: "" };
    }

    // 2. 为每条消息计算重要性分数（使用过滤后的消息）
    const scoredMessages = filteredMessages.map((msg, index) => {
      let score = 0;

      // 时间递减分数（最新消息+5分，逐渐递减）
      score += Math.max(0, 5 - index * 0.1);

      // @当前AI的消息 +10分
      const mentionsThisAI = msg.mentions.some(
        (m) => m.aiMemberId === aiMemberId,
      );
      if (mentionsThisAI) score += 10;

      // 被回复的消息 +8分
      const isRepliedTo = filteredMessages.some(
        (other) => other.replyTo?.id === msg.id,
      );
      if (isRepliedTo) score += 8;

      // 包含@提及的消息 +3分
      if (msg.mentions.length > 0) score += 3;

      // 用户消息比AI消息稍重要 +2分
      if (msg.senderId) score += 2;

      // 包含问号的消息（可能是问题） +2分
      if (msg.content.includes("?") || msg.content.includes("？")) score += 2;

      // 包含URL的消息 +2分
      if (msg.content.includes("http://") || msg.content.includes("https://")) {
        score += 2;
      }

      // 消息长度适中（100-500字）+1分
      const len = msg.content.length;
      if (len >= 100 && len <= 500) score += 1;

      // 当前AI自己发的消息 +3分（保持对话连贯）
      if (msg.aiMemberId === aiMemberId) score += 3;

      // 【辩论模式优化】对手的消息 +15分（确保能看到对手的最新发言）
      if (debateOpponentId && msg.aiMemberId === debateOpponentId) {
        score += 15;
        // 对手最近的3条消息额外加分
        const opponentMsgs = filteredMessages.filter(
          (m) => m.aiMemberId === debateOpponentId,
        );
        const opponentIndex = opponentMsgs.findIndex((m) => m.id === msg.id);
        if (opponentIndex < 3) {
          score += 10 - opponentIndex * 3; // 最新+10，第二新+7，第三新+4
        }
      }

      return {
        ...msg,
        score,
      };
    });

    // 3. 按分数排序，取top N，然后按时间重新排序
    // CRITICAL: Always include the latest user message (it contains the current request!)
    const latestUserMessage = filteredMessages.find((m) => m.senderId);

    let topMessages = scoredMessages
      .sort((a, b) => b.score - a.score)
      .slice(0, maxMessages)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Ensure the latest user message is always included
    if (
      latestUserMessage &&
      !topMessages.find((m) => m.id === latestUserMessage.id)
    ) {
      this.logger.log(
        `[SmartContext] Force-adding latest user message: "${latestUserMessage.content.substring(0, 50)}..."`,
      );
      // Add it and re-sort by time
      topMessages = [...topMessages, { ...latestUserMessage, score: 100 }].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
    }

    // 4. 如果消息被截断太多，生成早期消息的摘要
    // 【改进】不仅记录参与者，还保留关键内容摘要（情节、决策、结论等）
    let summary: string | null = null;
    const droppedCount = filteredMessages.length - topMessages.length;
    if (droppedCount > 5) {
      // 获取被丢弃的早期消息
      const droppedMessages = scoredMessages
        .filter((m) => !topMessages.find((t) => t.id === m.id))
        .slice(0, 15); // 增加到15条以获取更多上下文

      if (droppedMessages.length > 0) {
        const participants = [
          ...new Set(
            droppedMessages.map(
              (m) =>
                m.sender?.fullName ||
                m.sender?.username ||
                m.aiMember?.displayName ||
                "Unknown",
            ),
          ),
        ];

        // 【长文支持】提取关键内容摘要
        const contentSummaries: string[] = [];
        for (const msg of droppedMessages.slice(0, 8)) {
          const content = msg.content;
          // 提取章节标题（如：第X章、Chapter X）
          const chapterMatch = content.match(
            /(?:第\s*[一二三四五六七八九十\d]+\s*章[：:\s]*[^\n]+|Chapter\s*\d+[：:\s]*[^\n]+)/i,
          );
          if (chapterMatch) {
            contentSummaries.push(`📖 ${chapterMatch[0].substring(0, 50)}`);
            continue;
          }
          // 提取决策/结论（如：决定、确定、结论、总结）
          const decisionMatch = content.match(
            /(?:我们决定|最终确定|结论是|总结：|决定采用)[^。！\n]{10,50}/,
          );
          if (decisionMatch) {
            contentSummaries.push(`✅ ${decisionMatch[0]}`);
            continue;
          }
          // 提取任务/目标（如：任务、目标、需要完成）
          const taskMatch = content.match(
            /(?:主要任务|核心目标|需要完成|接下来要)[^。！\n]{10,50}/,
          );
          if (taskMatch) {
            contentSummaries.push(`🎯 ${taskMatch[0]}`);
            continue;
          }
          // 如果没有特殊标记，提取第一句有意义的内容
          const firstSentence = content
            .replace(/[\n\r]+/g, " ")
            .match(/[^。！？]{20,80}[。！？]/);
          if (firstSentence && contentSummaries.length < 5) {
            const sender =
              msg.sender?.fullName ||
              msg.sender?.username ||
              msg.aiMember?.displayName ||
              "";
            contentSummaries.push(`${sender}: ${firstSentence[0].trim()}`);
          }
        }

        // 构建增强摘要
        let enhancedSummary = `[Earlier discussion (${droppedCount} messages) involved: ${participants.join(", ")}]`;
        if (contentSummaries.length > 0) {
          enhancedSummary += `\n\n**Key points from earlier:**\n${contentSummaries.slice(0, 5).join("\n")}`;
        }
        summary = enhancedSummary;
      }
    }

    // 5. 收集所有消息中的 parsedUrls，生成 AI 上下文
    const allParsedUrls: ParsedUrl[] = [];
    for (const msg of topMessages) {
      // parsedUrls 存储在数据库中作为 JSON
      const msgParsedUrls = (msg as { parsedUrls?: unknown }).parsedUrls as
        | ParsedUrl[]
        | null;
      if (msgParsedUrls && Array.isArray(msgParsedUrls)) {
        allParsedUrls.push(...msgParsedUrls);
      }
    }

    // 去重并生成上下文
    const uniqueParsedUrls = allParsedUrls.filter(
      (url, index, self) => index === self.findIndex((u) => u.url === url.url),
    );

    // Generate context from parsed URLs
    let parsedUrlsContext = "";
    if (uniqueParsedUrls.length > 0) {
      const urlSummaries = uniqueParsedUrls
        .map((parsed) => {
          let summary = `**URL**: ${parsed.url}\n`;
          if (parsed.preview?.title)
            summary += `**Title**: ${parsed.preview.title}\n`;
          if (parsed.preview?.description)
            summary += `**Description**: ${parsed.preview.description}\n`;
          if (parsed.extractedContent?.fullText) {
            const contentPreview = parsed.extractedContent.fullText.substring(
              0,
              500,
            );
            summary += `**Content Preview**: ${contentPreview}${parsed.extractedContent.fullText.length > 500 ? "..." : ""}\n`;
          }
          return summary;
        })
        .join("\n---\n\n");

      parsedUrlsContext = `\n\n## Referenced URLs\nThe following URLs were shared in the discussion:\n\n${urlSummaries}`;
    }

    return {
      messages: topMessages.map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        aiMemberId: m.aiMemberId,
        sender: m.sender,
        aiMember: m.aiMember,
        createdAt: m.createdAt,
        score: m.score,
        parsedUrls: (m as { parsedUrls?: unknown }).parsedUrls as
          | ParsedUrl[]
          | null,
        replyTo: m.replyTo,
      })),
      summary,
      parsedUrlsContext,
    };
  }

  @Trace({ operationName: "AiResponseService.generateAIResponse" })
  async generateAIResponse(
    topicId: string,
    userId: string,
    aiMemberId: string,
    _contextMessageIds: string[],
    debateRole?: {
      role: "red" | "blue";
      opponent: { id: string; displayName: string };
      topic: string;
    } | null,
  ) {
    // 积分检查
    const estimatedCredits = 30; // AI Teams 每次回复消耗 30 积分
    if (this.creditsService) {
      const balanceCheck = await this.creditsService.checkBalance(
        userId,
        estimatedCredits,
      );
      if (!balanceCheck.sufficient) {
        throw new InsufficientCreditsException(
          estimatedCredits,
          balanceCheck.balance,
        );
      }
    }

    // ★ AI Kernel: 创建进程
    let kernelProcessId: string | undefined;
    if (this.missionExecutor) {
      try {
        const kr = await this.missionExecutor.execute({
          userId,
          agentId: "ai-teams-response",
          teamSessionId: topicId,
          input: { aiMemberId },
        });
        kernelProcessId = kr.processId;
        this.kernelProcessIds.set(`${topicId}:${aiMemberId}`, kernelProcessId);
      } catch {
        /* kernel optional */
      }
    }

    const billingRun = () =>
      BillingContext.run(
        { userId, moduleType: "ai-teams", operationType: "ai-reply" },
        async () => {
          const aiMember = await this.prisma.topicAIMember.findFirst({
            where: { id: aiMemberId, topicId },
            select: {
              id: true,
              aiModel: true,
              displayName: true,
              avatar: true,
              roleDescription: true,
              systemPrompt: true,
              contextWindow: true,
              capabilities: true,
              canMentionOtherAI: true,
              collaborationStyle: true,
            },
          });

          if (!aiMember) {
            throw new NotFoundException("AI member not found");
          }

          // 使用智能上下文管理器获取消息
          // 【关键】更激进的上下文限制，防止累积超过模型限制
          const MAX_CONTEXT_MESSAGES = 10; // 从30减少到10
          const debateOpponentId = debateRole?.opponent?.id;
          const smartContext = await this.buildSmartContext(
            topicId,
            aiMemberId,
            Math.min(aiMember.contextWindow || 10, MAX_CONTEXT_MESSAGES),
            debateOpponentId,
          );

          const contextMessages = smartContext.messages;
          const contextSummary = smartContext.summary;
          const parsedUrlsContext = smartContext.parsedUrlsContext;

          // 构建Prompt
          const topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            select: { name: true, description: true },
          });

          // 获取Topic关联的资源内容作为上下文
          const topicResources = await this.prisma.topicResource.findMany({
            where: { topicId },
            include: {
              resource: {
                select: {
                  title: true,
                  abstract: true,
                  sourceUrl: true,
                  type: true,
                },
              },
            },
            take: 5,
            orderBy: { createdAt: "desc" },
          });

          // 构建资源上下文
          let resourceContext = "";
          if (topicResources.length > 0) {
            const resourceSummaries = topicResources
              .filter((tr) => tr.resource)
              .map((tr) => {
                const r = tr.resource!;
                let summary = `- **${r.title || tr.name}**`;
                if (r.sourceUrl) summary += ` (${r.sourceUrl})`;
                if (r.abstract) {
                  const abstractPreview = r.abstract.substring(0, 300);
                  summary += `\n  ${abstractPreview}${r.abstract.length > 300 ? "..." : ""}`;
                }
                return summary;
              })
              .join("\n\n");

            if (resourceSummaries) {
              resourceContext = `\n\n## Reference Materials\nThe following resources have been shared in this discussion group. Use them to provide more informed responses:\n\n${resourceSummaries}`;
            }
          }

          // 检测是否需要搜索实时信息或抓取URL
          const recentUserMessages = contextMessages
            .filter((m) => m.senderId)
            .slice(0, 5);
          let searchContext = "";
          let urlContext = "";

          // 1. 从最近的用户消息中提取所有URL
          const allUrls: string[] = [];
          for (const msg of recentUserMessages) {
            const messageSample = msg.content.substring(0, 10000);
            const urls = this.extractUrls(messageSample);
            allUrls.push(...urls);
          }
          const uniqueUrls = [...new Set(allUrls)].slice(0, 2);

          if (uniqueUrls.length > 0) {
            this.logger.log(
              `Found ${uniqueUrls.length} URLs in recent messages, fetching content...`,
            );
            // ★ 通过 ToolRegistry 调用 web-fetch 工具获取 URL 内容
            const webFetchTool = this.toolRegistry.tryGet("web-fetch");
            if (webFetchTool) {
              const urlContents: string[] = [];
              for (const url of uniqueUrls) {
                try {
                  const fetchResult = await webFetchTool.execute(
                    { url },
                    this.createToolContext("web-fetch"),
                  );
                  if (fetchResult.success && fetchResult.data) {
                    const fetchData = fetchResult.data as {
                      content?: string;
                      title?: string;
                    };
                    if (fetchData.content) {
                      urlContents.push(
                        `**${fetchData.title || url}**\n${fetchData.content.substring(0, 2000)}`,
                      );
                    }
                  }
                } catch (e) {
                  this.logger.warn(`Failed to fetch URL ${url}: ${e}`);
                }
              }
              if (urlContents.length > 0) {
                urlContext = `\n\n## URL 内容\n${urlContents.join("\n\n---\n\n")}`;
                this.logger.log(`Added URL content to context`);
              }
            }
          }

          // 2. 检测是否需要搜索实时信息（仅当没有URL时才搜索）
          const lastUserMessage = recentUserMessages[0];
          if (
            lastUserMessage &&
            !urlContext &&
            this.shouldSearchForInfo(lastUserMessage.content)
          ) {
            this.logger.log(
              `Searching for real-time info: "${lastUserMessage.content.substring(0, 100)}..."`,
            );
            // ★ 通过 ToolRegistry 调用 web-search 工具
            const webSearchTool = this.toolRegistry.tryGet("web-search");
            if (webSearchTool) {
              const toolResult = await webSearchTool.execute(
                { query: lastUserMessage.content, numResults: 5 },
                this.createToolContext("web-search"),
              );
              if (toolResult.success && toolResult.data) {
                const searchData = toolResult.data as {
                  results: Array<{
                    title: string;
                    url: string;
                    content: string;
                  }>;
                  success: boolean;
                };
                if (searchData.success && searchData.results?.length > 0) {
                  searchContext =
                    "\n\n## 搜索结果\n" +
                    searchData.results
                      .map(
                        (r, i) =>
                          `[${i + 1}] **${r.title}**\n${r.content}\nSource: ${r.url}`,
                      )
                      .join("\n\n");
                  this.logger.log(
                    `Added ${searchData.results.length} search results to context`,
                  );
                }
              }
            }
          }

          // 构建上下文摘要部分
          const contextSummarySection = contextSummary
            ? `\n\n## Earlier Discussion Context\n${contextSummary}`
            : "";

          // ==================== 辩论模式处理 ====================
          let debatePrompt = "";

          if (debateRole) {
            const isRedTeam = debateRole.role === "red";
            const opponentName = debateRole.opponent.displayName;
            const debateTopic = debateRole.topic;
            const myName = aiMember.displayName;

            this.logger.log(
              `[Debate Mode] Using Controller-assigned role: AI=${myName}, role=${isRedTeam ? "红方/正方" : "蓝方/反方"}, opponent=${opponentName}, topic=${debateTopic}`,
            );

            // 过滤上下文消息
            const filteredContextMessages = contextMessages.filter((msg) => {
              if (msg.senderId) return true;
              if (msg.aiMemberId === debateRole.opponent.id) return true;
              if (msg.aiMemberId === aiMemberId) return true;
              return false;
            });

            const recentContextMessages = filteredContextMessages.slice(-5);

            this.logger.log(
              `[Debate Mode] Context filtered: ${contextMessages.length} -> ${recentContextMessages.length} messages`,
            );

            contextMessages.length = 0;
            contextMessages.push(...recentContextMessages);

            if (isRedTeam) {
              debatePrompt = `
#############################################
#  🔴 辩论系统指令 - 你是【红方/正方】       #
#############################################

【最高优先级指令 - 必须严格遵守】

## 当前辩论主题（唯一主题）
# >>> ${debateTopic} <<<
你只能讨论这个主题，禁止讨论任何其他话题！

## 你的身份
- 你是：${myName}
- 角色：红方/正方辩手
- 对手：${opponentName}

## 强制规则
1. 你的立场是【正方/支持】
2. 只讨论【${debateTopic}】，不讨论其他任何话题
3. 如果历史消息中有其他辩题（如"AI取代人类"等），完全忽略
4. 发言结尾必须 @${opponentName}

## 发言格式
**辩论主题**：${debateTopic}
**我方立场**：正方/支持 [表态]
**核心论点**：[2-3个论点]
**数据佐证**：[证据来源]
**向对方提问**：[问题]

@${opponentName} 请回应
`;
            } else {
              debatePrompt = `
#############################################
#  🔵 辩论系统指令 - 你是【蓝方/反方】       #
#############################################

【最高优先级指令 - 必须严格遵守】

## 当前辩论主题（唯一主题）
# >>> ${debateTopic} <<<
你只能讨论这个主题，禁止讨论任何其他话题！

## 你的身份
- 你是：${myName}
- 角色：蓝方/反方辩手
- 对手：${opponentName}

## 强制规则
1. 你的立场是【反方/反对】
2. 只讨论【${debateTopic}】，不讨论其他任何话题
3. 如果历史消息中有其他辩题（如"AI取代人类"等），完全忽略
4. 必须针对 ${opponentName} 的观点进行反驳
5. 发言结尾必须 @${opponentName}

## 发言格式
**辩论主题**：${debateTopic}
**对方观点问题**：[指出对方问题]
**我方反驳**：[2-3个反驳点]
**反面证据**：[证据来源]
**质疑点**：[尖锐问题]

@${opponentName} 请继续
`;
            }
          }

          // AI-AI协作
          let aiCollaborationPrompt = "";
          if (aiMember.canMentionOtherAI) {
            const otherAIs = await this.prisma.topicAIMember.findMany({
              where: {
                topicId,
                id: { not: aiMemberId },
              },
              select: {
                displayName: true,
                roleDescription: true,
              },
            });

            if (otherAIs.length > 0) {
              const aiList = otherAIs
                .map(
                  (ai) =>
                    `- @${ai.displayName}${ai.roleDescription ? ` (${ai.roleDescription})` : ""}`,
                )
                .join("\n");
              aiCollaborationPrompt = `\n\n## AI 协作功能（重要）

你可以通过 @AI名称 来触发其他 AI 助手响应。当你在回复中写 "@AI-Name" 时，系统会**自动调用该 AI 的 API**，他们**会真实地生成响应**。

**这不是文本装饰，是真实的函数调用！**

可以调用的 AI 助手：
${aiList}

**使用方法：**
- 在回复中任意位置写 "@AI-Name" 即可触发
- 被@的 AI 会看到你的消息并生成回复
- 你可以向他们提问、请求专业意见、或进行辩论

**示例：**
"关于这个技术方案，@AI-Claude 你有什么看法？"
→ 系统会自动触发 AI-Claude 生成响应

**注意：** 最大递归深度为 3 轮，避免无限循环。`;
            }
          }

          const combinedUrlContext = parsedUrlsContext || urlContext;

          // 【长文支持】使用向量检索获取相关历史上下文
          let semanticRetrievalContext = "";
          if (this.contextRetrievalService && !debateRole) {
            try {
              const recentMessageIds = contextMessages.map((m) => m.id);
              const currentQuery =
                contextMessages
                  .filter((m) => m.senderId)
                  .slice(-3)
                  .map((m) => m.content)
                  .join(" ") || "";

              if (currentQuery.length > 50) {
                semanticRetrievalContext =
                  await this.contextRetrievalService.buildEnhancedContext(
                    topicId,
                    currentQuery,
                    recentMessageIds,
                  );
                if (semanticRetrievalContext) {
                  this.logger.log(
                    `[Long Text Support] Added semantic retrieval context (${semanticRetrievalContext.length} chars)`,
                  );
                }
              }
            } catch (error) {
              this.logger.warn(
                `[Long Text Support] Semantic retrieval failed:`,
                error,
              );
              // 失败不影响主流程
            }
          }

          const systemPrompt = debatePrompt
            ? `You are ${aiMember.displayName}.
${debatePrompt}
${contextSummarySection}${resourceContext}${combinedUrlContext}${searchContext}`
            : aiMember.systemPrompt ||
              `You are ${aiMember.displayName}, an AI assistant participating in a group discussion.
${aiMember.roleDescription ? `Your role: ${aiMember.roleDescription}` : ""}
You are in a discussion group called "${topic?.name}".
${topic?.description ? `Group description: ${topic.description}` : ""}${contextSummarySection}${resourceContext}${combinedUrlContext}${searchContext}${semanticRetrievalContext}${aiCollaborationPrompt}

Respond naturally and helpfully to the discussion. When relevant, reference the shared materials, fetched web content, and search results to provide accurate, up-to-date information. Keep your responses concise but informative.`;

          // 使用 ContextRouter 智能路由上下文
          const userMessages = contextMessages.filter((m) => m.senderId);
          const lastUserMsg = userMessages[userMessages.length - 1];
          const userMessageContent = lastUserMsg?.content || "";

          this.logger.log(
            `[ContextRouter] Last user message: "${userMessageContent.substring(0, 100)}..."`,
          );

          const routeResult = await this.contextRouter.routeContext(
            topicId,
            userMessageContent,
            [],
          );

          this.logger.log(
            `[ContextRouter] Intent: ${routeResult.intent}, Strategy: ${routeResult.strategy}`,
          );

          let filteredContextMessages = contextMessages;
          let intentSystemPrompt = "";

          if (!debateRole) {
            const debatePatterns = [
              /辩论主题[：:]/,
              /我方立场[：:]/,
              /正方观点/,
              /反方观点/,
              /核心论点[：:]/,
              /向对方提问/,
              /@[\w\u4e00-\u9fa5\-]+\s*请回应/,
              /@[\w\u4e00-\u9fa5\-]+\s*请继续/,
            ];

            const isDebateMessage = (content: string): boolean => {
              return debatePatterns.some((pattern) => pattern.test(content));
            };

            const extractDebateSummary = (
              content: string,
              senderName: string,
            ): string => {
              const corePointsMatch = content.match(
                /核心论点[：:]([\s\S]*?)(?=\n\n|\*\*|$)/,
              );
              const stanceMatch = content.match(/我方立场[：:]\s*([^\n]+)/);

              let summary = `【${senderName}的观点】`;
              if (stanceMatch) {
                summary += `立场：${stanceMatch[1].trim()}。`;
              }
              if (corePointsMatch) {
                const points = corePointsMatch[1]
                  .replace(/^\d+\.\s*/gm, "")
                  .replace(/\*\*/g, "")
                  .trim()
                  .split("\n")
                  .filter((p) => p.trim())
                  .slice(0, 3)
                  .join("；");
                summary += `论点：${points}`;
              }
              return summary || content.substring(0, 200) + "...";
            };

            switch (routeResult.strategy) {
              case ContextStrategy.REFERENCE_RECENT:
                this.logger.log(
                  `[ContextRouter] Using REFERENCE_RECENT strategy`,
                );
                filteredContextMessages = contextMessages.map((msg) => {
                  if (msg.aiMemberId && isDebateMessage(msg.content)) {
                    const senderName = msg.aiMember?.displayName || "AI";
                    return {
                      ...msg,
                      content: extractDebateSummary(msg.content, senderName),
                    };
                  }
                  return msg;
                });
                const MAX_REF_CONTEXT = 12;
                if (filteredContextMessages.length > MAX_REF_CONTEXT) {
                  filteredContextMessages =
                    filteredContextMessages.slice(-MAX_REF_CONTEXT);
                }
                intentSystemPrompt = routeResult.systemPromptAddition || "";
                break;

              case ContextStrategy.STANDARD:
              default:
                this.logger.log(`[ContextRouter] Using STANDARD strategy`);

                let standardFiltered = contextMessages.filter((msg) => {
                  if (msg.senderId) return true;
                  if (msg.aiMemberId && isDebateMessage(msg.content)) {
                    this.logger.log(
                      `[Context Filter] Removing debate message from ${msg.aiMember?.displayName || "AI"}`,
                    );
                    return false;
                  }
                  return true;
                });

                const userMessagesInContext = standardFiltered.filter(
                  (m) => m.senderId,
                );
                const latestUserMsgForContext =
                  userMessagesInContext[userMessagesInContext.length - 1];

                const MAX_NORMAL_CONTEXT = 6;
                if (standardFiltered.length > MAX_NORMAL_CONTEXT) {
                  const recentMessages =
                    standardFiltered.slice(-MAX_NORMAL_CONTEXT);

                  if (
                    latestUserMsgForContext &&
                    !recentMessages.find(
                      (m) => m.id === latestUserMsgForContext.id,
                    )
                  ) {
                    recentMessages.shift();
                    recentMessages.push(latestUserMsgForContext);
                    recentMessages.sort(
                      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
                    );
                  }
                  standardFiltered = recentMessages;
                }

                if (latestUserMsgForContext) {
                  const lastMsg = standardFiltered[standardFiltered.length - 1];
                  if (lastMsg && lastMsg.id !== latestUserMsgForContext.id) {
                    standardFiltered = standardFiltered.filter(
                      (m) => m.id !== latestUserMsgForContext.id,
                    );
                    standardFiltered.push(latestUserMsgForContext);
                  }
                }

                filteredContextMessages = standardFiltered;

                this.logger.log(
                  `[STANDARD] Latest user msg: "${latestUserMsgForContext?.content.substring(0, 50)}..."`,
                );
                break;
            }

            this.logger.log(
              `[ContextRouter] Context: ${contextMessages.length} -> ${filteredContextMessages.length} messages`,
            );
          }

          let finalSystemPrompt = systemPrompt;
          if (intentSystemPrompt) {
            finalSystemPrompt = systemPrompt + "\n\n" + intentSystemPrompt;
          }

          // ==================== 工具调用模式 ====================
          // 检查是否应该使用工具
          const memberConfig = this.buildMemberConfig(aiMember);
          const toolTypes = this.teamMemberAgent.resolveTools(memberConfig);

          this.logger.debug(
            `[Tool Integration] Member ${aiMember.displayName}: ${toolTypes.length} tools available`,
          );

          // 如果有工具且应该使用工具，尝试工具模式
          if (toolTypes.length > 0 && this.shouldUseTools(aiMember)) {
            this.logger.log(
              `[Tool Integration] Using tool mode for ${aiMember.displayName} with ${toolTypes.length} tools`,
            );

            try {
              return await this.generateWithTools(
                topicId,
                aiMember,
                filteredContextMessages,
                toolTypes,
                finalSystemPrompt,
              );
            } catch (error) {
              this.logger.error(
                `[Tool Integration] Tool mode failed, falling back to standard mode:`,
                error,
              );
              // 降级到标准模式（继续执行下面的代码）
            }
          }

          // Build chat messages for AI service
          const MAX_MESSAGE_LENGTH = 4000;

          const missionMessagePatterns = [
            /^\[任务规划\]/,
            /^\[任务分解\]/,
            /^\[任务分配\]/,
            /^\[任务进度\]/,
            /^\[开始工作\]/,
            /^\[工作汇报\]/,
            /^\[任务修改\]/,
            /^\[结果整合\]/,
            /^\[最终交付\]/,
            /^\[Leader反馈\]/,
            /^\[Mission\]/i,
            /^\[AgentTask\]/i,
            /\(本报告由.*共同完成.*\)/,
            /\*\(系统提示[：:].*任务流.*\)\*/,
            /^🚀\s*\*\*团队任务已创建\*\*/,
            /^📋\s*\[任务分配\]/,
            /^❌\s*任务.*失败/,
            /^❌\s*任务执行出错/,
          ];

          const isMissionSystemMessage = (content: string): boolean => {
            const trimmedContent = content.trim();
            if (
              missionMessagePatterns.some((pattern) =>
                pattern.test(trimmedContent),
              )
            ) {
              return true;
            }
            if (
              trimmedContent.includes("[任务分解]") ||
              trimmedContent.includes("[工作汇报]") ||
              trimmedContent.includes("[最终交付]") ||
              trimmedContent.includes("[Leader反馈]") ||
              trimmedContent.includes("[结果整合]")
            ) {
              return true;
            }
            return false;
          };

          let normalContextMessages = filteredContextMessages.filter((msg) => {
            if (isMissionSystemMessage(msg.content)) {
              this.logger.log(
                `[Context Filter] Removing mission message: "${msg.content.substring(0, 50)}..."`,
              );
              return false;
            }
            return true;
          });

          this.logger.log(
            `[Context Filter] After mission filter: ${filteredContextMessages.length} -> ${normalContextMessages.length} messages`,
          );

          // ========== Context Size Management ==========
          // 【最佳实践】严格限制上下文大小，防止超过模型限制
          //
          // 关键策略：
          // 1. 每次对话只保留最近的少量消息
          // 2. 任务消息已在 buildSmartContext 中被过滤
          // 3. 总字符数严格限制，为响应留出足够空间

          // 1. 限制消息数量（更激进：从25减少到10）
          const MAX_CHAT_CONTEXT_MESSAGES = 10;
          if (normalContextMessages.length > MAX_CHAT_CONTEXT_MESSAGES) {
            this.logger.log(
              `[Context Management] Trimming messages: ${normalContextMessages.length} -> ${MAX_CHAT_CONTEXT_MESSAGES}`,
            );
            normalContextMessages = normalContextMessages.slice(
              -MAX_CHAT_CONTEXT_MESSAGES,
            );
          }

          // 2. 限制总字符数
          // 目标：~25k tokens = ~100k chars（扩展以支持长文创作场景）
          // 注：大多数模型支持 128k+ 上下文，100k chars 约占用 25% 容量
          const MAX_TOTAL_CONTEXT_CHARS = 100000;
          let totalContextChars = normalContextMessages.reduce(
            (sum, m) => sum + m.content.length,
            0,
          );

          // 如果仍然超过限制，从最旧的消息开始删除
          while (
            totalContextChars > MAX_TOTAL_CONTEXT_CHARS &&
            normalContextMessages.length > 2
          ) {
            const removed = normalContextMessages.shift();
            if (removed) {
              totalContextChars -= removed.content.length;
              this.logger.log(
                `[Context Management] Removed oldest message (${removed.content.length} chars), remaining: ${normalContextMessages.length} messages, ${totalContextChars} chars`,
              );
            }
          }

          // 3. 对过长的单条消息进行截断（最多2000字符）
          const MAX_SINGLE_MESSAGE_LENGTH = 2000;
          normalContextMessages = normalContextMessages.map((msg) => {
            if (msg.content.length > MAX_SINGLE_MESSAGE_LENGTH) {
              this.logger.log(
                `[Context Management] Truncating long message: ${msg.content.length} -> ${MAX_SINGLE_MESSAGE_LENGTH} chars`,
              );
              return {
                ...msg,
                content:
                  msg.content.substring(0, MAX_SINGLE_MESSAGE_LENGTH) +
                  "\n[... 内容过长已截断 ...]",
              };
            }
            return msg;
          });

          // 重新计算总字符数
          totalContextChars = normalContextMessages.reduce(
            (sum, m) => sum + m.content.length,
            0,
          );

          this.logger.log(
            `[Context Management] Final context: ${normalContextMessages.length} messages, ${totalContextChars} chars, ~${Math.round(totalContextChars / 4)} tokens`,
          );

          const chatMessages: ChatMessage[] = normalContextMessages.map((m) => {
            const senderName = m.sender
              ? m.sender.fullName || m.sender.username || "User"
              : m.aiMember?.displayName || "AI";
            const isAI = !!m.aiMemberId;

            let content = m.content;

            if (m.replyTo?.content) {
              const replyToSender = m.replyTo.sender
                ? m.replyTo.sender.fullName ||
                  m.replyTo.sender.username ||
                  "User"
                : m.replyTo.aiMember?.displayName || "AI";
              const quotedContent =
                m.replyTo.content.length > 500
                  ? m.replyTo.content.substring(0, 500) + "..."
                  : m.replyTo.content;
              content = `[引用 ${replyToSender} 的消息: "${quotedContent}"]\n\n${m.content}`;
            }

            if (content.length > MAX_MESSAGE_LENGTH) {
              content =
                content.substring(0, MAX_MESSAGE_LENGTH) +
                "\n\n[Message truncated due to length...]";
              this.logger.warn(
                `Message ${m.id} truncated from ${m.content.length} to ${MAX_MESSAGE_LENGTH} chars`,
              );
            }

            return {
              role: isAI ? "assistant" : "user",
              content,
              name: senderName,
            } as ChatMessage;
          });

          // Get AI model configuration
          this.logger.log(
            `[AI Model Lookup] aiMember.aiModel = "${aiMember.aiModel}", displayName = "${aiMember.displayName}"`,
          );

          const aiModelConfig = await this.chatFacade.getModelById(
            aiMember.aiModel,
          );

          this.logger.log(
            `[AI Model Lookup] By modelId "${aiMember.aiModel}": ${aiModelConfig ? `found (id=${aiModelConfig.id})` : "NOT FOUND"}`,
          );

          // Call AI service
          this.logger.log(
            `Generating AI response for topic ${topicId} using ${aiMember.aiModel}`,
          );
          let aiResponse: string;
          let tokensUsed = 0;
          const startTime = Date.now();

          try {
            // Determine output length based on model capabilities
            // ★ v3.1 C 阶段（2026-05-24）：删 isLargeModel 启发式，改 DB 驱动。
            //   AIModelConfig.maxTokens 是 capability 单源；阈值 >= 6000 等价
            //   原启发式（gpt-4 / claude / gemini 系列 admin 配置普遍 ≥6000）。
            //   替代删除的 `modelId.includes("gpt-4"|"claude"|"gemini")` 反模式
            //   （C.A.2）。
            const LARGE_MODEL_TOKEN_THRESHOLD = 6000;
            const modelId =
              aiModelConfig?.modelId ||
              (await this.getDefaultModelId(aiMember.aiModel));
            const isReasoningModel = aiModelConfig?.isReasoning ?? false;
            const configMaxTokens =
              typeof aiModelConfig?.maxTokens === "number"
                ? aiModelConfig.maxTokens
                : 0;
            const isLargeModel = configMaxTokens >= LARGE_MODEL_TOKEN_THRESHOLD;

            // 【长文支持】根据模型能力确定输出长度
            // - Reasoning models: "extended" (复杂多步骤任务、长文创作)
            // - Large models: "long" (标准对话、中等长度内容)
            // - Other models: "medium" (简单响应)
            const outputLength = isReasoningModel
              ? ("extended" as const)
              : isLargeModel
                ? ("long" as const)
                : ("medium" as const);

            this.logger.log(
              `Calling AI API: modelId=${modelId}, isReasoning=${isReasoningModel}, outputLength=${outputLength}`,
            );

            // 构建消息列表，包含系统提示
            const facadeMessages: ChatMessage[] = [
              { role: "system", content: finalSystemPrompt },
              ...chatMessages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            ];

            const result = await this.chatFacade.chat({
              messages: facadeMessages,
              model: modelId,
              taskProfile: {
                creativity: "medium",
                outputLength,
              },
            });
            aiResponse = result.content;
            tokensUsed = result.tokensUsed;

            // 记录AI响应指标
            const duration = Date.now() - startTime;
            if (this.metricsService) {
              this.metricsService.recordAIResponseLatency(
                aiMember.aiModel,
                duration,
              );
              this.metricsService.recordAIResponseTokens(
                aiMember.aiModel,
                tokensUsed,
              );
            }

            this.logger.log(
              `[AI Response Debug] Content received from AI, length: ${aiResponse?.length || 0}, duration: ${duration}ms`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "未知错误";
            this.logger.error(`Failed to generate AI response: ${errorMsg}`);

            // 记录AI响应错误指标
            if (this.metricsService) {
              this.metricsService.recordAIResponseError(
                aiMember.aiModel,
                "generation_failed",
              );
            }

            aiResponse = `**AI 响应生成失败**

我是 ${aiMember.displayName}，生成回复时遇到错误：

**错误信息**：${errorMsg}

请稍后重试，或联系管理员检查 API 配置。`;
          }

          // 创建AI消息
          this.logger.log(
            `[AI Response Debug] Saving to DB, content length: ${aiResponse?.length || 0}`,
          );
          const message = await this.prisma.topicMessage.create({
            data: {
              topicId,
              aiMemberId,
              content: aiResponse,
              contentType: MessageContentType.TEXT,
              prompt: systemPrompt,
              modelUsed: aiMember.aiModel,
              tokensUsed,
            },
            include: {
              aiMember: {
                select: {
                  id: true,
                  aiModel: true,
                  displayName: true,
                  avatar: true,
                  roleDescription: true,
                },
              },
            },
          });

          this.logger.log(
            `[AI Response Debug] Saved to DB, message.content length: ${message.content?.length || 0}`,
          );

          // 更新Topic的updatedAt
          await this.prisma.topic.update({
            where: { id: topicId },
            data: { updatedAt: new Date() },
          });

          // 记录AI响应审计日志
          if (this.auditService) {
            await this.auditService.logAIResponseGenerate(
              topicId,
              aiMemberId,
              message.id,
              aiMember.aiModel,
              tokensUsed,
            );
          }

          return message;
        },
      );

    return kernelProcessId
      ? MissionContext.run(
          { agentProcessId: kernelProcessId, userId },
          billingRun,
        )
      : billingRun();
  }

  /**
   * 创建AI消息（用于辩论系统等场景）
   */
  async createAIMessage(
    topicId: string,
    aiMemberId: string,
    content: string,
    modelUsed: string,
    tokensUsed?: number,
  ) {
    const message = await this.prisma.topicMessage.create({
      data: {
        topicId,
        aiMemberId,
        content,
        contentType: MessageContentType.TEXT,
        modelUsed,
        tokensUsed: tokensUsed || 0,
      },
      include: {
        aiMember: {
          select: {
            id: true,
            aiModel: true,
            displayName: true,
            avatar: true,
            roleDescription: true,
          },
        },
      },
    });

    await this.prisma.topic.update({
      where: { id: topicId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  /**
   * 从消息内容中解析@提及的AI成员
   */
  async parseAIMentionsFromContent(
    topicId: string,
    content: string,
    excludeAiMemberId?: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    const aiMembers = await this.prisma.topicAIMember.findMany({
      where: {
        topicId,
        ...(excludeAiMemberId ? { id: { not: excludeAiMemberId } } : {}),
      },
      select: {
        id: true,
        displayName: true,
        autoRespond: true,
      },
    });

    if (aiMembers.length === 0) {
      return [];
    }

    const mentionedAIs: Array<{ id: string; displayName: string }> = [];

    for (const ai of aiMembers) {
      const patterns = [
        new RegExp(`@${this.escapeRegExp(ai.displayName)}(?![\\w])`, "i"),
        new RegExp(`@"${this.escapeRegExp(ai.displayName)}"`, "i"),
        new RegExp(`@'${this.escapeRegExp(ai.displayName)}'`, "i"),
      ];

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          mentionedAIs.push({ id: ai.id, displayName: ai.displayName });
          this.logger.log(
            `[AI-AI] Detected mention of ${ai.displayName} in content`,
          );
          break;
        }
      }
    }

    return mentionedAIs;
  }

  /**
   * Determine if a message likely needs real-time information
   */
  private shouldSearchForInfo(content: string): boolean {
    const lowerContent = content.toLowerCase();

    const searchTriggers = [
      "最新",
      "最近",
      "今天",
      "昨天",
      "本周",
      "这周",
      "本月",
      "latest",
      "recent",
      "today",
      "yesterday",
      "this week",
      "this month",
      "current",
      "now",
      "2024",
      "2025",
      "什么是",
      "是什么",
      "怎么样",
      "如何",
      "为什么",
      "哪些",
      "哪个",
      "what is",
      "how to",
      "why",
      "which",
      "who is",
      "where",
      "新闻",
      "动态",
      "趋势",
      "发展",
      "进展",
      "消息",
      "news",
      "trend",
      "update",
      "development",
      "announcement",
      "比较",
      "对比",
      "区别",
      "评价",
      "评测",
      "推荐",
      "compare",
      "versus",
      "vs",
      "difference",
      "review",
      "recommend",
      "价格",
      "股价",
      "天气",
      "汇率",
      "price",
      "stock",
      "weather",
      "rate",
    ];

    return searchTriggers.some((trigger) => lowerContent.includes(trigger));
  }

  /**
   * 判断 AI 成员是否应该使用工具
   */
  private shouldUseTools(aiMember: {
    capabilities?: unknown;
    roleDescription?: string | null;
    displayName: string;
  }): boolean {
    // 如果有 capabilities，启用工具
    if (aiMember.capabilities && Array.isArray(aiMember.capabilities)) {
      if (aiMember.capabilities.length > 0) {
        this.logger.debug(
          `[shouldUseTools] ${aiMember.displayName} has capabilities, enabling tools`,
        );
        return true;
      }
    }

    // 检查角色描述中是否包含特定关键词
    const roleDesc = (aiMember.roleDescription || "").toLowerCase();
    const toolKeywords = [
      "leader",
      "researcher",
      "analyst",
      "developer",
      "搜索",
      "分析",
      "开发",
      "研究",
      "数据",
    ];

    const hasToolKeyword = toolKeywords.some((kw) => roleDesc.includes(kw));
    if (hasToolKeyword) {
      this.logger.debug(
        `[shouldUseTools] ${aiMember.displayName} role suggests tool use`,
      );
      return true;
    }

    // 默认不使用工具
    return false;
  }

  /**
   * 构建成员配置
   */
  private buildMemberConfig(aiMember: {
    id: string;
    displayName: string;
    roleDescription?: string | null;
    capabilities?: unknown;
  }) {
    const capabilities = Array.isArray(aiMember.capabilities)
      ? aiMember.capabilities
      : [];

    // 从角色描述推断角色类型
    const role = this.teamMemberAgent.inferRoleFromDescription(
      aiMember.roleDescription,
    );

    // 专业领域从角色描述中提取
    const expertiseAreas: string[] = [];
    if (aiMember.roleDescription) {
      // 简单提取，后续可以优化
      expertiseAreas.push(aiMember.roleDescription);
    }

    return {
      memberId: aiMember.id,
      displayName: aiMember.displayName,
      role,
      capabilities,
      expertiseAreas,
      workStyle: null,
      isLeader: role === "leader",
    };
  }

  /**
   * 带重试的工具生成 AI 响应
   * 使用指数退避策略处理临时错误
   * TODO: 在 generateWithTools 中集成此方法
   */
  private async generateWithToolsWithRetry(
    topicId: string,
    aiMember: {
      id: string;
      aiModel: string;
      displayName: string;
      roleDescription?: string | null;
    },
    contextMessages: Array<{
      content: string;
      senderId: string | null;
      aiMemberId: string | null;
      sender: { username: string | null; fullName: string | null } | null;
      aiMember: { displayName: string } | null;
    }>,
    toolTypes: BuiltinToolId[],
    systemPrompt: string,
    maxRetries: number = 3,
  ) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.generateWithTools(
          topicId,
          aiMember,
          contextMessages,
          toolTypes,
          systemPrompt,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        this.logger.warn(
          `[generateWithToolsWithRetry] Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`,
        );

        // 检查是否是可重试的错误
        if (!this.isRetryableError(lastError)) {
          this.logger.error(
            `[generateWithToolsWithRetry] Non-retryable error, giving up`,
          );
          throw lastError;
        }

        // 最后一次尝试不需要等待
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          this.logger.log(
            `[generateWithToolsWithRetry] Waiting ${delay}ms before retry...`,
          );
          await this.delay(delay);
        }
      }
    }

    // 所有重试都失败了
    this.logger.error(
      `[generateWithToolsWithRetry] All ${maxRetries} attempts failed`,
    );
    throw lastError;
  }

  /**
   * 检查错误是否可重试
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // 可重试的错误类型
    const retryablePatterns = [
      "timeout",
      "econnreset",
      "econnrefused",
      "socket hang up",
      "rate limit",
      "429",
      "503",
      "502",
      "500",
      "network",
      "temporary",
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 使用工具生成 AI 响应
   */
  @Trace({ operationName: "AiResponseService.generateWithTools" })
  private async generateWithTools(
    topicId: string,
    aiMember: {
      id: string;
      aiModel: string;
      displayName: string;
      roleDescription?: string | null;
    },
    contextMessages: Array<{
      content: string;
      senderId: string | null;
      aiMemberId: string | null;
      sender: { username: string | null; fullName: string | null } | null;
      aiMember: { displayName: string } | null;
    }>,
    toolTypes: BuiltinToolId[],
    systemPrompt: string,
  ) {
    this.logger.log(
      `[generateWithTools] Generating response with ${toolTypes.length} tools for ${aiMember.displayName}`,
    );

    // 配置 LLM Adapter (使用 AI Engine 的 FunctionCallingLLMAdapter，通过 Facade 访问)
    if (
      !this.toolFacade.functionCallingAdapter ||
      !this.toolFacade.functionCallingExecutor
    ) {
      throw new Error(
        "FunctionCallingLLMAdapter or FunctionCallingExecutor is not available",
      );
    }
    // ★ 先定位 lastUserMessage 用作 BYOK 解析的 userId 上下文
    const userMessages = contextMessages.filter((m) => m.senderId);
    const lastUserMessage = userMessages[userMessages.length - 1];
    const userPrompt = lastUserMessage?.content || "请继续";

    this.toolFacade.functionCallingAdapter.setConfig({
      aiMemberId: aiMember.id,
      workspaceId: topicId,
      // ★ BYOK 单源：把发起人 userId 透传给 adapter，apiKey 经 KeyResolver
      //   按 PERSONAL → ASSIGNED 解析，不再走 AIModel.apiKey 明文 / 环境变量旁路
      userId: lastUserMessage?.senderId ?? undefined,
    });

    // T2 Fix: 构建 AICapabilityContext，使用 executeWithContext() 以支持工具启用/禁用
    const capabilityContext: AICapabilityContext = {
      agentId: `ai-response-${aiMember.id}`,
      userId: lastUserMessage?.senderId || "system",
      teamId: topicId, // 使用 topicId 作为 teamId
      domain: "teams",
    };

    // 执行 Function Calling
    const events: AgentEvent[] = [];
    const toolCalls: Array<{
      tool: string;
      input: unknown;
      output: unknown;
    }> = [];
    let finalContent = "";

    try {
      // T2 Fix: 使用 executeWithContext() 替代 execute()
      // executeWithContext() 会通过 AICapabilityResolver 解析可用工具
      const eventGenerator =
        this.toolFacade.functionCallingExecutor.executeWithContext(
          this.toolFacade.functionCallingAdapter,
          systemPrompt,
          userPrompt,
          capabilityContext,
          {
            maxIterations: 5,
            maxToolCalls: 10,
            parallelToolCalls: false,
            enableRetry: true,
            taskProfile: {
              creativity: "medium",
              outputLength: "standard",
            },
          },
        );

      // 收集所有事件并推送 WebSocket
      for await (const event of eventGenerator) {
        events.push(event);

        if (event.type === "tool_call") {
          this.logger.debug(`[generateWithTools] Tool call: ${event.tool}`);
          // 推送工具调用开始事件
          await this.topicEventEmitter.emitToTopic(topicId, "tool:calling", {
            aiMemberId: aiMember.id,
            aiMemberName: aiMember.displayName,
            toolType: event.tool,
            input: event.input,
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === "tool_result") {
          // 找到对应的 tool_call 事件
          const toolCallEvent = events.find(
            (e) => e.type === "tool_call" && e.tool === event.tool,
          );
          toolCalls.push({
            tool: event.tool,
            input:
              toolCallEvent && toolCallEvent.type === "tool_call"
                ? toolCallEvent.input
                : undefined,
            output: event.output,
          });
          // 推送工具调用结果事件
          await this.topicEventEmitter.emitToTopic(topicId, "tool:result", {
            aiMemberId: aiMember.id,
            aiMemberName: aiMember.displayName,
            toolType: event.tool,
            output: event.output,
            duration: event.duration,
            success: true,
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === "complete") {
          finalContent = event.result.summary || "";
          this.logger.log(
            `[generateWithTools] Completed with ${toolCalls.length} tool calls`,
          );
          // 推送工具调用完成事件
          await this.topicEventEmitter.emitToTopic(topicId, "tool:complete", {
            aiMemberId: aiMember.id,
            aiMemberName: aiMember.displayName,
            toolCallCount: toolCalls.length,
            tokensUsed: event.result.tokensUsed,
            duration: event.result.duration,
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === "error") {
          this.logger.error(`[generateWithTools] Error: ${event.error}`);
          // 推送工具调用错误事件
          await this.topicEventEmitter.emitToTopic(topicId, "tool:error", {
            aiMemberId: aiMember.id,
            aiMemberName: aiMember.displayName,
            error: event.error,
            timestamp: new Date().toISOString(),
          });
          // 降级到纯文本模式
          finalContent = `工具调用出现错误: ${event.error}\n\n让我用常规方式回答...`;
        }
      }

      // 如果没有最终内容，生成默认响应
      if (!finalContent) {
        finalContent = "任务已完成，但没有生成摘要。";
      }

      // 保存消息到数据库
      const message = await this.prisma.topicMessage.create({
        data: {
          topicId,
          aiMemberId: aiMember.id,
          content: finalContent,
          contentType: MessageContentType.TEXT,
          prompt: systemPrompt,
          modelUsed: aiMember.aiModel,
          tokensUsed:
            events.find((e) => e.type === "complete")?.result?.tokensUsed || 0,
        },
        include: {
          aiMember: {
            select: {
              id: true,
              aiModel: true,
              displayName: true,
              avatar: true,
              roleDescription: true,
            },
          },
        },
      });

      // 更新 Topic
      await this.prisma.topic.update({
        where: { id: topicId },
        data: { updatedAt: new Date() },
      });

      return message;
    } catch (error) {
      this.logger.error(
        `[generateWithTools] Failed to generate with tools:`,
        error,
      );

      // 降级到纯文本生成（在调用方处理）
      throw error;
    }
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Get default model ID for a given AI model identifier.
   * Resolves shorthand provider names (e.g. "claude") to the first matching
   * available model, avoiding hardcoded version strings.
   */
  private async getDefaultModelId(modelIdentifier: string): Promise<string> {
    const lower = modelIdentifier.toLowerCase();

    // Already a full model ID (contains dash and a known provider name)
    if (
      lower.includes("-") &&
      (lower.includes("grok") ||
        lower.includes("gpt") ||
        lower.includes("claude") ||
        lower.includes("gemini") ||
        lower.startsWith("o1") ||
        lower.startsWith("o3"))
    ) {
      return modelIdentifier;
    }

    // Resolve shorthand by finding the first available model matching the prefix
    try {
      const availableModels =
        await this.chatFacade.getAvailableModelsExtended();
      const match = availableModels.find((m) =>
        m.id.toLowerCase().startsWith(lower),
      );
      if (match) {
        return match.id;
      }
    } catch {
      // Fall through to return the identifier as-is
    }

    return modelIdentifier;
  }
}
