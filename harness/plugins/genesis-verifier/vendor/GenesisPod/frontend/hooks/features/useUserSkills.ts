import { useCallback } from 'react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';

export interface UserSkillItem {
  id: string;
  name: string;
  description: string;
  domain: string;
  layer: string;
  granted: boolean;
  pending: boolean;
  grantExpiresAt: string | null;
}

interface UserSkillsResponse {
  items: UserSkillItem[];
}

/**
 * 2026-05-28 BYOK「我的技能」(授权版)：系统技能目录 + 当前用户授权状态。
 * 申请授权复用 POST /user/authorization/requests（type=SKILL_GRANT）。
 */
export function useUserSkills() {
  const { data, loading, error, refresh } = useApiGet<UserSkillsResponse>(
    '/user/skills',
    { immediate: true }
  );

  const skills = data?.items ?? [];

  // toast 交给调用方组件用 i18n 文案处理（避免 hook 内硬编码英文 + 双重提示）
  const requestSkillGrant = useCallback(
    async (skillId: string, reason?: string): Promise<boolean> => {
      try {
        await apiClient.post('/user/authorization/requests', {
          type: 'SKILL_GRANT',
          targetId: skillId,
          reason,
        });
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  return { skills, loading, error, refresh, requestSkillGrant };
}
