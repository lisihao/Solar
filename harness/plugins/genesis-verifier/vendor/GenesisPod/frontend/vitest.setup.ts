import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import zhTranslations from './lib/i18n/locales/zh.json';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// jest → vi alias（项目 100+ 历史测试用 jest.fn / jest.mock API，未迁移到
// vitest 命名，导致 vitest run 跑这些测试时 ReferenceError: jest is not defined。
// 全局别名让旧测试无修改可跑；新测试推荐直接用 vi。
// 用 any cast 避开 TS 类型守护 —— vi 表面 API 跟 jest 兼容到测试可用，但底层
// types 不同（VitestUtils 缺少 jest 的 internal API 如 autoMockOff），不能
// 走 `as typeof jest` 真类型映射，否则 tsc 报缺接口
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// i18n 测试 mock（避免 useTranslation hook 默认 t(key) 返回原 key 导致渲染断言失败）
// 历史 30+ 组件测试用字面量断言文本（如"NVIDIA Blackwell · 第 3 集"），
// 自从组件迁移到 t() + i18n key 后这些测试都 fail。
// 全局 mock 让 t(key, params) 走 zh.json 字典 + {{var}} 插值，对齐生产 zh 渲染。
function getNested(obj: unknown, path: string): string | undefined {
  if (!path) return undefined;
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in cur) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(
  str: string,
  params?: Record<string, string | number>
): string {
  if (!params) return str;
  return str.replace(
    /\{\{(\w+)\}\}/g,
    (_, k) => params[k]?.toString() ?? `{{${k}}}`
  );
}

vi.mock('@/lib/i18n', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  const t = (key: string, params?: Record<string, string | number>): string => {
    const raw = getNested(zhTranslations, key);
    return raw !== undefined ? interpolate(raw, params) : key;
  };
  return {
    ...actual,
    useTranslation: () => ({
      t,
      locale: 'zh' as const,
      setLocale: () => {},
      isLoading: false,
    }),
    useI18n: () => ({
      t,
      locale: 'zh' as const,
      setLocale: () => {},
      isLoading: false,
    }),
  };
});
