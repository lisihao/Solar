/**
 * plugins/core 抽象层桶（v5.1 R0.5 PR-0/PR-1）
 *
 * 仅暴露稳定接口契约，不暴露实现细节。
 * 实现层（HookBus / PluginRegistry / PluginLoader / PluginSupervisor）由
 * PR-2/PR-3 单独 export，不进 abstractions 桶。
 */

// PR-0: hooks 命名常量 + payload 类型
export * from "./hooks";
export * from "./hook-payloads";

// PR-1: 核心接口（@stable SDK 承诺面）
export * from "./plugin.interface";
export * from "./plugin-capability.types";
export * from "./service-tokens";
export * from "./hook-context.interface";

// W2-A: storage 域端口集合（按部署平台差异驱动 plugin 化）
export * from "./storage";

// W1-B: observability 域端口集合（可换 span exporter 后端）
export * from "./observability";
