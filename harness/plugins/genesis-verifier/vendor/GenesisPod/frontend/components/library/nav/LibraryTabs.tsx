'use client';

import type { LucideIcon } from 'lucide-react';

export interface LibraryTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface LibraryTabsProps {
  tabs: LibraryTabItem[];
  activeTab: string;
  onChange: (id: string) => void;
}

/**
 * 统一的下划线 Tab（中性灰底 + 紫色 indicator）
 * 替代原来"绿/蓝/紫"四色 chip。
 */
export default function LibraryTabs({
  tabs,
  activeTab,
  onChange,
}: LibraryTabsProps) {
  return (
    <div className="border-b border-gray-200 px-8">
      <div className="-mb-px flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`relative flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-violet-500 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  isActive ? 'text-violet-500' : 'text-gray-400'
                }`}
              />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
