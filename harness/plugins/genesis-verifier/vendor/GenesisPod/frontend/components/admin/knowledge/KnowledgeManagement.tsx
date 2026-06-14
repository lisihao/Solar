'use client';

/**
 * KnowledgeManagement —— 2026-05-11 W2 functional
 *
 * AI Engine 4 张卡片之一（与 模型/工具/技能 平级），admin 视角对全系统
 * 知识资产的统一管理入口。3 个 tab 全表格视图，行点击 → 右侧抽屉详情：
 *   - 知识库：跨用户 KB 列表（owner / 文档数 / 成员 / 状态 / 同步时间）
 *   - 文档：跨 KB 的 doc 列表（raw / chunks / embed 状态 / 错误）
 *   - Wiki：跨 KB 的 wiki 页面列表（slug / 分类 / 引用源 / 出向链接）
 *
 * 风格约束：light-only + Lucide + 与 BYOKDictionaryModal / 模型管理一致。
 */

import { useState } from 'react';
import { BookOpen, FileText, BookText } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { KnowledgeBaseTable } from './KnowledgeBaseTable';
import { DocumentTable } from './DocumentTable';
import { WikiPageTable } from './WikiPageTable';

type TabKey = 'kbs' | 'documents' | 'wiki';

const TABS: TabItem[] = [
  { key: 'kbs', label: '知识库', icon: BookOpen },
  { key: 'documents', label: '文档', icon: FileText },
  { key: 'wiki', label: 'Wiki', icon: BookText },
];

export default function KnowledgeManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>('kbs');

  return (
    <div className="space-y-6">
      <Tabs
        items={TABS}
        value={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
      />

      {activeTab === 'kbs' && <KnowledgeBaseTable />}
      {activeTab === 'documents' && <DocumentTable />}
      {activeTab === 'wiki' && <WikiPageTable />}
    </div>
  );
}
