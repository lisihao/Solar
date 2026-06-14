/**
 * Mission Platform Contract — 跨 ai-app 的 mission runner / mission list 接口
 *
 * Rev 5 / S1-5 (2026-05-09):closes custom-agents back-coupling。
 *
 * 起因:`ai-app/custom-agents/custom-agents.service.ts` 之前直接 import
 * `PlaygroundPipelineDispatcher`(具体类) + `MissionStore`(具体类) + `MissionListItem`
 * (具体类型)+ `RunMissionInputSchema`(具体 schema)。这是事实上的反向耦合(custom-agents
 * 紧耦合到 playground 实现细节,违反 Dependency Inversion 原则)。
 *
 * 解决:本 contract 文件提供:
 *   - DI tokens(`MISSION_RUNNER` / `MISSION_LIST_READER`)
 *   - 接口契约(`IMissionRunner` / `IMissionListReader`)
 *   - 共享 types(`MissionRunResult` / `MissionListItem`)
 *
 * playground 端在 `playground.module.ts` 用 `useExisting` 把 dispatcher / store
 * 注册到 token;custom-agents 端 `@Inject(MISSION_RUNNER)` 拿到 IMissionRunner 接口
 * (而非 PlaygroundPipelineDispatcher 具体类)。
 *
 * 详见 docs/architecture/ai-app/playground/agent-team-boundary-audit-2026-05-08.md
 * §3.3 + §7 S1-5。
 */

// ============================================
// DI Tokens
// ============================================

/** DI token:mission runner(实现:PlaygroundPipelineDispatcher) */
export const MISSION_RUNNER = Symbol("MISSION_RUNNER");

/** DI token:mission list reader(实现:MissionStore) */
export const MISSION_LIST_READER = Symbol("MISSION_LIST_READER");

// ============================================
// Mission run result
// ============================================

/**
 * IMissionRunner.runMission 的返回值 — mission 启动后的最小快照。
 * 与 playground `PipelineMissionSummary` 同 shape(structural typing 保证)。
 */
export interface MissionRunResult {
  readonly missionId: string;
  readonly status: string;
  readonly stepsCompleted: number;
  readonly tokensUsed?: number;
  readonly costUsd?: number;
}

// ============================================
// Mission list item
// ============================================

/**
 * MissionListItem — 由 MissionStore.listByMissionIds 返回的 mission summary 行。
 * 与 playground `MissionListItem` 同 shape。
 */
export interface MissionListItem {
  id: string;
  topic: string;
  depth: string;
  language: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  wallTimeMs: number | null;
  finalScore: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  reportTitle: string | null;
  reportSummary: string | null;
  errorMessage: string | null;
}

// ============================================
// Mission Runner contract
// ============================================

/**
 * IMissionRunner — 启动一次 mission 的契约。
 *
 * 实现方:`PlaygroundPipelineDispatcher`(注册为 `useExisting: PlaygroundPipelineDispatcher`)。
 * 消费方:`CustomAgentsService.launch()`(via `@Inject(MISSION_RUNNER)`)。
 *
 * 输入 `input` 用 `unknown` — 契约不约束具体 schema(避免 contract 反向依赖业务 schema);
 * 实现方负责内部 validate(实现 `RunMissionInputSchema.safeParse` 或等价)。
 * 消费方应在调用前先做自己的 validation(如 custom-agents 用 RunMissionInputSchema
 * defensive parse,与具体 schema 耦合是 caller-side 决策)。
 */
export interface IMissionRunner {
  /**
   * 跑一次 mission,返回最小快照。
   *
   * @param missionId mission 唯一 ID
   * @param input mission 业务输入(实现方 internal validate)
   * @param userId mission owner
   * @param workspaceId 可选,workspace scoping
   * @param afterRowCreated 可选回调:mission row INSERT + session 装配完成后,
   *                        长耗时 stages 启动之前同步触发一次。caller 可在此回调
   *                        await 写自己的关联表(如 custom-agents launches),保证主调
   *                        endpoint 返回时关联行已就位。回调抛错只 log warn,不阻断
   *                        orchestrator(launches 写失败属可容忍 degrade)。
   * @returns mission 启动快照(missionId / status / stepsCompleted 等)
   */
  runMission(
    missionId: string,
    input: unknown,
    userId: string,
    workspaceId?: string,
    afterRowCreated?: () => Promise<void>,
  ): Promise<MissionRunResult>;
}

// ============================================
// Mission List Reader contract
// ============================================

/**
 * IMissionListReader — 按 missionId 列表批量读 mission summary 的契约。
 *
 * 实现方:`MissionStore`(playground)。
 * 消费方:`CustomAgentsService.listMissionsByAgent()`。
 *
 * 顺序保留入参顺序(DB IN 不保证顺序,实现方按入参 missionIds 顺序返);
 * 已删除的 mission 静默跳过(返 list 长度可能 < 入参长度)。
 */
export interface IMissionListReader {
  /**
   * 批量读 mission summary。
   *
   * @param userId mission owner(隔离过滤)
   * @param missionIds 要读的 mission ID 列表
   * @returns 按入参顺序排列的 MissionListItem[](已删除的跳过)
   */
  listByMissionIds(
    userId: string,
    missionIds: ReadonlyArray<string>,
  ): Promise<MissionListItem[]>;
}
