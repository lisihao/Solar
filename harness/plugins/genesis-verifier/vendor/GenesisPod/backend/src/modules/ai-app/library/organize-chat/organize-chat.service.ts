import { Injectable, Logger, Optional } from "@nestjs/common";
import { OrganizeScope, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  ChatFacade,
  ToolFacade,
  type AICapabilityContext,
  type ExecutionConfig,
} from "@/modules/ai-harness/facade";
import {
  CreditsService,
  InsufficientCreditsException,
} from "../../../platform/facade";
import { OrganizeChatDto } from "./dto/organize-chat.dto";
import { ORGANIZE_AGENT_ROLE_ID } from "./tools/organize-bookmark-tools";

/** 一条工具动作的可读明细（建了哪些集合 / 打了什么标签给多少条 / 移动多少条）*/
export interface OrganizeToolAction {
  tool: string;
  /** 人类可读明细，如「新建集合「AI 论文」」「打标签 LLM ×5」「移动 3 条」 */
  detail: string;
}

/** SSE 事件（前端逐条渲染：会话/状态/工具动作/总结/完成/错误）*/
export type OrganizeStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; stage: "planning" }
  | {
      type: "tool";
      phase: "call" | "result";
      tool: string;
      data?: unknown;
      /** result 阶段带可读明细，前端直接渲染（与持久化 toolActions 同源）*/
      detail?: string;
    }
  | { type: "chunk"; content: string }
  | {
      type: "done";
      sessionId: string;
      assistantMessageId: string;
      tokensUsed: number;
      summary: string;
      /** 本轮全部写动作明细（权威列表；代理掉事件时前端以此为准）*/
      toolActions: OrganizeToolAction[];
    }
  | { type: "error"; message: string };

const ORGANIZE_ESTIMATED_CREDITS = 20;

/** 读工具（只读现状，不算"做了什么"）—— 明细列表里跳过，避免噪声。*/
const ORGANIZE_READ_TOOLS = new Set([
  "organize-list-collections",
  "organize-list-items",
]);

const ORGANIZE_STATUS_LABEL: Record<string, string> = {
  UNREAD: "未读",
  READING: "在读",
  COMPLETED: "已读",
  ARCHIVED: "归档",
};

/**
 * 把一次工具调用的 input + output 拼成人类可读明细。
 * 写工具产出具体结果（建了哪些集合 / 打了什么标签给多少条 / 移动多少条）；
 * 读工具返回 ""（caller 据此跳过，不进明细列表）。
 */
function summarizeOrganizeToolAction(
  tool: string,
  input: unknown,
  output: unknown,
): string {
  if (ORGANIZE_READ_TOOLS.has(tool)) return "";
  const inp = (input ?? {}) as Record<string, unknown>;
  const out = (output ?? {}) as Record<string, unknown>;
  const itemIds = Array.isArray(inp.itemIds) ? (inp.itemIds as unknown[]) : [];
  const count = (key: string): number =>
    typeof out[key] === "number" ? out[key] : itemIds.length;

  switch (tool) {
    case "organize-create-collection": {
      const name = (out.name ?? inp.name ?? "") as string;
      return `新建集合「${name}」`;
    }
    case "organize-tag-items": {
      const tags = Array.isArray(inp.tags)
        ? (inp.tags as string[]).join("、")
        : "";
      const op =
        inp.operation === "remove"
          ? "移除标签"
          : inp.operation === "set"
            ? "覆盖标签"
            : "打标签";
      return `${op} ${tags} ×${count("updated")}`;
    }
    case "organize-move-items":
      return `移动 ${count("moved")} 条`;
    case "organize-set-status": {
      const label =
        ORGANIZE_STATUS_LABEL[(inp.status as string) ?? ""] ??
        ((inp.status as string) || "状态");
      return `设为${label} ×${count("updated")}`;
    }
    default:
      return tool;
  }
}

@Injectable()
export class OrganizeChatService {
  private readonly logger = new Logger(OrganizeChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly toolFacade: ToolFacade,
    @Optional() private readonly creditsService?: CreditsService,
  ) {}

  /**
   * 对话整理一轮：复用平台 ReAct 工具循环（chatWithToolsStream），把 AgentEvent 转为 SSE。
   * 不自写 loop；意图理解 + 工具选择由平台 agent 完成；工具薄封装 collections（行级鉴权）。
   */
  async *streamOrganize(
    userId: string,
    dto: OrganizeChatDto,
  ): AsyncGenerator<OrganizeStreamEvent> {
    const scope = dto.scope ?? OrganizeScope.BOOKMARKS;

    // 1. 会话（续聊 or 新建）
    let session = dto.sessionId
      ? await this.prisma.organizeSession.findFirst({
          where: { id: dto.sessionId, userId },
        })
      : null;
    if (!session) {
      session = await this.prisma.organizeSession.create({
        data: { userId, scope, title: dto.message.slice(0, 50) || "整理会话" },
      });
    }
    yield { type: "session", sessionId: session.id };

    // 2. 持久化用户消息
    await this.prisma.organizeMessage.create({
      data: { sessionId: session.id, role: "user", content: dto.message },
    });

    // 3. 余额闸门（评审 Q5：按轮计费）
    if (this.creditsService) {
      const balance = await this.creditsService.checkBalance(
        userId,
        ORGANIZE_ESTIMATED_CREDITS,
      );
      if (!balance.sufficient) {
        throw new InsufficientCreditsException(
          ORGANIZE_ESTIMATED_CREDITS,
          balance.balance,
        );
      }
    }

    // 4. 模型配置（复用 ai-ask 范式；BYOK key 由 facade 内部解析）
    const modelConfig = await this.getModelConfig(dto.modelId);

    // 5. 组装 organize agent：systemPrompt + roleId 隔离 context
    //    精确源类型优先用 dto.itemType（前端按 tab 传）；否则按粗粒度 scope 兜底。
    const itemType =
      dto.itemType ?? (scope === OrganizeScope.NOTES ? "NOTE" : "BOOKMARK");
    const systemPrompt = this.buildSystemPrompt(
      itemType,
      dto.conversationHistory,
    );
    const capabilityContext: AICapabilityContext = {
      agentId: `organize-${session.id}`,
      userId,
      roleId: ORGANIZE_AGENT_ROLE_ID,
      domain: "organize",
    };
    const executionConfig: Partial<ExecutionConfig> = {
      maxIterations: 6,
      maxToolCalls: 15,
      taskProfile: { creativity: "medium", outputLength: "standard" },
    };

    yield { type: "status", stage: "planning" };

    // 6. 跑平台 ReAct 工具循环，AgentEvent → SSE
    let summary = "";
    let tokensUsed = 0;
    const toolActions: OrganizeToolAction[] = [];
    // 工具循环 parallelToolCalls=false（顺序执行），tool_call 紧邻其 tool_result，
    // 用 pendingInput 把 call 的 input 配给随后的 result 拼明细。
    let pendingInput: unknown;

    for await (const ev of this.toolFacade.chatWithToolsStream({
      systemPrompt,
      userPrompt: dto.message,
      context: capabilityContext,
      modelConfig: {
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        apiKey: modelConfig.apiKey ?? undefined,
        apiEndpoint: modelConfig.apiEndpoint ?? undefined,
      },
      executionConfig,
    })) {
      switch (ev.type) {
        case "tool_call":
          pendingInput = ev.input;
          yield { type: "tool", phase: "call", tool: ev.tool, data: ev.input };
          break;
        case "tool_result": {
          const detail = summarizeOrganizeToolAction(
            ev.tool,
            pendingInput,
            ev.output,
          );
          pendingInput = undefined;
          // 只把"做了什么"的写动作进明细列表；读工具(detail="")跳过。
          if (detail) toolActions.push({ tool: ev.tool, detail });
          yield {
            type: "tool",
            phase: "result",
            tool: ev.tool,
            data: ev.output,
            detail: detail || undefined,
          };
          break;
        }
        case "complete":
          summary = ev.result.summary;
          tokensUsed = ev.result.tokensUsed;
          if (summary) yield { type: "chunk", content: summary };
          break;
        case "error":
          throw new Error(ev.error);
        default:
          break;
      }
    }

    // 6.5 如实兜底：agent 没产出总结时，按实际写动作给诚实结论，
    //     避免"啥都没做却显示已完成"。有动作→列动作；无动作→明说没改 + 范围说明。
    if (!summary.trim()) {
      summary =
        toolActions.length > 0
          ? `已完成整理：${toolActions.map((a) => a.detail).join("；")}`
          : "本次没有进行任何更改。我只能整理已有内容（建集合 / 归类 / 打标签 / 标阅读状态），无法新建或修改条目本身（如新建文件、新建页面、写正文）。";
      yield { type: "chunk", content: summary };
    }

    // 7. 持久化助手消息 + 触碰会话时间
    const assistantMessage = await this.prisma.organizeMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: summary,
        toolActions: toolActions as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.organizeSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    // 8. 计费（按本轮实际 token；BLK-6：显式扣费，不依赖 BillingContext 包裹 generator）
    if (this.creditsService && tokensUsed > 0) {
      try {
        await this.creditsService.consumeCredits({
          userId,
          moduleType: "organize-chat",
          operationType: "organize",
          tokenCount: tokensUsed,
          modelName: modelConfig.name,
          referenceId: session.id,
          description: "对话整理",
        });
      } catch (err) {
        this.logger.error(
          `[organize] consumeCredits failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    yield {
      type: "done",
      sessionId: session.id,
      assistantMessageId: assistantMessage.id,
      tokensUsed,
      summary,
      toolActions,
    };
  }

  /** 取最近会话消息（前端代理掐断后 GET 对账，同 ai-ask reconcile 范式）*/
  async getRecentMessages(userId: string, sessionId: string, limit = 6) {
    const session = await this.prisma.organizeSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) return [];
    return this.prisma.organizeMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 20),
    });
  }

  /** 复用 ai-ask 的模型解析（默认 CHAT 模型；apiKey 由 facade 内部按 BYOK 解析）*/
  private async getModelConfig(modelId?: string | null) {
    if (modelId) {
      const model = await this.chatFacade.getModelById(modelId);
      if (model) {
        return {
          modelId: model.modelId,
          name: model.displayName,
          provider: model.provider,
          apiKey: null as string | null,
          apiEndpoint: model.apiEndpoint || null,
        };
      }
    }
    const defaultModel = await this.chatFacade.getDefaultTextModel();
    if (!defaultModel) {
      throw new Error("No CHAT AI model is available");
    }
    return {
      modelId: defaultModel.modelId,
      name: defaultModel.displayName,
      provider: defaultModel.provider,
      apiKey: null as string | null,
      apiEndpoint: null as string | null,
    };
  }

  private buildSystemPrompt(
    itemType: string,
    history?: Array<{ role: string; content: string }>,
  ): string {
    const label = ORGANIZE_TYPE_LABEL[itemType] ?? ORGANIZE_TYPE_LABEL.BOOKMARK;
    // 笔记/图片/飞书：源条目不在集合里，需先 list-source-items → assign 纳入集合，
    //   再用 collectionItemId 打标/标状态（书签则条目已在集合，直接 list-items）。
    const isSource =
      itemType === "NOTE" ||
      itemType === "IMAGE" ||
      itemType === "FEISHU" ||
      itemType === "NOTION" ||
      itemType === "DRIVE";
    const lines = [
      `你是用户资料库的「${label}」整理助手。根据用户的自然语言指令，调用工具真实整理用户的库。整理只在本地"整理覆盖层"进行（分集合/打标签/标状态），绝不修改源数据本身（不改笔记正文、不改图片、不写回外部平台）。`,
      `你的能力仅限：建集合、把已有条目归入集合、打标签、标阅读状态。你【不能】新建、删除或修改条目本身——例如新建文件、新建 ${label} 页面/文档、编辑正文。这类请求超出你的范围。`,
      "规则：",
    ];
    if (isSource) {
      lines.push(
        `1. 先用 organize-list-source-items（itemType="${itemType}"）了解该源现状——每条返回 sourceId（源 id）、collectionItemId（已纳入集合时的整理 id，未纳入为 null）、所在集合、tags、状态。`,
        "2. 需要新集合时用 organize-create-collection；用 organize-list-collections 查已有集合。",
        "3. 把条目纳入集合：organize-assign-items（itemType 同上，sourceIds 来自第 1 步的 sourceId，collectionId 为目标集合）→ 返回 collectionItemIds。",
        "4. 打标签/标状态：organize-tag-items / organize-set-status，itemIds 用 collectionItemId（来自第 1 步已纳入的，或第 3 步 assign 返回的）。",
        "5. 所有 id 必须来自工具实际返回，不得编造；单次写操作最多 100 条，超出分批。",
        "6. 完成后用简洁中文总结你做了什么（建了哪些集合、把多少条纳入、打了什么标签/标了什么状态）。",
      );
    } else {
      lines.push(
        "1. 先用 organize-list-collections / organize-list-items 了解现状，再做写操作。",
        "2. 写工具（打标/移动/改状态）的 itemIds 必须来自 organize-list-items 实际返回的 id，不得编造。",
        "3. 严格遵守用户的限定条件（如「已读的别动」→ 先按 status 过滤再操作）。",
        "4. 单次写操作最多 100 条；超出请分批并说明。",
        "5. 完成后用简洁中文总结你做了什么（建了哪些集合、给多少条打了什么标签/移动到哪）。",
      );
    }
    // 共用守则：超范围请求要如实拒绝，且严禁假装完成
    lines.push(
      "【超范围】若请求超出你的整理能力（如新建/删除文件、新建页面、写内容），不要调用任何工具、不要假装完成，直接用中文说明你做不了 + 你能做什么。",
      "【如实总结】只有真的调用了写工具（建集合/纳入/打标/标状态）才说「已完成」并逐条列出实际动作；若本轮没做任何更改，必须明确回复「本次没有进行任何更改」并说明原因，绝不能回复「已完成整理」之类含糊的成功话术。",
    );
    if (history && history.length > 0) {
      lines.push("", "对话历史（供延续上下文）：");
      for (const m of history.slice(-20)) {
        lines.push(`${m.role === "assistant" ? "助手" : "用户"}：${m.content}`);
      }
    }
    return lines.join("\n");
  }
}

const ORGANIZE_TYPE_LABEL: Record<string, string> = {
  BOOKMARK: "书签",
  NOTE: "笔记",
  IMAGE: "图片",
  FEISHU: "飞书",
  NOTION: "Notion",
  DRIVE: "Google Drive",
};
