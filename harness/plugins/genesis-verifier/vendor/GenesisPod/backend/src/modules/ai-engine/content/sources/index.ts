/**
 * ai-engine/content/sources — barrel
 *
 * 2026-05-24 P17a: 通用 ContentSource 契约 + registry。
 * facade re-export 后，ai-app 走 facade，不直接导这里。
 */

export * from "./content-source.contract";
export * from "./content-source.token";
export { ContentSourceRegistry } from "./content-source-registry.service";
