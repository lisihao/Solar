/**
 * LeaderChatService —— mission Leader 对话（编排）
 *
 * 用户点击 mission 详情页的 Leader 节点 → 弹出 chat 浮窗 → 与该 mission
 * 的 Leader（拥有完整 topic / dimensions / report 上下文）讨论。
 *
 * 模型选择走 Harness 同款链路：modelType=CHAT + userId（BYOK），
 * 不硬编码任何 provider/模型。
 *
 * ★ 2026-05-04 PR-10a (拆分为 < 500 行合规, standards/16 §六)：
 *   • leader-chat-prompt.ts            ← buildLeaderChatPrompt（system prompt 拼装）
 *   • leader-decision-parser.util.ts   ← parseLeaderDecisionResponse + safeParseStoredDecision
 *   • leader-chat.service.ts (本文件)  ← list / send / 持久化 / 业务事件 emit / Mission 装配
 *
 * ★ 2026-05-15 PR-F: 静态决策协议（decision schema / 规则 / CREATE_TODO 约束 / 风格）
 *   整体迁到 `skills/leader-chat/SKILL.md`，由 BuiltinSkillCatalog 加载，buildLeaderChatPrompt
 *   只负责拼运行时 mission context + 注入 SKILL.md instructions。"绕过 SkillRegistry"
 *   闭环。LeaderChat 业务模式是 single-turn chat completion（不是 ReAct loop），
 *   因此直接调 AiChatService.chat() 是合理的，无需 AgentExecutorService。
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  AiChatService,
  AiModelConfigService,
  BuiltinSkillCatalog,
  EventBus,
  ReflectionMissionScheduler,
  executeWithModelFailover,
  type DomainEvent,
} from "@/modules/ai-harness/facade";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { buildLeaderChatPrompt } from "./leader-chat-prompt";
import {
  parseLeaderDecisionResponse,
  safeParseStoredDecision,
  type LeaderDecision,
  type LeaderDecisionType,
} from "./leader-decision-parser.util";

/**
 * spec-only fallback: BuiltinSkillCatalog 在 prod bootstrap 总能加载 leader-chat SKILL.md
 * 经 SkillLoader@onApplicationBootstrap 注册，runtime 不会命中 fallback。
 *
 * 2026-05-15 Round 1 代码质量评审备注：本常量与 skills/leader-chat/SKILL.md 的 JSON
 * schema 段是**结构性副本**，不是双源——只在 spec / SkillLoader 还没跑的窗口期保底。
 * **维护规则**：要改决策协议（schema / rules / style）必须改 SKILL.md，不能改本常量；
 * 本常量保持最小化以让 spec 不依赖 SkillLoader bootstrap。
 */
const LEADER_CHAT_SKILL_FALLBACK = [
  "## CRITICAL: Return a strict JSON decision wrapped in ```json fence:",
  "```json",
  '{ "decisionType": "DIRECT_ANSWER" | "CREATE_TODO" | "CLARIFY" | "ACKNOWLEDGE",',
  '  "response": "<markdown shown in chat bubble>",',
  '  "todo": [ { "name": "<dim>", "rationale": "<why>" } ],',
  '  "clarifyOptions": ["<opt1>", "<opt2>"] }',
  "```",
  "Decision rules: new research angle → CREATE_TODO; status question → DIRECT_ANSWER; ambiguous → CLARIFY; thanks → ACKNOWLEDGE.",
].join("\n");

export type { LeaderDecision, LeaderDecisionType };

export interface LeaderChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number | null;
  createdAt: Date;
  /** assistant-only：LLM 输出的结构化决策 */
  decision?: LeaderDecision | null;
}

export interface LeaderChatSendResult {
  user: LeaderChatMessage;
  assistant: LeaderChatMessage;
  /** CREATE_TODO 时已追加到 mission.dimensions 的新任务 ids */
  appendedDimensionIds?: string[];
}

@Injectable()
export class LeaderChatService {
  private readonly log = new Logger(LeaderChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: AiChatService,
    private readonly store: MissionStore,
    private readonly eventBus: EventBus,
    private readonly skillCatalog: BuiltinSkillCatalog,
    // 2026-05-15 PR-I.4: Consolidation rule injection — 闭环让 LLM 看到过去失败模式提醒。
    // @Optional() 让 spec 不传也能跑（无 rule 时 snippet=空 → 与原 behavior 等价）。
    @Optional()
    private readonly consolidation?: ReflectionMissionScheduler,
    // 模型级 failover：BYOK 默认模型 provider 报错时换用户的下一个 CHAT 模型。
    // @Optional() 缺失时退化为无 failover（行为同修复前）。
    @Optional()
    private readonly modelConfig?: AiModelConfigService,
  ) {}

  async list(missionId: string): Promise<LeaderChatMessage[]> {
    const rows = await this.prisma.agentPlaygroundLeaderChat.findMany({
      where: { missionId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role === "assistant" ? "assistant" : "user",
      content: r.content,
      tokensUsed: r.tokensUsed,
      createdAt: r.createdAt,
      // 旧消息 / 解析失败 → null
      decision: safeParseStoredDecision((r as { decision?: unknown }).decision),
    }));
  }

  /**
   * 用户发送一条消息 → 拼装上下文 → LLM 回复 (JSON 决策) → 持久化 + 触发动作
   *
   * 决策类型动作：
   *   DIRECT_ANSWER  → 仅展示文本
   *   CREATE_TODO    → 追加 dimensions 到 mission（若 mission 仍 running）
   *   CLARIFY        → 前端展示选项按钮
   *   ACKNOWLEDGE    → 仅展示文本
   */
  async send(
    missionId: string,
    userId: string,
    content: string,
  ): Promise<LeaderChatSendResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("Message content cannot be empty");
    }

    // ★ 2026-05-25：允许与任意已存在 mission 的 Leader 对话（含已完成/失败/取消）。
    //   用户常在 mission 跑完后追问报告——原先硬限 running/starting 会让完成后对话 400。
    //   仅"追加研究方向(CREATE_TODO)"需要 running，已由下游 canAppendToCurrentRun 优雅
    //   降级提示（"mission 已不在运行中…不会自动并入本次运行"），不在此处硬拒。
    const missionCheck = await this.store.getById(missionId, userId);
    if (!missionCheck) {
      throw new BadRequestException(`mission ${missionId} not found`);
    }

    // 1) 持久化用户消息
    const userMsg = await this.prisma.agentPlaygroundLeaderChat.create({
      data: {
        missionId,
        userId,
        role: "user",
        content: trimmed.slice(0, 4000),
      },
    });

    // 2) 拉取 mission 上下文 + 历史对话
    const mission = await this.store.getById(missionId, userId);
    const previous = await this.list(missionId);

    // PR-F: 从 SKILL.md 取静态决策协议（schema + 规则 + 风格）
    const skill = this.skillCatalog.get("leader-chat");
    const decisionInstructions =
      skill?.instructions ?? LEADER_CHAT_SKILL_FALLBACK;

    // PR-I.4: Consolidation rule injection — 拿过去归纳的 top-K 通用失败模式提醒
    let consolidationSnippet = "";
    if (this.consolidation) {
      try {
        const ruleSet = await this.consolidation.getRulesForMission([]);
        consolidationSnippet = ruleSet.promptSnippet;
      } catch (err) {
        this.log.warn(
          `[send ${missionId}] consolidation rule fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const systemPrompt = buildLeaderChatPrompt(
      mission,
      decisionInstructions,
      consolidationSnippet,
    );

    const messages = previous.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantText = "";
    let decision: LeaderDecision | null = null;
    let usedTokens: number | undefined;
    try {
      // 模型级 failover：BYOK 默认模型 provider 报错（含 NO_AVAILABLE_KEY /
      // QUOTA_EXCEEDED / 5xx）时，换用户配置的下一个 CHAT 模型重试，而非直接
      // 给"Leader 暂时无法回复"。modelConfig 缺失时 provider=undefined → 单次调用。
      const modelConfig = this.modelConfig;
      const failoverProvider = modelConfig
        ? async (
            excludeModelIds: ReadonlyArray<string>,
          ): Promise<string | null> => {
            try {
              const models = await modelConfig.listUserEnabledModelsByType(
                userId,
                AIModelType.CHAT,
                excludeModelIds,
              );
              return models[0]?.modelId ?? null;
            } catch {
              return null;
            }
          }
        : undefined;

      const result = await executeWithModelFailover({
        agentId: "leader-chat",
        logger: this.log,
        provider: failoverProvider,
        attempt: (modelOverride) =>
          this.chat.chat({
            systemPrompt,
            messages,
            model: modelOverride,
            modelType: modelOverride ? undefined : AIModelType.CHAT,
            userId,
            taskProfile: { creativity: "low", outputLength: "medium" },
            operationName: "playground.leader-chat",
          }),
        // 非 strict 路径下 provider 错会以 isError 返回，也要触发换模型。
        inspectResult: (res) => ({
          failoverable: (res as { isError?: boolean }).isError === true,
          modelId: res.model,
          message: res.content ?? "",
        }),
      });
      const raw = result.content?.trim() || "";
      usedTokens = result.usage?.totalTokens;
      // 3) 解析 JSON 决策
      const parsed = parseLeaderDecisionResponse(raw);
      assistantText = parsed.response || "(Leader did not respond)";
      decision = parsed.decision;
    } catch (err) {
      this.log.error(
        `[send ${missionId}] LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      assistantText = `Leader 暂时无法回复（${err instanceof Error ? err.message : "unknown error"}）。请稍后重试。`;
    }

    const wantsCreateTodo =
      decision?.type === "CREATE_TODO" &&
      decision.todo &&
      decision.todo.length > 0;
    const canAppendToCurrentRun =
      mission?.status === "running" && (mission.lastCompletedStage ?? 0) < 3;
    if (wantsCreateTodo && !canAppendToCurrentRun) {
      const reason =
        mission?.status !== "running"
          ? "mission 已不在运行中"
          : "当前 mission 已完成研究派发阶段";
      assistantText =
        `${assistantText}\n\n（${reason}，这些新研究方向不会自动并入本次运行。请通过重跑/新 mission 执行。）`.slice(
          0,
          8000,
        );
      decision = {
        ...decision,
        type: "DIRECT_ANSWER",
        todo: undefined,
      };
    }

    // 4) 持久化 assistant 回复（含 decision JSON）—— Prisma JSON 字段
    //    上游 prisma generate 后 decision 字段类型可知；保持显式 unknown→Prisma cast
    const assistantMsg = await this.prisma.agentPlaygroundLeaderChat.create({
      data: {
        missionId,
        userId,
        role: "assistant",
        content: assistantText.slice(0, 8000),
        tokensUsed: usedTokens ?? null,
        decision: (decision ?? null) as unknown as never,
      },
    });

    // 5) CREATE_TODO 动作：mission 仍 running 时追加 dimensions
    let appendedIds: string[] | undefined;
    if (
      decision?.type === "CREATE_TODO" &&
      decision.todo &&
      decision.todo.length > 0 &&
      canAppendToCurrentRun
    ) {
      try {
        appendedIds = await this.store.appendDimensions(
          missionId,
          decision.todo,
        );
        this.log.log(
          `[send ${missionId}] appended ${appendedIds.length} dimension(s) from leader chat`,
        );
        // 广播追加事件给前端 → TaskListPanel + SVG 自动 refresh dimensions
        if (appendedIds.length > 0) {
          await this.broadcastAppendedDimensions(
            missionId,
            userId,
            appendedIds,
            decision.todo,
          );
        }
      } catch (err) {
        this.log.warn(
          `[send ${missionId}] appendDimensions failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      user: this.toDto(userMsg),
      assistant: { ...this.toDto(assistantMsg), decision },
      appendedDimensionIds: appendedIds,
    };
  }

  private async broadcastAppendedDimensions(
    missionId: string,
    userId: string,
    appendedIds: string[],
    todo: { name: string; rationale: string }[],
  ): Promise<void> {
    const event: DomainEvent = {
      type: "playground.dimensions:appended",
      scope: { missionId, userId },
      payload: {
        appendedIds,
        source: "user-chat",
        items: todo.map((t, i) => ({
          id: appendedIds[i],
          name: t.name,
          rationale: t.rationale,
        })),
      },
      timestamp: Date.now(),
    };
    await this.eventBus.emit(event).catch((e: unknown) => {
      this.log.warn(
        `[send ${missionId}] broadcast dimensions:appended failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    // ★ BUG-E 部分修：让前端任务列表立即显示这些新 dim 处于 pending 状态
    //   每个新 dim 发一条 dimension:retrying 事件（reason=leader-chat-create）
    //   todo-ledger 已映射为 leader-chat-create origin，会创建任务行可见
    //   实际 Researcher 派遣由 orchestrator 在下一个 S5 boundary 检测 pending
    //   dim 时统一拉起（深度修法见 Task #23 追记）。
    // ★ P0-2: appendDimensions 可能部分失败返回 appendedIds.length < todo.length，
    //   越界访问会让 agentId=`researcher#chat-undefined` 污染前端任务列表。
    //   循环边界统一取 min(todo.length, appendedIds.length)，确保 1:1 对应。
    const safeLen = Math.min(todo.length, appendedIds.length);
    for (let i = 0; i < safeLen; i++) {
      const t = todo[i];
      await this.eventBus
        .emit({
          type: "playground.dimension:retrying",
          scope: { missionId, userId },
          agentId: `researcher#chat-${appendedIds[i]}`,
          payload: {
            dimension: t.name,
            reason: "leader-chat-create",
            rationale: t.rationale,
            source: "user-chat",
            // ★ 关键：标 willExecute=false 让前端区分"已登记但暂未派遣"，
            //   不应在 UI 显示为"进行中"，应展示为"等待派遣"+ 提示用户
            //   重启 mission 或等 orchestrator boundary 拉起
            willExecute: false,
            note: "Leader Chat 已登记该维度，待 orchestrator 在下一阶段拉起或用户重启 mission",
          },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.log.warn(
            `[${missionId}] emit dimension:retrying (leader-chat-create) for "${t.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }

  private toDto(row: {
    id: string;
    role: string;
    content: string;
    tokensUsed: number | null;
    createdAt: Date;
    decision?: unknown;
  }): LeaderChatMessage {
    return {
      id: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      tokensUsed: row.tokensUsed,
      createdAt: row.createdAt,
      decision: safeParseStoredDecision(row.decision),
    };
  }
}
