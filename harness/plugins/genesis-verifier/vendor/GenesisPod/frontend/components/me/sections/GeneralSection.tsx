'use client';

import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react';
import { useThemeStore, type Appearance } from '@/stores';
import { useTranslation } from '@/lib/i18n';
import { PersonalizationSection } from './PersonalizationSection';

/**
 * 通用 /me/general — 一镜到底重设计（2026-05-23）：
 *   焦点 = 外观主题 + 聊天消息样式（用户在本页要做的选择）；
 *   去厚卡盒，改轻量 section（小标题 + 紧凑内容）连续流。个性化（聊天样式 + 兴趣）合并续接。
 * 外观主题写 themeStore.appearance，由 ThemeApplier 落到 <html class="dark">，即时生效并持久化。
 */
const OPTIONS: { value: Appearance; labelKey: string; icon: LucideIcon }[] = [
  { value: 'light', labelKey: 'me.general.light', icon: Sun },
  { value: 'dark', labelKey: 'me.general.dark', icon: Moon },
  { value: 'system', labelKey: 'me.general.system', icon: Monitor },
];

export function GeneralSection() {
  const { t } = useTranslation();
  const appearance = useThemeStore((s) => s.appearance);
  const setAppearance = useThemeStore((s) => s.setAppearance);

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 md:p-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('me.general.appearance')}
        </h3>
        <p className="mb-3 mt-1 text-xs text-gray-400">
          {t('me.general.appearanceDesc')}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = appearance === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setAppearance(opt.value)}
                className={`flex items-center gap-2.5 rounded-lg border p-3 text-left text-sm transition-colors ${
                  selected
                    ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${selected ? 'text-violet-600' : 'text-gray-500'}`}
                />
                <span
                  className={`font-medium ${
                    selected ? 'text-violet-700' : 'text-gray-700'
                  }`}
                >
                  {t(opt.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 个性化续接：聊天样式 + 兴趣标签（同一镜到底流内） */}
      <PersonalizationSection />
    </div>
  );
}
