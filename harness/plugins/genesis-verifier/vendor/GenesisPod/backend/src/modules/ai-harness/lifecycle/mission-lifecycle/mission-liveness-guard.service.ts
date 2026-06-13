/**
 * MissionLivenessGuard —— harness 层 mission 活性单一权威检测
 *
 * 设计目标（2026-05-05 用户驱动重构，归并 4 个旧 detector）：
 *   1. **归一**：所有上层消费方共用同一检测算法 + 同一 timer，避免各自实现
 *      的"叠加性误报"和"互不感知"
 *   2. **多信号校验**：单一信号失败（DB 心跳被 row lock 阻塞 / Redis 抖动 / 事件 flush
 *      暂停）不构成误判依据；必须 heartbeat AND events 同时 stale 才算真死
 *   3. **启动期豁免**：mission 启动 < startupGraceMs（默认 5min）一律跳过，避免
 *      fire-and-forget refreshHeartbeat 尚未落 DB 就被新轮 scan 杀
 *   4. **三阶梯**：
 *        - 任一信号 stale > softWarnThresholdMs（默认 10min）→ emit warning（不杀）
 *        - heartbeat AND events 同 stale > staleThresholdMs（默认 5min，配合上面）→ markFailed
 *        - startedAt > wallTimeCapMs（默认 4h）→ markFailed（wall-time hard cap）
 *   5. **Adapter 注入**：harness 不感知具体表 schema —— 上层消费方提供
 *      fetchRunningMissions + getMostRecentEventTs + markFailed callbacks
 *   6. **多 namespace**：同 timer scan 多消费方，节省 60s scan 开销
 *
 * ★ 回收依据唯一性契约（RB4）：
 *   - **唯一回收依据 = DB heartbeatAt**（通过 adapter.fetchRunningMissions 取得）。
 *   - Redis runtime heartbeat（MissionRuntimeStateStore.claimOrBeat）是活性探测，
 *     不参与回收判定。本 Guard 的 runOnce 只读 MissionLivenessRow.heartbeatAt
 *     （DB 字段），不调用 MissionRuntimeStateStore 的任何方法。
 *   - 契约由 liveness-reclaim-contract.spec.ts 守护，禁止绕过。
 *
 * 替代关系（一并删除/迁出）：
 *   - 旧 in-app health scheduler（已 disabled）
 *   - 旧 in-app store.recoverPodCrashedRunning + recoverOrphanedRunning（移到 adapter callback 内）
 *   - 旧 Redis-heartbeat orphan-detector（已 disabled）
 *
 * 与 health-monitor.ts 关系：
 *   - MissionHealthMonitor 是无 timer 的纯算法（runOnce + fetcher / onTimeout 回调）
 *   - MissionLivenessGuard 是含 timer + 多 namespace + 多信号的完整服务
 *   - 后续可考虑把 health-monitor 的算法 inline 进来 / 或让 guard 复用 health-monitor
 *     —— 当前为简洁起见，guard 自实现（共用 30 行算法不值得引入跨文件依赖）
 */

import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

/**
 * Mission 活性检测最小行数据（adapter 必须能从底层表 select 出这 4 个字段）
 */
export interface MissionLivenessRow {
  readonly id: string;
  readonly userId: string;
  readonly startedAt: Date;
  /** null 表示从未刷新心跳（极旧的 mission / 启动后立即崩） */
  readonly heartbeatAt: Date | null;
  /**
   * 最近一次 reopen 时间（mission failed/quality-failed → running 反向状态机）。
   * null = 该 mission 从未 reopen 过。
   *
   * 设计来源：rerun-overhaul-design-v1.md §3.5（c195035f 类事故修补）。
   * wall-time 计算应该用 effective start = max(startedAt, lastReopenedAt)，
   * 否则 7h+ 前 started 的 mission 一旦 reopen 立即触发 wall-time-exceeded 误杀
   * （与重跑 cascade markCompleted 形成 race，前端读到 mission:failed 误以为重跑挂了）。
   */
  readonly lastReopenedAt?: Date | null;
}

/**
 * Adapter —— ai-app 提供的"如何读 / 如何写 / 如何 emit"实现
 *
 * 不依赖具体 ORM；harness 不感知 prisma / mongoose / 等。
 */
export interface MissionLivenessAdapter {
  /** 拉取所有 status='running' 的 mission（数量上限由 adapter 自行限制，建议 200）*/
  fetchRunningMissions(): Promise<MissionLivenessRow[]>;

  /**
   * 拉取 mission 在 sinceMs 之后最近一条事件 ts（epoch ms）。
   * 返回 Map：missionId → 最近事件 ts；missionId 缺席表示"窗口内无事件"
   *
   * 实现示例：
   *   prisma.event.groupBy({ by:['missionId'], where:{ missionId: { in }, ts: { gte: sinceMs } }, _max:{ ts:true } })
   */
  getMostRecentEventTs(
    missionIds: ReadonlyArray<string>,
    sinceMs: number,
  ): Promise<Map<string, number>>;

  /** 标记 mission 失败：reason 是分类码（machine-readable），errorMessage 是给用户的友好文本 */
  markFailed(
    missionId: string,
    reason: "no-activity" | "wall-time-exceeded",
    errorMessage: string,
  ): Promise<void>;

  /** 可选：emit warning 让 UI 看到 mission 不健康（但还没杀），用户可主动 cancel */
  emitWarning?(
    missionId: string,
    userId: string,
    payload: {
      ageMs: number;
      heartbeatAgeMs: number | null;
      eventAgeMs: number | null;
    },
  ): Promise<void>;
}

export interface MissionLivenessConfig {
  /** mission 启动后内不扫描，default 5min（避免 fire-and-forget heartbeat 未落库即被杀） */
  startupGraceMs?: number;
  /** 心跳 / 事件 stale 阈值（双信号同时超过此值才认 dead），default 5min */
  staleThresholdMs?: number;
  /** soft warn 阈值（任一信号超过即 emit warning，不杀），default 10min */
  softWarnThresholdMs?: number;
  /** wall-time 硬上限，default 4h */
  wallTimeCapMs?: number;
  /** scan 间隔，default 60s */
  scanIntervalMs?: number;
  /** boot 之后多久首次扫描，default 60s（让 redeploy 切换稳定 + 旧 pod 自然收尾）*/
  bootDelayMs?: number;
}

const DEFAULTS: Required<MissionLivenessConfig> = {
  startupGraceMs: 5 * 60 * 1000,
  staleThresholdMs: 5 * 60 * 1000,
  softWarnThresholdMs: 10 * 60 * 1000,
  wallTimeCapMs: 4 * 60 * 60 * 1000,
  scanIntervalMs: 60_000,
  bootDelayMs: 60_000,
};

interface RegisteredAdapter {
  readonly adapter: MissionLivenessAdapter;
  readonly config: Required<MissionLivenessConfig>;
}

export interface ScanResult {
  namespace: string;
  checked: number;
  warned: number;
  killed: number;
  spared: number;
}

@Injectable()
export class MissionLivenessGuard implements OnModuleDestroy {
  private readonly log = new Logger(MissionLivenessGuard.name);
  /**
   * ★ IN-PROCESS（故意不迁 Redis）：
   *   每个 NestJS pod 在 onModuleInit 时由 ai-app 调 registerAdapter() 注入自己的
   *   adapter（含 fetchRunningMissions / markFailed 等 function 引用），这些 callback
   *   绑定了 PrismaService / EventBus 等 DI 实例，**不可序列化**，无法跨进程传输。
   *   pod 重启后 onModuleInit 自动重新注册，不需要持久化。
   */
  private readonly adapters = new Map<string, RegisteredAdapter>();
  private bootTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private started = false;
  /**
   * ★ IN-PROCESS（故意不迁 Redis）：
   *   每 mission 最近一次 emitWarning 时间，仅用于 soft-warn 告警去重（避免每 60s scan
   *   都重复推同一条 warning toast）。
   *
   *   跨 pod 行为：多 pod 场景下各 pod 有独立 lastWarnedAt，理论上同一 mission 可能
   *   从不同 pod 各收到一次 warning，但这只是轻微 UX 重复（不影响正确性）。
   *   kill 决策（markFailed）基于 DB 状态，与此 map 无关，无跨 pod 一致性要求。
   *
   *   不迁 Redis 的原因：
   *   1. 迁 Redis 需注入 CacheService → 破坏当前零依赖构造器（spec 用 new Guard() 直接实例化）
   *   2. 收益 = 减少每 pod 一次的重复 warning，代价不值
   *   3. 当前 Railway 单 pod 部署，跨 pod 场景未出现
   *
   *   key = `${namespace}:${missionId}` 防多 namespace 串扰。
   */
  private readonly lastWarnedAt = new Map<string, number>();
  /**
   * ★ 全覆盖审计修 (2026-05-06): WARN_COOLDOWN_MS 改为动态辅助方法；
   * 此常量仅作全局兜底（无 config 时使用）。
   * 实际 cooldown = floor(config.softWarnThresholdMs / 2)，确保在 softWarn
   * 阈值内至少能 warn 一次（P2 修复：与 softWarnThresholdMs 同时基对齐）。
   */
  /** 动态计算某 namespace 的 warn cooldown（floor(softWarn/2)，最少 5min）*/
  private warnCooldownFor(config: Required<MissionLivenessConfig>): number {
    return Math.max(Math.floor(config.softWarnThresholdMs / 2), 5 * 60 * 1000);
  }

  /**
   * 由上层消费方在 onModuleInit 调用注册自己的 adapter。
   * namespace 必须唯一（按消费方业务名命名）。
   */
  registerAdapter(
    namespace: string,
    adapter: MissionLivenessAdapter,
    config?: MissionLivenessConfig,
  ): void {
    if (this.adapters.has(namespace)) {
      this.log.warn(
        `[liveness] namespace "${namespace}" already registered, overwriting`,
      );
    }
    this.adapters.set(namespace, {
      adapter,
      config: { ...DEFAULTS, ...config },
    });
    this.log.log(`[liveness] adapter registered: namespace="${namespace}"`);
    if (!this.started) this.startScanLoop();
  }

  unregisterAdapter(namespace: string): void {
    this.adapters.delete(namespace);
    if (this.adapters.size === 0) this.stopScanLoop();
  }

  /**
   * 启动 scan 循环 —— boot delay 后首次跑 + 之后 scanInterval 周期跑
   * 多 namespace 共用同一个 timer（用最小 scanInterval / bootDelay 即可，所有
   * namespace 都按自己 config 的阈值在 scan 内部判定）
   */
  startScanLoop(): void {
    if (this.started) return;
    this.started = true;
    const minBootDelay = this.minOf("bootDelayMs");
    const minScanInterval = this.minOf("scanIntervalMs");
    this.bootTimer = setTimeout(() => {
      void this.runAll();
      this.scanTimer = setInterval(() => {
        void this.runAll();
      }, minScanInterval);
      this.scanTimer.unref?.();
    }, minBootDelay);
    this.bootTimer.unref?.();
    this.log.log(
      `[liveness] scan loop started (bootDelay=${minBootDelay}ms, interval=${minScanInterval}ms)`,
    );
  }

  stopScanLoop(): void {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.started = false;
  }

  onModuleDestroy(): void {
    this.stopScanLoop();
  }

  /** 测试 / 手动入口：跑所有 namespace 一次 */
  async runAll(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const [namespace, entry] of this.adapters) {
      try {
        results.push(
          await this.runOnce(namespace, entry.adapter, entry.config),
        );
      } catch (err) {
        this.log.error(
          `[liveness] scan ${namespace} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return results;
  }

  /** 测试 / 手动入口：跑单个 namespace */
  async forceScan(namespace: string): Promise<ScanResult | null> {
    const entry = this.adapters.get(namespace);
    if (!entry) return null;
    return this.runOnce(namespace, entry.adapter, entry.config);
  }

  /**
   * 单次扫描算法（核心逻辑）：
   *   1. fetch running missions
   *   2. 按 startupGrace 过滤新 mission
   *   3. 拉最近事件 ts（仅查 stale 候选）
   *   4. 三阶梯判定：
   *      - wall-time 超 → markFailed
   *      - heartbeat AND events 同 stale > stale 阈值 → markFailed
   *      - 任一 stale > soft warn 阈值 → emitWarning
   *   5. 统计返回
   */
  private async runOnce(
    namespace: string,
    adapter: MissionLivenessAdapter,
    config: Required<MissionLivenessConfig>,
  ): Promise<ScanResult> {
    const missions = await adapter
      .fetchRunningMissions()
      .catch((err: unknown) => {
        this.log.warn(
          `[liveness:${namespace}] fetchRunningMissions failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as MissionLivenessRow[];
      });
    if (missions.length === 0) {
      return { namespace, checked: 0, warned: 0, killed: 0, spared: 0 };
    }
    const now = Date.now();
    const candidates = missions.filter(
      (m) => now - m.startedAt.getTime() >= config.startupGraceMs,
    );
    const spared = missions.length - candidates.length;
    if (candidates.length === 0) {
      return { namespace, checked: 0, warned: 0, killed: 0, spared };
    }

    const ids = candidates.map((m) => m.id);
    // 用 staleThresholdMs * 3 作为窗口下限拉事件，防止 query 扫到天荒地老
    const eventsSince = now - config.staleThresholdMs * 3;
    const eventTs = await adapter
      .getMostRecentEventTs(ids, eventsSince)
      .catch((err: unknown) => {
        this.log.warn(
          `[liveness:${namespace}] getMostRecentEventTs failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return new Map<string, number>();
      });

    let warned = 0;
    let killed = 0;
    for (const m of candidates) {
      // ★ 2026-05-07 rerun-overhaul：wall-time 用 effective start。reopen 后从最近
      //   reopen 时间起算，不从 mission 创建时间。否则 7h+ 前 started 的 mission 一旦
      //   reopen 立即被误判 wall-time-exceeded（与 cascade markCompleted 形成 race，
      //   前端读到 mission:failed 误以为重跑失败）。
      const reopenedMs = m.lastReopenedAt?.getTime() ?? 0;
      const effectiveStart = Math.max(m.startedAt.getTime(), reopenedMs);
      const ageMs = now - effectiveStart;
      // wall-time 硬上限：直接杀
      if (ageMs > config.wallTimeCapMs) {
        await adapter
          .markFailed(
            m.id,
            "wall-time-exceeded",
            `Mission 超过最大执行时长（${Math.round(config.wallTimeCapMs / 60_000)} 分钟）。\n\n` +
              "已自动停止以释放资源。建议：在左侧操作区点「开始」重跑相同主题（存在断点时按钮显示「继续上次」可从断点续跑），或微调档位（depth / lengthProfile）后重新发起。",
          )
          .catch((err: unknown) => {
            this.log.warn(
              `[liveness:${namespace}] markFailed ${m.id} (wall-time) threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        killed++;
        continue;
      }

      const heartbeatAgeMs = m.heartbeatAt
        ? now - m.heartbeatAt.getTime()
        : null;
      const eventTsMs = eventTs.get(m.id);
      const eventAgeMs = eventTsMs != null ? now - eventTsMs : null;
      const heartbeatStale =
        heartbeatAgeMs == null || heartbeatAgeMs > config.staleThresholdMs;
      const eventStale =
        eventAgeMs == null || eventAgeMs > config.staleThresholdMs;

      if (heartbeatStale && eventStale) {
        // 双信号都旧 —— 真死
        const reason =
          `Mission 在执行过程中失联 ≥ ${Math.round(config.staleThresholdMs / 60_000)} 分钟（无心跳 + 无事件输出）。\n\n` +
          "可能原因：pod 重启 / Railway redeploy / 进程崩溃。\n" +
          "建议：在左侧操作区点「开始」重跑相同主题；存在断点时按钮显示「继续上次」，可从断点续跑。";
        await adapter
          .markFailed(m.id, "no-activity", reason)
          .catch((err: unknown) => {
            this.log.warn(
              `[liveness:${namespace}] markFailed ${m.id} (no-activity) threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        // 终态 → 清 dedup 防泄漏
        this.lastWarnedAt.delete(`${namespace}:${m.id}`);
        killed++;
      } else if (
        // soft warn：任一信号超过 soft 阈值（且未杀）→ 提醒用户
        adapter.emitWarning &&
        ((heartbeatAgeMs != null &&
          heartbeatAgeMs > config.softWarnThresholdMs) ||
          (eventAgeMs != null && eventAgeMs > config.softWarnThresholdMs))
      ) {
        // ★ dedup：cooldown = floor(softWarnThresholdMs/2) 内不重发同一 mission 的 warning
        // ★ 全覆盖审计修 (2026-05-06): 用动态 warnCooldownFor(config) 替代固定常量
        const dedupKey = `${namespace}:${m.id}`;
        const lastWarn = this.lastWarnedAt.get(dedupKey) ?? 0;
        if (now - lastWarn < this.warnCooldownFor(config)) {
          continue; // 还在冷却期，跳过本次 emit
        }
        await adapter
          .emitWarning(m.id, m.userId, {
            ageMs,
            heartbeatAgeMs,
            eventAgeMs,
          })
          .catch((err: unknown) => {
            this.log.debug(
              `[liveness:${namespace}] emitWarning ${m.id} threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        this.lastWarnedAt.set(dedupKey, now);
        warned++;
      }
    }

    if (killed > 0 || warned > 0) {
      this.log.warn(
        `[liveness:${namespace}] checked=${candidates.length} killed=${killed} warned=${warned} spared=${spared}`,
      );
    } else {
      this.log.debug(
        `[liveness:${namespace}] checked=${candidates.length}, all healthy (spared=${spared} new)`,
      );
    }
    return { namespace, checked: candidates.length, warned, killed, spared };
  }

  private minOf(field: keyof MissionLivenessConfig): number {
    let min = DEFAULTS[field];
    for (const { config } of this.adapters.values()) {
      const v = config[field];
      if (v < min) min = v;
    }
    return min;
  }
}
