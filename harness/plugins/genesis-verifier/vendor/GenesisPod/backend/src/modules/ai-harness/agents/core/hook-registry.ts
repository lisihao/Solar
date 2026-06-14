/**
 * HookRegistry — IHookRegistry 实现 (PR-I 强化版)
 *
 * 派发逻辑：
 *   1. 按 priority desc + 注册顺序 asc 排序
 *   2. 按 scope 过滤（global 永远跑；agent/role/skill 需 scopeTarget 匹配）
 *   3. 每个 handler 加 timeout 包裹（默认 5s，防止 hook 卡住主流程）
 *   4. handler 抛错被捕获并 logger.warn —— 永不抛到 caller（hook 不应 break agent）
 *   5. handler 返回 { block: true } 立即停止派发
 *   6. handler 返回 { replacePayload } 改写后续 handler 看到的 payload（链式 mutation）
 *
 * Scope 语义：
 *   - global: 不限定，所有 dispatch 都跑
 *   - agent:  只在 context.agentId === scopeTarget 时跑
 *   - role:   只在 context.envelope.metadata.roleId === scopeTarget 时跑
 *   - skill:  只在 context.envelope.metadata.activeSkill === scopeTarget 时跑
 */

import { Logger } from "@nestjs/common";
import type {
  HookEvent,
  HookPayloadMap,
  IHookBinding,
  IHookRegistry,
  IHookResult,
  IContextEnvelope,
} from "../abstractions";

interface StoredBinding {
  binding: IHookBinding<HookEvent>;
  registrationOrder: number;
}

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`hook timeout after ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export class HookRegistry implements IHookRegistry {
  private readonly logger = new Logger(HookRegistry.name);
  private readonly bindings = new Map<HookEvent, StoredBinding[]>();
  private counter = 0;

  register<E extends HookEvent>(binding: IHookBinding<E>): () => void {
    const event = binding.event;
    const list = this.bindings.get(event) ?? [];
    const stored: StoredBinding = {
      binding: binding as unknown as IHookBinding<HookEvent>,
      registrationOrder: this.counter++,
    };
    list.push(stored);
    list.sort((a, b) => {
      const pa = a.binding.priority ?? 0;
      const pb = b.binding.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.registrationOrder - b.registrationOrder;
    });
    this.bindings.set(event, list);

    return () => {
      const current = this.bindings.get(event);
      if (!current) return;
      const idx = current.indexOf(stored);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  /**
   * P0-6: 查询 Stop 事件的某个（或所有）binding 是否标记 skipOnApiError=true。
   *
   * 调用方（loop）在 API error catch 路径调用此方法，决定是否跳过对应 stop hook。
   * 返回 true 表示"至少有一个 Stop binding 要跳过（skipOnApiError=true）"，
   * loop 在 finally 中应调用 dispatchStopFiltered(isApiError=true) 而不是普通 dispatch。
   */
  hasAnySkipOnApiErrorStopHook(): boolean {
    const list = this.bindings.get("Stop") ?? [];
    return list.some((s) => s.binding.skipOnApiError === true);
  }

  /**
   * P0-6: 带 isApiError 标志的 Stop 派发——跳过 skipOnApiError=true 的 binding。
   * isApiError=false 时行为与普通 dispatch 完全相同（全量跑，向后兼容）。
   */
  async dispatchStop(
    payload: HookPayloadMap["Stop"],
    context: { agentId: string; envelope: IContextEnvelope },
    isApiError: boolean,
  ): Promise<IHookResult> {
    const list = this.bindings.get("Stop") ?? [];
    let currentPayload: unknown = payload;

    for (const { binding } of list) {
      // P0-6: API error 路径跳过 skipOnApiError=true 的 hook
      if (isApiError && binding.skipOnApiError === true) {
        this.logger.debug(
          `[P0-6] skipping Stop hook (scope=${binding.scope}) on API error path (skipOnApiError=true)`,
        );
        continue;
      }

      if (!this.matchesScope(binding, context)) continue;

      let result: IHookResult | void;
      try {
        const r = binding.handler(
          currentPayload as HookPayloadMap["Stop"],
          context,
        );
        if (r && typeof (r as Promise<unknown>).then === "function") {
          result = await withTimeout(
            r as Promise<IHookResult | void>,
            DEFAULT_HOOK_TIMEOUT_MS,
            `Stop/${binding.scope}`,
          );
        } else {
          result = r as IHookResult | void;
        }
      } catch (err) {
        this.logger.warn(
          `hook Stop/${binding.scope} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      if (!result || typeof result !== "object") continue;

      if ("replacePayload" in result && result.replacePayload !== undefined) {
        currentPayload = result.replacePayload;
      }
      if ("block" in result && result.block) {
        return result;
      }
    }

    if (currentPayload !== payload) {
      return { replacePayload: currentPayload };
    }
    return {};
  }

  async dispatch<E extends HookEvent>(
    event: E,
    payload: HookPayloadMap[E],
    context: { agentId: string; envelope: IContextEnvelope },
  ): Promise<IHookResult> {
    const list = this.bindings.get(event) ?? [];
    let currentPayload: unknown = payload;

    for (const { binding } of list) {
      // PR-I: scope filter
      if (!this.matchesScope(binding, context)) continue;

      let result: IHookResult | void;
      try {
        const r = binding.handler(currentPayload as HookPayloadMap[E], context);
        if (r && typeof (r as Promise<unknown>).then === "function") {
          result = await withTimeout(
            r as Promise<IHookResult | void>,
            DEFAULT_HOOK_TIMEOUT_MS,
            `${event}/${binding.scope}`,
          );
        } else {
          result = r as IHookResult | void;
        }
      } catch (err) {
        // PR-I: hook 抛错只记日志，不影响主流程（block=false 等价默认行为）
        this.logger.warn(
          `hook ${event}/${binding.scope} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      if (!result || typeof result !== "object") continue;

      // PR-I: replacePayload 链式 mutation —— 后续 handler 看到改写后的 payload
      if ("replacePayload" in result && result.replacePayload !== undefined) {
        currentPayload = result.replacePayload;
      }
      if ("block" in result && result.block) {
        return result;
      }
    }
    // 把可能被 replacePayload 改过的 payload 通过 result 暴露给 caller，方便上层用
    if (currentPayload !== payload) {
      return { replacePayload: currentPayload };
    }
    return {};
  }

  private matchesScope(
    binding: IHookBinding<HookEvent>,
    context: { agentId: string; envelope: IContextEnvelope },
  ): boolean {
    if (binding.scope === "global") return true;
    // 建议修：非 global scope 但缺 target → 显式拒绝，避免"看似限定其实全开"
    if (!binding.scopeTarget) {
      this.logger.warn(
        `hook ${binding.event} declared scope="${binding.scope}" without scopeTarget — ignored (would be unsafe global)`,
      );
      return false;
    }
    if (binding.scope === "agent") {
      return binding.scopeTarget === context.agentId;
    }
    if (binding.scope === "role") {
      const roleId = (
        context.envelope.metadata as { roleId?: string } | undefined
      )?.roleId;
      return binding.scopeTarget === roleId;
    }
    if (binding.scope === "skill") {
      const skill = (
        context.envelope.metadata as { activeSkill?: string } | undefined
      )?.activeSkill;
      return binding.scopeTarget === skill;
    }
    return true;
  }
}
