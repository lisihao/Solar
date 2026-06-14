import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Module-level mocks must be hoisted before imports that reference them
vi.mock('@/lib/utils/config', () => ({
  config: { apiUrl: 'http://test-api' },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  isAuthenticated: vi.fn(() => false),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks to allow cache reset
import {
  useAIModels,
  clearAIModelsCache,
  getDefaultModelByType,
  getDefaultChatModel,
  getDefaultFastChatModel,
  getDefaultImageModel,
  pickPreferredModel,
  userHasBYOK,
  type AIModel,
} from '../useAIModels';

const makeModel = (overrides: Partial<AIModel> = {}): AIModel => ({
  id: 'model-1',
  dbId: 'db-1',
  name: 'Test Model',
  modelName: 'test',
  provider: 'TestProvider',
  modelId: 'test-model-v1',
  modelType: 'CHAT',
  icon: '',
  iconUrl: '',
  color: '',
  description: '',
  isDefault: false,
  ...overrides,
});

describe('useAIModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level cache between tests
    clearAIModelsCache();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });
  });

  afterEach(() => {
    clearAIModelsCache();
  });

  // ==================== Initial State ====================

  it('should start loading when cache is empty', () => {
    const { result } = renderHook(() => useAIModels());
    // loading should be true initially when no cache exists
    expect(result.current.loading).toBe(true);
    expect(result.current.models).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ==================== Successful Fetch ====================

  it('should populate models after successful fetch', async () => {
    const models = [
      makeModel({ id: 'model-1', modelId: 'gpt-4', isDefault: true }),
      makeModel({ id: 'model-2', modelId: 'claude-3', name: 'Claude' }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: models }),
    });

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('should handle API returning array directly (no wrapper)', async () => {
    const models = [makeModel({ modelId: 'gpt-4' })];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(models),
    });

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toHaveLength(1);
  });

  // ==================== Deduplication ====================

  it('should deduplicate models with the same modelId', async () => {
    const models = [
      makeModel({ id: 'a', modelId: 'gpt-4', isDefault: false }),
      makeModel({ id: 'b', modelId: 'gpt-4', isDefault: true }),
      makeModel({ id: 'c', modelId: 'claude-3', isDefault: false }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: models }),
    });

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // gpt-4 deduplicated to 1 (the default one), claude-3 is unique
    expect(result.current.models).toHaveLength(2);
    const gpt4 = result.current.models.find((m) => m.modelId === 'gpt-4');
    expect(gpt4?.isDefault).toBe(true);
  });

  it('should keep first occurrence when neither is default', async () => {
    const models = [
      makeModel({ id: 'a', modelId: 'gpt-4', name: 'First', isDefault: false }),
      makeModel({
        id: 'b',
        modelId: 'gpt-4',
        name: 'Second',
        isDefault: false,
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: models }),
    });

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].name).toBe('First');
  });

  // ==================== Error Handling ====================

  it('should fallback to default models on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have fallback models
    expect(result.current.models.length).toBeGreaterThan(0);
    expect(result.current.error).toBe('Network error');
  });

  it('should fallback to default models on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useAIModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.models.length).toBeGreaterThan(0);
    expect(result.current.error).toBeTruthy();
  });

  // ==================== Fetch URL / Auth ====================

  it('should call correct API endpoint with auth header', async () => {
    const { result } = renderHook(() => useAIModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );
  });

  // ==================== Cache ====================

  it('should not refetch when cache is still valid after clearAIModelsCache is called', async () => {
    const models = [makeModel({ modelId: 'gpt-4' })];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: models }),
    });

    // First mount
    const { result: r1, unmount: u1 } = renderHook(() => useAIModels());
    await waitFor(() => expect(r1.current.loading).toBe(false));
    u1();

    // Clear cache
    clearAIModelsCache();

    // Second mount should refetch
    const { result: r2 } = renderHook(() => useAIModels());
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ==================== Utility Functions ====================

describe('getDefaultModelByType', () => {
  const models: AIModel[] = [
    makeModel({ modelId: 'gpt-4', modelType: 'CHAT', isDefault: true }),
    makeModel({
      modelId: 'gpt-4o-mini',
      modelType: 'CHAT_FAST',
      isDefault: true,
    }),
    makeModel({
      modelId: 'dall-e-3',
      modelType: 'IMAGE_GENERATION',
      isDefault: false,
    }),
    makeModel({
      modelId: 'imagen-3',
      modelType: 'IMAGE_GENERATION',
      isDefault: true,
    }),
  ];

  it('returns default model for given type', () => {
    const model = getDefaultModelByType(models, 'CHAT');
    expect(model?.modelId).toBe('gpt-4');
  });

  it('returns first model of type when none is default', () => {
    const nonDefaultModels: AIModel[] = [
      makeModel({
        modelId: 'dall-e-2',
        modelType: 'IMAGE_GENERATION',
        isDefault: false,
      }),
    ];
    const model = getDefaultModelByType(nonDefaultModels, 'IMAGE_GENERATION');
    expect(model?.modelId).toBe('dall-e-2');
  });

  it('returns undefined when no model matches type', () => {
    const model = getDefaultModelByType(models, 'MULTIMODAL');
    expect(model).toBeUndefined();
  });

  it('handles empty models array', () => {
    expect(getDefaultModelByType([], 'CHAT')).toBeUndefined();
  });
});

describe('getDefaultChatModel', () => {
  it('returns CHAT type default model', () => {
    const models: AIModel[] = [
      makeModel({ modelId: 'gpt-4', modelType: 'CHAT', isDefault: true }),
      makeModel({
        modelId: 'dall-e',
        modelType: 'IMAGE_GENERATION',
        isDefault: true,
      }),
    ];
    const model = getDefaultChatModel(models);
    expect(model?.modelId).toBe('gpt-4');
  });

  it('falls back to inference by name when no CHAT type', () => {
    const models: AIModel[] = [
      makeModel({
        modelId: 'gpt-4-legacy',
        modelType: undefined as never,
        name: 'GPT-4',
        isDefault: true,
      }),
    ];
    const model = getDefaultChatModel(models);
    expect(model).toBeDefined();
  });

  it('returns undefined for empty list', () => {
    expect(getDefaultChatModel([])).toBeUndefined();
  });
});

describe('getDefaultFastChatModel', () => {
  it('returns CHAT_FAST default model', () => {
    const models: AIModel[] = [
      makeModel({ modelId: 'gpt-4', modelType: 'CHAT', isDefault: true }),
      makeModel({
        modelId: 'gpt-4o-mini',
        modelType: 'CHAT_FAST',
        isDefault: true,
      }),
    ];
    expect(getDefaultFastChatModel(models)?.modelId).toBe('gpt-4o-mini');
  });
});

describe('getDefaultImageModel', () => {
  it('returns IMAGE_GENERATION default model', () => {
    const models: AIModel[] = [
      makeModel({
        modelId: 'dall-e-3',
        modelType: 'IMAGE_GENERATION',
        isDefault: true,
      }),
    ];
    expect(getDefaultImageModel(models)?.modelId).toBe('dall-e-3');
  });

  it('returns undefined when no image model exists', () => {
    const models: AIModel[] = [
      makeModel({ modelId: 'gpt-4', modelType: 'CHAT', isDefault: true }),
    ];
    expect(getDefaultImageModel(models)).toBeUndefined();
  });
});

// W4-byok 2026-05-05: BYOK 优先级核心规则 — 所有 dropdown 默认值都走它
describe('pickPreferredModel (BYOK > admin default > [0])', () => {
  it('returns user-key model over admin default', () => {
    const models: AIModel[] = [
      makeModel({ id: 'sys', modelId: 'gpt-5', isDefault: true }),
      makeModel({ id: 'mine', modelId: 'grok-3', isUserKey: true }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('mine');
  });

  it('within user-key models, prefers admin default', () => {
    const models: AIModel[] = [
      makeModel({ id: 'mine-a', modelId: 'grok-3', isUserKey: true }),
      makeModel({
        id: 'mine-b',
        modelId: 'grok-fast',
        isUserKey: true,
        isDefault: true,
      }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('mine-b');
  });

  it('falls back to admin default when no user-key model', () => {
    const models: AIModel[] = [
      makeModel({ id: 'a', modelId: 'gpt-4' }),
      makeModel({ id: 'b', modelId: 'gpt-5', isDefault: true }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('b');
  });

  it('falls back to first when no user-key and no default', () => {
    const models: AIModel[] = [
      makeModel({ id: 'first', modelId: 'gpt-4' }),
      makeModel({ id: 'second', modelId: 'gpt-5' }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('first');
  });

  it('returns undefined for empty list', () => {
    expect(pickPreferredModel([])).toBeUndefined();
  });

  it('handles undefined input gracefully', () => {
    expect(
      pickPreferredModel(undefined as unknown as AIModel[])
    ).toBeUndefined();
  });

  it('user has multiple BYOK without default — picks first user-key', () => {
    const models: AIModel[] = [
      makeModel({ id: 'sys', modelId: 'gpt-5', isDefault: true }),
      makeModel({ id: 'mine-a', modelId: 'grok-3', isUserKey: true }),
      makeModel({ id: 'mine-b', modelId: 'claude-4', isUserKey: true }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('mine-a');
  });

  // ─── 真实用户 simulation（DB 实证）────────────────────────────────

  it('simulates user 18780216 (xai BYOK only, no openai)', () => {
    // DB enabled: 3 OpenAI + 1 Cohere (system)
    // User has: cohere + xai + voyage PERSONAL keys
    // BYOK_DEFAULT_MODELS[xai] generates xai models with isUserKey=true
    const models: AIModel[] = [
      makeModel({
        id: 'sys-gpt5',
        modelId: 'gpt-5',
        provider: 'OpenAI',
        isDefault: true, // admin marked default
      }),
      makeModel({
        id: 'sys-gpt-mini',
        modelId: 'gpt-5-mini',
        provider: 'OpenAI',
      }),
      makeModel({
        id: 'sys-cohere',
        modelId: 'cohere-r-plus',
        provider: 'Cohere',
        isUserKey: true, // user has cohere key
      }),
      makeModel({
        id: 'byok-xai-grok3',
        modelId: 'grok-3-latest',
        provider: 'xAI',
        isUserKey: true,
      }),
      makeModel({
        id: 'byok-xai-grok4',
        modelId: 'grok-4-reasoning',
        provider: 'xAI',
        isUserKey: true,
      }),
    ];
    // Expected: pick first user-key (cohere/xai), NOT system gpt-5
    const picked = pickPreferredModel(models);
    expect(picked?.isUserKey).toBe(true);
    expect(picked?.id).not.toBe('sys-gpt5'); // 严格 BYOK：不能选系统模型
  });

  it('simulates user 487acfeb (openai PERSONAL + admin OpenAI default)', () => {
    // User configured PERSONAL openai key → admin's OpenAI gpt-5 isDefault
    // becomes isUserKey=true (provider matched)
    const models: AIModel[] = [
      makeModel({
        id: 'sys-gpt5',
        modelId: 'gpt-5',
        provider: 'OpenAI',
        isDefault: true,
        isUserKey: true,
      }),
      makeModel({
        id: 'sys-gpt-mini',
        modelId: 'gpt-5-mini',
        provider: 'OpenAI',
        isUserKey: true,
      }),
      makeModel({
        id: 'sys-cohere',
        modelId: 'cohere-r-plus',
        provider: 'Cohere',
        isUserKey: true,
      }),
    ];
    // All 3 are user-key, gpt-5 is default → should pick gpt-5
    expect(pickPreferredModel(models)?.id).toBe('sys-gpt5');
  });

  it('simulates user with no BYOK (anonymous / fresh signup)', () => {
    // Pure system models, no user keys → fall back to admin default
    const models: AIModel[] = [
      makeModel({
        id: 'sys-gpt5',
        modelId: 'gpt-5',
        provider: 'OpenAI',
        isDefault: true,
      }),
      makeModel({
        id: 'sys-claude',
        modelId: 'claude-4',
        provider: 'Anthropic',
      }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('sys-gpt5');
  });

  // ─── 边界 / 防御性 ───────────────────────────────────────────────

  it('treats undefined isUserKey as false (not as user key)', () => {
    const models: AIModel[] = [
      makeModel({ id: 'a', modelId: 'gpt-5', isDefault: true }),
      makeModel({ id: 'b', modelId: 'grok-3' }),
    ];
    // 都没 isUserKey → 走 isDefault 路径
    expect(pickPreferredModel(models)?.id).toBe('a');
  });

  it('handles all-isUserKey list with no isDefault', () => {
    const models: AIModel[] = [
      makeModel({ id: 'mine-a', modelId: 'grok-3', isUserKey: true }),
      makeModel({ id: 'mine-b', modelId: 'claude-4', isUserKey: true }),
    ];
    expect(pickPreferredModel(models)?.id).toBe('mine-a');
  });

  it('does not pick disabled-looking model erroneously', () => {
    // 100% defensive — even if list mixes types, picker stays simple
    const models: AIModel[] = [
      makeModel({
        id: 'image',
        modelId: 'imagen-3',
        modelType: 'IMAGE_GENERATION',
        isUserKey: true,
      }),
      makeModel({
        id: 'chat',
        modelId: 'gpt-5',
        modelType: 'CHAT',
        isDefault: true,
      }),
    ];
    // pickPreferredModel 不过滤 modelType（调用方负责 filter），picker 只看 isUserKey
    expect(pickPreferredModel(models)?.id).toBe('image');
  });

  it('large list (100 models) — perf sanity', () => {
    const models: AIModel[] = Array.from({ length: 100 }, (_, i) =>
      makeModel({
        id: `m-${i}`,
        modelId: `model-${i}`,
        // 第 50 个是 user-key + isDefault，第 0 个是 admin default
        isDefault: i === 0,
        isUserKey: i === 50,
      })
    );
    // BYOK 命中 → 第 50 个是唯一 user-key，应该选它
    expect(pickPreferredModel(models)?.id).toBe('m-50');
  });

  it('returned model is the same reference (no mutation)', () => {
    const userKeyModel = makeModel({
      id: 'mine',
      modelId: 'grok-3',
      isUserKey: true,
    });
    const models: AIModel[] = [
      makeModel({ id: 'sys', modelId: 'gpt-5', isDefault: true }),
      userKeyModel,
    ];
    expect(pickPreferredModel(models)).toBe(userKeyModel); // same object reference
  });
});

// W4-byok 2026-05-05: User D 体验黑洞修复 — 没 BYOK 用户检测
describe('userHasBYOK (BYOK 配置检测，给 banner 用)', () => {
  it('returns true when at least one model has isUserKey=true', () => {
    const models: AIModel[] = [
      makeModel({ id: 'sys', modelId: 'gpt-5', isDefault: true }),
      makeModel({ id: 'mine', modelId: 'grok-3', isUserKey: true }),
    ];
    expect(userHasBYOK(models)).toBe(true);
  });

  it('returns false when NO model has isUserKey=true (User D scenario)', () => {
    const models: AIModel[] = [
      makeModel({ id: 'sys-a', modelId: 'gpt-5', isDefault: true }),
      makeModel({ id: 'sys-b', modelId: 'claude-4' }),
    ];
    expect(userHasBYOK(models)).toBe(false);
  });

  it('returns false for empty models list (loading / error state)', () => {
    expect(userHasBYOK([])).toBe(false);
  });

  it('returns false for null/undefined input', () => {
    expect(userHasBYOK(null as unknown as AIModel[])).toBe(false);
    expect(userHasBYOK(undefined as unknown as AIModel[])).toBe(false);
  });

  it('isUserKey=undefined is treated as no BYOK', () => {
    const models: AIModel[] = [
      makeModel({ id: 'a', modelId: 'gpt-5' }),
      makeModel({ id: 'b', modelId: 'claude-4' }),
    ];
    // 都没 isUserKey 字段 → 没 BYOK
    expect(userHasBYOK(models)).toBe(false);
  });

  it('isUserKey=false explicit is treated as no BYOK', () => {
    const models: AIModel[] = [
      makeModel({ id: 'a', modelId: 'gpt-5', isUserKey: false }),
    ];
    expect(userHasBYOK(models)).toBe(false);
  });

  it('mixed list with at least one BYOK → true', () => {
    const models: AIModel[] = [
      makeModel({ id: 'a', modelId: 'gpt-5', isUserKey: false }),
      makeModel({ id: 'b', modelId: 'claude-4' }),
      makeModel({ id: 'c', modelId: 'grok-3', isUserKey: true }),
    ];
    expect(userHasBYOK(models)).toBe(true);
  });

  it('simulates User C (xai PERSONAL only) — has BYOK', () => {
    // 后端给所有 xai 模型标 isUserKey=true（包括 BYOK_DEFAULT_MODELS 动态生成）
    const models: AIModel[] = [
      makeModel({ id: 'sys-gpt5', modelId: 'gpt-5', isDefault: true }),
      makeModel({
        id: 'byok-grok',
        modelId: 'grok-3-latest',
        provider: 'xAI',
        isUserKey: true,
      }),
    ];
    expect(userHasBYOK(models)).toBe(true);
  });

  it('simulates User D (no PERSONAL no ASSIGNED) — needs banner', () => {
    // 纯系统模型，没任何 isUserKey
    const models: AIModel[] = [
      makeModel({
        id: 'sys-gpt5',
        modelId: 'gpt-5',
        provider: 'OpenAI',
        isDefault: true,
      }),
      makeModel({
        id: 'sys-cohere',
        modelId: 'cohere-r-plus',
        provider: 'Cohere',
        isDefault: true,
      }),
    ];
    expect(userHasBYOK(models)).toBe(false);
  });

  it('simulates ASSIGNED-only user (admin gave him a DistributableKey)', () => {
    // 后端 union PERSONAL + ASSIGNED → admin 分配的 provider 也标 isUserKey=true
    const models: AIModel[] = [
      makeModel({
        id: 'assigned-openai',
        modelId: 'gpt-5',
        provider: 'OpenAI',
        isUserKey: true, // 来自 keyAssignments
      }),
    ];
    expect(userHasBYOK(models)).toBe(true);
  });
});
