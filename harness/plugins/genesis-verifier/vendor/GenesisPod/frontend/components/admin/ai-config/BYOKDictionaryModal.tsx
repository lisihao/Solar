'use client';

/**
 * BYOKDictionaryModal —— 2026-05-11 字典管理（右侧抽屉）
 *
 * UX 演进：
 *   v1（初版）：3 个折叠面板平铺在 /admin/ai/models 主页 → 杂乱不专业
 *   v2：按钮触发居中 Modal（max-w-5xl）→ 两侧大片留白 + 覆盖左侧菜单
 *   v3（本版）：右侧抽屉，保留左侧主菜单可视 + 抽屉宽度跟随屏幕
 *
 * 设计要点：
 *   - 抽屉位置：fixed inset-y-0 right-0，宽度 w-[min(1100px,calc(100vw-13rem-2rem))]
 *   - 不覆盖左侧 Sidebar（md+ 时 w-52 = 13rem，+2rem 间距 防贴边）
 *   - 背景遮罩从 Sidebar 右边开始（left-16 md:left-52）让侧栏始终能点
 *   - 删除冗余 description / tab description（用户："保留必要的，不要事无巨细"）
 */

import { useEffect, useState } from 'react';
import { X, Globe, KeyRound, Tag } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { AIProvidersSettings } from './AIProvidersSettings';
import { ApiFormatsSettings } from './ApiFormatsSettings';
import { ModelTypesSettings } from './ModelTypesSettings';

type TabKey = 'providers' | 'apiFormats' | 'modelTypes';

const TABS: TabItem[] = [
  { key: 'providers', label: 'AI Providers', icon: Globe },
  { key: 'apiFormats', label: 'API Formats', icon: KeyRound },
  { key: 'modelTypes', label: 'Model Types', icon: Tag },
];

export function BYOKDictionaryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('providers');

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* 遮罩：
            mobile (<md): Sidebar hidden 用 MobileNav，遮罩全屏 left-0
            md+: Sidebar w-52 (13rem) 可视，遮罩从 left-52 开始让侧栏可点 */}
      <div
        className="fixed inset-y-0 left-0 right-0 z-40 bg-black/30 md:left-52"
        onClick={onClose}
      />
      {/* 右侧抽屉：
            mobile: 全宽（w-full）
            md+: 宽度自适应（100vw - 13rem sidebar - 2rem 缓冲），上限 1100px */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[calc(100vw-13rem-2rem)] md:max-w-[1100px]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">字典管理</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs（紧贴 header，无 description 噪声） */}
        <Tabs
          className="flex-shrink-0 bg-gray-50 px-6"
          items={TABS}
          value={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
        />

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-white p-6">
          {activeTab === 'providers' && <AIProvidersSettings />}
          {activeTab === 'apiFormats' && <ApiFormatsSettings />}
          {activeTab === 'modelTypes' && <ModelTypesSettings />}
        </div>
      </div>
    </>
  );
}
