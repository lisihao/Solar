'use client';

/**
 * GlobalAIBarProvider
 *
 * 挂载 GlobalAIBar 并向外暴露 openGlobalAIBar() 单例方法。
 * 在 providers.tsx 中作为全局 Provider 使用。
 */

import { useEffect } from 'react';
import { useGlobalAIBar, registerGlobalAIBarOpen } from './useGlobalAIBar';
import { GlobalAIBar } from './GlobalAIBar';

export function GlobalAIBarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const bar = useGlobalAIBar();

  // 注册单例 open 函数，供 openGlobalAIBar() 外部调用
  useEffect(() => {
    registerGlobalAIBarOpen(bar.open);
  }, [bar.open]);

  return (
    <>
      {children}
      <GlobalAIBar {...bar} />
    </>
  );
}
