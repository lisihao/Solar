'use client';

import type { CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { MODULE_THEMES, moduleFromPath } from '@/lib/design/module-themes';

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  hideSidebar?: boolean;
}

/**
 * AppShell - Unified layout component for desktop and mobile
 *
 * Includes:
 * - MobileNav (visible on mobile, hidden on md+)
 * - Sidebar (hidden on mobile, visible on md+) - can be hidden with hideSidebar prop
 * - Main content area with proper spacing
 *
 * 版本更新提示已从顶部横幅迁移到通知中心（推送）—— 见
 * backend `NotificationPresetsService.notifyVersionUpdate`。
 *
 * ★ Hydration 问题已在 Providers 层面统一处理（isMounted 模式）
 */
export default function AppShell({
  children,
  className = '',
  hideSidebar = false,
}: AppShellProps) {
  // 按当前模块覆盖主内容区的 --primary / --ring CSS 变量：让该模块页面内所有
  // bg-primary 主按钮 / focus ring 自动变成模块识别色（与菜单一致），无需改 Button。
  // 仅作用于主内容，不含侧边栏（侧边栏每个菜单各自上色）。
  const pathname = usePathname();
  const moduleKey = moduleFromPath(pathname);
  const themeStyle: CSSProperties | undefined = moduleKey
    ? ({
        '--primary': MODULE_THEMES[moduleKey].primaryHsl,
        '--ring': MODULE_THEMES[moduleKey].primaryHsl,
      } as CSSProperties)
    : undefined;
  return (
    <>
      {/* Mobile Navigation - Only visible on small screens */}
      {!hideSidebar && <MobileNav />}

      {/* Main Layout Container */}
      <div className={`flex h-screen flex-col bg-gray-50 ${className}`}>
        <div className="flex min-h-0 flex-1">
          {/* Desktop Sidebar - Hidden on mobile, or when hideSidebar is true */}
          {!hideSidebar && <Sidebar />}

          {/* Main Content */}
          <div className="flex min-w-0 flex-1 flex-col" style={themeStyle}>
            <div className="flex min-h-0 flex-1">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}
