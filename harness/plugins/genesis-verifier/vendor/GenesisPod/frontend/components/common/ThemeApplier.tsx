'use client';

import { useEffect } from 'react';
import { useThemeStore } from '@/stores';

/**
 * ThemeApplier - 将 themeStore.appearance 落到 <html class="dark"> + color-scheme。
 *
 * - 'light' / 'dark'：直接套用。
 * - 'system'：跟随 prefers-color-scheme，并监听其变化。
 *
 * 仅在客户端运行（useEffect），SSR/hydration 安全。
 */
export function ThemeApplier() {
  const appearance = useThemeStore((s) => s.appearance);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (dark: boolean) => {
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
    };

    if (appearance === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mql.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    apply(appearance === 'dark');
  }, [appearance]);

  return null;
}
