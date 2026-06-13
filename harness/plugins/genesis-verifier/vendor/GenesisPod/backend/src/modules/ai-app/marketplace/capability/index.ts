/**
 * 市场能力契约层 barrel —— 版本化 manifest + 可插拔 runner 端口 + 注册表。
 * 消费方（company / 任何 app）只从这里 import 能力契约，不碰具体能力实现。
 */
export {
  type CapabilityManifest,
  type CapabilityKind,
  capabilityKey,
} from "./capability-manifest";
export {
  type ICapabilityRunner,
  type CapabilityRunInput,
  type CapabilityRunContext,
  type CapabilityRunEvent,
  type CapabilityRunResult,
  type MissionPersistencePort,
  type MissionTerminalDetails,
} from "./capability-runner.port";
export { CapabilityRegistry } from "./capability-registry";
