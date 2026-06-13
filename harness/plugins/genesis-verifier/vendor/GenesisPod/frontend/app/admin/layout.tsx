'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Admin 路由组守卫（Wave 4 精化 2026-05-11）：
 *  - 加载中 → 显示骨架 loader
 *  - 未登录 → 跳 /login
 *  - 已登录但非 admin → 跳 / 主页（避免靠后端 401 才拦截，体验更干净）
 *  - admin → 渲染 children
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isAdmin) {
      router.replace('/');
    }
  }, [isLoading, user, isAdmin, router]);

  if (isLoading) {
    return (
      <AppShell>
        <main className="flex h-full flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </main>
      </AppShell>
    );
  }

  // 未登录或非 admin —— 渲染占位 UI 防止内容闪现（router.replace 已在 effect 中触发）
  if (!user || !isAdmin) {
    return (
      <AppShell>
        <main className="flex h-full flex-1 items-center justify-center">
          <div className="text-center">
            <ShieldAlert className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="text-sm text-gray-500">需要管理员权限</p>
            <p className="mt-1 text-xs text-gray-400">正在跳转…</p>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </AppShell>
  );
}
