'use client';

/**
 * Create Topic Dialog Component
 *
 * 创建研究专题的对话框
 */

import { useState, useEffect, useMemo } from 'react';
import type {
  ResearchTopic,
  CreateTopicDto,
  ResearchTemplate,
  TopicVisibility,
} from '@/lib/types/topic-insights';
import {
  ResearchTopicType,
  RefreshFrequency,
} from '@/lib/types/topic-insights';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { useTranslation } from '@/lib/i18n';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
import { Modal } from '@/components/ui/dialogs/Modal';

interface CreateTopicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (topic: ResearchTopic) => void;
  defaultType?: ResearchTopicType;
  editTopic?: ResearchTopic | null; // ★ 编辑模式：传入要编辑的专题
  initialName?: string; // ★ 预填专题名称（来自 AI Ask ActionCard 跳转）
}

// Icons
const LoaderIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

// Topic type icons configuration
const topicTypeIcons = {
  [ResearchTopicType.MACRO]: (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  [ResearchTopicType.TECHNOLOGY]: (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  ),
  [ResearchTopicType.COMPANY]: (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  ),
  [ResearchTopicType.EVENT]: (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
      />
    </svg>
  ),
};

const topicTypeStyles = {
  [ResearchTopicType.MACRO]: {
    gradient: 'from-blue-500 to-cyan-600',
    borderColor: 'border-blue-500',
    bgColor: 'bg-blue-50',
  },
  [ResearchTopicType.TECHNOLOGY]: {
    gradient: 'from-purple-500 to-pink-600',
    borderColor: 'border-purple-500',
    bgColor: 'bg-purple-50',
  },
  [ResearchTopicType.COMPANY]: {
    gradient: 'from-emerald-500 to-teal-600',
    borderColor: 'border-emerald-500',
    bgColor: 'bg-emerald-50',
  },
  [ResearchTopicType.EVENT]: {
    gradient: 'from-orange-500 to-red-500',
    borderColor: 'border-orange-500',
    bgColor: 'bg-orange-50',
  },
};

// Time range value type
type TimeRangeValue =
  | 'all'
  | '6months'
  | '1year'
  | '2years'
  | '3years'
  | '5years';

export function CreateTopicDialog({
  isOpen,
  onClose,
  onCreated,
  defaultType = ResearchTopicType.MACRO,
  editTopic = null, // ★ 编辑模式
  initialName = '',
}: CreateTopicDialogProps) {
  const { t } = useTranslation();
  const {
    createTopic,
    updateTopic, // ★ 更新专题
    fetchTemplates,
    templates: rawTemplates,
    isLoadingTemplates,
  } = useTopicInsightsStore();

  // ★ 是否为编辑模式
  const isEditMode = !!editTopic;

  // Ensure templates is always an array
  const templates = Array.isArray(rawTemplates) ? rawTemplates : [];

  const [step, setStep] = useState<'type' | 'details'>('type');
  const [selectedType, setSelectedType] =
    useState<ResearchTopicType>(defaultType);
  const [selectedTemplate, setSelectedTemplate] =
    useState<ResearchTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [refreshFrequency, setRefreshFrequency] = useState<RefreshFrequency>(
    RefreshFrequency.WEEKLY
  );
  const [searchTimeRange, setSearchTimeRange] =
    useState<TimeRangeValue>('6months');
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<
    string[]
  >([]);
  const [visibility, setVisibility] = useState<TopicVisibility>('PRIVATE'); // ★ 默认私有
  const [language, setLanguage] = useState<'zh' | 'en'>('zh'); // ★ 报告语言，默认中文
  const [enableFigures, setEnableFigures] = useState(true); // ★ 是否显示图表，默认开启
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [researchDepth, setResearchDepth] = useState<
    'quick' | 'standard' | 'thorough'
  >('standard');
  // ★ EVENT 类型专属状态
  const [eventInputMode, setEventInputMode] = useState<'url' | 'paste'>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceContent, setSourceContent] = useState('');

  // ★ 可见性选项 (使用 i18n)
  const visibilityOptions = useMemo(
    () => [
      {
        value: 'PRIVATE' as TopicVisibility,
        label: t('topicResearch.sharing.visibility.private'),
        description: t('topicResearch.sharing.visibility.privateDesc'),
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        ),
      },
      {
        value: 'SHARED' as TopicVisibility,
        label: t('topicResearch.sharing.visibility.shared'),
        description: t('topicResearch.sharing.visibility.sharedDesc'),
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        ),
      },
      {
        value: 'PUBLIC' as TopicVisibility,
        label: t('topicResearch.sharing.visibility.public'),
        description: t('topicResearch.sharing.visibility.publicDesc'),
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      },
    ],
    [t]
  );

  // Build options with i18n
  const topicTypeOptions = useMemo(
    () => [
      {
        type: ResearchTopicType.MACRO,
        label: t('topicResearch.types.macro'),
        description: t('topicResearch.types.macroDesc'),
      },
      {
        type: ResearchTopicType.TECHNOLOGY,
        label: t('topicResearch.types.technology'),
        description: t('topicResearch.types.technologyDesc'),
      },
      {
        type: ResearchTopicType.COMPANY,
        label: t('topicResearch.types.company'),
        description: t('topicResearch.types.companyDesc'),
      },
      {
        type: ResearchTopicType.EVENT,
        label: t('topicResearch.types.event'),
        description: t('topicResearch.types.eventDesc'),
      },
    ],
    [t]
  );

  const frequencyOptions = useMemo(
    () => [
      {
        value: RefreshFrequency.DAILY,
        label: t('topicResearch.frequency.daily'),
        description: t('topicResearch.frequency.dailyDesc'),
      },
      {
        value: RefreshFrequency.WEEKLY,
        label: t('topicResearch.frequency.weekly'),
        description: t('topicResearch.frequency.weeklyDesc'),
      },
      {
        value: RefreshFrequency.BIWEEKLY,
        label: t('topicResearch.frequency.biweekly'),
        description: t('topicResearch.frequency.biweeklyDesc'),
      },
      {
        value: RefreshFrequency.MONTHLY,
        label: t('topicResearch.frequency.monthly'),
        description: t('topicResearch.frequency.monthlyDesc'),
      },
      {
        value: RefreshFrequency.MANUAL,
        label: t('topicResearch.frequency.manual'),
        description: t('topicResearch.frequency.manualDesc'),
      },
    ],
    [t]
  );

  const timeRangeOptions = useMemo(
    () => [
      {
        value: 'all' as const,
        label: t('topicResearch.timeRange.all'),
        description: t('topicResearch.timeRange.allDesc'),
      },
      {
        value: '6months' as const,
        label: t('topicResearch.timeRange.6months'),
        description: t('topicResearch.timeRange.6monthsDesc'),
      },
      {
        value: '1year' as const,
        label: t('topicResearch.timeRange.1year'),
        description: t('topicResearch.timeRange.1yearDesc'),
      },
      {
        value: '2years' as const,
        label: t('topicResearch.timeRange.2years'),
        description: t('topicResearch.timeRange.2yearsDesc'),
      },
      {
        value: '3years' as const,
        label: t('topicResearch.timeRange.3years'),
        description: t('topicResearch.timeRange.3yearsDesc'),
      },
      {
        value: '5years' as const,
        label: t('topicResearch.timeRange.5years'),
        description: t('topicResearch.timeRange.5yearsDesc'),
      },
    ],
    [t]
  );

  // Load templates when type changes
  useEffect(() => {
    if (isOpen && selectedType) {
      fetchTemplates(selectedType);
    }
  }, [isOpen, selectedType, fetchTemplates]);

  // Reset when dialog opens
  useEffect(() => {
    if (isOpen) {
      if (editTopic) {
        // ★ 编辑模式：使用现有专题数据填充表单
        setStep('details'); // 直接进入详情步骤
        setSelectedType(editTopic.type);
        setSelectedTemplate(null);
        setName(editTopic.name);
        setDescription(editTopic.description || '');
        setRefreshFrequency(
          editTopic.refreshFrequency || RefreshFrequency.WEEKLY
        );
        setSearchTimeRange(
          (editTopic.topicConfig as { searchTimeRange?: TimeRangeValue })
            ?.searchTimeRange || '6months'
        );
        setSelectedKnowledgeBases(
          (editTopic.topicConfig as { knowledgeBaseIds?: string[] })
            ?.knowledgeBaseIds || []
        );
        setEnableFigures(
          (editTopic.topicConfig as { enableFigures?: boolean })
            ?.enableFigures !== false // 默认 true
        );
        setVisibility((editTopic.visibility as TopicVisibility) || 'PRIVATE');
        setLanguage((editTopic.language as 'zh' | 'en') || 'zh');
        const savedDepth = (
          editTopic.topicConfig as { researchDepth?: string } | undefined
        )?.researchDepth;
        setResearchDepth(
          savedDepth === 'quick' || savedDepth === 'thorough'
            ? savedDepth
            : 'standard'
        );
        setShowAdvanced(false);
        setError(null);
      } else {
        // ★ 创建模式：重置表单
        setStep(initialName ? 'details' : 'type'); // 有预填名时跳过类型选择步骤
        setSelectedType(defaultType);
        setSelectedTemplate(null);
        setName(initialName);
        setDescription('');
        setRefreshFrequency(RefreshFrequency.WEEKLY);
        setSearchTimeRange('6months');
        setSelectedKnowledgeBases([]);
        setEnableFigures(true); // ★ 默认开启图表
        setVisibility('PRIVATE');
        setLanguage('zh');
        setResearchDepth('standard');
        setShowAdvanced(false);
        setError(null);
        // ★ 重置 EVENT 状态
        setEventInputMode('url');
        setSourceUrl('');
        setSourceContent('');
      }
    }
  }, [isOpen, defaultType, editTopic, initialName]);

  const handleTypeSelect = (type: ResearchTopicType) => {
    setSelectedType(type);
    setSelectedTemplate(null);
    setStep('details');
  };

  const handleTemplateSelect = (template: ResearchTemplate) => {
    setSelectedTemplate(template);
    setName(template.name);
    setDescription(template.description);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Build topicConfig with searchTimeRange, knowledgeBaseIds, and enableFigures
      const topicConfig: Record<string, unknown> = {};
      if (searchTimeRange !== 'all') {
        topicConfig.searchTimeRange = searchTimeRange;
      }
      if (selectedKnowledgeBases.length > 0) {
        topicConfig.knowledgeBaseIds = selectedKnowledgeBases;
      }
      // ★ 只有当禁用图表时才保存（默认为 true）
      if (!enableFigures) {
        topicConfig.enableFigures = false;
      }
      topicConfig.researchDepth = researchDepth;

      // ★ EVENT 类型：注入锚定文章信息
      if (selectedType === ResearchTopicType.EVENT) {
        if (eventInputMode === 'url' && sourceUrl.trim()) {
          topicConfig.sourceUrl = sourceUrl.trim();
        } else if (eventInputMode === 'paste' && sourceContent.trim()) {
          topicConfig.sourceContent = sourceContent.trim().slice(0, 5000);
        }
      }

      if (isEditMode && editTopic) {
        // ★ 编辑模式：更新专题
        const updateDto = {
          name: name.trim(),
          description: description.trim() || undefined,
          refreshFrequency,
          visibility,
          language,
          topicConfig:
            Object.keys(topicConfig).length > 0 ? topicConfig : undefined,
        };

        const topic = await updateTopic(editTopic.id, updateDto);
        onCreated(topic);
        onClose();
      } else {
        // ★ 创建模式：创建新专题
        const dto: CreateTopicDto = {
          name: name.trim(),
          description: description.trim() || undefined,
          type: selectedType,
          refreshFrequency,
          visibility,
          language,
          dimensions: selectedTemplate?.dimensions,
          topicConfig:
            Object.keys(topicConfig).length > 0 ? topicConfig : undefined,
        };

        const topic = await createTopic(dto);
        onCreated(topic);
        onClose();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEditMode
            ? t('topicResearch.createDialog.updateFailed')
            : t('topicResearch.createDialog.createFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle = isEditMode
    ? t('topicResearch.createDialog.editTopic')
    : step === 'type'
      ? t('topicResearch.createDialog.selectType')
      : t('topicResearch.createDialog.configTopic');

  const dialogSubtitle = isEditMode
    ? t('topicResearch.createDialog.editTopicHint')
    : step === 'type'
      ? t('topicResearch.createDialog.selectTypeHint')
      : t('topicResearch.createDialog.configHint');

  const footerContent = (
    <div className="flex w-full items-center justify-between">
      <div>
        {/* ★ 编辑模式不显示返回按钮 */}
        {step === 'details' && !isEditMode && (
          <button
            type="button"
            onClick={() => setStep('type')}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            {t('topicResearch.createDialog.backToType')}
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          {t('common.cancel')}
        </button>
        {step === 'details' && (
          <button
            onClick={handleSubmit}
            disabled={
              !name.trim() ||
              loading ||
              (selectedType === ResearchTopicType.EVENT &&
                !isEditMode &&
                (eventInputMode === 'url'
                  ? !sourceUrl.trim()
                  : !sourceContent.trim()))
            }
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading && <LoaderIcon className="h-4 w-4 animate-spin" />}
            {isEditMode
              ? t('topicResearch.createDialog.saveChanges')
              : t('topicResearch.createTopic')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={dialogTitle}
      subtitle={dialogSubtitle}
      size="xl"
      contentClassName="max-h-[70vh]"
      footerClassName="justify-stretch"
      footer={footerContent}
    >
      {step === 'type' ? (
        // Step 1: Select Type
        <div className="grid grid-cols-4 gap-4">
          {topicTypeOptions.map((option) => {
            const styles = topicTypeStyles[option.type];
            return (
              <button
                key={option.type}
                onClick={() => handleTypeSelect(option.type)}
                className={`flex flex-col items-center rounded-xl border-2 p-6 transition-all ${
                  selectedType === option.type
                    ? `${styles.borderColor} ${styles.bgColor}`
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div
                  className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${styles.gradient} text-white shadow-md`}
                >
                  {topicTypeIcons[option.type]}
                </div>
                <span className="font-medium text-gray-900">
                  {option.label}
                </span>
                <span className="mt-1 text-center text-xs text-gray-500">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        // Step 2: Details Form
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('topicResearch.createDialog.topicName')}{' '}
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('topicResearch.createDialog.topicNamePlaceholder')}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('topicResearch.createDialog.topicDesc')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('topicResearch.createDialog.topicDescPlaceholder')}
              rows={4}
              maxLength={50000}
              className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ minHeight: '80px', maxHeight: '400px' }}
            />
            {description.length > 0 && (
              <p
                className={`mt-1 text-right text-xs ${description.length > 48000 ? 'text-red-500' : 'text-gray-400'}`}
              >
                {description.length.toLocaleString()} / 50,000
              </p>
            )}
          </div>

          {/* ★ EVENT 类型专属：URL/粘贴输入 */}
          {selectedType === ResearchTopicType.EVENT && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('topicResearch.createDialog.eventSource')}
                <span className="text-red-500"> *</span>
              </label>
              {/* 输入模式切换 */}
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEventInputMode('url')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    eventInputMode === 'url'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t('topicResearch.createDialog.eventInputUrl')}
                </button>
                <button
                  type="button"
                  onClick={() => setEventInputMode('paste')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    eventInputMode === 'paste'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t('topicResearch.createDialog.eventInputPaste')}
                </button>
              </div>
              {eventInputMode === 'url' ? (
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder={t(
                    'topicResearch.createDialog.eventUrlPlaceholder'
                  )}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              ) : (
                <textarea
                  value={sourceContent}
                  onChange={(e) => setSourceContent(e.target.value)}
                  placeholder={t(
                    'topicResearch.createDialog.eventPastePlaceholder'
                  )}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              )}
              <p className="mt-1 text-xs text-gray-400">
                {t('topicResearch.createDialog.eventSourceHint')}
              </p>
            </div>
          )}

          {/* Research Depth Selector */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('topicResearch.createDialog.researchDepthLabel') ||
                t('topicResearch.researchDepth.label')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['quick', 'standard', 'thorough'] as const).map((depth) => {
                const labels: Record<string, string> = {
                  quick: t('topicResearch.researchDepth.quick'),
                  standard: t('topicResearch.researchDepth.standard'),
                  thorough: t('topicResearch.researchDepth.thorough'),
                };
                const descriptions: Record<string, string> = {
                  quick: t('topicResearch.researchDepth.quickDesc'),
                  standard: t('topicResearch.researchDepth.standardDesc'),
                  thorough: t('topicResearch.researchDepth.thoroughDesc'),
                };
                const icons: Record<string, string> = {
                  quick: 'M13 10V3L4 14h7v7l9-11h-7z',
                  standard:
                    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
                  thorough:
                    'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
                };
                const isSelected = researchDepth === depth;
                return (
                  <button
                    key={depth}
                    type="button"
                    onClick={() => setResearchDepth(depth)}
                    className={`group relative flex flex-col items-center rounded-xl border-2 px-3 py-3 text-center transition-all ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm shadow-violet-500/10'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    title={descriptions[depth]}
                  >
                    {isSelected && (
                      <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500 text-white">
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                    <svg
                      className={`mb-1.5 h-5 w-5 ${isSelected ? 'text-violet-500' : 'text-gray-400 group-hover:text-gray-500'}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={icons[depth]}
                      />
                    </svg>
                    <div
                      className={`text-sm font-semibold ${isSelected ? 'text-violet-700' : 'text-gray-700'}`}
                    >
                      {labels[depth]}
                    </div>
                    <div
                      className={`mt-0.5 text-[11px] ${isSelected ? 'text-violet-500' : 'text-gray-400'}`}
                    >
                      {descriptions[depth]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Advanced Settings (collapsible) */}
          <div className="border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex w-full items-center justify-between py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              <span>
                {t('topicResearch.createDialog.advancedSettings') ||
                  'Advanced Settings'}
              </span>
              <svg
                className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showAdvanced && (
              <div className="mt-2 space-y-3">
                {/* Refresh Frequency */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('topicResearch.createDialog.refreshFrequency')}
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {frequencyOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRefreshFrequency(option.value)}
                        className={`rounded-lg border px-2 py-1.5 text-center transition-all ${
                          refreshFrequency === option.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <span className="block text-xs font-medium">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Range */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('topicResearch.createDialog.searchTimeRange')}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {t('topicResearch.createDialog.searchTimeRangeHint')}
                    </span>
                  </label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {timeRangeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSearchTimeRange(option.value)}
                        className={`rounded-lg border px-2 py-1.5 text-center transition-all ${
                          searchTimeRange === option.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                        title={option.description}
                      >
                        <span className="block text-xs font-medium">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ★ Visibility Selector */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('topicResearch.sharing.visibility.title')}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {t('topicResearch.visibilityDesc')}
                    </span>
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {visibilityOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setVisibility(option.value)}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                          visibility === option.value
                            ? option.value === 'PRIVATE'
                              ? 'border-gray-500 bg-gray-50 text-gray-700'
                              : option.value === 'SHARED'
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                        title={option.description}
                      >
                        {option.icon}
                        <span className="text-xs font-medium">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ★ Language Selector */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('topicResearch.language')}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {t('topicResearch.languageDesc')}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLanguage('zh')}
                      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                        language === 'zh'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {t('topicResearch.languageOptions.zh')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage('en')}
                      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                        language === 'en'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {t('topicResearch.languageOptions.en')}
                      </span>
                    </button>
                  </div>
                </div>

                {/* ★ Figure Display Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      {t('topicResearch.createDialog.reportFigures')}
                    </label>
                    <p className="text-xs text-gray-400">
                      {t('topicResearch.createDialog.reportFiguresDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnableFigures(!enableFigures)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      enableFigures ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        enableFigures ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Knowledge Base Selector */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('topicResearch.createDialog.knowledgeBase')}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {t('topicResearch.createDialog.knowledgeBaseHint')}
                    </span>
                  </label>
                  <KnowledgeBaseSelector
                    selectedIds={selectedKnowledgeBases}
                    onSelectionChange={setSelectedKnowledgeBases}
                    multiple={true}
                    maxSelections={5}
                    placeholder={t(
                      'topicResearch.createDialog.knowledgeBasePlaceholder'
                    )}
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {typeof error === 'string'
                ? error
                : t('topicResearch.createDialog.operationFailed')}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
