'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UserProfileButton from './UserProfileButton';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { CURRENT_VERSION } from '@/lib/utils/changelog';
import { BrandLogo } from '@/components/common/brand/BrandLogo';
import { config } from '@/lib/utils/config';
import { MODULE_THEMES } from '@/lib/design/module-themes';
import { NAV_GROUPS, navItemActive } from '@/lib/constants/nav-config';
import { useUnreadNotificationCount } from '@/hooks/domain/useNotifications';
import { useNotificationSocket } from '@/hooks/domain/useNotificationSocket';

// Sidebar Panel Toggle Icon - left narrow, right wide
// Fill shows current visible state: expanded = right filled, collapsed = left filled
function SidebarToggleIcon({
  state,
}: {
  state: 'expanded' | 'collapsed' | 'pinned';
}) {
  // When expanded/pinned: right (content area) is visible, so fill right
  // When collapsed: left (sidebar) is minimized, so fill left
  const isExpanded = state === 'expanded' || state === 'pinned';
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-7">
      {/* Outer frame */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Left narrow panel - fill when collapsed */}
      <rect
        x="3"
        y="3"
        width="6"
        height="18"
        rx="2"
        fill={!isExpanded ? '#6b7280' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Right wide panel - fill when expanded */}
      <rect
        x="9"
        y="3"
        width="12"
        height="18"
        rx="2"
        fill={isExpanded ? '#9ca3af' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

interface SidebarProps {
  className?: string;
}

export default function Sidebar({ className = '' }: SidebarProps) {
  // 三种状态: expanded(默认展开), collapsed(收起), pinned(固定)
  const [sidebarState, setSidebarState] = useState<
    'expanded' | 'collapsed' | 'pinned'
  >('expanded');

  // 悬停展开
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();

  // 通知 unread badge：拉模式 + socket 推模式（实时增量）
  const { count: unreadCount, refresh: refreshUnreadCount } =
    useUnreadNotificationCount();
  useNotificationSocket({
    onNewNotification: () => void refreshUnreadCount(),
    onBroadcast: () => void refreshUnreadCount(),
  });

  // 展开逻辑：pinned时始终展开，collapsed时hover展开，expanded时展开
  const showExpanded =
    sidebarState === 'pinned' ||
    sidebarState === 'expanded' ||
    (sidebarState === 'collapsed' && isHovered);

  // 点击切换状态: expanded → collapsed → pinned → expanded
  const handleToggle = () => {
    if (sidebarState === 'expanded') {
      setSidebarState('collapsed');
      setIsHovered(false);
    } else if (sidebarState === 'collapsed') {
      setSidebarState('pinned');
    } else {
      setSidebarState('expanded');
    }
  };

  // 检查鼠标是否在侧边栏内
  const checkMouseInSidebar = useCallback(() => {
    if (!sidebarRef.current) return false;
    const rect = sidebarRef.current.getBoundingClientRect();
    // 获取当前鼠标位置（通过监听 mousemove 存储的位置）
    const mouseX =
      (window as unknown as { __sidebarMouseX?: number }).__sidebarMouseX ?? -1;
    const mouseY =
      (window as unknown as { __sidebarMouseY?: number }).__sidebarMouseY ?? -1;
    return (
      mouseX >= rect.left &&
      mouseX <= rect.right &&
      mouseY >= rect.top &&
      mouseY <= rect.bottom
    );
  }, []);

  // 处理鼠标进入
  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  // 处理鼠标离开 - 延迟折叠，并再次检查鼠标位置
  const handleMouseLeave = () => {
    // 清除之前的定时器
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // 延迟折叠，并在折叠前再次确认鼠标确实离开了
    hoverTimeoutRef.current = setTimeout(() => {
      // 再次检查鼠标是否真的离开了侧边栏
      if (!checkMouseInSidebar()) {
        setIsHovered(false);
      }
    }, 300);
  };

  // 监听全局鼠标位置
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      (window as unknown as { __sidebarMouseX?: number }).__sidebarMouseX =
        e.clientX;
      (window as unknown as { __sidebarMouseY?: number }).__sidebarMouseY =
        e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // 页面导航后，检查鼠标是否还在侧边栏内
  useEffect(() => {
    // 导航后延迟检查，如果鼠标还在侧边栏内则保持展开
    const timer = setTimeout(() => {
      if (checkMouseInSidebar()) {
        setIsHovered(true);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [pathname, checkMouseInSidebar]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <aside
      ref={sidebarRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${showExpanded ? 'w-52' : 'w-16'} relative z-40 hidden h-full flex-col overflow-hidden border-r border-gray-200 bg-white transition-all duration-300 md:flex ${className}`}
    >
      {/* Header */}
      <div
        className={`flex flex-shrink-0 items-center overflow-hidden border-b border-gray-100 px-3 py-3 ${showExpanded ? 'justify-between' : 'justify-center'}`}
      >
        {!showExpanded ? (
          /* Collapsed state: Logo with hover -> Toggle button */
          <button
            onClick={handleToggle}
            className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-gray-100"
            title="Open sidebar"
          >
            {/* Default: Show Logo */}
            <BrandLogo
              variant="icon"
              iconClassName="h-8 w-8 transition-all duration-200 group-hover:scale-75 group-hover:opacity-0"
            />
            {/* Hover: Show Toggle icon */}
            <span className="absolute text-gray-600 opacity-0 transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
              <SidebarToggleIcon state={sidebarState} />
            </span>
          </button>
        ) : (
          /* Expanded state: Logo + Text on left */
          <Link
            href="/"
            className="group flex min-w-0 items-center overflow-hidden"
            title={config.brand.fullName}
          >
            <BrandLogo
              variant="full"
              iconClassName="h-[18px] w-auto flex-shrink-0 transition-transform duration-300 group-hover:scale-105"
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
        )}
        {/* Toggle button - only in expanded state */}
        {showExpanded && (
          <button
            onClick={handleToggle}
            className="ml-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title={
              sidebarState === 'pinned' ? 'Unpin sidebar' : 'Collapse sidebar'
            }
          >
            <SidebarToggleIcon state={sidebarState} />
          </button>
        )}
      </div>

      {/* Main Navigation —— 单一数据源 NAV_GROUPS（与 MobileNav 同源，杜绝漂移） */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        <div className="space-y-5">
          {NAV_GROUPS.filter((g) => !g.hidden).map((group, gi) => {
            const items = group.items.filter((it) => !it.adminOnly || isAdmin);
            if (items.length === 0) return null;
            const groupLabel = group.labelKey ? t(group.labelKey) : group.label;
            return (
              <div key={groupLabel ?? `group-${gi}`} className="space-y-1">
                {groupLabel &&
                  (showExpanded ? (
                    <div className="px-3 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {groupLabel}
                    </div>
                  ) : (
                    <div className="my-1 border-t border-gray-200/60" />
                  ))}
                {items.map((item) => {
                  const active = navItemActive(pathname, item);
                  const activeCls = item.moduleKey
                    ? `${MODULE_THEMES[item.moduleKey].activeBg} ${MODULE_THEMES[item.moduleKey].text}`
                    : 'bg-gray-100 text-gray-900';
                  const label = item.labelKey ? t(item.labelKey) : item.label;
                  const Icon = item.Icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={
                        item.forceReload
                          ? (e) => {
                              if (pathname === item.href) {
                                e.preventDefault();
                                window.location.href = item.href;
                              }
                            }
                          : undefined
                      }
                      className={`flex items-center ${!showExpanded ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        active ? activeCls : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      title={label}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      {showExpanded && <span>{label}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Bottom Navigation —— pb-3 留呼吸位，防被视口/任务栏裁切；
          space-y-0.5 让 notifications / user / language 间距清晰 */}
      <div className="flex-shrink-0 space-y-0.5 border-t border-gray-200 px-3 pb-3 pt-1.5">
        <Link
          href="/notifications"
          onClick={(e) => {
            // Force navigation even if already on notifications page
            if (pathname === '/notifications') {
              e.preventDefault();
              window.location.href = '/notifications';
            }
          }}
          className={`flex items-center ${!showExpanded ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm font-medium ${
            pathname === '/notifications'
              ? 'bg-pink-50 text-gray-900'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
          title="Notifications"
        >
          <span className="relative flex-shrink-0">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            {unreadCount > 0 && (
              <span
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
                aria-label={`${unreadCount} unread notifications`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          {showExpanded && (
            <span className="flex flex-1 items-center justify-between">
              <span>{t('nav.notifications')}</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
          )}
        </Link>

        {/* User Profile / Login Button */}
        <div>
          <UserProfileButton isCollapsed={!showExpanded} />
        </div>

        {/* 系统 (admin only) — 2026-05-12: 挪到 UserProfileButton 下方，
            与"账号/语言"同列归到底部分区。布局与 notifications 一致。 */}
        {isAdmin && (
          <Link
            href="/admin/overview"
            className={`flex items-center ${!showExpanded ? 'justify-center' : 'gap-3'} rounded-lg px-3 py-1.5 text-sm font-medium ${
              pathname?.startsWith('/admin')
                ? 'bg-purple-50 text-gray-900'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
            title={t('nav.system')}
          >
            <svg
              className="h-5 w-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            {showExpanded && <span>{t('nav.system')}</span>}
          </Link>
        )}
      </div>
    </aside>
  );
}
