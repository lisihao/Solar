'use client';

/**
 * AskTeamsButton —— AI Ask 工具栏的"团队模式"入口
 *
 * 设计：teams-mode.md §10
 * 样式：与 KnowledgeBaseSelector(compact) 对齐（无边框 / 灰文字 / hover 浅灰），
 *      置于 AskToolsButton(🔑) 之前，与"知识库"按钮形成一组。
 * 行为：点击直接弹 NewAskRoomModal（不再跳路由）。
 */

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import NewAskRoomModal from './NewAskRoomModal';

export default function AskTeamsButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100"
        title={t('askRoom.button.title')}
        aria-label={t('askRoom.button.aria')}
      >
        <Users className="h-4 w-4" />
        <span className="whitespace-nowrap">{t('askRoom.button.label')}</span>
      </button>
      <NewAskRoomModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
