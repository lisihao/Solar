'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboardingStatus } from '@/hooks/features/useByokUser';

/**
 * BYOK 引导拦截：
 * - 未登录：什么都不做（不触发 /user/* 请求以免误触 401 → 自动 logout）
 * - 管理员：完全跳过
 * - 普通用户 && 未完成引导 && 不在 /me/api-keys 路径下 → 重定向到
 *   /me/api-keys
 *
 * 放在 Providers 内部、AuthProvider 之后；对 /login /auth 相关路径静默。
 */
const ALLOWED_PATHS = [
  '/me/api-keys', // BYOK 配置入口（个人中心 API Keys section）
  '/auth',
  '/login',
  '/logout',
];

export function ByokOnboardingGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  // ★ 把「是否需要拉 /user/onboarding/status」放在上层，避免未登录时触发 401
  if (isLoading) return <>{children}</>;
  if (!user) return <>{children}</>;
  if (user.role === 'ADMIN' || user.isAdmin) return <>{children}</>;

  return <UserScopedGuard>{children}</UserScopedGuard>;
}

function UserScopedGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, loading } = useOnboardingStatus();

  useEffect(() => {
    if (loading) return;

    const onAllowedPath = ALLOWED_PATHS.some((p) => pathname?.startsWith(p));
    if (onAllowedPath) return;

    if (status?.requiresOnboarding) {
      router.replace('/me/api-keys');
    }
  }, [loading, pathname, status, router]);

  return <>{children}</>;
}
