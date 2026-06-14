'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states/LoadingState';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
} from '@/components/me/settings-sections';

/**
 * /me 个人中心外壳：主 sidebar（AppShell）+ 二级导航（分组）+ section 内容。
 * 未登录访问 → /login?redirect=...（设计 §3.3.4 边界状态）。
 */
export default function MeLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(
        `/login?redirect=${encodeURIComponent(pathname || '/me')}`
      );
    }
  }, [user, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <AppShell>
        <LoadingState fullScreen />
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1">
        {/* 二级导航 */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-3 py-6 md:block">
          <h2 className="px-3 pb-4 text-lg font-bold text-gray-900">
            {t('me.title')}
          </h2>
          <nav className="space-y-6">
            {SETTINGS_GROUPS.map((grp) => (
              <div key={grp.group}>
                <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t(grp.labelKey)}
                </p>
                <div className="space-y-0.5">
                  {SETTINGS_SECTIONS.filter((s) => s.group === grp.group).map(
                    (section) => {
                      const Icon = section.icon;
                      const href = `/me/${section.id}`;
                      const active = pathname === href;
                      return (
                        <Link
                          key={section.id}
                          href={href}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            active
                              ? 'bg-gray-100 text-gray-900'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              active ? 'text-violet-600' : 'text-gray-400'
                            }`}
                          />
                          {t(section.labelKey)}
                        </Link>
                      );
                    }
                  )}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* section 内容 */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50/50">
          {/* 移动端横向 section 切换（桌面用左侧 aside） */}
          <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-4 py-2 md:hidden">
            {SETTINGS_SECTIONS.map((section) => {
              const href = `/me/${section.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={section.id}
                  href={href}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t(section.labelKey)}
                </Link>
              );
            })}
          </nav>
          {children}
        </main>
      </div>
    </AppShell>
  );
}
