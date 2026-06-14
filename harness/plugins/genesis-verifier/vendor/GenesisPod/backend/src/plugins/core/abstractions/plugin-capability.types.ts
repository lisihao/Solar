/**
 * Plugin Capability 声明（v5.1 §11.5 / standards/19 §七 规则 13）
 *
 * 类似 Android Manifest permission / browser extension permission：
 * 每 plugin 在 manifest.capabilities 显式声明所需能力，启动期 + 运行时 + 配置期三重校验。
 *
 * v5.1 HIGH-1 修订：read:llm-payload 拆分为 :meta（元数据）+ :full（完整 payload）。
 *   生产 profile 默认禁用 :full，避免 PII 泄露。
 */
import type { HookId } from "./hooks";

export type PluginCapability =
  // ── 基础设施服务（getService gate）──
  | "service:redis"
  | "service:postgres"
  | "service:http"
  | "service:websocket"

  // ── hook 注册（细粒度声明）──
  | `hook:${HookId}`

  // ── LLM payload 数据访问（v5.1 HIGH-1 拆分）──
  | "read:llm-payload:meta" // missionId / agentId / model / token usage
  | "read:llm-payload:full" // 含 messages 内容（生产默认禁用）
  | "write:llm-payload" // 通过 ctx.replacePayload() 修改（v5.1 CRIT-1）

  // ── Tool payload 数据访问 ──
  | "read:tool-payload"
  | "write:tool-payload"

  // ── Memory 访问 ──
  | "read:memory"
  | "write:memory"

  // ── 跨 plugin 通信 ──
  | "events:publish"
  | "events:subscribe"
  | `events:cross-subscribe:${string}`; // v5.1 HIGH-2 显式跨 namespace 订阅

/**
 * 不可被 ai-app 模块层 override 的 capability（standards/19 §七 LOW-2）
 * 生产环境保护性能力，由项目级 plugins.config.yaml 统一管理。
 */
export const PROTECTED_CAPABILITIES: ReadonlySet<string> = new Set([
  "read:llm-payload:full",
  "write:llm-payload",
]);
