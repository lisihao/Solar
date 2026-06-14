/**
 * mission-detail canonical tab 内容组件（标准 21 P1.5）
 *
 * 可选复用件：各业务在 MissionDetailFrame 的 children（右栏内容区）里，按 activeTab
 * 选用这些 canonical tab 渲染常见内容类型（引用/报告/任务…），把自己的数据适配成
 * 组件 props 即可——风格由 Frame + 这些 canonical 件统一，内容业务自定义。
 */
export { MissionReferencesTab } from './MissionReferencesTab';
export type {
  MissionReferencesTabProps,
  MissionReference,
} from './MissionReferencesTab';
