'use client';

import { useTranslation } from '@/lib/i18n';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';

interface DeleteProjectDialogProps {
  isOpen: boolean;
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteProjectDialog({
  isOpen,
  projectName,
  onConfirm,
  onClose,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      type="danger"
      title={t('common.delete')}
      description={t('aiResearch.project.deleteConfirm', { name: projectName })}
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
    />
  );
}
