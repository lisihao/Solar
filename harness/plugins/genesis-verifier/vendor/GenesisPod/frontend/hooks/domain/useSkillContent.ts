import { useState, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import { createLogger } from '@/lib/utils/logger';
import type {
  SkillContentResponse,
  SkillVersion,
} from '@/components/admin/skills/types';

const logger = createLogger('useSkillContent');

export function useSkillContent() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [content, setContent] = useState<SkillContentResponse | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);

  const fetchContent = useCallback(async (skillId: string) => {
    setLoading(true);
    try {
      const res = await apiClient.get<SkillContentResponse>(
        `/admin/ai/skills/${skillId}/content`
      );
      setContent(res);
      setVersions(res.versions || []);
      return res;
    } catch (err) {
      logger.error('Failed to fetch skill content:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveContent = useCallback(
    async (
      skillId: string,
      promptContent: string,
      frontmatter: Record<string, unknown> | null,
      changeNote: string
    ) => {
      setSaving(true);
      try {
        const res = await apiClient.put<{ version: string }>(
          `/admin/ai/skills/${skillId}/content`,
          { content: promptContent, frontmatter, changeNote }
        );
        // Reload content after save
        await fetchContent(skillId);
        return res;
      } catch (err) {
        logger.error('Failed to save skill content:', err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [fetchContent]
  );

  const fetchVersions = useCallback(async (skillId: string, limit = 20) => {
    try {
      const res = await apiClient.get<SkillVersion[]>(
        `/admin/ai/skills/${skillId}/versions?limit=${limit}`
      );
      setVersions(res);
      return res;
    } catch (err) {
      logger.error('Failed to fetch versions:', err);
      throw err;
    }
  }, []);

  const restoreVersion = useCallback(
    async (skillId: string, versionId: string) => {
      setRestoring(true);
      try {
        const res = await apiClient.post<{ version: string }>(
          `/admin/ai/skills/${skillId}/versions/${versionId}/restore`
        );
        // Reload content and versions after restore
        await fetchContent(skillId);
        return res;
      } catch (err) {
        logger.error('Failed to restore version:', err);
        throw err;
      } finally {
        setRestoring(false);
      }
    },
    [fetchContent]
  );

  const createSkill = useCallback(
    async (data: {
      skillId: string;
      displayName: string;
      description: string;
      promptContent: string;
      frontmatter?: Record<string, unknown>;
      layer?: string;
      domain?: string;
      tags?: string[];
    }) => {
      setSaving(true);
      try {
        const res = await apiClient.post<SkillContentResponse>(
          '/admin/ai/skills',
          data
        );
        return res;
      } catch (err) {
        logger.error('Failed to create skill:', err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    content,
    versions,
    loading,
    saving,
    restoring,
    fetchContent,
    saveContent,
    fetchVersions,
    restoreVersion,
    createSkill,
  };
}
