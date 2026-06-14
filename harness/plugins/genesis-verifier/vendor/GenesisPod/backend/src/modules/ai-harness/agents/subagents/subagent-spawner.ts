/**
 * SubagentSpawner — 派生子 Agent
 *
 * 职责：
 *   1. PreSubagentSpawn hook（可阻断）
 *   2. 解析 isolation policy 派生 envelope
 *   3. 用 AgentFactory 构造子 Agent（继承 loop / memoryBridge / skillActivator）
 *   4. 返回 SubagentHandle，让父 agent 可以消费事件流或等结果
 */

import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  IAgent,
  ISubagentHandle,
  ISubagentSpec,
  ISubagentSpawner,
} from "@/modules/ai-harness/agents/abstractions";
import { AgentFactory } from "@/modules/ai-harness/agents/core/agent-factory";
import { HookRegistry } from "@/modules/ai-harness/agents/core/hook-registry";
import { resolveIsolation } from "./isolation";
import { SubagentHandle } from "./subagent-handle";

export class SubagentSpawnBlockedError extends Error {
  constructor(reason?: string) {
    super(`Subagent spawn blocked: ${reason ?? "policy"}`);
    this.name = "SubagentSpawnBlockedError";
  }
}

/**
 * AgentFactory ↔ SubagentSpawner 的循环依赖已由 HarnessModule.onApplicationBootstrap
 * 的 setter injection（`factory.setSubagentSpawner(spawner)`）打破，所以这里直接
 * 注入 AgentFactory 即可，不再需要 @Inject(forwardRef(...))。
 */
@Injectable()
export class SubagentSpawner implements ISubagentSpawner {
  constructor(
    private readonly factory: AgentFactory,
    private readonly hooks: HookRegistry,
  ) {}

  async spawn(parent: IAgent, spec: ISubagentSpec): Promise<ISubagentHandle> {
    const parentEnvelope = parent.getEnvelope();

    // 1. PreSubagentSpawn hook
    const hookResult = await this.hooks.dispatch(
      "PreSubagentSpawn",
      {
        spec: {
          kind: "subagent_spawn",
          name: spec.name,
          prompt: spec.prompt,
          isolation: spec.isolation,
          budget: spec.budget
            ? {
                tokens: spec.budget.maxTokens,
                iterations: spec.budget.maxIterations,
              }
            : undefined,
        },
      },
      { agentId: parent.id, envelope: parentEnvelope },
    );
    if (hookResult.block) {
      throw new SubagentSpawnBlockedError(hookResult.reason);
    }

    // 2. Derive envelope via isolation policy
    const isolation = resolveIsolation(spec.isolation ?? "context");
    const childSessionId = randomUUID();
    const childSystemPrompt =
      spec.identity instanceof Object && "toSystemPrompt" in spec.identity
        ? // AgentIdentity with toSystemPrompt
          (spec.identity as { toSystemPrompt: () => string }).toSystemPrompt()
        : `# Role\n${spec.identity.role.name}\n\n${spec.identity.role.description ?? ""}`;

    const childEnvelope = isolation.derive(parentEnvelope, {
      subagentSessionId: childSessionId,
      subagentSystemPrompt: childSystemPrompt,
      budgetOverride: spec.budget,
      // T3 (sub-agent least-privilege): scope inherited tools to the child's
      // own allow/forbid policy instead of copying the full parent tool surface.
      allowedTools: spec.allowedTools,
      forbiddenTools: spec.forbiddenTools,
    });

    // 3. Build child agent via factory with derived envelope
    const child = this.factory.createWithEnvelope(
      {
        identity: spec.identity,
        sessionId: childSessionId,
        userId: childEnvelope.memory.userId,
      },
      childEnvelope,
    );

    // 4. Wrap in handle
    return new SubagentHandle({
      name: spec.name,
      parent,
      spec,
      child,
    });
  }

  /**
   * 并行派生多个子 agent，按聚合模式等待结果。
   *
   * 模式：
   *   - "all"      ·  全部完成（Promise.all）；任一失败 → 抛错
   *   - "first"    ·  第一个 succeed 的 → resolve；同时 abort 其它
   *   - "majority" ·  半数以上完成（向上取整）→ resolve（返回已完成的）；超时退化为 all
   *
   * 用例：
   *   - all       多 source 抓取 + 主 agent 整合
   *   - first     多策略并跑取最快（hedged request）
   *   - majority  多 judge 投票（n=3, 2/3 多数即可）
   */
  async spawnMany(
    parent: IAgent,
    specs: readonly ISubagentSpec[],
    mode: "all" | "first" | "majority" = "all",
  ): Promise<{
    handles: ISubagentHandle[];
    results: Array<
      | {
          ok: true;
          output: string | Record<string, unknown>;
          handle: ISubagentHandle;
        }
      | { ok: false; error: Error; handle: ISubagentHandle }
    >;
  }> {
    const handles = await Promise.all(specs.map((s) => this.spawn(parent, s)));

    // SubagentHandle 是 lazy stream：必须显式消费 events 才会驱动子 agent 真正执行。
    // 这里用 IIFE 同时启动 drain + waitForResult，两者绑定到同一 Promise。
    const settledPromises = handles.map(async (h) => {
      const drain = (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _ of h.events) {
            // discarded — caller doesn't care about per-event detail in spawnMany.
            // Use spawn() + manual event consumption when streaming is required.
          }
        } catch {
          // swallow — error surfaces via waitForResult
        }
      })();
      try {
        const output = await h.waitForResult();
        await drain; // ensure drain completes before resolving
        return { ok: true as const, output, handle: h };
      } catch (err) {
        await drain.catch(() => {
          /* */
        });
        return {
          ok: false as const,
          error: err instanceof Error ? err : new Error(String(err)),
          handle: h,
        };
      }
    });

    if (mode === "all") {
      const results = await Promise.all(settledPromises);
      return { handles, results };
    }

    if (mode === "first") {
      // First to succeed wins; on failure continue waiting for others.
      // 必修 #5: 整个 then 链 .catch 兜底，防止 abort 失败导致 unhandled rejection
      return new Promise((resolve) => {
        const results: Array<
          | {
              ok: true;
              output: string | Record<string, unknown>;
              handle: ISubagentHandle;
            }
          | { ok: false; error: Error; handle: ISubagentHandle }
        > = [];
        let resolved = false;
        let pending = settledPromises.length;
        const finishWith = (r: (typeof results)[number]) => {
          results.push(r);
          pending -= 1;
          if (!resolved && r.ok) {
            resolved = true;
            // Abort siblings in parallel; each catch swallows
            void Promise.all(
              handles
                .filter((h) => h !== r.handle)
                .map((h) =>
                  h.abort("first-mode: another sibling won").catch(() => {
                    /* ignore */
                  }),
                ),
            ).finally(() => resolve({ handles, results }));
          } else if (!resolved && pending === 0) {
            resolve({ handles, results });
          }
        };
        for (const p of settledPromises) {
          p.then(finishWith).catch((err) => {
            // settledPromises 内部已 try/catch，理论不会进这里；
            // 但以防 handle 抛同步错——兜底保护，永不 unhandled
            finishWith({
              ok: false,
              error: err instanceof Error ? err : new Error(String(err)),
              handle: handles[0],
            });
          });
        }
      });
    }

    // majority: ceil(N/2) successes resolves
    const threshold = Math.ceil(specs.length / 2);
    return new Promise((resolve) => {
      const results: Array<
        | {
            ok: true;
            output: string | Record<string, unknown>;
            handle: ISubagentHandle;
          }
        | { ok: false; error: Error; handle: ISubagentHandle }
      > = [];
      let resolved = false;
      let pending = settledPromises.length;
      let succeeded = 0;
      for (const p of settledPromises) {
        void p.then((r) => {
          results.push(r);
          pending -= 1;
          if (r.ok) succeeded += 1;
          if (!resolved && succeeded >= threshold) {
            resolved = true;
            resolve({ handles, results });
          } else if (!resolved && pending === 0) {
            resolve({ handles, results });
          }
        });
      }
    });
  }
}
