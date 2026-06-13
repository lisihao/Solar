import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSocialCreateStore } from '../socialCreateStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/domain/useAISocial', () => ({
  SocialContentType: {},
  SocialContentSourceType: {},
}));

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useSocialCreateStore.setState({
    currentStep: 1,
    sourceType: null,
    sourceId: null,
    sourceTitle: null,
    externalUrl: '',
    platform: null,
    connectionId: null,
    connectionName: null,
    skipAccount: false,
    title: '',
    content: '',
    digest: '',
    tags: [],
    coverImage: '',
    isProcessing: false,
    isSaving: false,
    isPublishing: false,
    currentContentId: null,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useSocialCreateStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useSocialCreateStore - initial state', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should have correct default values', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    expect(result.current.currentStep).toBe(1);
    expect(result.current.sourceType).toBeNull();
    expect(result.current.sourceId).toBeNull();
    expect(result.current.sourceTitle).toBeNull();
    expect(result.current.externalUrl).toBe('');
    expect(result.current.platform).toBeNull();
    expect(result.current.connectionId).toBeNull();
    expect(result.current.connectionName).toBeNull();
    expect(result.current.skipAccount).toBe(false);
    expect(result.current.title).toBe('');
    expect(result.current.content).toBe('');
    expect(result.current.digest).toBe('');
    expect(result.current.tags).toEqual([]);
    expect(result.current.coverImage).toBe('');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.isPublishing).toBe(false);
    expect(result.current.currentContentId).toBeNull();
  });
});

describe('useSocialCreateStore - setSource', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set sourceType, sourceId, and sourceTitle', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setSource('AI_RESEARCH', 'res-123', 'My Research');
    });

    expect(result.current.sourceType).toBe('AI_RESEARCH');
    expect(result.current.sourceId).toBe('res-123');
    expect(result.current.sourceTitle).toBe('My Research');
  });

  it('should reset platform, connectionId, connectionName, and skipAccount when source changes', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    useSocialCreateStore.setState({
      platform: 'WECHAT_ARTICLE',
      connectionId: 'conn-1',
      connectionName: 'My Account',
      skipAccount: true,
    });

    act(() => {
      result.current.setSource('MANUAL');
    });

    expect(result.current.platform).toBeNull();
    expect(result.current.connectionId).toBeNull();
    expect(result.current.connectionName).toBeNull();
    expect(result.current.skipAccount).toBe(false);
  });

  it('should default id and title to null when not provided', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setSource('MANUAL');
    });

    expect(result.current.sourceId).toBeNull();
    expect(result.current.sourceTitle).toBeNull();
  });

  it('should allow setting null sourceType', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setSource('AI_RESEARCH', 'id-1', 'Title');
    });

    act(() => {
      result.current.setSource(null);
    });

    expect(result.current.sourceType).toBeNull();
  });
});

describe('useSocialCreateStore - setExternalUrl', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update externalUrl', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setExternalUrl('https://example.com/article');
    });

    expect(result.current.externalUrl).toBe('https://example.com/article');
  });
});

describe('useSocialCreateStore - setPlatform', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set the platform and reset account fields', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    useSocialCreateStore.setState({
      connectionId: 'conn-1',
      connectionName: 'Acc',
      skipAccount: true,
    });

    act(() => {
      result.current.setPlatform('WECHAT_ARTICLE');
    });

    expect(result.current.platform).toBe('WECHAT_ARTICLE');
    expect(result.current.connectionId).toBeNull();
    expect(result.current.connectionName).toBeNull();
    expect(result.current.skipAccount).toBe(false);
  });

  it('should allow setting null platform', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setPlatform('WECHAT_ARTICLE');
    });

    act(() => {
      result.current.setPlatform(null);
    });

    expect(result.current.platform).toBeNull();
  });
});

describe('useSocialCreateStore - setConnection', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set connectionId and connectionName', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setConnection('conn-abc', 'My WeChat');
    });

    expect(result.current.connectionId).toBe('conn-abc');
    expect(result.current.connectionName).toBe('My WeChat');
  });

  it('should allow setting null values', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setConnection('conn-1', 'Name');
    });

    act(() => {
      result.current.setConnection(null, null);
    });

    expect(result.current.connectionId).toBeNull();
    expect(result.current.connectionName).toBeNull();
  });
});

describe('useSocialCreateStore - setSkipAccount', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should toggle skipAccount', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setSkipAccount(true);
    });
    expect(result.current.skipAccount).toBe(true);

    act(() => {
      result.current.setSkipAccount(false);
    });
    expect(result.current.skipAccount).toBe(false);
  });
});

describe('useSocialCreateStore - content fields', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update title', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setTitle('My Article Title');
    });
    expect(result.current.title).toBe('My Article Title');
  });

  it('should update content text', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setContentText('Article body text...');
    });
    expect(result.current.content).toBe('Article body text...');
  });

  it('should update digest', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setDigest('Short summary');
    });
    expect(result.current.digest).toBe('Short summary');
  });

  it('should update tags array', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setTags(['AI', 'tech', 'news']);
    });
    expect(result.current.tags).toEqual(['AI', 'tech', 'news']);
  });

  it('should update coverImage', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setCoverImage('https://example.com/cover.jpg');
    });
    expect(result.current.coverImage).toBe('https://example.com/cover.jpg');
  });
});

describe('useSocialCreateStore - status flags', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update isProcessing', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setIsProcessing(true);
    });
    expect(result.current.isProcessing).toBe(true);
  });

  it('should update isSaving', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setIsSaving(true);
    });
    expect(result.current.isSaving).toBe(true);
  });

  it('should update isPublishing', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setIsPublishing(true);
    });
    expect(result.current.isPublishing).toBe(true);
  });

  it('should update currentContentId', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.setCurrentContentId('content-456');
    });
    expect(result.current.currentContentId).toBe('content-456');
  });
});

describe('useSocialCreateStore - setContentFromAI', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set title, content, digest, tags, and contentId from AI data', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setContentFromAI({
        title: 'AI Title',
        content: 'AI Content',
        digest: 'AI Summary',
        tags: ['tag1', 'tag2'],
        contentId: 'ai-content-1',
      });
    });

    expect(result.current.title).toBe('AI Title');
    expect(result.current.content).toBe('AI Content');
    expect(result.current.digest).toBe('AI Summary');
    expect(result.current.tags).toEqual(['tag1', 'tag2']);
    expect(result.current.currentContentId).toBe('ai-content-1');
  });

  it('should use empty defaults when optional fields are absent', () => {
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setContentFromAI({ title: 'T', content: 'C' });
    });

    expect(result.current.digest).toBe('');
    expect(result.current.tags).toEqual([]);
    expect(result.current.currentContentId).toBeNull();
  });
});

describe('useSocialCreateStore - canGoToStep', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should always allow going to step 1', () => {
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(1)).toBe(true);
  });

  it('should allow step 2 when sourceType is MANUAL', () => {
    useSocialCreateStore.setState({ sourceType: 'MANUAL' });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(2)).toBe(true);
  });

  it('should allow step 2 when sourceType is EXTERNAL_URL with non-empty url', () => {
    useSocialCreateStore.setState({
      sourceType: 'EXTERNAL_URL',
      externalUrl: 'https://example.com',
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(2)).toBe(true);
  });

  it('should block step 2 when sourceType is EXTERNAL_URL with empty url', () => {
    useSocialCreateStore.setState({
      sourceType: 'EXTERNAL_URL',
      externalUrl: '',
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(2)).toBe(false);
  });

  it('should allow step 2 when sourceType is non-null and sourceId is non-null', () => {
    useSocialCreateStore.setState({
      sourceType: 'AI_RESEARCH',
      sourceId: 'res-1',
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(2)).toBe(true);
  });

  it('should block step 2 when sourceType is null', () => {
    useSocialCreateStore.setState({ sourceType: null });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(2)).toBe(false);
  });

  it('should allow step 3 when platform is set and step 2 is valid', () => {
    useSocialCreateStore.setState({
      sourceType: 'MANUAL',
      platform: 'WECHAT_ARTICLE',
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(3)).toBe(true);
  });

  it('should block step 3 when platform is null', () => {
    useSocialCreateStore.setState({ sourceType: 'MANUAL', platform: null });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(3)).toBe(false);
  });

  it('should allow step 4 when connectionId is set and steps 2 and 3 are valid', () => {
    useSocialCreateStore.setState({
      sourceType: 'MANUAL',
      platform: 'WECHAT_ARTICLE',
      connectionId: 'conn-1',
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(4)).toBe(true);
  });

  it('should allow step 4 when skipAccount is true', () => {
    useSocialCreateStore.setState({
      sourceType: 'MANUAL',
      platform: 'WECHAT_ARTICLE',
      skipAccount: true,
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(4)).toBe(true);
  });

  it('should block step 4 when neither connectionId nor skipAccount is set', () => {
    useSocialCreateStore.setState({
      sourceType: 'MANUAL',
      platform: 'WECHAT_ARTICLE',
      connectionId: null,
      skipAccount: false,
    });
    const { result } = renderHook(() => useSocialCreateStore());
    expect(result.current.canGoToStep(4)).toBe(false);
  });
});

describe('useSocialCreateStore - setStep', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update currentStep when canGoToStep is satisfied', () => {
    useSocialCreateStore.setState({ sourceType: 'MANUAL' });
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setStep(2);
    });

    expect(result.current.currentStep).toBe(2);
  });

  it('should NOT update currentStep when canGoToStep returns false', () => {
    // No source set, so step 2 is blocked
    const { result } = renderHook(() => useSocialCreateStore());

    act(() => {
      result.current.setStep(2);
    });

    expect(result.current.currentStep).toBe(1); // stays at 1
  });
});

describe('useSocialCreateStore - reset', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should restore all fields to initial values', () => {
    useSocialCreateStore.setState({
      currentStep: 3,
      sourceType: 'AI_RESEARCH',
      sourceId: 'res-1',
      sourceTitle: 'Title',
      externalUrl: 'https://x.com',
      platform: 'WECHAT_ARTICLE',
      connectionId: 'conn-1',
      connectionName: 'WX',
      skipAccount: true,
      title: 'Article',
      content: 'Body',
      digest: 'Digest',
      tags: ['a'],
      coverImage: 'https://img.com',
      isProcessing: true,
      isSaving: true,
      isPublishing: true,
      currentContentId: 'c-1',
    });

    const { result } = renderHook(() => useSocialCreateStore());
    act(() => {
      result.current.reset();
    });

    expect(result.current.currentStep).toBe(1);
    expect(result.current.sourceType).toBeNull();
    expect(result.current.sourceId).toBeNull();
    expect(result.current.platform).toBeNull();
    expect(result.current.connectionId).toBeNull();
    expect(result.current.title).toBe('');
    expect(result.current.tags).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.isPublishing).toBe(false);
  });
});
