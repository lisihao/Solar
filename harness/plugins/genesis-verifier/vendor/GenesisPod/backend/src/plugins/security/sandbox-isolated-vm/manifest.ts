/**
 * sandbox-isolated-vm plugin manifest（v5.1 R0.5 PR-10）
 *
 * 监听 TOOL_WRAP（v5.1 P0-1 wrap 语义）：把 tool 执行包在 timeout + memory limit 容器内。
 * 真正 isolated-vm runtime 由生产 exporter 注入；spec 用 InMemorySandboxRunner mock。
 *
 * v5.1 §11.10 SDK 信任：
 *   replaces='sandbox' 与 sandbox-vm2 互斥（同 replaces 值最多 1 enabled）
 *   manifest.required 在生产环境通常 = true（PluginConfigService 配置覆盖）
 *
 * Capability:
 *   read:tool-payload（读 toolId / input 决定是否走沙箱）
 *   不申请 service:* —— sandbox 是纯计算容器，不依赖外部服务
 */
import type { IPluginManifest } from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";

export const SANDBOX_ISOLATED_VM_MANIFEST: IPluginManifest = {
  id: "security/sandbox-isolated-vm",
  version: "1.0.0",
  coreVersionRange: "^1.0.0",
  description:
    "Wrap tool execution in isolated-vm sandbox with memory + timeout limits (v5.1 R0.5 PR-10)",
  category: "security",
  stability: "stable",
  replaces: "sandbox",
  hooks: [CORE_HOOKS.TOOL_WRAP],
  capabilities: [`hook:${CORE_HOOKS.TOOL_WRAP}`, "read:tool-payload"],
  payloadVersions: {
    [CORE_HOOKS.TOOL_WRAP]: [1],
  },
  phase: "bootstrap",
  required: false,
  tags: ["production-recommended", "security-class"],
  // standards/19 §九 LOW-2: security-class plugins 严禁 ai-app override
  overridable: false,
};
