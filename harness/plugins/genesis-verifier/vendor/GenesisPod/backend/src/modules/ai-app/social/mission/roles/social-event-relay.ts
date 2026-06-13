/**
 * SocialEventRelay — harness EventRelayFramework 的 social 前缀薄壳 + 安全脱敏层。
 *
 * 安全（2026-05-21 Playground 对齐重构 §C，security-auditor P0）：
 *   social 比 research 多一层凭证暴露面——`publish-executor` / `platform-probe`
 *   的 agent action.input / observation.output / thought 会携带平台凭证
 *   （微信/小红书 token、cookie、session、connectionId、浏览器 fnSource）。
 *   这些事件经 WS 广播到前端 = 凭证上线裸奔。故在唯一 emit 出口 `emitEvent`
 *   做 redact，凭证根治不上线（前端 derive 另有 defense-in-depth 双保险）。
 *
 *   redact 规则：
 *     - agent:thought（高危角色）   → 整条不发（CoT 会复述凭证，正则不可靠）
 *     - agent:action（高危角色）    → 丢 input/calls（url token / fnSource / cookie）
 *     - agent:observation（高危角色）→ output 只发摘要（平台原始 API 响应含 appMsgId/cookie）
 *     - 其余事件 / 非高危角色        → 原样透传（parent 已丢 error.diagnostic 等）
 */

import {
  EventBus,
  EventRelayFramework,
} from "@/modules/ai-harness/facade";

/** 持有平台凭证、原文绝不可外发的高危角色（与前端 SENSITIVE_RAW_ROLES 对齐） */
const SENSITIVE_ROLES = new Set(["publish-executor", "platform-probe"]);

function roleOf(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "role" in payload) {
    const r = (payload as { role?: unknown }).role;
    return typeof r === "string" ? r.toLowerCase() : undefined;
  }
  return undefined;
}

type RedactResult = { drop: true } | { drop: false; payload: unknown };

/**
 * 对 social agent 事件按角色脱敏；drop=true 表示整条不发。
 * 导出供 dispatcher 的 deps.emit 复用同一脱敏出口（narrative 等旁路也受护）。
 */
export function redactSocialEvent(
  type: string,
  payload: unknown,
): RedactResult {
  const role = roleOf(payload);
  const sensitive = role ? SENSITIVE_ROLES.has(role) : false;
  if (!sensitive) return { drop: false, payload };

  // thought / reflection 都可能在 CoT 里复述凭证（正则不可靠）→ 整条不发
  if (type.endsWith("agent:thought") || type.endsWith("agent:reflection")) {
    return { drop: true };
  }
  if (type.endsWith("agent:action")) {
    if (!payload || typeof payload !== "object")
      return { drop: false, payload };
    const {
      input: _input,
      calls: _calls,
      ...safe
    } = payload as Record<string, unknown>;
    return { drop: false, payload: safe };
  }
  if (type.endsWith("agent:observation")) {
    if (!payload || typeof payload !== "object")
      return { drop: false, payload };
    // output（平台原始 API 响应）+ error（报错消息可能内嵌 token）都要脱敏
    const {
      output: _output,
      error: _error,
      ...rest
    } = payload as Record<string, unknown>;
    return {
      drop: false,
      payload: {
        ...rest,
        output: { _redacted: "platform-response-hidden" },
        error: _error ? "platform-error-hidden" : undefined,
      },
    };
  }
  return { drop: false, payload };
}

export class SocialEventRelay extends EventRelayFramework {
  constructor(eventBus: EventBus) {
    super(eventBus, "social");
  }

  override async emitEvent(args: {
    type: string;
    missionId: string;
    userId: string;
    agentId?: string;
    traceId?: string;
    payload: unknown;
  }): Promise<void> {
    const result = redactSocialEvent(args.type, args.payload);
    if (result.drop) return;
    await super.emitEvent({ ...args, payload: result.payload });
  }
}
