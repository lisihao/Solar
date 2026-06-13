'use client';

/**
 * CreateRadarTopicModal
 *
 * 创建 AI 雷达主题的对话框。走 MissionDialogShell 公共壳（与 Topic Insights /
 * Playground 视觉一致）；primary 区放双输入框（名称 ≤160 + 详细描述 ≤2000，
 * feedback_expose_dual_input_topic_description）；advanced 折叠区放对象类型 /
 * 关键词 / 刷新频率。
 */

import { useState, type ReactNode } from 'react';
import { MissionDialogShell } from '@/components/common/dialogs/MissionDialogShell';
import { createTopic } from '@/services/ai-radar/api';
import type {
  CreateRadarTopicInput,
  RadarEntityType,
  RadarTopic,
} from '@/services/ai-radar/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (topic: RadarTopic) => void;
}

const ENTITY_TYPES: Array<{ value: RadarEntityType; label: string }> = [
  { value: 'topic', label: '话题' },
  { value: 'company', label: '公司' },
  { value: 'product', label: '产品' },
  { value: 'person', label: '人物' },
  { value: 'event', label: '事件' },
];

const CRON_PRESETS = [
  { value: '0 */6 * * *', label: '每 6 小时' },
  { value: '0 */12 * * *', label: '每 12 小时' },
  { value: '0 0 * * *', label: '每天 0 点' },
  { value: '0 */2 * * *', label: '每 2 小时（高频）' },
];

const SAMPLE_NAMES = [
  'GPT-5 发布动态',
  'OpenAI 公司动态',
  '英伟达股价与新闻',
  '上海机器人产业动态',
];

export function CreateRadarTopicModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entityType, setEntityType] = useState<RadarEntityType>('topic');
  const [keywordsRaw, setKeywordsRaw] = useState('');
  const [refreshCron, setRefreshCron] = useState('0 */6 * * *');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdvancedCustomized =
    entityType !== 'topic' || refreshCron !== '0 */6 * * *';

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('主题名称至少 2 个字符');
      return;
    }
    const keywords = keywordsRaw
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      setError('请至少填 1 个关键词');
      return;
    }
    const input: CreateRadarTopicInput = {
      name: trimmedName,
      description: description.trim() || undefined,
      entityType,
      keywords,
      refreshCron,
    };
    setSubmitting(true);
    try {
      const topic = await createTopic(input);
      onCreated(topic);
      setName('');
      setDescription('');
      setKeywordsRaw('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MissionDialogShell
      isOpen={open}
      onClose={onClose}
      title="新建 AI 雷达"
      subtitle="针对一个话题 / 公司 / 产品持续监控多源数据，AI 自动评分 + 实体抽取 + 信号洞察"
      submitLabel={submitting ? '创建中…' : '创建雷达'}
      submitting={submitting}
      submitDisabled={!name.trim()}
      onSubmit={() => {
        void handleSubmit();
      }}
      defaultAdvancedOpen={isAdvancedCustomized}
      error={error}
      primary={
        <>
          <Field
            label="主题名称"
            required
            hint={name.length > 0 ? `${name.length}/160` : undefined}
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：GPT-5 发布动态"
              maxLength={160}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              required
            />
            {!name && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SAMPLE_NAMES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setName(s)}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </Field>

          <Field
            label="详细描述"
            hintInline="选填——给 AI 更完整的关注角度 / 排除项 / 目标用途，明显提升数据源推荐与评分质量"
            hint={
              description.length > 0 ? `${description.length}/2000` : undefined
            }
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：聚焦 GPT-5 的能力评测 / 价格策略 / 与 Claude / Gemini 的对比；不关心营销话题；优先英文一手信源。"
              rows={5}
              maxLength={2000}
              className="w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </Field>

          <Field
            label="关键词"
            required
            hintInline="空格 / 逗号分隔，≤20 个，用于多源采集与相关度判断"
          >
            <input
              type="text"
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              placeholder="GPT-5, OpenAI, Sam Altman"
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </Field>
        </>
      }
      advancedLabel="高级设置（对象类型 / 刷新频率）"
      advanced={
        <>
          <Field label="对象类型">
            <div className="flex flex-wrap gap-1.5">
              {ENTITY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setEntityType(t.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    entityType === t.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="刷新频率">
            <div className="grid grid-cols-4 gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setRefreshCron(p.value)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-all ${
                    refreshCron === p.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </>
      }
    />
  );
}

function Field({
  label,
  required,
  hint,
  hintInline,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  hintInline?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
          {hintInline && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {hintInline}
            </span>
          )}
        </label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
