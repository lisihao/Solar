/**
 * CompanyMissionService — W3 团队 Mission 持久化 + 真实 LLM 执行
 *
 * Responsibilities:
 *   - createMission(): 落库 company_missions 行，fire-and-forget 异步执行。
 *   - listMissions(): 按 userId / teamId 查询列表。
 *
 * 执行流程（真实 LLM 三阶段）：
 *   1. status → 'running'，emit company.mission:started
 *   2. Stage planning  — Leader 拆解任务，emit company.stage:lifecycle {stage:'planning', ...}
 *   3. Stage execution — 各成员依 workflow stages 轮流执行，emit company.stage:lifecycle {stage:'execution', ...}
 *   4. Stage review    — Leader 综合评审，emit company.stage:lifecycle {stage:'review', ...}
 *   5. status → 'done' / 'failed'，emit company.mission:completed / mission:failed
 *
 * 无可用 LLM Key / API 错误 → catch → status 'failed' + emit company.mission:failed {message}
 * 不得吞错伪装成功。
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MissionFailedPreset } from "@/modules/platform/facade";
import { MissionSedimentService } from "@/modules/ai-app/library/sediment/mission-sediment.service";
import { CompanyMissionPersistenceAdapter } from "./company-mission-persistence.adapter";
import { EventBus, ChatFacade, AgentRunner } from "@/modules/ai-harness/facade";
import { SkillRegistry } from "@/modules/ai-engine/facade";
import type { CompanyMission, Prisma } from "@prisma/client";
import { AIModelType } from "@prisma/client";
import type { CompanyHiredAgent } from "@prisma/client";
import {
  CompanyRepository,
  type CompanyTeamForMission,
} from "./company.repository";
// ★ 通用路径 ⑤ 真用：成员若是可独立跑的叶子 agent，用 AgentRunner 真跑（非能力化团队）。
import {
  resolveAgentSpec,
  STANDALONE_RUNNABLE_AGENT_IDS,
} from "@/modules/ai-app/contracts/agent-spec-catalog";
// ★ 能力化执行：团队套用的 workflow → 市场 SKU → CapabilityRegistry 解析到平台共享能力
//   runner，在 harness 上真跑（零 playground 依赖）。design.md §4.3 + 能力 manifest/port。
import { MarketplaceCatalogService } from "@/modules/ai-app/marketplace/catalog/marketplace-catalog.service";
import { CompanyMissionGraphService } from "./company-mission-graph.service";
import {
  CapabilityRegistry,
  type ICapabilityRunner,
  type CapabilityRunEvent,
} from "@/modules/ai-app/marketplace/capability";

// ── local type alias so we don't need to import ChatRequest from facade types ─

type TaskProfile = {
  creativity?: "deterministic" | "low" | "medium" | "high";
  outputLength?:
    | "minimal"
    | "short"
    | "medium"
    | "standard"
    | "long"
    | "extended";
};

/** Hero 派单可选富化输入（透传到能力 runner，与 CapabilityRunInput 子集对齐）。 */
type HeroMissionExtra = {
  description?: string;
  depth?: "quick" | "standard" | "deep";
  language?: "zh-CN" | "en-US";
  withFigures?: boolean;
  knowledgeBaseIds?: string[];
  searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
  /** 报告文风档位（透传 capInput，缺省由能力 runner 默认值兜底）。 */
  styleProfile?: "executive" | "academic" | "journalistic" | "technical";
  /** 报告长度档位（透传 capInput，缺省由能力 runner 默认值兜底）。 */
  lengthProfile?: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";
  /** 报告受众档位（透传 capInput，缺省由能力 runner 默认值兜底）。 */
  audienceProfile?: "executive" | "domain-expert" | "general-public";
  /** 审核层级（透传 capInput，缺省由能力 runner 默认值兜底）。 */
  auditLayers?: "minimal" | "default" | "thorough" | "thorough+";
};

/**
 * 前端模型档位（Opus/Sonnet/Haiku 展示名）→ 引擎 modelType。
 * 不把档位名当真实 model id 传（那会解析失败），统一走 modelType，由引擎按 TaskProfile + fallback 链选模型。
 */
const TIER_TO_MODEL_TYPE: Record<string, AIModelType> = {
  Opus: AIModelType.CHAT,
  Sonnet: AIModelType.CHAT_FAST,
  Haiku: AIModelType.CHAT_FAST,
};

/** 验收兜底阈值/封顶（manifest.rubric 缺省时用）。 */
const DEFAULT_ACCEPTANCE_THRESHOLD = 60;
const DEFAULT_ACCEPTANCE_MAX_ATTEMPTS = 2;

/**
 * 14 阶段 systemStageId → company 3 桶（planning / execution / review）。
 * 锚点见 capability-execution-architecture.md §5 + step-id-mapping.contract.ts
 * （s1-budget … s12-self-evolution）。company 把 14 阶段折叠回自己已有的 3 桶视图。
 */
const SYSTEM_STAGE_TO_COMPANY_BUCKET: Record<
  string,
  "planning" | "execution" | "review"
> = {
  "s1-budget": "planning",
  "s2-leader-plan": "planning",
  "s3-researcher-collect": "execution",
  "s4-leader-assess": "execution",
  "s5-reconciler": "execution",
  "s6-analyst": "execution",
  "s7-writer-outline": "execution",
  "s8-writer": "execution",
  "s8b-quality-enhancement": "execution",
  "s9-critic": "review",
  "s9b-objective-eval": "review",
  "s10-leader-foreword-signoff": "review",
  "s11-persist": "review",
  "s12-self-evolution": "review",
};

/**
 * 兜底：6 阶段精简版 stepId → company 3 桶（systemStageId 缺省时用，不删不退化）。
 */
const STEP_ID_TO_COMPANY_BUCKET: Record<
  string,
  "planning" | "execution" | "review"
> = {
  plan: "planning",
  research: "execution",
  reconcile: "execution",
  analyze: "execution",
  write: "execution",
  review: "review",
};

/** agent 生命周期 phase → 渐进维度状态（started/其余 → running）。 */
function phaseToDimStatus(phase: string): "running" | "done" | "failed" {
  return phase === "completed"
    ? "done"
    : phase === "failed"
      ? "failed"
      : "running";
}

// ── service ───────────────────────────────────────────────────────────────────

@Injectable()
export class CompanyMissionService implements OnModuleInit {
  private readonly log = new Logger(CompanyMissionService.name);
  /**
   * 运行中 mission 的 abort 句柄。用于取消：abort() 中止 capability run（researcher
   * 的 fetch / LLM 调用尊重 signal）。单 pod 内有效——多 pod 时取消请求若落到非起跑
   * pod 只翻 DB 状态，原 pod 的 run 由下次心跳/终态收口（已知局限，待共享信号补强）。
   */
  private readonly abortControllers = new Map<string, AbortController>();
  /**
   * 协作动态事件缓存（按 missionId）。run 期间累积 agent/stage 级事件，
   * 终态时落 result.collab 供详情重开回放（解决 live WS 流断开后协作动态丢失）。
   */
  private readonly collabBuffers = new Map<
    string,
    Array<{ type: string; payload: unknown; timestamp: number }>
  >();
  /**
   * 运行中渐进任务状态（按 missionId）。随事件实时更新并落库 result.steps，
   * 让"任务列表"在运行中就逐个出现并推进 + 持久化（重开/刷新仍在，非事后补）。
   */
  private readonly liveTaskState = new Map<
    string,
    {
      planning?: "running" | "done";
      review?: "running" | "done";
      dimOrder: string[];
      dimStatus: Map<string, "running" | "done" | "failed">;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
    private readonly chatFacade: ChatFacade,
    private readonly companyRepository: CompanyRepository,
    private readonly skillRegistry: SkillRegistry,
    private readonly agentRunner: AgentRunner,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly catalogService: MarketplaceCatalogService,
    // ★ 运行态持久化（枢纽）：注入能力核的 ctx.persistence → 每阶段 checkpoint 落库 +
    //   终态首写赢仲裁（取消/完成/失败竞态）。W4 已建本适配器但此前未接线。
    private readonly persistenceAdapter: CompanyMissionPersistenceAdapter,
    // ★ 失败通知（email/站内）：company mission 失败/僵尸清理时通知用户，别让用户
    //   无声等待。@Optional —— NotificationDispatcherModule 未装配时优雅缺省。
    @Optional() private readonly missionFailedPreset?: MissionFailedPreset,
    // ★ post-run 副作用：mission 完成后自动构建知识图谱。@Optional 让裁剪测试床优雅降级。
    @Optional() private readonly missionGraph?: CompanyMissionGraphService,
    // ★ post-run 副作用：mission 完成后把报告沉淀进应用内库（library notes）。@Optional
    //   让裁剪测试床优雅降级（不沉淀、不影响 mission）。
    @Optional() private readonly sediment?: MissionSedimentService,
  ) {}

  /** 发 mission 失败通知（fire-and-forget，best-effort，不阻断主流程）。 */
  private async notifyMissionFailed(args: {
    missionId: string;
    userId: string;
    title: string;
    reason: string;
    failureCode?: string;
  }): Promise<void> {
    await this.missionFailedPreset
      ?.notify({
        userId: args.userId,
        missionId: args.missionId,
        missionTitle: args.title || "专家任务",
        missionUrl: "/agents",
        reason: args.reason,
        ...(args.failureCode ? { failureCode: args.failureCode } : {}),
      })
      .catch((err: unknown) => {
        this.log.warn(
          `notifyMissionFailed ${args.missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * ★ 耐久恢复（P0）：boot 时扫 stale running orphan。pod 重启会丢失内存里的
   *   abortControllers / liveTaskState / collabBuffers，DB 上 status='running' 不会
   *   自动改 → mission 永久卡 running（僵尸）。本钩子在启动时：
   *     - 可恢复（有 checkpoint + __dispatch）→ 用同一 missionId 重跑（能力核经
   *       persistence.loadCheckpoint 续跑，跳过已完成 stage）。
   *     - 不可恢复 → mark failed + emit，杀掉僵尸（用户看到失败可重跑，不再无声转圈）。
   */
  onModuleInit(): void {
    void this.recoverOrphanMissions();
  }

  /** 把派发参数 merge 进 result.__dispatch（boot resume 重建上下文用，best-effort）。 */
  private async persistDispatchMeta(
    missionId: string,
    dispatch: {
      capabilityId: string;
      preferredModelId?: string;
      extra?: HeroMissionExtra;
    },
  ): Promise<void> {
    try {
      const row = await this.prisma.companyMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });
      const result =
        row?.result &&
        typeof row.result === "object" &&
        !Array.isArray(row.result)
          ? { ...(row.result as Record<string, unknown>) }
          : {};
      result.__dispatch = JSON.parse(
        JSON.stringify(dispatch),
      ) as Prisma.InputJsonValue;
      await this.prisma.companyMission.update({
        where: { id: missionId },
        data: { result: result as Prisma.InputJsonValue },
      });
    } catch (err: unknown) {
      this.log.warn(
        `persistDispatchMeta ${missionId} failed (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async recoverOrphanMissions(): Promise<void> {
    try {
      const staleMs = 5 * 60 * 1000;
      const cutoff = new Date(Date.now() - staleMs);
      const orphans = await this.prisma.companyMission.findMany({
        where: { status: "running", updatedAt: { lt: cutoff } },
        select: {
          id: true,
          userId: true,
          title: true,
          result: true,
          progress: true,
        },
      });
      if (orphans.length === 0) {
        this.log.log("[orphan-recovery] no stale running missions");
        return;
      }
      this.log.warn(
        `[orphan-recovery] found ${orphans.length} stale running mission(s)`,
      );
      for (const o of orphans) {
        // 原子认领：bump updatedAt（写同值 progress 触发 @updatedAt），count===1 才本 pod 处理，
        //   多 pod 并发 boot 时每个 orphan 只被一个 pod 认领（防重复续跑/重复计费）。
        const claim = await this.prisma.companyMission.updateMany({
          where: { id: o.id, status: "running", updatedAt: { lt: cutoff } },
          data: { progress: o.progress },
        });
        if (claim.count !== 1) continue;

        const result =
          o.result && typeof o.result === "object" && !Array.isArray(o.result)
            ? (o.result as Record<string, unknown>)
            : {};
        const cp = result.__checkpoint as { lastStepId?: string } | undefined;
        const dispatch = result.__dispatch as
          | {
              capabilityId?: string;
              preferredModelId?: string;
              extra?: HeroMissionExtra;
            }
          | undefined;

        if (cp?.lastStepId && dispatch?.capabilityId) {
          this.log.warn(
            `[orphan-recovery] resuming ${o.id} from checkpoint "${cp.lastStepId}"`,
          );
          // fire-and-forget 续跑：runHeroMission → runViaCapability →
          //   persistence.loadCheckpoint(同 missionId) → 能力核从 lastStepId 续跑。
          void this.runHeroMission(
            o.id,
            o.userId,
            dispatch.capabilityId,
            o.title,
            dispatch.preferredModelId ?? "",
            dispatch.extra,
          );
        } else {
          this.log.warn(
            `[orphan-recovery] ${o.id} not resumable (cp=${cp?.lastStepId ?? "none"}, dispatch=${dispatch ? "y" : "n"}) → mark failed`,
          );
          const message =
            "Mission 在执行中遇到后端重启（进程内存丢失且无可恢复 checkpoint）。" +
            "已自动标记为失败，请重新下发任务。";
          // 终态走仲裁：若 orphan 在扫描与认领间隙被用户取消，won=false，
          // 不得再 emit failed / 发失败通知盖掉 cancelled 语义。
          const won = await this.finalizeIfNotCancelled(o.id, {
            status: "failed",
            result: {
              ...result,
              error: message,
              failureCode: "DISPATCHER_BOOT_ORPHAN_CLEANUP",
              failedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          });
          if (won) {
            await this.emit("company.mission:failed", o.id, o.userId, {
              missionId: o.id,
              message,
            });
            await this.notifyMissionFailed({
              missionId: o.id,
              userId: o.userId,
              title: o.title,
              reason: message,
              failureCode: "DISPATCHER_BOOT_ORPHAN_CLEANUP",
            });
          }
        }
      }
    } catch (err: unknown) {
      this.log.error(
        `[orphan-recovery] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 把 Agent 装配的技能（skillIds）解析回真实方法论正文，注入系统提示。
   * 这才让"选了技能"真生效——LLM 拿到的是方法论正文，不是技术 id 字符串。
   *
   * 数据源与市场货架一致：engine SkillRegistry 里的 prompt 型技能
   * （PromptSkillAdapter.getPromptContent() 返回 .skill.md 正文）。
   */
  private buildSkillInstructions(skillIds: string[]): string {
    if (!skillIds.length) return "";
    const blocks: string[] = [];
    for (const id of skillIds) {
      const skill = this.skillRegistry.tryGet(id) as unknown as
        | { name?: string; getPromptContent?: () => string }
        | undefined;
      const body = skill?.getPromptContent?.()?.trim();
      if (body) {
        blocks.push(`## Skill: ${skill?.name ?? id}\n${body}`);
      }
    }
    if (!blocks.length) {
      // 装配了技能但加载不到正文（如 code-backed 执行单元）：至少声明名字
      return `You are equipped with skills: ${skillIds.join(", ")}.`;
    }
    return `You are equipped with the following skills. Apply their methodology rigorously:\n\n${blocks.join("\n\n")}`;
  }

  // ── create + dispatch ──────────────────────────────────────────────────────

  async createMission(
    userId: string,
    teamId: string,
    title: string,
  ): Promise<CompanyMission> {
    const mission = await this.prisma.companyMission.create({
      data: { userId, teamId, title, status: "queued", progress: 0 },
    });

    // fire-and-forget: 异步执行，不等待，异常由 runMission 内部处理
    void this.runMission(mission.id, userId).catch((err: unknown) => {
      this.log.error(
        `CompanyMission ${mission.id} run failed (outer catch): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return mission;
  }

  // ── hero capability dispatch ─────────────────────────────────────────────────

  /**
   * createHeroMission —— Hero 模型派发：落库一条 company_missions 行（heroId 设置、
   * teamId 为 null、status "queued"），然后把 capabilityId 解析到能力 runner 并真跑，
   * 复用与团队路径完全相同的 run/bridge/persist 机器（runViaCapability + bridgeCapabilityEvent），
   * emit 同一套 company.mission:* / company.stage:lifecycle 事件，前端流原样工作。
   *
   * preferredModelId = hero.models[0]：用户选了真实 model id → 透传 bypass election；
   * 为空 → 引擎按 TaskProfile + BYOK 默认选模型（0-config 可用）。
   */
  async createHeroMission(
    userId: string,
    heroId: string,
    capabilityId: string,
    title: string,
    preferredModelId: string,
    extra?: HeroMissionExtra,
  ): Promise<CompanyMission> {
    const mission = await this.prisma.companyMission.create({
      data: {
        userId,
        teamId: null,
        heroId,
        title,
        status: "queued",
        progress: 0,
      },
    });

    // fire-and-forget：异步执行，异常由内部 catch 处理（不吞错伪装成功）。
    void this.runHeroMission(
      mission.id,
      userId,
      capabilityId,
      mission.title,
      preferredModelId,
      extra,
    ).catch((err: unknown) => {
      this.log.error(
        `CompanyHero mission ${mission.id} run failed (outer catch): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return mission;
  }

  /**
   * 复跑 —— 用原 mission 终态保留的派发参数（result.__dispatch）创建一条**全新** mission
   * 重跑（同 hero + 同档位 depth/语言/知识库/图文）。原 mission 历史保留不动，返回新 mission。
   * 缺 __dispatch（历史数据/被覆盖）→ 抛错，前端提示无法复跑、请重新下发。
   */
  async rerunHeroMission(
    userId: string,
    missionId: string,
  ): Promise<CompanyMission> {
    const src = await this.prisma.companyMission.findFirst({
      where: { id: missionId, userId },
    });
    if (!src) throw new NotFoundException("Mission not found");
    const result =
      src.result && typeof src.result === "object" && !Array.isArray(src.result)
        ? (src.result as Record<string, unknown>)
        : {};
    const dispatch = result.__dispatch as
      | {
          capabilityId?: string;
          preferredModelId?: string;
          extra?: HeroMissionExtra;
        }
      | undefined;
    if (!dispatch?.capabilityId) {
      throw new BadRequestException(
        "该任务缺少可复跑的派发参数（可能为历史数据），请重新下发任务。",
      );
    }
    return this.createHeroMission(
      userId,
      src.heroId ?? "",
      dispatch.capabilityId,
      src.title,
      dispatch.preferredModelId ?? "",
      dispatch.extra,
    );
  }

  /**
   * Hero mission 执行：解析 capabilityId → 能力 runner → runViaCapability 真跑。
   * 复用团队能力路径的同一套 started/running + 结果持久化 + 事件桥。
   */
  private async runHeroMission(
    missionId: string,
    userId: string,
    capabilityId: string,
    title: string,
    preferredModelId: string,
    extra?: HeroMissionExtra,
  ): Promise<void> {
    await this.updateMission(missionId, { status: "running", progress: 0 });
    // ★ 耐久恢复：把派发参数落 result.__dispatch，让 boot orphan 扫描能用同一 missionId
    //   经 loadCheckpoint 续跑（mission 行本身不存这些参数）。best-effort，不阻断主流程。
    await this.persistDispatchMeta(missionId, {
      capabilityId,
      preferredModelId,
      ...(extra ? { extra } : {}),
    });
    await this.emit("company.mission:started", missionId, userId, {
      missionId,
    });

    const controller = new AbortController();
    this.abortControllers.set(missionId, controller);

    try {
      const runner = this.capabilityRegistry.resolve(capabilityId);
      if (!runner) {
        throw new Error(
          `capability runner "${capabilityId}" not registered; ensure its onModuleInit ran`,
        );
      }
      // 真实 model id 优先；为空时 undefined → 引擎按 TaskProfile + BYOK 选模型。
      await this.runViaCapability(
        missionId,
        userId,
        title,
        runner,
        preferredModelId || undefined,
        controller.signal,
        extra,
      );
    } catch (err: unknown) {
      // 用户取消：cancelMission 已置 cancelled 状态并广播，run 抛出的 AbortError
      // 不应再覆盖为 failed。
      if (controller.signal.aborted) {
        this.log.log(`CompanyHero mission ${missionId} cancelled by user`);
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      this.log.error(`CompanyHero mission ${missionId} failed: ${message}`);

      await this.updateMission(missionId, {
        status: "failed",
        result: { error: message, failedAt: new Date().toISOString() },
      }).catch((dbErr: unknown) => {
        this.log.error(
          `Failed to persist failed status for ${missionId}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      });

      await this.emit("company.mission:failed", missionId, userId, {
        missionId,
        message,
      });
      await this.notifyMissionFailed({
        missionId,
        userId,
        title,
        reason: message,
      });
    } finally {
      this.abortControllers.delete(missionId);
      this.collabBuffers.delete(missionId);
      this.liveTaskState.delete(missionId);
    }
  }

  /**
   * 取消运行中的 mission：abort capability run + 置 cancelled 状态（按 userId 归属校验）。
   * 单 pod 内 abort 立即生效；前端乐观置 cancelled，无需额外事件。
   */
  async cancelMission(userId: string, missionId: string): Promise<void> {
    const mission = await this.prisma.companyMission.findFirst({
      where: { id: missionId, userId },
    });
    if (!mission) throw new NotFoundException("Mission not found");

    this.abortControllers.get(missionId)?.abort();
    this.abortControllers.delete(missionId);

    await this.updateMission(missionId, { status: "cancelled" });
  }

  // ── list ───────────────────────────────────────────────────────────────────

  async listMissions(
    userId: string,
    teamId?: string,
  ): Promise<CompanyMission[]> {
    return this.prisma.companyMission.findMany({
      where: { userId, ...(teamId ? { teamId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  /** 删除一条 mission（按 userId 归属校验，防越权删他人任务）。 */
  async deleteMission(userId: string, missionId: string): Promise<void> {
    await this.prisma.companyMission.deleteMany({
      where: { id: missionId, userId },
    });
  }

  /** 重命名 mission 标题（按 userId 归属校验）。 */
  async renameMission(
    userId: string,
    missionId: string,
    title: string,
  ): Promise<void> {
    await this.prisma.companyMission.updateMany({
      where: { id: missionId, userId },
      data: { title },
    });
  }

  // ── internal runner ────────────────────────────────────────────────────────

  /**
   * 真实三阶段执行流：
   *   queued → running → emit started
   *   planning: Leader LLM 拆解子任务
   *   execution: 各成员依 workflow stages 顺序执行
   *   review:    Leader LLM 综合评审
   *   running → done/failed + emit completed/failed
   */
  private async runMission(missionId: string, userId: string): Promise<void> {
    // 1. 查 mission 基础信息
    const mission = await this.prisma.companyMission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      this.log.warn(`CompanyMission ${missionId} not found, aborting run`);
      return;
    }

    // 2. 查团队 + 成员 agent + workflow
    const team = await this.companyRepository.findTeamForMission(
      mission.teamId,
      userId,
    );

    // 3. 状态 running
    await this.updateMission(missionId, { status: "running", progress: 0 });
    await this.emit("company.mission:started", missionId, userId, {
      missionId,
    });

    try {
      // ★ 采用引用 → 共享能力 → 在 harness 上真跑（design.md §4.3 + 能力 manifest/port）。
      //   团队套用的 workflow.sourceListingId → 市场 SKU.missionType → CapabilityRegistry
      //   解析到平台共享的能力 runner（用同一批共享 agent，纯执行）。解析到 → 真跑该能力；
      //   解析不到（非能力化团队）→ 退回下方通用 chat 三阶段。
      //   深度研究团队（含 researcher 成员）强制走能力 runner，不降级（见 resolveCapabilityRunner）。
      const runner = this.resolveCapabilityRunner(team);
      if (runner) {
        // 从 leader（或首个成员）取真实 model id 作为 preferredModelId：
        //   - 用户在 UI 选了具体模型（非档位名）→ 直接透传，bypass election，BYOK 解析链生效
        //   - 未选 / 档位名 → 空字符串，AgentRunner 按 TaskProfile + BYOK 默认选模型（正确）
        const leader = this.resolveLeader(team);
        const pref = leader?.models?.[0] ?? "";
        const preferredModelId = TIER_TO_MODEL_TYPE[pref]
          ? undefined
          : pref || undefined;
        await this.runViaCapability(
          missionId,
          userId,
          mission.title,
          runner,
          preferredModelId,
        );
        return;
      }

      // ── Stage 1: planning ───────────────────────────────────────────────
      await this.emit("company.stage:lifecycle", missionId, userId, {
        stage: "planning",
        status: "started",
      });

      const planningResult = await this.runPlanning(
        mission.title,
        team,
        userId,
      );

      await this.updateMission(missionId, { progress: 33 });
      await this.emit("company.stage:lifecycle", missionId, userId, {
        stage: "planning",
        status: "completed",
      });

      // ── Stage 2: execution ──────────────────────────────────────────────
      await this.emit("company.stage:lifecycle", missionId, userId, {
        stage: "execution",
        status: "started",
      });

      const executionResults = await this.runExecution(
        mission.title,
        planningResult,
        team,
        userId,
      );

      await this.updateMission(missionId, { progress: 66 });
      await this.emit("company.stage:lifecycle", missionId, userId, {
        stage: "execution",
        status: "completed",
      });

      // ── Stage 3: review ─────────────────────────────────────────────────
      await this.emit("company.stage:lifecycle", missionId, userId, {
        stage: "review",
        status: "started",
      });

      const reviewResult = await this.runReview(
        mission.title,
        planningResult,
        executionResults,
        team,
        userId,
      );

      // 4. 完成 —— 终态走仲裁（取消首写赢）：用户中途取消已置 cancelled，此处条件写
      //    避免把 cancelled 盖回 done（与能力路径 finalizeIfNotCancelled 一致，普通团队
      //    任务此前裸写会盖掉取消）。
      const won = await this.finalizeIfNotCancelled(missionId, {
        status: "done",
        progress: 100,
        result: {
          summary: reviewResult,
          planningOutput: planningResult,
          executionOutputs: executionResults,
          completedAt: new Date().toISOString(),
        },
      });
      if (won) {
        await this.emit("company.stage:lifecycle", missionId, userId, {
          stage: "review",
          status: "completed",
        });
        await this.emit("company.mission:completed", missionId, userId, {
          missionId,
        });
        this.log.log(`CompanyMission ${missionId} completed`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      this.log.error(`CompanyMission ${missionId} failed: ${message}`);

      // 终态走仲裁：未被取消才写 failed（避免盖掉用户取消）。与能力路径一致。
      const won = await this.finalizeIfNotCancelled(missionId, {
        status: "failed",
        result: { error: message, failedAt: new Date().toISOString() },
      });
      if (won) {
        await this.emit("company.mission:failed", missionId, userId, {
          missionId,
          message,
        });
        // ★ 别让用户无声等待：普通团队任务失败也发通知（此前仅能力路径有，
        //   纯 chat 团队失败用户会无声等待——补齐）。
        await this.notifyMissionFailed({
          missionId,
          userId,
          title: mission.title,
          reason: message,
        });
      }
    }
  }

  // ── 能力化执行（采用引用 → 共享能力 runner → 在 harness 真跑）──────────────────

  /**
   * 把团队套用的 workflow（sourceListingId → 市场 SKU.missionType）解析到平台共享的
   * 能力 runner（CapabilityRegistry）。
   *
   * 深度研究团队（含 researcher 成员 / 绑 deep-insight workflow）强制走能力 runner，
   * **不降级**到通用三阶段 chat——降级是模型用错（qwen3-max 偷跑）的根因。
   * 若 deep-insight runner 尚未注册（onModuleInit 未触发）→ warn + throw，
   * 而非静默 fallback，让问题可观测。
   */
  private resolveCapabilityRunner(
    team: CompanyTeamForMission | null,
  ): ICapabilityRunner | undefined {
    // 1) 正道：团队套用的 workflow → 市场 SKU.missionType → 能力。
    const sourceListingId = team?.workflow?.sourceListingId;
    if (sourceListingId) {
      const sku = this.catalogService
        .getWorkflows()
        .find((w) => w.id === sourceListingId);
      if (sku?.missionType) {
        const runner = this.capabilityRegistry.resolve(sku.missionType);
        if (runner) return runner;
        // workflow 绑定了 missionType 但 runner 未注册：硬失败，不降级
        this.log.error(
          `resolveCapabilityRunner: missionType "${sku.missionType}" for listing "${sourceListingId}" not found in CapabilityRegistry — deep-insight runner may not have initialized`,
        );
        throw new Error(
          `capability runner "${sku.missionType}" not registered; ensure DeepInsightDefaultRunner.onModuleInit ran`,
        );
      }
    }
    // 2) 存量兼容：未绑 workflow 但花名册含 researcher 叶子的团队 → 硬路由到 deep-insight。
    //    强制不降级：找不到 runner 抛错（可观测），不静默 fallback 到通用三阶段。
    if (
      team?.members.some(
        (m) => m.hiredAgent?.listingId === "playground.researcher",
      )
    ) {
      const runner = this.capabilityRegistry.resolve("deep-insight");
      if (runner) return runner;
      this.log.error(
        `resolveCapabilityRunner: deep-insight runner not found in CapabilityRegistry — cannot run deep-research team`,
      );
      throw new Error(
        `capability runner "deep-insight" not registered; ensure DeepInsightDefaultRunner.onModuleInit ran`,
      );
    }
    return undefined;
  }

  /**
   * 经能力 runner 真跑：runner 是平台共享、纯执行（用共享 agent，产出结果 + 流式事件），
   * **company 负责持久化 + 把事件桥到 company.* WS**。零 playground 依赖、零山寨重实现。
   *
   * preferredModelId 透传到 CapabilityRunInput，最终到达 agentRunner.run RunOptions，
   * 命中 resolvePreferredModel 第一优先，bypass election，走用户 BYOK 默认解析链。
   */
  private async runViaCapability(
    missionId: string,
    userId: string,
    topic: string,
    runner: ICapabilityRunner,
    preferredModelId?: string,
    signal?: AbortSignal,
    extra?: HeroMissionExtra,
    attempt = 1,
  ): Promise<void> {
    const result = await runner.run(
      {
        topic,
        ...(preferredModelId ? { preferredModelId } : {}),
        ...(extra?.description ? { description: extra.description } : {}),
        ...(extra?.depth ? { depth: extra.depth } : {}),
        ...(extra?.language ? { language: extra.language } : {}),
        ...(extra?.withFigures !== undefined
          ? { withFigures: extra.withFigures }
          : {}),
        ...(extra?.knowledgeBaseIds?.length
          ? { knowledgeBaseIds: extra.knowledgeBaseIds }
          : {}),
        ...(extra?.searchTimeRange
          ? { searchTimeRange: extra.searchTimeRange }
          : {}),
        ...(extra?.styleProfile ? { styleProfile: extra.styleProfile } : {}),
        ...(extra?.lengthProfile ? { lengthProfile: extra.lengthProfile } : {}),
        ...(extra?.audienceProfile
          ? { audienceProfile: extra.audienceProfile }
          : {}),
        ...(extra?.auditLayers ? { auditLayers: [extra.auditLayers] } : {}),
      },
      {
        userId,
        missionId,
        ...(signal ? { signal } : {}),
        // ★ 运行态持久化（枢纽）：注入 company 持久化端口 → 能力核每阶段 saveCheckpoint
        //   落 company_missions.result.__checkpoint + 终态首写赢仲裁。
        persistence: this.persistenceAdapter,
        onEvent: (e) => {
          void this.bridgeCapabilityEvent(missionId, userId, e);
        },
      },
    );

    const toJson = (v: unknown): Prisma.InputJsonValue =>
      JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

    // 维度 → 子任务 steps：让前端"任务列表"tab 有内容（成功按各 researcher pipeline
    // 状态，失败按已规划维度标 failed），不再永远空白。
    const pipelines = result.dimensionPipelines ?? {};
    const planObj = result.stageOutputs?.plan as
      | { dimensions?: Array<{ name?: string }> }
      | undefined;
    const planDimNames = (planObj?.dimensions ?? [])
      .map((d) => d?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const dimNames =
      Object.keys(pipelines).length > 0 ? Object.keys(pipelines) : planDimNames;
    const dimSteps = dimNames.map((d) => {
      const p = pipelines[d];
      return {
        label: d,
        role: "Researcher",
        dimension: d,
        status: p?.state === "completed" ? "done" : "failed",
        ...(typeof p?.tokensUsed === "number" ? { tokens: p.tokensUsed } : {}),
        ...(typeof p?.costCents === "number" ? { costCents: p.costCents } : {}),
      };
    });

    // 协作动态：累积的 agent/stage 事件落库，详情重开可回放。
    const collab = toJson(this.collabBuffers.get(missionId) ?? []);

    if (result.status === "completed") {
      // ── 验收 gate：surface runner 内部 verdict，按 manifest.rubric 阈值判定 ──
      const rubric = runner.manifest.rubric;
      const threshold = rubric?.passThreshold ?? DEFAULT_ACCEPTANCE_THRESHOLD;
      const maxAttempts =
        rubric?.maxAttempts ?? DEFAULT_ACCEPTANCE_MAX_ATTEMPTS;
      const rv = result.reviewVerdict;
      const score = typeof rv?.score === "number" ? rv.score : undefined;
      // 有分用分；无分但有三档 verdict → reject 判不通过；都没有 → 放行（不阻塞无评审能力）。
      const passed =
        score !== undefined
          ? score >= threshold
          : rv?.verdict
            ? rv.verdict !== "reject"
            : true;

      // 不通过且未到封顶 → 重跑（仅对"跑成功但质量不达标"重跑，绝不对 error 无脑重试）。
      if (!passed && attempt < maxAttempts && !signal?.aborted) {
        this.log.warn(
          `CompanyMission ${missionId} acceptance below threshold ` +
            `(score=${score ?? "n/a"} verdict=${rv?.verdict ?? "n/a"} < ${threshold}); ` +
            `retry attempt ${attempt + 1}/${maxAttempts}`,
        );
        await this.emit("company.stage:lifecycle", missionId, userId, {
          stage: "review",
          status: "started",
          label: `质量不达标，重跑（第 ${attempt + 1} 次）`,
        });
        await this.runViaCapability(
          missionId,
          userId,
          topic,
          runner,
          preferredModelId,
          signal,
          extra,
          attempt + 1,
        );
        return;
      }

      // ★ 终态走仲裁：条件写（未取消才写），避免盖掉用户取消。
      const won = await this.finalizeIfNotCancelled(missionId, {
        status: "done",
        progress: 100,
        result: {
          summary: result.report ?? "",
          references: toJson(result.references ?? []),
          dimensions: dimNames,
          steps: toJson(dimSteps),
          collab,
          usage: {
            totalTokens: result.usage?.totalTokens ?? 0,
            totalCostCents: result.usage?.totalCostCents ?? 0,
          },
          // ── 验收结果落 result JSON（无 schema 变更）──
          review: toJson({
            score: score ?? null,
            verdict: rv?.verdict ?? null,
            passed,
            threshold,
            attempts: attempt,
            notes: rv?.notes ?? [],
          }),
          capabilityId: runner.manifest.id,
          // ★ 复跑用：终态保留派发参数（capabilityId/model/档位），让 rerun 用同档位重跑。
          __dispatch: toJson({
            capabilityId: runner.manifest.id,
            ...(preferredModelId ? { preferredModelId } : {}),
            ...(extra ? { extra } : {}),
          }),
          completedAt: new Date().toISOString(),
        },
      });
      // 被取消抢先（won=false）→ 不发 completed 事件（mission:cancelled 已由 cancelMission 广播）。
      if (won) {
        await this.emit("company.mission:completed", missionId, userId, {
          missionId,
        });
        // ★ post-run 副作用 #1：知识图谱构建（fire-and-forget，不阻断主流程）。
        //   graphService.build 读 CompanyMission.result.summary → LLM 抽取实体/关系
        //   → upsert company_mission_graphs。失败只 error log，不影响 mission 终态。
        if (this.missionGraph) {
          void this.missionGraph
            .build(userId, missionId)
            .catch((err: unknown) => {
              this.log.error(
                `[post-run graph ${missionId}] knowledge-graph build failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
        // ★ post-run 副作用 #2：library 沉淀（fire-and-forget，不阻断主流程）。
        //   把能力核报告 markdown 落成一条 library note，与 playground 侧对称。
        if (this.sediment) {
          void this.sediment
            .sedimentMission({
              missionId,
              userId,
              title: topic,
              content: result.report ?? "",
              source: "company",
              tags: ["company", ...dimNames],
            })
            .catch((err: unknown) => {
              this.log.error(
                `[post-run sediment ${missionId}] library sediment failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
      }
      this.log.log(
        `CompanyMission ${missionId} completed via capability "${runner.manifest.id}" ` +
          `(score=${score ?? "n/a"} passed=${passed} attempts=${attempt})`,
      );
      return;
    }

    // failed —— 不伪装成功：真实 error 落库 + emit（前端失败空态据此显示真因）。
    // 仍带上已规划维度（标 failed），让"任务列表"展示尝试过的子任务而非空白。
    const message = result.error ?? "capability run failed";
    // ★ 终态走仲裁：条件写（未取消才写）。能力核 abort 后返回 failed，但用户取消已置
    //   cancelled——此处守护避免把 cancelled 盖成 failed。
    const won = await this.finalizeIfNotCancelled(missionId, {
      status: "failed",
      result: {
        error: message,
        dimensions: dimNames,
        steps: toJson(dimSteps),
        collab,
        // ★ 复跑用：失败也保留派发参数，让用户一键重跑同档位任务。
        __dispatch: toJson({
          capabilityId: runner.manifest.id,
          ...(preferredModelId ? { preferredModelId } : {}),
          ...(extra ? { extra } : {}),
        }),
        failedAt: new Date().toISOString(),
      },
    });
    if (won) {
      await this.emit("company.mission:failed", missionId, userId, {
        missionId,
        message,
      });
      await this.notifyMissionFailed({
        missionId,
        userId,
        title: topic,
        reason: message,
      });
    }
  }

  /** 能力执行流事件 → company.stage:lifecycle + 进度（前端任务详情 WS 实时呈现）。 */
  private async bridgeCapabilityEvent(
    missionId: string,
    userId: string,
    event: CapabilityRunEvent,
  ): Promise<void> {
    if (event.type === "stage:started" || event.type === "stage:completed") {
      // 优先用结构化 telemetry.systemStageId（14 阶段锚点，W2 后能力 runner 填充）；
      // 缺省时回退到 stepId→3桶硬编码 map（6 阶段精简版兜底，不删不退化）。
      const stage = this.resolveCompanyStage(event);
      if (stage) {
        const done = event.type === "stage:completed";
        await this.emit("company.stage:lifecycle", missionId, userId, {
          stage,
          status: done ? "completed" : "started",
          label: event.label,
          // ★ 14 步实时任务列表：透传 telemetry.systemStageId，前端 deriveLiveSteps
          //   命中即按 14 阶段逐行点亮（与 playground 一致）；缺省时前端走 3 桶降级。
          ...(event.telemetry?.systemStageId
            ? { telemetry: { systemStageId: event.telemetry.systemStageId } }
            : {}),
        });
        // 渐进任务：planning 桶起点 → 规划任务；review 桶 → 评审任务。
        // 锚点优先用 systemStageId（s2-leader-plan / s10-leader-signoff…），
        // 退回旧 stepId（plan / review）保持兼容。
        const sys = event.telemetry?.systemStageId;
        const isPlanAnchor = sys
          ? sys === "s2-leader-plan"
          : event.stepId === "plan";
        const isReviewAnchor = sys
          ? stage === "review"
          : event.stepId === "review";
        if (isPlanAnchor || isReviewAnchor) {
          const st = this.liveState(missionId);
          if (isPlanAnchor)
            st.planning = done ? "done" : (st.planning ?? "running");
          else st.review = done ? "done" : (st.review ?? "running");
          await this.persistLiveProgress(missionId);
        }
      }
    } else if (event.type === "agent-lifecycle") {
      // 完成快照：桥转到 company.agent:lifecycle 供前端实时展示 token/model 进度
      const p = event.payload ?? {};
      const state = typeof p.state === "string" ? p.state : undefined;
      const phase =
        typeof p.phase === "string"
          ? p.phase
          : state === "succeeded" || state === "completed"
            ? "completed"
            : state === "failed"
              ? "failed"
              : "completed";
      const role =
        typeof p.role === "string" ? p.role : (p.agentId as string | undefined);
      await this.emit("company.agent:lifecycle", missionId, userId, {
        stepId: event.stepId,
        label: event.label,
        phase,
        role,
        ...p,
      });
      // 渐进任务：若该生命周期快照带 dimension，同样纳入逐维度推进
      const dim = typeof p.dimension === "string" ? p.dimension : undefined;
      if (dim && this.markDimension(missionId, dim, phaseToDimStatus(phase))) {
        await this.persistLiveProgress(missionId);
      }
    } else if (event.type === "agent-trace") {
      // 过程级 agent 事件：按 kind 分流
      const p = event.payload ?? {};
      const kind = typeof p.kind === "string" ? p.kind : "";
      const role = typeof p.role === "string" ? p.role : undefined;
      const dimension =
        typeof p.dimension === "string" ? p.dimension : undefined;

      if (
        kind === "lifecycle-started" ||
        kind === "lifecycle-completed" ||
        kind === "lifecycle-failed"
      ) {
        // 生命周期节点 → company.agent:lifecycle
        const phase =
          kind === "lifecycle-started"
            ? "started"
            : kind === "lifecycle-completed"
              ? "completed"
              : "failed";
        await this.emit("company.agent:lifecycle", missionId, userId, {
          phase,
          role,
          ...(dimension !== undefined ? { dimension } : {}),
          ...(typeof p.agentId === "string" ? { agentId: p.agentId } : {}),
          ...(typeof p.tokensUsed === "number"
            ? { tokensUsed: p.tokensUsed }
            : {}),
          ...(p.modelTrail !== undefined ? { modelTrail: p.modelTrail } : {}),
        });
        // 渐进任务：每个维度的 researcher 随生命周期逐个出现并推进
        if (
          dimension &&
          this.markDimension(missionId, dimension, phaseToDimStatus(phase))
        ) {
          await this.persistLiveProgress(missionId);
        }
      } else {
        // thinking / action_planned / action_executed / error → 双路发送：
        //   (a) company.agent:trace  — 结构化过程追踪（timeline 抽屉可见）
        //   (b) company.agent:narrative — 精简文本（协作动态人读性，截断防膨胀）
        const rawKind = typeof p.kind === "string" ? p.kind : "";
        const toolId = typeof p.toolId === "string" ? p.toolId : undefined;
        const agentId = typeof p.agentId === "string" ? p.agentId : undefined;
        const stepId = event.stepId;
        const ts = event.timestamp ?? Date.now();

        // (a) company.agent:trace — 结构化 kind 映射（与 playground AgentTraceSchema 对齐）
        //   thinking → "thought"；action_planned / action_executed → "action"；其余 skip。
        const traceKind = this.traceKindFromAgentKind(rawKind);
        if (traceKind !== null && agentId) {
          const rawText = typeof p.text === "string" ? p.text : undefined;
          const traceItem: Record<string, unknown> = {
            kind: traceKind,
            ts,
            ...(toolId ? { toolId } : {}),
            ...(rawText !== undefined ? { text: rawText } : {}),
          };
          await this.emit("company.agent:trace", missionId, userId, {
            agentId,
            role: role ?? "agent",
            ...(dimension !== undefined ? { dimension } : {}),
            ...(stepId ? { stepId } : {}),
            items: [traceItem],
          });
        }

        // (b) company.agent:narrative — 精简策展文本（截断防止大 blob 灌入协作动态）
        const narrativeText = this.buildNarrativeText(
          rawKind,
          typeof p.text === "string" ? p.text : undefined,
          toolId,
        );
        const tag = typeof p.tag === "string" ? p.tag : undefined;
        if (narrativeText !== undefined) {
          await this.emit("company.agent:narrative", missionId, userId, {
            text: narrativeText,
            ...(role !== undefined ? { role } : {}),
            ...(tag !== undefined ? { tag } : {}),
            ...(dimension !== undefined ? { dimension } : {}),
          });
        }
      }
    } else if (event.type === "domain") {
      // ★ #16b domain 事件桥接：能力核发 domain 中性事件 → company.<event> namespace。
      // payload 结构：{ event: string; data: Record<string,unknown> }
      const domainPayload = event.payload as
        | { event?: string; data?: Record<string, unknown> }
        | undefined;
      const domainEvent = domainPayload?.event;
      const domainData = domainPayload?.data ?? {};
      if (domainEvent) {
        // 翻译 agent:lifecycle domain 事件时同步更新渐进维度状态。
        if (domainEvent === "agent:lifecycle") {
          const dim =
            typeof domainData.dimension === "string"
              ? domainData.dimension
              : undefined;
          const phase =
            typeof domainData.phase === "string"
              ? domainData.phase
              : "completed";
          if (
            dim &&
            this.markDimension(missionId, dim, phaseToDimStatus(phase))
          ) {
            await this.persistLiveProgress(missionId);
          }
        }
        // Fix 3：dimension:research:completed → "running"（采集完成，评分仍在途）；
        //   dimension:graded → "done"（评分落地，维度真正终态）。
        //   单调性守护由 markDimension 内部保证（done/failed 不被 running 降级）。
        //   若 dimension:graded 因能力核异常未到达，终态时 runViaCapability 里的
        //   dimSteps 写入（p?.state === "completed" ? "done" : "failed"）兜底覆盖。
        if (domainEvent === "dimension:research:completed") {
          const dim =
            typeof domainData.dimension === "string"
              ? domainData.dimension
              : undefined;
          if (dim && this.markDimension(missionId, dim, "running")) {
            await this.persistLiveProgress(missionId);
          }
        }
        if (domainEvent === "dimension:graded") {
          const dim =
            typeof domainData.dimension === "string"
              ? domainData.dimension
              : undefined;
          if (dim && this.markDimension(missionId, dim, "done")) {
            await this.persistLiveProgress(missionId);
          }
        }
        await this.emit(
          `company.${domainEvent}`,
          missionId,
          userId,
          domainData,
        );
      }
    }
  }

  /**
   * Fix 1：CapabilityRunEvent agent-trace kind → company.agent:trace 的结构化 kind。
   * 返回 null 表示该 kind 不映射到结构化 trace（不发 agent:trace 事件）。
   *   thinking             → "thought"
   *   action_planned       → "action"（工具调用意图）
   *   action_executed      → "action"（工具调用完成，有 toolId）
   *   error                → null（错误通过 narrative warning 暴露，不放入 trace timeline）
   */
  private traceKindFromAgentKind(kind?: string): "thought" | "action" | null {
    switch (kind) {
      case "thinking":
        return "thought";
      case "action_planned":
      case "action_executed":
        return "action";
      default:
        return null;
    }
  }

  /**
   * Fix 1：构建 narrative 精简文本（截断防止大 blob 灌入协作动态）。
   *   thinking            → 前 280 字符 + 省略号
   *   action_executed     → 短摘要 "调用 ${toolId}：${query/url 摘要}"
   *   action_planned      → 前 200 字符 + 省略号
   *   error               → 保留原文（告警用）
   *   无文本可用           → undefined（不发 narrative）
   */
  private buildNarrativeText(
    kind?: string,
    text?: string,
    toolId?: string,
  ): string | undefined {
    if (kind === "thinking") {
      if (!text) return undefined;
      return text.length > 280 ? `${text.slice(0, 280)}…` : text;
    }
    if (kind === "action_executed" && toolId) {
      const summary =
        text && text.length > 60 ? `${text.slice(0, 60)}…` : (text ?? "");
      return `调用 ${toolId}${summary ? `：${summary}` : ""}`;
    }
    if (kind === "action_planned" && text) {
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    }
    if (kind === "error" && text) {
      return text;
    }
    return undefined;
  }

  /**
   * 把能力执行事件归类到 company 的 3 桶（planning / execution / review）。
   *
   * 优先级：
   *   1. event.telemetry.systemStageId（14 阶段结构化锚点，s1-budget … s12-self-evolution，
   *      W2 后能力 runner 填充）→ 经 SYSTEM_STAGE_TO_COMPANY_BUCKET 归桶。
   *   2. 兜底 event.stepId（6 阶段精简版的 plan/research/…，老 runner 用）→ STEP_ID_TO_COMPANY_BUCKET。
   *
   * 兜底 map 保留不删——W2 未接前/能力降级时仍能正确点亮 3 桶，不退化。
   */
  private resolveCompanyStage(
    event: CapabilityRunEvent,
  ): "planning" | "execution" | "review" | undefined {
    const sys = event.telemetry?.systemStageId;
    if (sys && SYSTEM_STAGE_TO_COMPANY_BUCKET[sys]) {
      return SYSTEM_STAGE_TO_COMPANY_BUCKET[sys];
    }
    return event.stepId ? STEP_ID_TO_COMPANY_BUCKET[event.stepId] : undefined;
  }

  /** 取/建某 mission 的渐进任务状态。 */
  private liveState(missionId: string) {
    let s = this.liveTaskState.get(missionId);
    if (!s) {
      s = { dimOrder: [], dimStatus: new Map() };
      this.liveTaskState.set(missionId, s);
    }
    return s;
  }

  /**
   * 渐进维度状态机的唯一写入口。返回状态是否真的变化——
   * agent:lifecycle 与 dimension:research:completed 对同一维度会背靠背到达，
   * 只有变化才值得触发 persistLiveProgress 的全量 result 写。
   */
  private markDimension(
    missionId: string,
    dim: string,
    status: "running" | "done" | "failed",
  ): boolean {
    const st = this.liveState(missionId);
    if (!st.dimStatus.has(dim)) {
      st.dimOrder.push(dim);
    } else {
      const current = st.dimStatus.get(dim);
      if (current === status) return false;
      // 单调性：终态（done/failed）不被迟到的 running 事件降级回运行中。
      if (
        status === "running" &&
        (current === "done" || current === "failed")
      ) {
        return false;
      }
    }
    st.dimStatus.set(dim, status);
    return true;
  }

  /**
   * 把当前渐进任务状态 + 协作动态落库到 result（运行中实时持久化）。
   * status/progress 不变（保持 running）；终态时 runViaCapability 用最终结果覆盖。
   */
  private async persistLiveProgress(missionId: string): Promise<void> {
    const s = this.liveTaskState.get(missionId);
    if (!s) return;
    const steps: Array<Record<string, unknown>> = [];
    if (s.planning)
      steps.push({
        label: "意图理解 · 维度拆解",
        role: "Leader",
        status: s.planning === "done" ? "done" : "running",
      });
    for (const d of s.dimOrder)
      steps.push({
        label: d,
        role: "Researcher",
        dimension: d,
        status: s.dimStatus.get(d) ?? "running",
      });
    if (s.review)
      steps.push({
        label: "综合评审",
        role: "Reviewer",
        status: s.review === "done" ? "done" : "running",
      });

    // 整列替换前读回 __ 前缀的运行期元数据（__checkpoint / __dispatch / __terminal）原样保留：
    // s3 期间 adapter 已写 checkpoint，实时进度写若整体覆盖会让崩溃续跑/复跑依据全部丢失。
    // （与 patchCheckpoint 的 read-modify-write 并发仍有窄竞态窗口，best-effort 一致。）
    const preserved: Record<string, unknown> = {};
    try {
      const row = await this.prisma.companyMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });
      if (
        row?.result &&
        typeof row.result === "object" &&
        !Array.isArray(row.result)
      ) {
        for (const [k, v] of Object.entries(
          row.result as Record<string, unknown>,
        )) {
          if (k.startsWith("__")) preserved[k] = v;
        }
      }
    } catch (err: unknown) {
      this.log.warn(
        `persistLiveProgress ${missionId} read-back failed (metadata may be lost): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const toJson = (v: unknown): Prisma.InputJsonValue =>
      JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
    await this.updateMission(missionId, {
      result: toJson({
        ...preserved,
        steps,
        dimensions: s.dimOrder,
        collab: this.collabBuffers.get(missionId) ?? [],
        live: true,
      }),
    });
  }

  // ── Stage implementations ──────────────────────────────────────────────────

  /**
   * Stage 1: Leader 拆解任务。
   * 返回 planning 输出文本（可为 JSON 描述子任务列表，供 execution 使用）。
   * 无 leader 时用系统默认模型。
   */
  private async runPlanning(
    missionTitle: string,
    team: CompanyTeamForMission | null,
    userId: string,
  ): Promise<string> {
    const leader = this.resolveLeader(team);

    const systemPrompt = [
      [
        "You are the CEO and team leader of a consulting firm.",
        "Your task is to analyze the given mission and break it down into a structured execution plan.",
        "Identify 2–4 concrete subtasks for the team members, each with a clear objective and expected deliverable.",
        "If a workflow is defined, align subtasks to those stages.",
        "Output a concise plan in plain text or lightweight JSON.",
      ].join(" "),
      this.buildSkillInstructions(leader?.skillIds ?? []),
    ]
      .filter(Boolean)
      .join("\n\n");

    const userContent = [
      `Mission: ${missionTitle}`,
      team?.workflow
        ? `Team workflow stages: ${team.workflow.stages.join(", ")}`
        : "",
      team
        ? `Team members: ${this.describeMemberRoles(team)}`
        : "No team configured — use general best practices.",
    ]
      .filter(Boolean)
      .join("\n");

    const req = this.buildChatRequest(
      systemPrompt,
      userContent,
      leader,
      { creativity: "medium", outputLength: "medium" },
      "company-mission-planning",
      userId,
    );

    const result = await this.chatFacade.chat(req);
    if (result.isError) {
      throw new Error(`Planning stage LLM error: ${result.content}`);
    }
    return result.content;
  }

  /**
   * Stage 2: 各成员（或无成员时用 non-leader model）依 workflow stages 执行。
   * 返回每个成员/阶段的产出文本数组。
   */
  private async runExecution(
    missionTitle: string,
    planningOutput: string,
    team: CompanyTeamForMission | null,
    userId: string,
  ): Promise<string[]> {
    const executionStages = this.resolveExecutionStages(team);
    const nonLeaderMembers = this.resolveNonLeaderMembers(team);

    const outputs: string[] = [];

    for (let i = 0; i < executionStages.length; i++) {
      const stageName = executionStages[i];
      // Round-robin assign a member if available; otherwise fall back to leader/default
      const member =
        nonLeaderMembers.length > 0
          ? nonLeaderMembers[i % nonLeaderMembers.length]
          : this.resolveLeader(team);

      // ★ ⑤ 真用（工具/ReAct 级）：成员若是可独立跑的 playground 叶子 agent（researcher），
      //   解析回真 @DefineAgent 类用 AgentRunner 真跑（带真 web-search/ReAct）；
      //   失败或非叶子 → 退回下方「注入真技能指令的通用 chat」。
      const realOutput = await this.tryRunRealAgent(
        member,
        missionTitle,
        stageName,
        planningOutput,
        userId,
      );
      if (realOutput != null) {
        outputs.push(`[${stageName}]\n${realOutput}`);
        continue;
      }

      const systemPrompt = [
        member
          ? `You are a ${member.role} on a consulting team.`
          : "You are a specialist consultant.",
        `Your goal is to execute the "${stageName}" stage of the mission.`,
        "Be specific, thorough, and professional.",
        this.buildSkillInstructions(member?.skillIds ?? []),
      ]
        .filter(Boolean)
        .join("\n\n");

      const userContent = [
        `Mission: ${missionTitle}`,
        `Execution plan:\n${planningOutput}`,
        `Your focus for stage "${stageName}": produce a detailed, actionable output for this stage.`,
      ].join("\n\n");

      const req = this.buildChatRequest(
        systemPrompt,
        userContent,
        member,
        { creativity: "medium", outputLength: "long" },
        `company-mission-execution-${stageName}`,
        userId,
      );

      const result = await this.chatFacade.chat(req);
      if (result.isError) {
        throw new Error(
          `Execution stage "${stageName}" LLM error: ${result.content}`,
        );
      }
      outputs.push(`[${stageName}]\n${result.content}`);
    }

    return outputs;
  }

  /**
   * ⑤ 真用：成员若解析为「可独立跑的 playground 叶子 agent」，用 AgentRunner 真跑
   * 该 @DefineAgent 类（researcher → 真 web-search/ReAct，出结构化 findings）。
   * 非叶子 / 未沉淀 / 跑失败 → 返回 null，调用方退回通用 chat（不抛错、不阻断 mission）。
   */
  private async tryRunRealAgent(
    member: CompanyHiredAgent | null,
    topic: string,
    dimension: string,
    context: string,
    userId: string,
  ): Promise<string | null> {
    const listingId = member?.listingId;
    if (!listingId || !STANDALONE_RUNNABLE_AGENT_IDS.has(listingId))
      return null;
    const SpecClass = resolveAgentSpec(listingId);
    if (!SpecClass) return null;

    try {
      const result = await this.agentRunner.run(
        SpecClass,
        {
          topic,
          dimension,
          language: "zh-CN",
          description: context.slice(0, 4000),
          withFigures: false,
        },
        { userId },
      );
      const text = this.stringifyAgentOutput(result.output);
      this.log.log(
        `CompanyMission member "${listingId}" ran real agent (out ${text.length} chars)`,
      );
      return text;
    } catch (err) {
      this.log.warn(
        `real agent "${listingId}" run failed, fallback to chat: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private stringifyAgentOutput(output: unknown): string {
    if (typeof output === "string") return output;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }

  /**
   * Stage 3: Leader 综合评审并生成最终交付。
   * 返回综合后的 final summary 文本。
   */
  private async runReview(
    missionTitle: string,
    planningOutput: string,
    executionOutputs: string[],
    team: CompanyTeamForMission | null,
    userId: string,
  ): Promise<string> {
    const leader = this.resolveLeader(team);

    const systemPrompt = [
      [
        "You are the CEO reviewing your team's work.",
        "Synthesize all stage outputs into a cohesive final deliverable.",
        "Evaluate completeness, quality, and alignment with the original mission goal.",
        "Produce a clear, professional final summary and any key recommendations.",
      ].join(" "),
      this.buildSkillInstructions(leader?.skillIds ?? []),
    ]
      .filter(Boolean)
      .join("\n\n");

    const userContent = [
      `Mission: ${missionTitle}`,
      `Planning output:\n${planningOutput}`,
      "Team execution outputs:",
      ...executionOutputs.map((o, i) => `--- Output ${i + 1} ---\n${o}`),
      "\nSynthesize these into a final deliverable and provide your assessment.",
    ].join("\n\n");

    const req = this.buildChatRequest(
      systemPrompt,
      userContent,
      leader,
      { creativity: "low", outputLength: "long" },
      "company-mission-review",
      userId,
    );

    const result = await this.chatFacade.chat(req);
    if (result.isError) {
      throw new Error(`Review stage LLM error: ${result.content}`);
    }
    return result.content;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Build a chat request from a system prompt + user content.
   * Uses model from the agent's models array if provided, otherwise falls back to
   * AIModelType.CHAT (let the engine select the best available model).
   * TaskProfile is always semantic — never hardcodes temperature or maxTokens.
   */
  private buildChatRequest(
    systemPrompt: string,
    userContent: string,
    agent: CompanyHiredAgent | null,
    taskProfile: TaskProfile,
    operationName: string,
    userId: string,
  ): Parameters<ChatFacade["chat"]>[0] {
    // 成员模型偏好 = 用户「我的模型」里选的真实 model id（fallback 链取主模型）。
    // 旧档位名（Opus/Sonnet/Haiku）仅作向后兼容：识别为档位则走 modelType，不当真实 id 传。
    const pref = agent?.models?.[0] ?? "";
    const legacyType = TIER_TO_MODEL_TYPE[pref];
    const model = legacyType ? "" : pref;
    const modelType: AIModelType = legacyType ?? AIModelType.CHAT;

    return {
      messages: [{ role: "user" as const, content: userContent }],
      systemPrompt,
      taskProfile,
      operationName,
      // 真实 model id 优先；为空时由 modelType + TaskProfile 解析（符合"fallback 用空串"红线）
      ...(model ? { model } : {}),
      modelType,
      // ★ 后台 mission 任务无 RequestContext → 必须显式带 billing.userId，
      //   否则下游 AiChatService 严格 BYOK 防呆会抛 "[chat] Refused: no userId"。
      billing: {
        userId,
        moduleType: "company",
        operationType: operationName,
      },
    };
  }

  /** Resolve the leader agent (by leaderId → member lookup). Falls back to null. */
  private resolveLeader(
    team: CompanyTeamForMission | null,
  ): CompanyHiredAgent | null {
    if (!team) return null;
    if (team.leaderId) {
      const m = team.members.find((m) => m.hiredAgentId === team.leaderId);
      if (m) return m.hiredAgent;
    }
    // Fallback: first member as leader
    return team.members[0]?.hiredAgent ?? null;
  }

  /** Resolve non-leader members. */
  private resolveNonLeaderMembers(
    team: CompanyTeamForMission | null,
  ): CompanyHiredAgent[] {
    if (!team) return [];
    return team.members
      .filter((m) => m.hiredAgentId !== team.leaderId)
      .map((m) => m.hiredAgent);
  }

  /**
   * Execution stage IDs: use workflow.stages if defined, otherwise ["execution"].
   * We always emit "execution" as the stage:lifecycle event name for frontend compat.
   * The execution loop may cover one or more workflow stages internally.
   */
  private resolveExecutionStages(team: CompanyTeamForMission | null): string[] {
    if (team?.workflow?.stages.length) {
      return team.workflow.stages;
    }
    return ["execution"];
  }

  /** Human-readable member role summary for the leader's planning prompt. */
  private describeMemberRoles(team: CompanyTeamForMission): string {
    return team.members
      .map((m) => {
        const tag = m.hiredAgentId === team.leaderId ? "(leader)" : "";
        return `${m.hiredAgent.name} [${m.hiredAgent.role}]${tag}`;
      })
      .join(", ");
  }

  /**
   * ★ 终态走仲裁（枢纽）：终态写（done/failed）经条件 updateMany 实现"取消首写赢"——
   *   仅当 mission 未被取消时才写终态，避免 run 后无条件写盖掉用户取消（cancelMission
   *   已置 cancelled）。返回是否真正写入（count>0），调用方据此决定要不要 emit 终态事件。
   *
   *   与 CompanyMissionPersistenceAdapter.applyTerminalIfRunning（能力核执行期调用，落
   *   __terminal + checkpoint）配套：adapter 抢仲裁权，service 写业务富结果但同样守护取消。
   */
  private async finalizeIfNotCancelled(
    id: string,
    data: {
      status: "done" | "failed";
      progress?: number;
      result: Prisma.InputJsonValue;
    },
  ): Promise<boolean> {
    try {
      const res = await this.prisma.companyMission.updateMany({
        // 仅守护 cancelled，不能收窄成 RUNNING_STATUSES：能力轨上 adapter.applyTerminalIfRunning
        // 在 runner 返回前已把行写成 done/failed（崩溃耐久的裸终态），service 的富结果终写
        // （steps/review/__dispatch/事件门）必须能覆盖它——收窄会让 won 恒为 false，
        // completed/failed 事件与 post-run 副作用全部静默丢失。
        where: { id, status: { not: "cancelled" } },
        data,
      });
      return res.count > 0;
    } catch (err: unknown) {
      this.log.warn(
        `finalizeIfNotCancelled ${id} db error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async updateMission(
    id: string,
    data: Partial<
      Pick<CompanyMission, "status" | "progress"> & {
        result: Prisma.InputJsonValue;
      }
    >,
  ): Promise<void> {
    await this.prisma.companyMission
      .update({ where: { id }, data })
      .catch((err: unknown) => {
        this.log.warn(
          `updateMission ${id} db error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private async emit(
    type: string,
    missionId: string,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const timestamp = Date.now();
    // 协作动态持久化：缓存 agent/stage 级事件，mission 终态时落库 result.collab，
    // 重开详情可回放（live WS 流断开后不再丢）。封顶 500 条防膨胀。
    if (type.startsWith("company.agent") || type.startsWith("company.stage")) {
      const buf = this.collabBuffers.get(missionId) ?? [];
      if (buf.length < 500) {
        buf.push({ type, payload, timestamp });
        this.collabBuffers.set(missionId, buf);
      }
    }
    await this.eventBus
      .emit({
        type,
        scope: { missionId, userId },
        payload,
        timestamp,
      })
      .catch((err: unknown) => {
        this.log.warn(
          `emit ${type} for ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
