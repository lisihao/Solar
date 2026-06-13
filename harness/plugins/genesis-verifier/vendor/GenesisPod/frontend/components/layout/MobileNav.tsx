'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import UserProfileButton from './UserProfileButton';
import LanguageSwitcher from '@/components/common/switchers/LanguageSwitcher';
import { Menu, X, Bell, Settings } from 'lucide-react';
import { BrandLogo } from '@/components/common/brand/BrandLogo';
import { CURRENT_VERSION } from '@/lib/utils/changelog';
import { MODULE_THEMES } from '@/lib/design/module-themes';
import { NAV_GROUPS, navItemActive } from '@/lib/constants/nav-config';

interface MobileNavProps {
  className?: string;
}

export default function MobileNav({ className = '' }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();

  // Close menu when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const isActive = (path: string) => pathname === path;

  return (
    <>
      {/* Mobile Header - Only visible on small screens */}
      <header
        className={`fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden ${className}`}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center">
          <BrandLogo
            variant="full"
            iconClassName="h-[18px] w-auto"
            subtitle={
              <Link
                href="/changelog"
                onClick={(e) => e.stopPropagation()}
                className="transition-colors hover:text-[#18181b]"
              >
                v{CURRENT_VERSION}
              </Link>
            }
          />
        </Link>

        {/* Menu Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
        >
          {isOpen ? (
            <X className="h-6 w-6 text-gray-700" />
          ) : (
            <Menu className="h-6 w-6 text-gray-700" />
          )}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Menu Drawer */}
      <nav
        className={`fixed bottom-0 right-0 top-14 z-40 w-72 transform bg-white shadow-xl transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col overflow-y-auto">
          {/* Main Navigation —— 单一数据源 NAV_GROUPS（与 Sidebar 同源，杜绝漂移） */}
          <div className="flex-1 px-3 py-4">
            <div className="space-y-1">
              {NAV_GROUPS.filter((g) => !g.hidden).map((group, gi) => {
                const items = group.items.filter(
                  (it) => !it.adminOnly || isAdmin
                );
                if (items.length === 0) return null;
                const groupLabel = group.labelKey
                  ? t(group.labelKey)
                  : group.label;
                return (
                  <div key={groupLabel ?? `group-${gi}`} className="space-y-1">
                    {groupLabel && (
                      <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {groupLabel}
                      </div>
                    )}
                    {items.map((item) => {
                      const active = navItemActive(pathname, item);
                      const activeCls = item.moduleKey
                        ? `${MODULE_THEMES[item.moduleKey].activeBg} ${MODULE_THEMES[item.moduleKey].text}`
                        : 'bg-gray-100 text-gray-900';
                      const label = item.labelKey
                        ? t(item.labelKey)
                        : item.label;
                      const Icon = item.Icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                            active
                              ? activeCls
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Icon className="h-5 w-5 flex-shrink-0" />
                          <span>{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Section */}
          <div className="border-t border-gray-200 px-3 py-4">
            <div className="space-y-1">
              <Link
                href="/notifications"
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive('/notifications')
                    ? 'bg-pink-50 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Bell className="h-5 w-5 flex-shrink-0" />
                <span>{t('nav.notifications')}</span>
              </Link>
            </div>

            {/* User Profile */}
            <div className="mt-4 border-t border-gray-200 pt-4">
              <UserProfileButton isCollapsed={false} />
            </div>

            {/* 系统 (admin entry, below username) */}
            {isAdmin && (
              <div className="mt-2">
                <Link
                  href="/admin/overview"
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                    pathname?.startsWith('/admin')
                      ? 'bg-purple-50 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Settings className="h-5 w-5 flex-shrink-0" />
                  <span>{t('nav.system')}</span>
                </Link>
              </div>
            )}

            {/* Language Switcher */}
            <div className="mt-3">
              <LanguageSwitcher variant="sidebar" />
            </div>
          </div>
        </div>
      </nav>

      {/* Spacer for mobile header */}
      <div className="h-14 md:hidden" />
    </>
  );
}
