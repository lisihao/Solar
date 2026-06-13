'use client';

import { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { config } from '@/lib/utils/config';
import { SettingsSectionCard } from '@/components/ui/cards/SettingsSectionCard';
import { Input, Textarea } from '@/components/ui/form';
import { logger } from '@/lib/utils/logger';

/**
 * 账户 /me/account — 头像（Google 管理，只读）+ 昵称 + 简介 + 邮箱（只读）+ 退出登录。
 * 从 profile god-page 的 profile tab 拆出。数据来自 useAuth，保存走 PATCH /auth/profile。
 */
export function AccountSection() {
  const { t } = useTranslation();
  const { user, accessToken, logout } = useAuth();

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.username || user.email?.split('@')[0] || '');
      setBio(user.bio || '');
    }
  }, [user]);

  if (!user) return null;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${config.apiUrl}/auth/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ username: name, bio }),
      });
      if (!response.ok) throw new Error('Failed to update profile');
      setMessage({ type: 'success', text: t('profile.profileUpdated') });
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      logger.error('Failed to update profile:', error);
      setMessage({ type: 'error', text: t('profile.profileUpdateFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSectionCard title={t('profile.profilePicture')}>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gray-200">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username || user.email}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-cyan-400 text-3xl font-bold text-white">
                {(name || user.email || '?').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="text-sm text-gray-600">
              {t('profile.managedByGoogle')}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('profile.updateGoogleProfile')}
            </p>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('profile.basicInfo')}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('profile.name')}
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('profile.email')}
            </label>
            <Input type="email" value={user.email || ''} disabled />
            <p className="mt-1 text-xs text-gray-500">
              {t('profile.emailCannotChange')}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('profile.bio')}
            </label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
        </div>
      </SettingsSectionCard>

      {message && (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-medium ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <LogOut className="h-4 w-4" />
          {t('common.logout')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-6 py-2 font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t('profile.saving') : t('profile.saveChanges')}
        </button>
      </div>
    </div>
  );
}
