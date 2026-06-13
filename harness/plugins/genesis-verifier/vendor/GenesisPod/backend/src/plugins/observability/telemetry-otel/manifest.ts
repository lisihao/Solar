/**
 * telemetry-otel plugin manifest（v5.1 R0.5 PR-7）
 *
 * 监听全部 6 个核心 hook，写 OTel span：
 *   LLM_REQUEST / LLM_RESPONSE / TOOL_BEFORE / TOOL_AFTER /
 *   MISSION_START / MISSION_END
 *
 * v5.1 HIGH-1 capability：
 *   read:llm-payload:meta（仅元数据 missionId/agentId/model/tokensUsed）
 *   read:tool-payload（toolId / cacheHit）
 *   service:http（OTLP exporter 外发请求）
 *
 * 不声明 :full 级别，避免 PII 泄露（生产 profile 默认禁用 full）。
 */
import type { IPluginManifest } from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";

export const TELEMETRY_OTEL_MANIFEST: IPluginManifest = {
  id: "observability/telemetry-otel",
  version: "1.0.0",
  coreVersionRange: "^1.0.0",
  description:
    "OpenTelemetry exporter for LLM / Tool / Mission spans (v5.1 R0.5 PR-7)",
  category: "observability",
  stability: "stable",
  replaces: "telemetry",
  hooks: [
    CORE_HOOKS.LLM_REQUEST,
    CORE_HOOKS.LLM_RESPONSE,
    CORE_HOOKS.TOOL_BEFORE,
    CORE_HOOKS.TOOL_AFTER,
    CORE_HOOKS.MISSION_START,
    CORE_HOOKS.MISSION_END,
  ],
  capabilities: [
    `hook:${CORE_HOOKS.LLM_REQUEST}`,
    `hook:${CORE_HOOKS.LLM_RESPONSE}`,
    `hook:${CORE_HOOKS.TOOL_BEFORE}`,
    `hook:${CORE_HOOKS.TOOL_AFTER}`,
    `hook:${CORE_HOOKS.MISSION_START}`,
    `hook:${CORE_HOOKS.MISSION_END}`,
    "read:llm-payload:meta",
    "read:tool-payload",
    "service:http",
  ],
  payloadVersions: {
    [CORE_HOOKS.LLM_REQUEST]: [1],
    [CORE_HOOKS.LLM_RESPONSE]: [1],
    [CORE_HOOKS.TOOL_BEFORE]: [1],
    [CORE_HOOKS.TOOL_AFTER]: [1],
    [CORE_HOOKS.MISSION_START]: [1],
    [CORE_HOOKS.MISSION_END]: [1],
  },
  phase: "bootstrap",
  required: false,
  tags: ["production-recommended"],
  homepage: "https://github.com/anthropics/genesis-agent-teams",
};
