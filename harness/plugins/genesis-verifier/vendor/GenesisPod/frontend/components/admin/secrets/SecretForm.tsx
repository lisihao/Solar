'use client';

import { useState, useMemo } from 'react';
import {
  X,
  Key,
  Save,
  Info,
  Circle,
  AlertCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import {
  Secret,
  SecretCategory,
  CreateSecretDto,
  UpdateSecretDto,
} from '@/hooks/domain/useAdminSecrets';
import { useKeyHealth } from '@/hooks/domain';
import { isMultiKeySecret, type KeyHealthStatus } from '@/lib/types/admin';
import { formatDateSafe } from '@/lib/utils/date';

// Category keys for i18n lookup
const CATEGORY_KEYS: { value: SecretCategory; key: string }[] = [
  { value: 'AI_MODEL', key: 'aiModel' },
  { value: 'SEARCH', key: 'search' },
  { value: 'EXTRACTION', key: 'extraction' },
  { value: 'YOUTUBE', key: 'youtube' },
  { value: 'TTS', key: 'tts' },
  { value: 'SKILLSMP', key: 'skillsmp' },
  { value: 'POLICY', key: 'policy' },
  { value: 'FINANCE', key: 'finance' },
  { value: 'ACADEMIC', key: 'academic' },
  { value: 'WEATHER', key: 'weather' },
  { value: 'IMAGE_SEARCH', key: 'imageSearch' },
  { value: 'DEV_TOOLS', key: 'devTools' },
  { value: 'MCP', key: 'mcp' },
  { value: 'OTHER', key: 'other' },
];

interface SecretFormProps {
  secret: Secret | null;
  onSubmit: (data: CreateSecretDto | UpdateSecretDto) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function SecretForm({
  secret,
  onSubmit,
  onCancel,
  isSubmitting,
}: SecretFormProps) {
  const { t } = useTranslation();
  const isEditing = !!secret;

  // Build category options with i18n labels
  const categoryOptions = CATEGORY_KEYS.map((cat) => ({
    value: cat.value,
    label: t(`admin.secrets.categories.${cat.key}`) || cat.key,
  }));

  const [formData, setFormData] = useState({
    name: secret?.name ?? '',
    displayName: secret?.displayName ?? '',
    value: '',
    category: secret?.category ?? ('OTHER' as SecretCategory),
    description: secret?.description ?? '',
    provider: secret?.provider ?? '',
    isActive: secret?.isActive ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // 判断当前密钥是否支持多密钥（按具体 Secret 名称判断）
  // 编辑时使用 secret.name，新建时使用 formData.name
  const currentSecretName = isEditing ? secret?.name : formData.name;
  const supportsMultiKey = isMultiKeySecret(currentSecretName ?? '');

  // 获取密钥健康状态（仅在编辑多密钥类型时有效）
  const shouldFetchHealth = isEditing && supportsMultiKey && !!secret?.name;
  const {
    keyHealth,
    stats: healthStats,
    isLoading: isLoadingHealth,
    refetch: refetchHealth,
  } = useKeyHealth(shouldFetchHealth ? (secret?.name ?? null) : null, {
    immediate: shouldFetchHealth,
  });

  // 渲染单个密钥的健康状态指示器
  const renderHealthIndicator = (health: KeyHealthStatus) => {
    if (health.isHealthy) {
      return (
        <span className="flex items-center gap-1.5 text-xs text-green-600">
          <Circle className="h-2.5 w-2.5 fill-green-500" />
          <span className="font-medium">{health.maskedKey}</span>
          <span className="text-green-500">健康</span>
        </span>
      );
    }

    if (health.cooldownUntil) {
      const cooldownEnd = new Date(health.cooldownUntil);
      const now = new Date();
      const remainingMs = cooldownEnd.getTime() - now.getTime();
      const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));

      return (
        <span
          className="flex items-center gap-1.5 text-xs text-amber-600"
          title={`冷却结束: ${formatDateSafe(cooldownEnd, 'time')}`}
        >
          <Clock className="h-2.5 w-2.5" />
          <span className="font-medium">{health.maskedKey}</span>
          <span>
            {remainingMin > 0 ? `冷却 ${remainingMin}分钟` : '即将恢复'}
          </span>
        </span>
      );
    }

    return (
      <span
        className="flex items-center gap-1.5 text-xs text-red-600"
        title={health.lastError}
      >
        <AlertCircle className="h-2.5 w-2.5" />
        <span className="font-medium">{health.maskedKey}</span>
        <span>{health.lastError || '失败'}</span>
      </span>
    );
  };

  // 计算输入的密钥数量（支持逗号分隔或换行分隔）
  const keyCount = useMemo(() => {
    if (!formData.value.trim()) return 0;
    // 先按换行分割，再按逗号分割，过滤空值
    const keys = formData.value
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    return keys.length;
  }, [formData.value]);

  // 处理多密钥保存时的格式转换（换行转逗号）
  const normalizeMultiKeys = (value: string): string => {
    return value
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
      .join(',');
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!isEditing && !formData.name.trim()) {
      newErrors.name = '名称不能为空';
    } else if (!isEditing && !/^[a-z0-9-]+$/.test(formData.name)) {
      newErrors.name = '名称只能包含小写字母、数字和连字符';
    }

    if (!formData.displayName.trim()) {
      newErrors.displayName = '显示名称不能为空';
    }

    if (!isEditing && !formData.value.trim()) {
      newErrors.value = '密钥值不能为空';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    // 如果是多密钥类型，将换行格式转为逗号分隔
    const finalValue = supportsMultiKey
      ? normalizeMultiKeys(formData.value)
      : formData.value;

    if (isEditing) {
      const updateData: UpdateSecretDto = {
        displayName: formData.displayName,
        description: formData.description || undefined,
        category: formData.category,
        provider: formData.provider || undefined,
        isActive: formData.isActive,
      };
      if (finalValue.trim()) {
        updateData.value = finalValue;
      }
      await onSubmit(updateData);
    } else {
      await onSubmit({
        name: formData.name,
        displayName: formData.displayName,
        value: finalValue,
        category: formData.category,
        description: formData.description || undefined,
        provider: formData.provider || undefined,
        isActive: formData.isActive,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl ">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 ">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 ">
            <Key className="h-5 w-5" />
            {isEditing ? '编辑密钥' : '添加密钥'}
          </h3>
          <button onClick={onCancel} className="rounded p-1 hover:bg-gray-100 ">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 表单 */}
        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          className="space-y-4 p-6"
        >
          {/* 名称 (仅创建时) */}
          {!isEditing && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 ">
                名称 (唯一标识) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                autoComplete="off"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    name: e.target.value.toLowerCase(),
                  })
                }
                placeholder="例如: openai-api-key"
                className={`w-full rounded-lg border bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                  errors.name ? 'border-red-500' : 'border-gray-300 '
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-500">{errors.name}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                只能包含小写字母、数字和连字符
              </p>
            </div>
          )}

          {/* 显示名称 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 ">
              显示名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.displayName}
              autoComplete="off"
              onChange={(e) =>
                setFormData({ ...formData, displayName: e.target.value })
              }
              placeholder="例如: OpenAI API Key"
              className={`w-full rounded-lg border bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                errors.displayName ? 'border-red-500' : 'border-gray-300 '
              }`}
            />
            {errors.displayName && (
              <p className="mt-1 text-sm text-red-500">{errors.displayName}</p>
            )}
          </div>

          {/* 密钥值 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 ">
              密钥值 {!isEditing && <span className="text-red-500">*</span>}
              {supportsMultiKey && keyCount > 0 && (
                <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-normal text-blue-700 ">
                  {keyCount} 个密钥
                </span>
              )}
            </label>
            {supportsMultiKey ? (
              <>
                <textarea
                  value={formData.value}
                  onChange={(e) =>
                    setFormData({ ...formData, value: e.target.value })
                  }
                  placeholder={
                    isEditing
                      ? '留空则不修改\n每行一个密钥，或用逗号分隔'
                      : '每行一个密钥，或用逗号分隔\n例如:\ntvly-xxxxxxxxxxxx\ntvly-yyyyyyyyyyyy'
                  }
                  rows={4}
                  className={`font-mono w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                    errors.value ? 'border-red-500' : 'border-gray-300 '
                  }`}
                />
                <div className="mt-1 flex items-start gap-1 text-xs text-gray-500">
                  <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <span>
                    支持多个密钥轮换使用，当一个密钥配额耗尽时自动切换到下一个
                  </span>
                </div>
                {/* 健康状态显示（仅编辑时） */}
                {isEditing && keyHealth.length > 0 && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 ">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700 ">
                        密钥健康状态
                        {healthStats && (
                          <span className="ml-2 font-normal text-gray-500">
                            ({healthStats.healthy}/{healthStats.total} 可用)
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => refetchHealth()}
                        disabled={isLoadingHealth}
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-50 "
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${isLoadingHealth ? 'animate-spin' : ''}`}
                        />
                        刷新
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {keyHealth.map((health, idx) => (
                        <div key={idx}>{renderHealthIndicator(health)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <input
                type="password"
                value={formData.value}
                autoComplete="new-password"
                onChange={(e) =>
                  setFormData({ ...formData, value: e.target.value })
                }
                placeholder={isEditing ? '留空则不修改' : '输入密钥值'}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                  errors.value ? 'border-red-500' : 'border-gray-300 '
                }`}
              />
            )}
            {errors.value && (
              <p className="mt-1 text-sm text-red-500">{errors.value}</p>
            )}
          </div>

          {/* 分类和提供商 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 ">
                分类
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    category: e.target.value as SecretCategory,
                  })
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 "
              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 ">
                提供商
              </label>
              <input
                type="text"
                autoComplete="off"
                value={formData.provider}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
                placeholder="例如: OpenAI"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 "
              />
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 ">
              描述
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="可选的描述信息"
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 "
            />
          </div>

          {/* 启用状态 */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700 ">
              启用此密钥
            </label>
          </div>

          {/* 按钮 */}
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 ">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100 "
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
