'use client';

import { useState, useEffect, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader, isAuthenticated } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
// AI模型类型 - 与后端 Prisma schema 保持一致
export type AIModelType =
  | 'CHAT' // 标准聊天模型 (GPT-4, Claude, Gemini Pro)
  | 'CHAT_FAST' // 快速/低成本聊天模型 (GPT-4o-mini, Claude Haiku, Gemini Flash)
  | 'CODE' // 代码模型 (Claude Sonnet, GPT-4o, Codestral, DeepSeek Coder)
  | 'IMAGE_GENERATION' // 图片生成模型 (DALL-E 3, Imagen 4)
  | 'IMAGE_EDITING' // 图片编辑模型 (Imagen 3)
  | 'MULTIMODAL'; // 多模态模型 (Gemini 2.0 Flash)

export interface AIModel {
  id: string; // 数据库唯一 ID（用于前端选中状态）
  dbId: string; // 数据库 ID（保持兼容）
  name: string; // 显示名称
  modelName: string; // 模型标识名（如 gemini, gemini-image，用于 AI member 的 aiModel 字段）
  provider: string; // 提供商
  modelId: string; // 实际模型 ID
  modelType: AIModelType; // 模型类型
  icon: string; // emoji 或图标路径
  iconUrl: string; // 图标 URL
  color: string; // Tailwind 颜色类
  description: string; // 描述
  isDefault: boolean; // 是否默认
  isUserKey?: boolean; // 是否来自用户自己的 API Key
}

// 缓存模型列表（避免重复请求）
let cachedModels: AIModel[] | null = null;
let cacheTimestamp: number = 0;
let cachedAuthState: boolean = false; // 缓存时的认证状态
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// ★ BYOK: 全局 revision counter，清除缓存时递增，触发所有 useAIModels 实例重新获取
let cacheRevision = 0;
const cacheListeners = new Set<() => void>();

function subscribeCacheRevision(listener: () => void) {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function notifyCacheCleared() {
  cacheRevision++;
  cacheListeners.forEach((fn) => fn());
}

/**
 * 去重模型列表 - 按 modelId 去重，每个实际模型只保留一个
 * 优先保留标记为默认的模型
 */
function deduplicateModels(models: AIModel[]): AIModel[] {
  // Guard against undefined/null models
  if (!models || !Array.isArray(models)) {
    return [];
  }

  const modelMap = new Map<string, AIModel>();

  for (const model of models) {
    const key = model.modelId; // 按实际模型 ID 去重
    const existing = modelMap.get(key);

    if (!existing) {
      // 第一次遇到这个 modelId，直接添加
      modelMap.set(key, model);
    } else if (model.isDefault && !existing.isDefault) {
      // 如果当前模型是默认的而已有的不是，替换
      modelMap.set(key, model);
    }
    // 否则保留已有的
  }

  return Array.from(modelMap.values());
}

/**
 * 获取已启用的 AI 模型列表 Hook
 */
export function useAIModels() {
  const [models, setModels] = useState<AIModel[]>(cachedModels || []);
  const [loading, setLoading] = useState(!cachedModels);
  const [error, setError] = useState<string | null>(null);
  // ★ BYOK: 监听缓存清除事件，触发重新获取
  const [revision, setRevision] = useState(cacheRevision);

  useEffect(() => {
    return subscribeCacheRevision(() => setRevision((r) => r + 1));
  }, []);

  useEffect(() => {
    const fetchModels = async () => {
      // 检查缓存是否有效
      const now = Date.now();

      // 验证缓存数据是否包含 modelType 字段（兼容性检查）
      // 认证状态变化时也要刷新缓存（BYOK: 登录后需要获取 isUserKey 标记）
      const currentAuth = isAuthenticated();
      const isCacheValid =
        cachedModels &&
        now - cacheTimestamp < CACHE_DURATION &&
        cachedModels.every((m) => m.modelType !== undefined) &&
        cachedAuthState === currentAuth;

      if (isCacheValid) {
        setModels(cachedModels!);
        setLoading(false);
        return;
      }

      // 如果缓存无效或缺少 modelType，清除缓存并重新获取
      if (
        cachedModels &&
        !cachedModels.every((m) => m.modelType !== undefined)
      ) {
        logger.debug(
          '[useAIModels] Cache invalid: missing modelType, clearing...'
        );
        cachedModels = null;
        cacheTimestamp = 0;
      }

      try {
        setLoading(true);
        const response = await fetch(`${config.apiUrl}/ai/models`, {
          headers: getAuthHeader(),
        });
        if (response.ok) {
          const result = await response.json();
          // API returns { success: true, data: [...] } format
          // Extract the data array from the response wrapper
          const modelsArray = Array.isArray(result?.data)
            ? result.data
            : Array.isArray(result)
              ? result
              : [];
          if (modelsArray.length === 0 && result?.data !== undefined) {
            logger.warn('[useAIModels] API returned empty or invalid data');
          }
          cachedModels = modelsArray;
          cacheTimestamp = now;
          cachedAuthState = currentAuth;
          setModels(modelsArray);
          setError(null);
        } else {
          throw new Error('Failed to fetch AI models');
        }
      } catch (err) {
        logger.error('Failed to fetch AI models:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        // 如果获取失败，使用默认的硬编码列表作为后备
        setModels(getDefaultModels());
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // 对模型列表进行去重，避免显示重复的模型配置
  const uniqueModels = useMemo(() => deduplicateModels(models), [models]);

  return { models: uniqueModels, loading, error };
}

/**
 * 清除模型缓存（当管理员修改模型配置后调用）
 */
export function clearAIModelsCache() {
  cachedModels = null;
  cacheTimestamp = 0;
  cachedAuthState = false;
  notifyCacheCleared();
}

/**
 * 根据模型类型获取默认模型
 * @param models 模型列表
 * @param modelType 目标模型类型 (CHAT, CHAT_FAST, IMAGE_GENERATION, etc.)
 * @returns 默认模型或 undefined
 */
export function getDefaultModelByType(
  models: AIModel[],
  modelType: AIModelType
): AIModel | undefined {
  // Debug: 输出所有模型的 modelType 信息
  if (process.env.NODE_ENV === 'development') {
    logger.debug('[getDefaultModelByType] Looking for type:', {
      modelType,
      availableModels: models.map((m) => ({
        name: m.name,
        modelName: m.modelName,
        modelType: m.modelType,
        isDefault: m.isDefault,
      })),
    });
  }

  // 1. 优先查找该类型中标记为默认的模型
  const defaultOfType = models.find(
    (m) => m.modelType === modelType && m.isDefault
  );
  if (defaultOfType) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        '[getDefaultModelByType] Found default of type:',
        defaultOfType.name
      );
    }
    return defaultOfType;
  }

  // 2. 如果没有默认的，返回该类型的第一个模型
  const firstOfType = models.find((m) => m.modelType === modelType);
  if (firstOfType) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        '[getDefaultModelByType] Found first of type:',
        firstOfType.name
      );
    }
    return firstOfType;
  }

  // 3. 如果该类型没有模型，返回 undefined
  if (process.env.NODE_ENV === 'development') {
    logger.debug('[getDefaultModelByType] No model found for type:', modelType);
  }
  return undefined;
}

/**
 * 判断模型是否为聊天类型（CHAT 或 CHAT_FAST）
 * 通过 modelType 字段或模型名称推断
 */
function isChatModel(model: AIModel): boolean {
  // 1. 首先检查 modelType 字段
  if (model.modelType === 'CHAT' || model.modelType === 'CHAT_FAST') {
    return true;
  }

  // 2. 如果 modelType 为空或未知，根据模型名称/ID 推断
  const nameLower = (model.name || '').toLowerCase();
  const modelIdLower = (model.modelId || '').toLowerCase();

  // 排除明确的图像生成模型
  if (
    nameLower.includes('imagen') ||
    modelIdLower.includes('imagen') ||
    nameLower.includes('dall-e') ||
    modelIdLower.includes('dall-e') ||
    model.modelType === 'IMAGE_GENERATION' ||
    model.modelType === 'IMAGE_EDITING'
  ) {
    return false;
  }

  // 常见聊天模型关键词
  const chatKeywords = [
    'gpt',
    'claude',
    'gemini',
    'grok',
    'chat',
    'llama',
    'mistral',
    'deepseek',
  ];
  for (const keyword of chatKeywords) {
    if (nameLower.includes(keyword) || modelIdLower.includes(keyword)) {
      return true;
    }
  }

  // 默认不确定的模型不作为聊天模型
  return false;
}

/**
 * 获取标准聊天的默认模型（用于 AI Studio 等复杂对话场景）
 * 增强版：支持 modelType 为空时的后备逻辑
 */
export function getDefaultChatModel(models: AIModel[]): AIModel | undefined {
  // 1. 首先尝试通过 modelType === 'CHAT' 查找
  const byType = getDefaultModelByType(models, 'CHAT');
  if (byType) return byType;

  // 2. 如果没找到，尝试通过名称推断
  // 这是为了兼容 modelType 字段未设置的旧数据
  if (process.env.NODE_ENV === 'development') {
    logger.debug(
      '[getDefaultChatModel] No CHAT type found, trying to infer from name...'
    );
  }

  // 查找标记为默认且看起来像聊天模型的
  const defaultChat = models.find((m) => m.isDefault && isChatModel(m));
  if (defaultChat) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        '[getDefaultChatModel] Found default chat model by inference:',
        defaultChat.name
      );
    }
    return defaultChat;
  }

  // 查找任意看起来像聊天模型的
  const anyChat = models.find((m) => isChatModel(m));
  if (anyChat) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        '[getDefaultChatModel] Found chat model by inference:',
        anyChat.name
      );
    }
    return anyChat;
  }

  return undefined;
}

/**
 * 获取快速聊天的默认模型（用于简单任务：分类、翻译、摘要等）
 */
export function getDefaultFastChatModel(
  models: AIModel[]
): AIModel | undefined {
  return getDefaultModelByType(models, 'CHAT_FAST');
}

/**
 * 获取图片生成的默认模型
 */
export function getDefaultImageModel(models: AIModel[]): AIModel | undefined {
  return getDefaultModelByType(models, 'IMAGE_GENERATION');
}

/**
 * 选择"该用什么模型作为默认值"的统一规则。
 *
 * 优先级（W4-byok 2026-05-05）：
 *   1. **用户的 BYOK 模型**（isUserKey=true）— 用户配了自己的 key 就优先用，
 *      不能让默认值落到 admin 系统 key 模型上，否则用户发消息时 KeyResolver
 *      因找不到 PERSONAL/ASSIGNED key 直接报错（严格 BYOK 模式）。
 *      在 BYOK 中又优先 admin 标记的 isDefault（让 admin 在用户范围内引导默认）。
 *   2. admin 标记的 isDefault 模型（系统级默认）
 *   3. 列表第一个
 *
 * 适用：所有 model dropdown 的初始化默认值，不分页面。
 * 反模式：直接 `models.find(m => m.isDefault) || models[0]` —— 这会让有 BYOK
 * 的用户默认选中系统 key 模型，是当前事故的真根因。
 */
export function pickPreferredModel(models: AIModel[]): AIModel | undefined {
  if (!models || models.length === 0) return undefined;

  const userKeyModels = models.filter((m) => m.isUserKey);
  if (userKeyModels.length > 0) {
    return userKeyModels.find((m) => m.isDefault) ?? userKeyModels[0];
  }

  return models.find((m) => m.isDefault) ?? models[0];
}

/**
 * 用户是否配置了任何 BYOK key（PERSONAL 或 ASSIGNED）。
 *
 * 严格 BYOK 模式下，没配 BYOK 的用户**点击发消息必然报 NoAvailableKeyError**
 * （commit 0635c70d9 删了 SYSTEM fallback）。所以即便 dropdown 默认选了系统模型，
 * 调用时也会失败 — UI 必须用此 helper 检测后展示 BYOK 配置 banner，不让用户陷入
 * "看似可用实则必败"的体验黑洞。
 *
 * 实现：检测 models 列表里是否有任何 isUserKey=true 的项。后端
 * getEnabledModelsForFrontend 给用户配过 PERSONAL key 的 provider 模型 +
 * BYOK_DEFAULT_MODELS 动态生成的模型都标 isUserKey=true。
 */
export function userHasBYOK(models: AIModel[]): boolean {
  if (!models || !Array.isArray(models) || models.length === 0) return false;
  return models.some((m) => m.isUserKey === true);
}

/**
 * 默认模型列表（后备方案）
 */
function getDefaultModels(): AIModel[] {
  return [
    {
      id: 'default-grok',
      dbId: '',
      name: 'Grok (xAI)',
      modelName: 'grok',
      provider: 'xAI',
      modelId: 'grok-3-latest',
      modelType: 'CHAT',
      icon: '🤖',
      iconUrl: '/icons/ai/grok.svg',
      color: 'from-blue-500 to-blue-600',
      description: 'xAI Grok - 快速智能',
      isDefault: true,
    },
    {
      id: 'default-gpt-4',
      dbId: '',
      name: 'ChatGPT (OpenAI)',
      modelName: 'gpt-4',
      provider: 'OpenAI',
      modelId: 'gpt-4-turbo',
      modelType: 'CHAT',
      icon: '🧠',
      iconUrl: '/icons/ai/openai.svg',
      color: 'from-green-500 to-green-600',
      description: 'OpenAI ChatGPT - 深度思考',
      isDefault: false,
    },
    {
      id: 'default-claude',
      dbId: '',
      name: 'Claude (Anthropic)',
      modelName: 'claude',
      provider: 'Anthropic',
      modelId: 'claude-sonnet-4-20250514',
      modelType: 'CHAT',
      icon: '🎭',
      iconUrl: '/icons/ai/claude.svg',
      color: 'from-orange-500 to-orange-600',
      description: 'Anthropic Claude - 对话专家',
      isDefault: false,
    },
    {
      id: 'default-gemini',
      dbId: '',
      name: 'Gemini (Google)',
      modelName: 'gemini',
      provider: 'Google',
      modelId: 'gemini-2.0-flash',
      modelType: 'CHAT',
      icon: '💎',
      iconUrl: '/icons/ai/gemini.svg',
      color: 'from-purple-500 to-purple-600',
      description: 'Google Gemini - 多模态',
      isDefault: false,
    },
  ];
}
