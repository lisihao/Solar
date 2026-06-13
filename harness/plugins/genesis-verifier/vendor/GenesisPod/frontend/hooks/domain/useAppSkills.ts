/**
 * useAppSkills Hook
 *
 * Per-AI-App skills data fetching and domain toggle
 */

import { useCallback, useState } from 'react';
import { useApiGet } from '../core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import type { DomainSkillsResponse } from '@/components/common/skills/types';

/**
 * Hook for fetching domain-specific skills with effectiveness data
 */
export function useAppSkills(domain: string) {
  const { data, loading, error, refresh } = useApiGet<DomainSkillsResponse>(
    `/skills/by-domain/${domain}`
  );

  const [toggling, setToggling] = useState(false);

  const toggleSkill = useCallback(
    async (skillId: string, enabled: boolean) => {
      setToggling(true);
      try {
        await apiClient.patch(`/skills/${skillId}/domains/${domain}`, {
          enabled,
        });
        refresh();
      } catch (err) {
        toast.error(
          'Operation failed',
          err instanceof Error ? err.message : 'Failed to toggle skill'
        );
      } finally {
        setToggling(false);
      }
    },
    [domain, refresh]
  );

  return {
    skills: data?.skills ?? [],
    stats: data?.stats ?? { total: 0, enabled: 0, byLayer: {} },
    loading,
    error,
    refresh,
    toggleSkill,
    toggling,
  };
}
