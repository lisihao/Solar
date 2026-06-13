'use client';

import { useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import {
  useThemeStore,
  USER_MESSAGE_STYLES,
  AI_MESSAGE_STYLES,
} from '@/stores';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { config } from '@/lib/utils/config';
import { Input } from '@/components/ui/form';
import { logger } from '@/lib/utils/logger';

/**
 * 个性化（合并进通用）— 一镜到底重设计（2026-05-23）：
 *   焦点 = 聊天气泡样式选择（我的 / AI）；预览缩小内联；兴趣标签压紧凑区。
 *   去厚卡盒，改轻量 section 连续流。样式走 useThemeStore（即时持久化）；兴趣保存走 PATCH /auth/profile。
 */
export function PersonalizationSection() {
  const { t } = useTranslation();
  const { user, accessToken } = useAuth();
  const {
    userMessageStyle,
    aiMessageStyle,
    setUserMessageStyle,
    setAiMessageStyle,
  } = useThemeStore();

  const [interests, setInterests] = useState<string[]>([]);
  const [newInterest, setNewInterest] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (user) setInterests(user.interests || []);
  }, [user]);

  const addInterest = () => {
    const v = newInterest.trim();
    if (v && !interests.includes(v)) {
      setInterests([...interests, v]);
      setNewInterest('');
    }
  };

  const removeInterest = (idx: number) => {
    setInterests(interests.filter((_, i) => i !== idx));
  };

  const saveInterests = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${config.apiUrl}/auth/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ interests }),
      });
      if (!response.ok) throw new Error('Failed to save interests');
      setMessage({ type: 'success', text: t('profile.profileUpdated') });
    } catch (error) {
      logger.error('Failed to save interests:', error);
      setMessage({ type: 'error', text: t('profile.profileUpdateFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* 聊天外观 —— 焦点：消息样式选择 */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('profile.chatAppearance')}
        </h3>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('profile.myMessageStyle')}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {USER_MESSAGE_STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setUserMessageStyle(style.value)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 transition-all ${style.preview} ${
                    userMessageStyle === style.value
                      ? 'ring-2 ring-gray-900'
                      : 'hover:scale-110'
                  }`}
                  title={style.name}
                >
                  {userMessageStyle === style.value && (
                    <Check className="h-4 w-4 text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('profile.aiMessageStyle')}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {AI_MESSAGE_STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setAiMessageStyle(style.value)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 transition-all ${style.preview} ${
                    aiMessageStyle === style.value
                      ? 'ring-2 ring-gray-900'
                      : 'hover:scale-110'
                  }`}
                  title={style.name}
                >
                  {aiMessageStyle === style.value && (
                    <Check className="h-4 w-4 text-gray-900" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 预览 —— 缩小内联 */}
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-400">
              {t('profile.preview')}
            </p>
            <div className="space-y-2">
              <div className="flex justify-end">
                <div
                  className={`max-w-[75%] rounded-2xl rounded-tr-none px-3 py-2 text-sm shadow-sm ${userMessageStyle}`}
                >
                  <p>{t('me.personalization.previewUser')}</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div
                  className={`max-w-[75%] rounded-2xl rounded-tl-none px-3 py-2 text-sm ${aiMessageStyle}`}
                >
                  <p>{t('me.personalization.previewAi')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 研究兴趣 —— 紧凑 */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('profile.researchInterests')}
        </h3>
        <div className="mb-2 flex flex-wrap gap-2">
          {interests.map((interest, idx) => (
            <span
              key={idx}
              className="flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700"
            >
              {interest}
              <button
                onClick={() => removeInterest(idx)}
                className="ml-0.5 text-violet-600 hover:text-violet-900"
                aria-label="remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {interests.length === 0 && (
            <span className="text-sm text-gray-500">
              {t('me.personalization.noInterests')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="text"
            value={newInterest}
            onChange={(e) => setNewInterest(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addInterest()}
            placeholder={t('profile.enterInterest')}
            inputSize="sm"
            className="flex-1"
          />
          <button
            onClick={addInterest}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {t('profile.add')}
          </button>
        </div>

        {message && (
          <div
            className={`mt-3 rounded-md border px-4 py-2.5 text-sm font-medium ${
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            onClick={saveInterests}
            disabled={saving}
            className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('profile.saving') : t('profile.saveChanges')}
          </button>
        </div>
      </section>
    </>
  );
}
