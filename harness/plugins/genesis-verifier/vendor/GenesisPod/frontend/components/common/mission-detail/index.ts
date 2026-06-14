export { MissionDetailFrame } from './MissionDetailFrame';
export type {
  MissionDetailFrameProps,
  MissionDetailFrameTab,
} from './MissionDetailFrame';

export { MissionActionGroup } from './MissionActionGroup';
export type {
  MissionActionButtonSpec,
  MissionActionVariant,
} from './MissionActionGroup';
export { MissionControlCard } from './MissionControlCard';
export type { MissionControlCardProps } from './MissionControlCard';

export { DrawerShell } from './DrawerShell';
export type { DrawerShellProps } from './DrawerShell';

export { ModalShell } from './ModalShell';
export type { ModalShellProps } from './ModalShell';

// canonical 任务列表（行→Drawer）+ 角色卡（下沉自 playground，内容无关）
export { MissionTaskList } from './MissionTaskList';
export type {
  MissionTaskListProps,
  MissionTaskColumn,
} from './MissionTaskList';
export { RoleCard } from './RoleCard';
export type { RoleCardProps, RoleCardStatus } from './RoleCard';

// canonical tab 内容（可选复用件，标准 21 P1.5）
export * from './tabs';
