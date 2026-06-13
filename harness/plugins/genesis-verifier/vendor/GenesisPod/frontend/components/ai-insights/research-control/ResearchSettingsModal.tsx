'use client';

/**
 * ResearchSettingsModal - 研究设置弹窗
 *
 * 提供研究专题的各项配置选项
 */

import { useState, useCallback, useEffect } from 'react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
import { logger } from '@/lib/utils/logger';
import { updateTopic } from '@/services/topic-insights/api';
import { toast } from '@/stores';
import { useI18n } from '@/lib/i18n';
import {
  Users,
  BookOpen,
  Eye,
  Lock,
  Globe,
  Search,
  X,
  UserPlus,
  Loader2,
  Save,
  Sparkles,
} from 'lucide-react';
import { AppSkillsPanel } from '@/components/common/skills/AppSkillsPanel';

interface ResearchSettingsModalProps {
  open: boolean;
  onClose: () => void;
  topicId: string;
}

type VisibilityType = 'private' | 'team' | 'public';

// Team member interface
interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export function ResearchSettingsModal({
  open,
  onClose,
  topicId,
}: ResearchSettingsModalProps) {
  const { t } = useI18n();
  const { currentTopic } = useTopicInsightsStore();
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<
    string[]
  >([]);
  const [visibility, setVisibility] = useState<VisibilityType>('private');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Team member selection state
  const [selectedMembers, setSelectedMembers] = useState<TeamMember[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isSearchingMembers, setIsSearchingMembers] = useState(false);
  const [searchResults, setSearchResults] = useState<TeamMember[]>([]);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);

  // Initialize from currentTopic
  useEffect(() => {
    if (currentTopic) {
      // Set visibility from topic (API uses PRIVATE/SHARED/PUBLIC, local uses private/team/public)
      if (currentTopic.visibility) {
        const visibilityMap: Record<string, VisibilityType> = {
          PRIVATE: 'private',
          SHARED: 'team',
          PUBLIC: 'public',
          private: 'private',
          team: 'team',
          public: 'public',
        };
        setVisibility(visibilityMap[currentTopic.visibility] || 'private');
      }
      // ★ 从 topicConfig 加载知识库ID
      const knowledgeBaseIds = currentTopic.topicConfig?.knowledgeBaseIds;
      if (Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length > 0) {
        setSelectedKnowledgeBases(knowledgeBaseIds);
        logger.debug(
          'Loaded knowledge base IDs from topicConfig:',
          knowledgeBaseIds
        );
      } else {
        setSelectedKnowledgeBases([]);
      }
    }
  }, [currentTopic]);

  // Save knowledge base and visibility settings
  const handleSaveSettings = useCallback(async () => {
    setIsSavingSettings(true);
    try {
      // ★ 调用 API 更新专题配置
      await updateTopic(topicId, {
        topicConfig: {
          // 保留其他已有配置
          ...currentTopic?.topicConfig,
          knowledgeBaseIds: selectedKnowledgeBases,
        },
        visibility:
          visibility === 'private'
            ? 'PRIVATE'
            : visibility === 'team'
              ? 'SHARED'
              : 'PUBLIC',
      });

      logger.debug('Saved settings successfully:', {
        selectedKnowledgeBases,
        visibility,
        teamMembers: selectedMembers,
      });

      toast.success(
        t('topicResearch.researchControl.settings.saveSuccess'),
        t('topicResearch.researchControl.settings.saveSuccessMsg')
      );
    } catch (error) {
      logger.error('Failed to save settings:', error);
      toast.error(
        t('topicResearch.researchControl.settings.saveFailed'),
        error instanceof Error
          ? error.message
          : t('topicResearch.researchControl.settings.saveFailedMsg')
      );
    } finally {
      setIsSavingSettings(false);
    }
  }, [
    topicId,
    selectedKnowledgeBases,
    visibility,
    selectedMembers,
    currentTopic?.topicConfig,
  ]);

  // Search for team members
  const handleMemberSearch = useCallback(
    async (query: string) => {
      setMemberSearchQuery(query);
      if (!query.trim()) {
        setSearchResults([]);
        setShowMemberDropdown(false);
        return;
      }

      setIsSearchingMembers(true);
      setShowMemberDropdown(true);
      try {
        // TODO: Call API to search users
        // const results = await searchUsers(query);
        // For now, simulate with mock data
        const mockUsers: TeamMember[] = [
          { id: '1', name: '张三', email: 'zhangsan@example.com' },
          { id: '2', name: '李四', email: 'lisi@example.com' },
          { id: '3', name: '王五', email: 'wangwu@example.com' },
          { id: '4', name: '赵六', email: 'zhaoliu@example.com' },
        ].filter(
          (user) =>
            (user.name.toLowerCase().includes(query.toLowerCase()) ||
              user.email.toLowerCase().includes(query.toLowerCase())) &&
            !selectedMembers.some((m) => m.id === user.id)
        );
        setSearchResults(mockUsers);
      } finally {
        setIsSearchingMembers(false);
      }
    },
    [selectedMembers]
  );

  // Add a team member
  const addMember = useCallback((member: TeamMember) => {
    setSelectedMembers((prev) => [...prev, member]);
    setMemberSearchQuery('');
    setSearchResults([]);
    setShowMemberDropdown(false);
  }, []);

  // Remove a team member
  const removeMember = useCallback((memberId: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== memberId));
  }, []);

  const visibilityOptions: {
    value: VisibilityType;
    label: string;
    description: string;
    icon: typeof Lock;
  }[] = [
    {
      value: 'private',
      label: t('topicResearch.researchControl.settings.visibility.private'),
      description: t(
        'topicResearch.researchControl.settings.visibility.privateDesc'
      ),
      icon: Lock,
    },
    {
      value: 'team',
      label: t('topicResearch.researchControl.settings.visibility.team'),
      description: t(
        'topicResearch.researchControl.settings.visibility.teamDesc'
      ),
      icon: Users,
    },
    {
      value: 'public',
      label: t('topicResearch.researchControl.settings.visibility.public'),
      description: t(
        'topicResearch.researchControl.settings.visibility.publicDesc'
      ),
      icon: Globe,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('topicResearch.researchControl.settings.title')}
      subtitle={t('topicResearch.researchControl.settings.subtitle')}
      size="md"
      contentClassName="!p-0"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('topicResearch.researchControl.settings.close')}
          </Button>
          <Button
            size="sm"
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
          >
            {isSavingSettings ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t('topicResearch.researchControl.settings.saving')}
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {t('topicResearch.researchControl.settings.save')}
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="divide-y divide-gray-100">
        {/* 知识库配置 */}
        <div className="px-5 py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50">
              <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <h4 className="text-sm font-medium text-gray-900">
              {t('topicResearch.researchControl.settings.knowledgeBase.title')}
            </h4>
            <span className="text-xs text-gray-400">
              {t(
                'topicResearch.researchControl.settings.knowledgeBase.description'
              )}
            </span>
          </div>
          <KnowledgeBaseSelector
            selectedIds={selectedKnowledgeBases}
            onSelectionChange={setSelectedKnowledgeBases}
            multiple={true}
            maxSelections={5}
            placeholder={t(
              'topicResearch.researchControl.settings.knowledgeBase.placeholder'
            )}
          />
        </div>

        {/* 可见性设置 */}
        <div className="px-5 py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-cyan-50">
              <Eye className="h-3.5 w-3.5 text-cyan-600" />
            </div>
            <h4 className="text-sm font-medium text-gray-900">
              {t('topicResearch.researchControl.settings.visibility.title')}
            </h4>
          </div>
          <div className="flex gap-2">
            {visibilityOptions.map((option) => {
              const isSelected = visibility === option.value;
              const IconComponent = option.icon;
              return (
                <label
                  key={option.value}
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-400'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    checked={isSelected}
                    onChange={() => setVisibility(option.value)}
                    className="sr-only"
                  />
                  <IconComponent
                    className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}
                  />
                  <div className="min-w-0">
                    <div
                      className={`text-xs font-medium leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}
                    >
                      {option.label}
                    </div>
                    <div
                      className={`truncate text-[10px] leading-tight ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}
                    >
                      {option.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Team member configuration - shown when visibility is 'team' */}
          {visibility === 'team' && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-purple-600" />
                <span className="text-xs font-medium text-gray-700">
                  {t(
                    'topicResearch.researchControl.settings.visibility.selectMembers'
                  )}
                </span>
              </div>

              {/* Selected members */}
              {selectedMembers.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-1 rounded-full bg-purple-100 py-0.5 pl-2 pr-0.5 text-xs text-purple-700"
                    >
                      <span>{member.name}</span>
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        className="rounded-full p-0.5 hover:bg-purple-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={memberSearchQuery}
                    onChange={(e) => handleMemberSearch(e.target.value)}
                    placeholder={t(
                      'topicResearch.researchControl.settings.visibility.searchPlaceholder'
                    )}
                    className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                    onFocus={() => {
                      if (memberSearchQuery) setShowMemberDropdown(true);
                    }}
                  />
                  {isSearchingMembers && (
                    <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
                  )}
                </div>

                {/* Search results dropdown */}
                {showMemberDropdown && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => addMember(user)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50"
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-xs font-medium text-purple-600">
                          {user.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-gray-900">
                            {user.name}
                          </div>
                          <div className="truncate text-[10px] text-gray-500">
                            {user.email}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {showMemberDropdown &&
                  memberSearchQuery &&
                  !isSearchingMembers &&
                  searchResults.length === 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-gray-200 bg-white p-2 text-center text-xs text-gray-500 shadow-lg">
                      {t(
                        'topicResearch.researchControl.settings.visibility.noResults'
                      )}
                    </div>
                  )}
              </div>

              <p className="mt-1.5 text-[10px] text-gray-500">
                {selectedMembers.length > 0
                  ? t(
                      'topicResearch.researchControl.settings.visibility.selectedCount',
                      { count: selectedMembers.length }
                    )
                  : t(
                      'topicResearch.researchControl.settings.visibility.addMembersHint'
                    )}
              </p>
            </div>
          )}
        </div>

        {/* AI Skills 配置 */}
        <div className="px-5 py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-50">
              <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <h4 className="text-sm font-medium text-gray-900">
              {t('topicResearch.researchControl.settings.skills.title') ||
                'Research Skills'}
            </h4>
            <span className="text-xs text-gray-400">
              {t('topicResearch.researchControl.settings.skills.description') ||
                'Skills powering your research analysis'}
            </span>
          </div>
          <AppSkillsPanel domain="research" compact />
        </div>
      </div>
    </Modal>
  );
}
