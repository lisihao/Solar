'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  LogOut,
  LogIn,
  Coins,
  Check,
  Settings,
  Languages,
  HelpCircle,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCreditsStore } from '@/stores';
import { useTranslation, type Locale } from '@/lib/i18n';
import { LoadingInline } from '@/components/ui/states/LoadingState';

interface UserProfileButtonProps {
  isCollapsed?: boolean;
}

/**
 * UserProfileButton — 左下角头像菜单（设计 §3.1 / §3.3.1）。
 *
 * 标识区（名字/email/积分余额）→ 快捷区（充值跳 /me/billing、每日签到）
 * → 功能区（设置跳 /me/account、语言二级展开、帮助跳 /feedback）→ 登出区。
 *
 * 替代旧「个人资料 + 我的 AI 配置」双入口为单一「设置」；语言切换从 sidebar
 * 游离控件移入本菜单。
 */
export default function UserProfileButton({
  isCollapsed = false,
}: UserProfileButtonProps) {
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const { t, locale, setLocale } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [showLang, setShowLang] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ bottom: 0, left: 0 });
  const {
    account,
    checkinStatus,
    isCheckingIn,
    fetchBalance,
    fetchCheckinStatus,
    performCheckin,
    showCheckinModal,
  } = useCreditsStore();

  useEffect(() => {
    if (user) {
      void fetchBalance();
      void fetchCheckinStatus();
    }
  }, [user, fetchBalance, fetchCheckinStatus]);

  const handleCheckin = async () => {
    if (!checkinStatus?.canCheckin || isCheckingIn) return;
    await performCheckin();
    showCheckinModal();
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
        setShowLang(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeMenu = () => {
    setShowMenu(false);
    setShowLang(false);
  };

  const chooseLocale = (next: Locale) => {
    setLocale(next);
    setShowLang(false);
  };

  if (isLoading) {
    return (
      <div
        className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm`}
      >
        <LoadingInline text="" className="text-gray-400" />
      </div>
    );
  }

  // 未登录 — 登录按钮
  if (!user) {
    return (
      <button
        onClick={() => router.push('/login')}
        className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50`}
        title={t('common.login')}
      >
        <LogIn className="h-5 w-5 flex-shrink-0" />
        {!isCollapsed && <span>{t('common.login')}</span>}
      </button>
    );
  }

  const langLabel = locale === 'zh' ? '中文' : 'English';

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={buttonRef}
        onClick={() => {
          if (!showMenu && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setMenuPosition({
              bottom: window.innerHeight - rect.top + 8,
              left: rect.left,
            });
          }
          setShowMenu(!showMenu);
        }}
        className={`flex w-full items-center ${isCollapsed ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-50`}
        title={user.username || user.email}
      >
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username || user.email}
              className="h-full w-full object-cover"
            />
          ) : (
            <User className="h-3.5 w-3.5 text-gray-600" />
          )}
        </div>
        {!isCollapsed && (
          <span className="flex-1 truncate text-left text-gray-900">
            {user.fullName ||
              user.username ||
              user.email?.split('@')[0] ||
              'User'}
          </span>
        )}
      </button>

      {showMenu && (
        <div
          className="fixed z-50 w-60 rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{
            bottom: `${menuPosition.bottom}px`,
            left: `${menuPosition.left}px`,
          }}
        >
          {/* 标识区 */}
          <div className="border-b border-gray-200 p-3">
            <div className="font-medium text-gray-900">
              {user.fullName || user.username || 'User'}
            </div>
            <div className="mt-0.5 truncate text-sm text-gray-500">
              {user.email}
            </div>
            <Link
              href="/me/billing"
              onClick={closeMenu}
              className="mt-2 flex items-center justify-between rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 px-3 py-2 transition-colors hover:from-blue-100 hover:to-purple-100"
            >
              <span className="flex items-center gap-1.5">
                <Coins className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">
                  {t('credits.balance')}
                </span>
              </span>
              <span className="font-semibold text-blue-600">
                {account?.balance ?? 0}
              </span>
            </Link>
          </div>

          {/* 快捷区 */}
          {checkinStatus?.canCheckin && (
            <div className="border-b border-gray-100 p-1">
              <button
                onClick={() => {
                  void handleCheckin();
                  closeMenu();
                }}
                disabled={isCheckingIn}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50"
              >
                {isCheckingIn ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-300 border-t-green-600" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span>{t('credits.checkin')}</span>
              </button>
            </div>
          )}

          {/* 功能区 */}
          <div className="p-1">
            <Link
              href="/me/account"
              onClick={closeMenu}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Settings className="h-4 w-4" />
              <span>{t('me.menu.settings')}</span>
            </Link>

            {/* 语言（二级展开） */}
            <div
              className="relative"
              onMouseEnter={() => setShowLang(true)}
              onMouseLeave={() => setShowLang(false)}
            >
              <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                <Languages className="h-4 w-4" />
                <span className="flex-1 text-left">
                  {t('me.menu.language')}
                </span>
                <span className="text-xs text-gray-400">{langLabel}</span>
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
              </button>
              {showLang && (
                <div className="absolute bottom-0 left-full ml-1 w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {(['zh', 'en'] as Locale[]).map((loc) => (
                    <button
                      key={loc}
                      onClick={() => chooseLocale(loc)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <span>{loc === 'zh' ? '中文' : 'English'}</span>
                      {locale === loc && (
                        <Check className="h-3.5 w-3.5 text-violet-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Link
              href="/feedback"
              onClick={closeMenu}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <HelpCircle className="h-4 w-4" />
              <span>{t('me.menu.help')}</span>
            </Link>
          </div>

          {/* 登出区 */}
          <div className="border-t border-gray-100 p-1">
            <button
              onClick={() => {
                logout();
                closeMenu();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" />
              <span>{t('common.logout')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
