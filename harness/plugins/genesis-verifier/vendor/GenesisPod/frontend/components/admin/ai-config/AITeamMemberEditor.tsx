'use client';

import { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type {
  AITeamMemberTemplate,
  AICapability,
  AgentWorkStyle,
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
} from '@/services/admin-ai-teams/api';

interface AITeamMemberEditorProps {
  member?: AITeamMemberTemplate | null;
  onClose: () => void;
  onSave: (dto: CreateTeamMemberDto | UpdateTeamMemberDto) => Promise<void>;
}

const WORK_STYLES: { id: AgentWorkStyle; name: string; description: string }[] =
  [
    { id: 'AUTONOMOUS', name: '自主型', description: '独立完成任务，主动汇报' },
    { id: 'COLLABORATIVE', name: '协作型', description: '频繁与其他Agent交流' },
    { id: 'SUPPORTIVE', name: '支持型', description: '主要协助其他Agent' },
    { id: 'ANALYTICAL', name: '分析型', description: '深度分析，谨慎输出' },
    { id: 'CREATIVE', name: '创意型', description: '发散思维，提供创新方案' },
  ];

const CAPABILITIES: { id: AICapability; name: string }[] = [
  { id: 'TEXT_GENERATION', name: '文本生成' },
  { id: 'CODE_GENERATION', name: '代码生成' },
  { id: 'CODE_REVIEW', name: '代码审查' },
  { id: 'IMAGE_GENERATION', name: '图片生成' },
  { id: 'IMAGE_ANALYSIS', name: '图片分析' },
  { id: 'WEB_SEARCH', name: '网络搜索' },
  { id: 'URL_FETCH', name: 'URL抓取' },
  { id: 'DOCUMENT_ANALYSIS', name: '文档分析' },
  { id: 'REASONING', name: '深度推理' },
  { id: 'MATH', name: '数学计算' },
  { id: 'TRANSLATION', name: '翻译' },
  { id: 'SUMMARIZATION', name: '摘要生成' },
];

const SKILL_CATEGORIES: {
  category: string;
  name: string;
  skills: { id: string; name: string }[];
}[] = [
  {
    category: 'research',
    name: '研究类',
    skills: [
      { id: 'research-planning', name: '研究规划' },
      { id: 'information-retrieval', name: '信息检索' },
      { id: 'source-validation', name: '来源验证' },
      { id: 'data-collection', name: '数据收集' },
    ],
  },
  {
    category: 'analysis',
    name: '分析类',
    skills: [
      { id: 'data-analysis', name: '数据分析' },
      { id: 'trend-insight', name: '趋势洞察' },
      { id: 'logical-reasoning', name: '逻辑推理' },
      { id: 'risk-identification', name: '风险识别' },
    ],
  },
  {
    category: 'content',
    name: '内容类',
    skills: [
      { id: 'content-creation', name: '内容创作' },
      { id: 'structure-organization', name: '结构组织' },
      { id: 'language-polish', name: '语言润色' },
      { id: 'style-control', name: '风格控制' },
    ],
  },
  {
    category: 'technical',
    name: '技术类',
    skills: [
      { id: 'code-generation', name: '代码生成' },
      { id: 'architecture-design', name: '架构设计' },
      { id: 'debugging', name: '调试排错' },
      { id: 'code-review', name: '代码审查' },
    ],
  },
  {
    category: 'collaboration',
    name: '协作类',
    skills: [
      { id: 'quality-review', name: '质量审查' },
      { id: 'content-integration', name: '内容整合' },
      { id: 'consensus-building', name: '共识构建' },
      { id: 'task-delegation', name: '任务分配' },
    ],
  },
];

const BUILT_IN_ROLES = [
  { id: 'research-lead', name: '研究主管', isLeader: true },
  { id: 'content-lead', name: '内容主管', isLeader: true },
  { id: 'tech-lead', name: '技术主管', isLeader: true },
  { id: 'moderator', name: '协调员', isLeader: true },
  { id: 'researcher', name: '研究员', isLeader: false },
  { id: 'analyst', name: '分析师', isLeader: false },
  { id: 'writer', name: '作家', isLeader: false },
  { id: 'developer', name: '开发者', isLeader: false },
  { id: 'designer', name: '设计师', isLeader: false },
  { id: 'reviewer', name: '审查员', isLeader: false },
  { id: 'advocate', name: '倡导者', isLeader: false },
];

export default function AITeamMemberEditor({
  member,
  onClose,
  onSave,
}: AITeamMemberEditorProps) {
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState(member?.name || '');
  const [displayName, setDisplayName] = useState(member?.displayName || '');
  const [avatar, setAvatar] = useState(member?.avatar || '');
  const [roleId, setRoleId] = useState(member?.roleId || 'researcher');
  const [roleDescription, setRoleDescription] = useState(
    member?.roleDescription || ''
  );
  const [personality, setPersonality] = useState(member?.personality || '');
  const [isLeader, setIsLeader] = useState(member?.isLeader || false);
  const [defaultModel, setDefaultModel] = useState(member?.defaultModel || '');
  const [workStyle, setWorkStyle] = useState<AgentWorkStyle | undefined>(
    member?.workStyle
  );
  const [capabilities, setCapabilities] = useState<AICapability[]>(
    member?.capabilities || []
  );
  const [expertiseAreas, setExpertiseAreas] = useState<string[]>(
    member?.expertiseAreas || []
  );
  const [systemPrompt, setSystemPrompt] = useState(member?.systemPrompt || '');
  const [minCount, setMinCount] = useState(member?.minCount || 1);
  const [maxCount, setMaxCount] = useState(member?.maxCount || 1);

  // Update isLeader when roleId changes
  useEffect(() => {
    const role = BUILT_IN_ROLES.find((r) => r.id === roleId);
    if (role) {
      setIsLeader(role.isLeader);
    }
  }, [roleId]);

  const handleCapabilityToggle = (cap: AICapability) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleSkillToggle = (skillId: string) => {
    setExpertiseAreas((prev) =>
      prev.includes(skillId)
        ? prev.filter((s) => s !== skillId)
        : [...prev, skillId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name,
        displayName,
        avatar: avatar || undefined,
        roleId,
        roleDescription: roleDescription || undefined,
        personality: personality || undefined,
        isLeader,
        defaultModel: defaultModel || undefined,
        workStyle,
        capabilities,
        expertiseAreas,
        systemPrompt: systemPrompt || undefined,
        minCount,
        maxCount,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold">
            {member ? '编辑成员' : '添加成员'}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-6">
            {/* Basic Info */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                基本信息
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    头像
                  </label>
                  <input
                    type="text"
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="emoji 或 URL"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    内部标识 *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="architect"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    显示名称 *
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="首席架构师"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    角色类型
                  </label>
                  <select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <optgroup label="Leader 角色">
                      {BUILT_IN_ROLES.filter((r) => r.isLeader).map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="成员角色">
                      {BUILT_IN_ROLES.filter((r) => !r.isLeader).map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-sm text-gray-600">
                  角色职责
                </label>
                <input
                  type="text"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="负责规划故事结构和章节大纲..."
                />
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-sm text-gray-600">
                  性格特点
                </label>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={2}
                  placeholder="冷静、有条理、善于规划..."
                />
              </div>
            </div>

            {/* AI Model */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                AI 模型
              </h3>
              <input
                type="text"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="gpt-4o (留空使用系统默认)"
              />
            </div>

            {/* Work Style */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                工作风格
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {WORK_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() =>
                      setWorkStyle(
                        workStyle === style.id ? undefined : style.id
                      )
                    }
                    className={`rounded-lg border p-2 text-left transition-colors ${
                      workStyle === style.id
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-medium">{style.name}</div>
                    <div className="text-xs text-gray-500">
                      {style.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Capabilities (Tools) */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                武器/工具
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {CAPABILITIES.map((cap) => (
                  <label
                    key={cap.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors ${
                      capabilities.includes(cap.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={capabilities.includes(cap.id)}
                      onChange={() => handleCapabilityToggle(cap.id)}
                      className="sr-only"
                    />
                    <span
                      className={`text-sm ${
                        capabilities.includes(cap.id)
                          ? 'text-blue-700'
                          : 'text-gray-700'
                      }`}
                    >
                      {cap.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Skills (Expertise Areas) */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                技能专长
              </h3>
              <div className="space-y-3">
                {SKILL_CATEGORIES.map((category) => (
                  <div key={category.category}>
                    <div className="mb-1.5 text-xs font-medium text-gray-500">
                      {category.name}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {category.skills.map((skill) => (
                        <label
                          key={skill.id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                            expertiseAreas.includes(skill.id)
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={expertiseAreas.includes(skill.id)}
                            onChange={() => handleSkillToggle(skill.id)}
                            className="sr-only"
                          />
                          {skill.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                系统提示词
              </h3>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={4}
                placeholder="你是一位经验丰富的故事架构师..."
              />
            </div>

            {/* Instance Count */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                实例数量约束
              </h3>
              <div className="flex items-center gap-4">
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    最小数量
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={minCount}
                    onChange={(e) => setMinCount(parseInt(e.target.value) || 1)}
                    className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">
                    最大数量
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={maxCount}
                    onChange={(e) => setMaxCount(parseInt(e.target.value) || 1)}
                    className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !name || !displayName}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
