'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { useTranslation } from '@/lib/i18n';
import { createLogger } from '@/lib/utils/logger';
import { Tabs } from '@/components/ui/tabs';
import {
  Sparkles,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Package,
  ShoppingCart,
  Plus,
} from 'lucide-react';
import { LocalSkillsTable } from '@/components/admin/skills/LocalSkillsTable';
import { SkillsMarketplaceTab } from '@/components/admin/skills/SkillsMarketplaceTab';
import { SkillsDashboard } from '@/components/admin/skills/SkillsDashboard';
import { SkillPromptEditor } from '@/components/admin/skills/SkillPromptEditor';
import { useSkillContent } from '@/hooks/domain/useSkillContent';
import type { SkillConfig } from '@/components/admin/skills/types';

const logger = createLogger('SkillsManagement');

type TabType = 'local' | 'marketplace' | 'analytics';

export default function SkillsManagement() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<TabType>('local');
  const [showCreateEditor, setShowCreateEditor] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const { createSkill, saving: creatingSaving } = useSkillContent();

  // Load local skills
  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/skills`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setSkills(data.skills || []);
      }
    } catch (err) {
      logger.error('Failed to load skills:', err);
      setMessage({ type: 'error', text: t('admin.skills.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Load usage statistics
  const loadUsageStats = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/usage-stats`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setUsageCounts(data.skills || {});
      }
    } catch (err) {
      logger.error('Failed to load usage stats:', err);
    }
  }, []);

  useEffect(() => {
    loadSkills();
    loadUsageStats();
  }, [loadSkills, loadUsageStats]);

  // Statistics
  const stats = useMemo(() => {
    const total = skills.length;
    const enabled = skills.filter((s) => s.enabled).length;
    return { total, enabled };
  }, [skills]);

  // Toggle skill
  const handleToggle = async (skillId: string, enabled: boolean) => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/skills/${skillId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ enabled }),
      });

      if (res.ok) {
        setSkills((prev) =>
          prev.map((s) => (s.skillId === skillId ? { ...s, enabled } : s))
        );
        const action = enabled
          ? t('admin.skills.toggleEnabled')
          : t('admin.skills.toggleDisabled');
        setMessage({
          type: 'success',
          text: t('admin.skills.toggleSuccess', { action }),
        });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: t('admin.skills.operationFailed') });
      }
    } catch (err) {
      logger.error('Failed to toggle skill:', err);
      setMessage({ type: 'error', text: t('admin.skills.operationFailed') });
    }
  };

  // Save skill
  const handleSaveSkill = async (skill: SkillConfig) => {
    setSaving(true);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/ai/skills/${skill.skillId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify(skill),
        }
      );

      if (res.ok) {
        setSkills((prev) =>
          prev.map((s) => (s.skillId === skill.skillId ? skill : s))
        );
        setMessage({ type: 'success', text: t('admin.skills.saveSuccess') });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: t('admin.skills.saveFailed') });
      }
    } catch (err) {
      logger.error('Failed to save skill:', err);
      setMessage({ type: 'error', text: t('admin.skills.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  // Upload skill from file
  const handleUploadSkill = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${config.apiUrl}/admin/ai/skills/upload`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
        body: formData,
      });

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (res.ok && (data.success || result.success)) {
        setMessage({
          type: 'success',
          text:
            data.message ||
            t('admin.skills.uploadSuccess') ||
            'Skill uploaded successfully',
        });
        setTimeout(() => setMessage(null), 3000);
        // Reload skills to include the newly uploaded skill
        await loadSkills();
      } else {
        setMessage({
          type: 'error',
          text:
            data.message ||
            t('admin.skills.uploadFailed') ||
            'Failed to upload skill',
        });
      }
    } catch (err) {
      logger.error('Failed to upload skill:', err);
      setMessage({
        type: 'error',
        text: t('admin.skills.uploadFailed') || 'Failed to upload skill',
      });
    }
  };

  // Create new skill from UI
  const handleCreateSkill = async (
    content: string,
    frontmatter: Record<string, unknown> | null,
    _changeNote: string
  ) => {
    const skillId =
      (frontmatter?.id as string) ||
      (frontmatter?.name as string) ||
      `custom-skill-${Date.now()}`;
    const displayName =
      (frontmatter?.name as string) ||
      (frontmatter?.displayName as string) ||
      skillId;
    const description = (frontmatter?.description as string) || '';

    await createSkill({
      skillId,
      displayName,
      description,
      promptContent: content,
      frontmatter: frontmatter || undefined,
      layer: (frontmatter?.layer as string) || 'content',
      domain: (frontmatter?.domain as string) || 'general',
      tags: (frontmatter?.tags as string[]) || [],
    });

    setShowCreateEditor(false);
    setMessage({ type: 'success', text: 'Skill created successfully' });
    setTimeout(() => setMessage(null), 3000);
    await loadSkills();
  };

  // Install skill from marketplace
  const handleInstallSkill = async (skillId: string) => {
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/skillsmp/skills/${skillId}/install`,
        {
          method: 'POST',
          headers: { ...getAuthHeader() },
        }
      );

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (res.ok && (data.success || result.success)) {
        setMessage({
          type: 'success',
          text: t('admin.skills.marketplace.installSuccess'),
        });
        setTimeout(() => setMessage(null), 3000);
        // Reload local skills to include the newly installed skill
        await loadSkills();
      } else {
        const errorMsg =
          data.message || t('admin.skills.marketplace.installFailed');
        setMessage({
          type: 'error',
          text: errorMsg,
        });
        // Throw error so child component can handle it
        throw new Error(errorMsg);
      }
    } catch (err) {
      logger.error('Failed to install skill:', err);
      if (
        !err ||
        !(err instanceof Error) ||
        !err.message.includes(t('admin.skills.marketplace.installFailed'))
      ) {
        setMessage({
          type: 'error',
          text: t('admin.skills.marketplace.installFailed'),
        });
      }
      // Re-throw so child component knows installation failed
      throw err;
    }
  };

  if (loading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-purple-50 px-3 py-1.5">
            <span className="text-sm text-purple-700">
              <span className="font-semibold">{stats.enabled}</span> /{' '}
              {stats.total} {t('admin.skills.enabled')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateEditor(true)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-purple-700"
          >
            <Plus className="h-4 w-4" />
            New Skill
          </button>
          <button
            onClick={loadSkills}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.skills.refresh')}
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`flex items-center gap-3 rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
          <span>{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            className="ml-auto opacity-50 hover:opacity-100"
          >
            &times;
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <Tabs
        items={[
          {
            key: 'local',
            label: t('admin.skills.tabs.local'),
            icon: Package,
            count: stats.total,
          },
          {
            key: 'marketplace',
            label: t('admin.skills.tabs.marketplace'),
            icon: ShoppingCart,
          },
          { key: 'analytics', label: '技能统计', icon: Sparkles },
        ]}
        value={activeTab}
        onChange={(k) => setActiveTab(k as TabType)}
      />

      {/* Tab Content */}
      {activeTab === 'local' && (
        <LocalSkillsTable
          skills={skills}
          onToggle={handleToggle}
          onSaveSkill={handleSaveSkill}
          onUploadSkill={handleUploadSkill}
          saving={saving}
          usageCounts={usageCounts}
        />
      )}
      {activeTab === 'marketplace' && (
        <SkillsMarketplaceTab
          installedSkills={skills}
          onInstall={handleInstallSkill}
        />
      )}
      {activeTab === 'analytics' && <SkillsDashboard />}

      {/* Create New Skill Editor */}
      {showCreateEditor && (
        <SkillPromptEditor
          skillId="new-skill"
          initialContent=""
          initialFrontmatter={null}
          onSave={handleCreateSkill}
          onClose={() => setShowCreateEditor(false)}
          saving={creatingSaving}
        />
      )}
    </div>
  );
}
