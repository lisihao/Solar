/**
 * telemetry-otel plugin barrel（v5.1 R0.5 PR-7）
 */
export { TELEMETRY_OTEL_MANIFEST } from "./manifest";
export { TelemetryOtelPlugin, type TelemetryOtelConfig } from "./plugin";
export {
  type ISpanExporter,
  type TelemetrySpanData,
  InMemorySpanExporter,
} from "@/plugins/core/abstractions/observability/span-exporter.port";
