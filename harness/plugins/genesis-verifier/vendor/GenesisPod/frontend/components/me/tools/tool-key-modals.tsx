'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { apiClient } from '@/lib/api/client';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import {
  requestToolGrant,
  type UserToolItem,
} from '@/hooks/features/useUserTools';

/**
 * 工具 BYOK 弹层（配置密钥 / 申请授权）—— 抽自原 UserToolsTab，供团队工具卡片复用。
 */

// category string → SecretCategory enum value used in POST /user/secrets
const CATEGORY_MAP: Record<string, string> = {
  'Web Search': 'SEARCH',
  'Content Extraction': 'EXTRACTION',
  YouTube: 'YOUTUBE',
  TTS: 'TTS',
  Finance: 'FINANCE',
  Weather: 'WEATHER',
};

function mapCategory(category: string): string {
  if (CATEGORY_MAP[category]) return CATEGORY_MAP[category];
  if (/academic/i.test(category)) return 'ACADEMIC';
  if (/image/i.test(category)) return 'IMAGE_SEARCH';
  return 'OTHER';
}

export interface SecretOption {
  id: string;
  name: string;
  displayName: string;
  category: string;
  maskedValue: string;
  source: string;
}

export function ConfigureKeyModal({
  tool,
  userSecrets,
  onClose,
  onSuccess,
}: {
  tool: UserToolItem;
  userSecrets: SecretOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const targetCategory = mapCategory(tool.category);

  const selectableSecrets = useMemo(() => {
    const sameCat = (c?: string) =>
      (c ?? '').toUpperCase() === targetCategory.toUpperCase();
    return [...userSecrets].sort(
      (a, b) => Number(sameCat(b.category)) - Number(sameCat(a.category))
    );
  }, [userSecrets, targetCategory]);

  const hasNoSecrets = selectableSecrets.length === 0;

  const [mode, setMode] = useState<'select' | 'new'>(
    hasNoSecrets ? 'new' : 'select'
  );
  const [selectedId, setSelectedId] = useState(selectableSecrets[0]?.id ?? '');
  const [newValue, setNewValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (mode === 'select') {
      if (!selectedId) {
        setError('请选择一个已有密钥');
        return;
      }
    } else if (!newValue.trim()) {
      setError(t('me.tools.modal.keyRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const body =
        mode === 'select'
          ? {
              name: tool.secretName,
              category: targetCategory,
              provider: tool.toolId,
              sourceSecretId: selectedId,
            }
          : {
              name: tool.secretName,
              category: targetCategory,
              provider: tool.toolId,
              value: newValue.trim(),
            };
      await apiClient.post('/user/secrets', body);
      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('me.tools.modal.saveFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlayClick={false}
      size="sm"
      title={t('me.tools.modal.configureTitle', { name: tool.name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            {t('me.tools.modal.cancel')}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('me.tools.modal.saving') : t('me.tools.modal.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          为「{tool.name}」选择你已有的 Key，或新增一个。
        </p>

        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {!hasNoSecrets && (
            <button
              onClick={() => setMode('select')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                mode === 'select'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              从已有密钥选择（{selectableSecrets.length}）
            </button>
          )}
          <button
            onClick={() => setMode('new')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              mode === 'new'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            输入新密钥
          </button>
        </div>

        {mode === 'select' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">
              选择你的一个密钥（同类别已置顶）
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {selectableSecrets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName || s.name} · {s.category} · {s.maskedValue}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-gray-700">
                {t('me.tools.modal.keyLabel')}
              </label>
              {hasNoSecrets && (
                <a
                  href="/me/api-keys"
                  className="text-xs text-primary underline hover:text-primary/80"
                >
                  前往「我的密钥」添加
                </a>
              )}
            </div>
            <input
              type="text"
              autoComplete="new-password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t('me.tools.modal.keyPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function RequestGrantModal({
  tool,
  onClose,
  onSuccess,
}: {
  tool: UserToolItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await requestToolGrant(tool.toolId, reason.trim() || undefined);
      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('me.tools.modal.requestFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlayClick={false}
      size="sm"
      title={t('me.tools.modal.requestTitle', { name: tool.name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            {t('me.tools.modal.cancel')}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? t('me.tools.modal.requesting')
              : t('me.tools.modal.request')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          {t('me.tools.modal.requestDesc')}
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('me.tools.modal.reasonLabel')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('me.tools.modal.reasonPlaceholder')}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
