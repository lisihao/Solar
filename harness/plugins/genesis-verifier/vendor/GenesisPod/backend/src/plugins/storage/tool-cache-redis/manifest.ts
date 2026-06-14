/**
 * tool-cache-redis plugin manifest（v5.1 R0.5 PR-8）
 *
 * 监听 TOOL_BEFORE：cache 命中 → abort('cache-hit', cached)
 * 监听 TOOL_AFTER：non-cache-hit + 成功结果 → 写入 cache
 *
 * Capability:
 *   service:redis（拿 NamespacedRedisClient via getService）
 *   read:tool-payload（读 toolId + input 算 cache key）
 *   hook:engine.tool.before/after
 *
 * 不申请 write:tool-payload —— cache plugin 永不修改 payload。
 */
import type { IPluginManifest } from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";

export const TOOL_CACHE_REDIS_MANIFEST: IPluginManifest = {
  id: "storage/tool-cache-redis",
  version: "1.0.0",
  coreVersionRange: "^1.0.0",
  description:
    "Tool result cache backed by Redis (v5.1 R0.5 PR-8). " +
    "abort('cache-hit') on hit; write to cache on miss + success.",
  category: "storage",
  stability: "stable",
  replaces: "tool-cache",
  hooks: [CORE_HOOKS.TOOL_BEFORE, CORE_HOOKS.TOOL_AFTER],
  capabilities: [
    `hook:${CORE_HOOKS.TOOL_BEFORE}`,
    `hook:${CORE_HOOKS.TOOL_AFTER}`,
    "read:tool-payload",
    "service:redis",
  ],
  payloadVersions: {
    [CORE_HOOKS.TOOL_BEFORE]: [1],
    [CORE_HOOKS.TOOL_AFTER]: [1],
  },
  phase: "bootstrap",
  required: false,
  tags: ["production-recommended"],
};
