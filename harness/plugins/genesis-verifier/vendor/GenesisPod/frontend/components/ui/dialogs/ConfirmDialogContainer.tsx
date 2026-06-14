'use client';

import { ConfirmDialog } from './ConfirmDialog';
import { useConfirmStore } from '@/stores';

/**
 * 全局确认弹窗容器——由 confirmStore 驱动，配合命令式 `confirm()`。
 * 在 providers 挂载一次，全站共用；调用方只需 `await confirm({...})`。
 */
export function ConfirmDialogContainer() {
  const { current, close } = useConfirmStore();

  return (
    <ConfirmDialog
      open={!!current}
      onClose={() => close(false)}
      onConfirm={() => close(true)}
      title={current?.title ?? ''}
      description={current?.description}
      type={current?.type}
      confirmText={current?.confirmText}
      cancelText={current?.cancelText}
    />
  );
}

export default ConfirmDialogContainer;
