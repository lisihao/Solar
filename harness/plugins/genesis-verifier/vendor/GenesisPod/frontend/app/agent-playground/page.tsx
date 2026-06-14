'use client';

/**
 * Agent Playground Index Page
 *
 * 2026-05-05 R-CA: 重构为 MissionGalleryView 公共组件的薄壳。
 * 2026-05-10: 创建入口由 /agent-playground/team 全页 launcher 改为内联 modal
 *             （PlaygroundMissionDialog + 共享 MissionDialogShell），与 Topic
 *             Insight / Custom Agents 视觉一致。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import {
  listMissions,
  deleteMission,
  cleanupMissions,
  updateMission,
  setVisibility,
  type MissionListItem,
} from '@/services/agent-playground/api';
import { MissionGalleryView } from '@/components/common/missions/MissionGalleryView';
import { PlaygroundMissionDialog } from '@/components/agent-playground';
import { toast, confirm } from '@/stores';

export default function PlaygroundIndexPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [galleryReloadKey, setGalleryReloadKey] = useState(0);

  // 2026-05-13 #67: 删除主页"可继续"徽章 / banner / 继续按钮 ——
  // 用户反馈：homepage 提示"继续"无意义。续跑入口移到 mission 详情页的「更新」按钮
  // （interrupted 时按钮变"继续上次"+ hint），主页只保留 重跑/取消/编辑/删除。

  const handleEdit = async (mission: MissionListItem) => {
    // eslint-disable-next-line no-alert
    const next = window.prompt('重命名 Mission topic：', mission.topic);
    if (!next || !next.trim() || next === mission.topic) return;
    try {
      await updateMission(mission.id, { topic: next.trim() });
    } catch (e) {
      toast.error('重命名失败', e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (mission: MissionListItem) => {
    const ok = await confirm({
      title: `确定删除「${mission.topic}」？`,
      description: '此操作不可恢复。',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await deleteMission(mission.id);
    } catch (e) {
      toast.error('删除失败', e instanceof Error ? e.message : String(e));
    }
  };

  const handleCleanup = async () => {
    const ok = await confirm({
      title: '清理所有失败 / 已取消的 Mission？',
      description:
        '将删除「失败 / 质量未达标 / 已取消」状态的任务，保留运行中和已完成的。此操作不可恢复。',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const { deleted } = await cleanupMissions();
      toast.success('清理完成', `已删除 ${deleted} 个已结束任务`);
    } catch (e) {
      toast.error('清理失败', e instanceof Error ? e.message : String(e));
    }
  };

  const handleVisibilityChange = async (
    mission: MissionListItem,
    next: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  ) => {
    try {
      await setVisibility(mission.id, next);
      setGalleryReloadKey((n) => n + 1);
    } catch (e) {
      toast.error('切换权限失败', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <MissionGalleryView
        title={t('nav.aiInsights') || 'AI Insights'}
        subtitle="多智能体协作的深度洞察任务"
        iconGradient="from-violet-500 to-purple-600"
        createButtonLabel="新建 Mission"
        onCreateMission={() => setCreateOpen(true)}
        onCleanup={handleCleanup}
        fetchMissions={listMissions}
        onMissionClick={(m) => router.push(`/agent-playground/team/${m.id}`)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onVisibilityChange={(m, next) => void handleVisibilityChange(m, next)}
        reloadKey={galleryReloadKey}
        emptyState={{
          title: '还没有 Mission',
          hint: '启动你的第一个深度洞察 Mission',
          ctaLabel: '启动洞察 Mission',
        }}
      />
      <PlaygroundMissionDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(missionId) => {
          setGalleryReloadKey((n) => n + 1);
          router.push(`/agent-playground/team/${missionId}`);
        }}
      />
    </>
  );
}
