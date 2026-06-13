/**
 * Observability abstractions barrel（W1-B）
 *
 * 端口集合（按可换后端驱动 plugin 化）：
 *   - span-exporter.port  追踪 span 导出（OTLP/Jaeger/Datadog/Langfuse/in-memory）
 */
export * from "./span-exporter.port";
