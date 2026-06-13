'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Crown, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useAIModels, type AIModel } from '@/hooks/features/useAIModels';
import { useTranslation } from '@/lib/i18n';
import type {
  AskRoomMember,
  AskRoomMemberRole,
  AskRoomMemberType,
} from '@/lib/types/ask-room';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';

interface RoomMemberPanelProps {
  members: AskRoomMember[];
  onAdd: (input: {
    memberType: AskRoomMemberType;
    agentId?: string;
    modelId: string;
    displayName: string;
    role: AskRoomMemberRole;
    systemPrompt?: string;
  }) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onClose: () => void;
}

// 与 NewAskRoomModal 一致：群聊场景能用的模型类型，不含 IMAGE_*
const CHAT_LIKE_TYPES: AIModel['modelType'][] = [
  'CHAT',
  'CHAT_FAST',
  'CODE',
  'MULTIMODAL',
];

export function RoomMemberPanel({
  members,
  onAdd,
  onRemove,
  onClose,
}: RoomMemberPanelProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { models, loading: modelsLoading } = useAIModels();
  const chatLikeModels = useMemo(
    () => models.filter((m) => CHAT_LIKE_TYPES.includes(m.modelType)),
    [models]
  );
  const enabled = members.filter((m) => !m.deletedAt);

  // 选中模型 + 角色 + 可选 displayName 覆盖 + system prompt
  const [selectedModelDbId, setSelectedModelDbId] = useState<string | null>(
    null
  );
  const [role, setRole] = useState<AskRoomMemberRole>('MEMBER');
  const [displayNameOverride, setDisplayNameOverride] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    // 进入添加模式时重置
    if (!adding) return;
    setSelectedModelDbId(null);
    setRole('MEMBER');
    setDisplayNameOverride('');
    setSystemPrompt('');
    setError(null);
  }, [adding]);

  const submit = async () => {
    setError(null);
    const picked = chatLikeModels.find((m) => m.id === selectedModelDbId);
    if (!picked) {
      setError(t('askRoom.member.selectModelFirst'));
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({
        memberType: 'VIRTUAL',
        modelId: picked.modelId,
        displayName: displayNameOverride.trim() || picked.name,
        role,
        systemPrompt: systemPrompt.trim() || undefined,
      });
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SideDrawer
      open={true}
      onClose={onClose}
      title={t('askRoom.member.drawerTitle')}
      widthPx={448}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2.5 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
            <Users className="h-4 w-4" />
          </div>
          <div className="text-xs text-gray-500">
            {t('askRoom.member.drawerSubtitle', { count: enabled.length })}
          </div>
        </div>
        {/* 现有成员 */}
        <ul className="space-y-2">
          {enabled.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm ${
                  m.role === 'LEADER'
                    ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                    : 'bg-gradient-to-br from-emerald-400 to-teal-500'
                }`}
              >
                {m.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  {m.role === 'LEADER' && (
                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span className="truncate">{m.displayName}</span>
                </div>
                <div className="font-mono truncate text-[11px] text-gray-500">
                  {m.modelId} · {m.memberType}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                title={t('askRoom.member.removeTitle')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {/* 添加面板 */}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={enabled.length >= 8}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-3 text-sm font-medium text-gray-600 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t('askRoom.member.addTitle')}
          </button>
        ) : (
          <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/30 p-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800">
                {t('askRoom.member.selectModel')}
              </label>
              {modelsLoading ? (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : chatLikeModels.length === 0 ? (
                <EmptyState title={t('askRoom.member.noModels')} size="sm" />
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                  {chatLikeModels.map((m) => {
                    const checked = selectedModelDbId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedModelDbId(m.id);
                          // 选中时自动带 displayName（如果用户没改过）
                          if (!displayNameOverride) {
                            // 不强制写入，留空意味着 submit 时用 picked.name
                          }
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-all ${
                          checked
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
                            checked
                              ? 'bg-blue-500 text-white'
                              : 'border border-gray-300 bg-white'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-gray-900">
                              {m.name}
                            </span>
                            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                              {m.modelType}
                            </span>
                          </div>
                          <div className="font-mono truncate text-[11px] text-gray-500">
                            {m.provider} / {m.modelId}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                {t('askRoom.member.displayName')}
              </label>
              <input
                type="text"
                placeholder={
                  selectedModelDbId
                    ? (chatLikeModels.find((m) => m.id === selectedModelDbId)
                        ?.name ?? '')
                    : t('askRoom.member.displayNamePlaceholder')
                }
                value={displayNameOverride}
                onChange={(e) => setDisplayNameOverride(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                {t('askRoom.member.role')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    value: 'MEMBER' as const,
                    labelKey: 'askRoom.member.roleMember' as const,
                  },
                  {
                    value: 'LEADER' as const,
                    labelKey: 'askRoom.member.roleLeader' as const,
                  },
                ].map((opt) => {
                  const active = role === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        active
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                {t('askRoom.member.systemPrompt')}
              </label>
              <textarea
                placeholder={t('askRoom.member.systemPromptPlaceholder')}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !selectedModelDbId}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting
                  ? t('askRoom.member.confirming')
                  : t('askRoom.member.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                {t('askRoom.member.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
