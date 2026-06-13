/**
 * Admin Shared Components
 *
 * All Admin pages MUST use these components for visual consistency.
 * See `.claude/standards/20-admin-ui-design.md` for the design spec.
 */

export {
  default as AdminConfigCard,
  AdminConfigField,
  AdminConfigActions,
} from './AdminConfigCard';

export {
  default as AdminToggleCard,
  AdminToggleInline,
} from './AdminToggleCard';

export {
  default as ConnectionTestButton,
  createApiTestFn,
  type TestResult,
} from './ConnectionTestButton';

export { default as AdminDataTable, type ColumnDef } from './AdminDataTable';

// New shared components (Wave 1 of admin L1 restructure)
export {
  default as AdminStatsCards,
  type AdminStatCard,
  type StatSemantic,
} from './AdminStatsCards';

export { default as AdminToolbar } from './AdminToolbar';

export { default as AdminTabs, type AdminTab } from './AdminTabs';

export { default as AdminModal } from './AdminModal';

export { default as AdminDrawer } from './AdminDrawer';

export { default as AdminEmptyState } from './AdminEmptyState';

export { default as AdminLoadingSkeleton } from './AdminLoadingSkeleton';

export { default as AdminStatusBadge } from './AdminStatusBadge';
