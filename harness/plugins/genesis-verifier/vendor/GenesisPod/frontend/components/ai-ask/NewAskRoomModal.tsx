'use client';

/**
 * 新建 AI 团队房间 —— 弹窗形态
 *
 * 取代之前 /ai-ask/rooms/new 独立页：
 *   - AskTeamsButton 直接打开本 Modal，不跳路由
 *   - 字段最小化：房间名 + 协作模式 + 勾选 AI 成员
 *   - 房主（当前用户）固定首位（不可勾选），= AskSession.userId
 *   - 模型类型只列 CHAT / CHAT_FAST / CODE / MULTIMODAL（IMAGE_* 不能群聊）
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Modal } from '@/components/ui/dialogs/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useAIModels, type AIModel } from '@/hooks/features/useAIModels';
import { askRoomService } from '@/services/ai-ask-room.service';
import { useTranslation } from '@/lib/i18n';
import type { AskRoomMode } from '@/lib/types/ask-room';

interface Props {
  open: boolean;
  onClose: () => void;
}

const MODE_VALUES: AskRoomMode[] = [
  'FREECHAT',
  'PARALLEL_MERGE',
  'DEBATE',
  'VOTE',
  'REVIEW',
  'HANDOFF',
];

const CHAT_LIKE_TYPES: AIModel['modelType'][] = [
  'CHAT',
  'CHAT_FAST',
  'CODE',
  'MULTIMODAL',
];

export default function NewAskRoomModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { models, loading: modelsLoading } = useAIModels();

  const defaultRoomTitle = t('askRoom.newRoom.defaultTitle');
  const [title, setTitle] = useState(defaultRoomTitle);
  const [defaultMode, setDefaultMode] = useState<AskRoomMode>('FREECHAT');
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatLikeModels = useMemo(
    () => models.filter((m) => CHAT_LIKE_TYPES.includes(m.modelType)),
    [models]
  );

  // 打开时重置 + 默认勾选前 2 个
  useEffect(() => {
    if (!open) return;
    setTitle(defaultRoomTitle);
    setDefaultMode('FREECHAT');
    setError(null);
    setSubmitting(false);
    setSelectedModelIds(chatLikeModels.slice(0, 2).map((m) => m.id));
  }, [open, chatLikeModels, defaultRoomTitle]);

  const toggleModel = (id: string) => {
    setSelectedModelIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 8) return prev;
      return [...prev, id];
    });
  };

  const handleCreate = async () => {
    setError(null);
    if (selectedModelIds.length < 2) {
      setError(t('askRoom.newRoom.errorMinMembers'));
      return;
    }
    const picked = chatLikeModels.filter((m) =>
      selectedModelIds.includes(m.id)
    );
    if (picked.length < 2) {
      setError(t('askRoom.newRoom.errorModelOffline'));
      return;
    }

    setSubmitting(true);
    try {
      const created = await askRoomService.createRoom({
        title: title.trim() || defaultRoomTitle,
        roomConfig: { defaultMode, maxParticipants: 8 },
        initialMembers: picked.map((m, i) => ({
          memberType: 'VIRTUAL',
          modelId: m.modelId,
          displayName: m.name,
          role: i === 0 ? 'LEADER' : 'MEMBER',
          order: i,
        })),
      });
      onClose();
      router.push(`/ai-ask/rooms/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const userLabel =
    user?.fullName?.trim() ||
    user?.username?.trim() ||
    user?.email ||
    t('askRoom.newRoom.selfFallback');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-900">
              {t('askRoom.newRoom.title')}
            </div>
            <div className="mt-0.5 text-xs font-normal text-gray-500">
              {t('askRoom.newRoom.subtitle')}
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {t('askRoom.newRoom.footerHint')}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              {t('askRoom.newRoom.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || selectedModelIds.length < 2}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? t('askRoom.newRoom.creating')
                : t('askRoom.newRoom.create')}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 px-2 py-1">
        {/* 房间名 */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            {t('askRoom.newRoom.nameLabel')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('askRoom.newRoom.namePlaceholder')}
            className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {/* 协作模式 */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            {t('askRoom.newRoom.modeLabel')}
            <span className="ml-2 text-xs font-normal text-gray-400">
              {t('askRoom.newRoom.modeHint')}
            </span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            {MODE_VALUES.map((mode) => {
              const active = defaultMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDefaultMode(mode)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition-all ${
                    active
                      ? 'border-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm shadow-blue-500/10'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div
                    className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}
                  >
                    {t(`askRoom.modes.${mode}.label`)}
                  </div>
                  <div
                    className={`mt-1 text-xs ${active ? 'text-blue-500' : 'text-gray-400'}`}
                  >
                    {t(`askRoom.modes.${mode}.shortDescription`)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 成员 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-800">
              {t('askRoom.newRoom.membersLabel')}
              <span className="ml-2 text-xs font-normal text-gray-400">
                {t('askRoom.newRoom.membersCount', {
                  count: selectedModelIds.length,
                })}
              </span>
            </label>
          </div>

          {/* 你 — 房主 */}
          <div className="mb-3 flex items-center gap-3.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-blue-900">
                {t('askRoom.newRoom.youHost', { label: userLabel })}
              </div>
              <div className="mt-0.5 text-xs text-blue-600">
                {t('askRoom.newRoom.youHostHint')}
              </div>
            </div>
          </div>

          {/* AI 成员勾选列表 —— 双列网格 */}
          {modelsLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : chatLikeModels.length === 0 ? (
            <EmptyState title={t('askRoom.newRoom.noModels')} size="sm" />
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/50 p-3">
              <div className="grid grid-cols-2 gap-2">
                {chatLikeModels.map((m) => {
                  const checked = selectedModelIds.includes(m.id);
                  const reachedMax = !checked && selectedModelIds.length >= 8;
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2.5 transition-all ${
                        checked
                          ? 'border-blue-500 ring-1 ring-blue-500/20'
                          : reachedMax
                            ? 'cursor-not-allowed border-gray-200 opacity-50'
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
                          checked
                            ? 'bg-blue-500 text-white'
                            : 'border border-gray-300 bg-white'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        disabled={reachedMax}
                        onChange={() => toggleModel(m.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900">
                            {m.name}
                          </span>
                          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                            {m.modelType}
                          </span>
                        </div>
                        <div className="font-mono mt-0.5 truncate text-xs text-gray-500">
                          {m.provider} / {m.modelId}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
