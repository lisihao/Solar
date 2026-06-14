'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  Suspense,
  useMemo,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { config } from '@/lib/utils/config';
import AppShell from '@/components/layout/AppShell';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  Sparkles,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states';
import NotesList from '@/components/common/resource-lists/NotesList';
import {
  AIContextBuilder,
  type Resource as AIResource,
} from '@/lib/features/ai-office/context-builder';
import AIMessageRenderer from '@/components/ui/content/AIMessageRenderer';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import KeyMomentsPanel, {
  type KeyMoment,
} from '@/components/explore/youtube/KeyMomentsPanel';
import { SubtitleExportButton } from '@/components/explore/youtube';
import { useAIModels, pickPreferredModel, userHasBYOK } from '@/hooks';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';
import { BYOKRequiredBanner } from '@/components/common/byok/BYOKRequiredBanner';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import {
  fetchTranscriptSmart,
  uploadTranscriptToCache,
  saveTranslationToCache,
  fetchSavedTranslation,
  type TranslatedSegment,
} from '@/lib/features/explore/youtube-transcript';
import ClientDate from '@/components/common/ClientDate';
import { useI18n } from '@/lib/i18n/i18n-context';
import { toast } from '@/stores';

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

// 合并后的语义块
interface MergedSegment {
  text: string;
  start: number;
  duration: number;
  originalIndices: number[]; // 原始segments的索引
  blockIndex: number; // 语义块索引，用于背景色
}

/**
 * 将字幕按句子边界合并成语义块
 * 规则：遇到句末标点（.!?。！？）时结束当前块
 */
function mergeTranscriptBySentence(
  segments: TranscriptSegment[]
): MergedSegment[] {
  if (segments.length === 0) return [];

  const merged: MergedSegment[] = [];
  let currentText = '';
  let currentStart = 0;
  let currentDuration = 0;
  let currentIndices: number[] = [];
  let blockIndex = 0;

  // 句末标点正则
  const sentenceEndPattern = /[.!?。！？][\s]*$/;

  segments.forEach((segment, index) => {
    if (currentIndices.length === 0) {
      currentStart = segment.start;
    }

    let segmentText = (segment.text || '').trim();

    // 清理 YouTube 自动字幕中的各种标记
    // 1. 移除说话人标记 >> 或 > >（YouTube 自动字幕中的说话人切换标记）
    segmentText = segmentText.replace(/^>\s*>\s*/g, '').trim();
    segmentText = segmentText.replace(/>\s*>\s*/g, ' ').trim();

    // 2. 移除字幕开头的 - 符号（YouTube 字幕格式问题）
    if (segmentText.startsWith('- ')) {
      segmentText = segmentText.substring(2);
    } else if (segmentText.startsWith('-')) {
      segmentText = segmentText.substring(1).trim();
    }

    // 3. 移除多余空格
    segmentText = segmentText.replace(/\s+/g, ' ').trim();

    if (!segmentText) {
      // 跳过空文本的segment，但仍然将其包含在当前块的indices中
      currentIndices.push(index);
      return;
    }

    currentText += (currentText ? ' ' : '') + segmentText;
    currentDuration = segment.start + segment.duration - currentStart;
    currentIndices.push(index);

    // 检查是否到达句末或累积文本过长（超过200字符强制换行）
    if (sentenceEndPattern.test(segmentText) || currentText.length > 200) {
      merged.push({
        text: currentText,
        start: currentStart,
        duration: currentDuration,
        originalIndices: [...currentIndices],
        blockIndex: blockIndex++,
      });
      currentText = '';
      currentIndices = [];
    }
  });

  // 处理剩余内容
  if (currentText) {
    merged.push({
      text: currentText,
      start: currentStart,
      duration: currentDuration,
      originalIndices: [...currentIndices],
      blockIndex: blockIndex,
    });
  }

  return merged;
}

// 语义块背景色（柔和的交替色）
const BLOCK_COLORS = ['bg-white', 'bg-slate-50', 'bg-gray-50', 'bg-zinc-50'];

interface Topic {
  title: string;
  timestamp: number;
  color: string;
}

interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface SolarVideoResource {
  id: string;
  title: string;
  abstract?: string;
  content?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  rawData?: {
    description?: string;
    [key: string]: unknown;
  };
}

const getSolarVideoDescription = (
  resource: SolarVideoResource | null | undefined
) => {
  if (!resource) return '';

  const candidates = [
    resource.rawData?.description,
    resource.metadata?.description,
    resource.content,
    resource.abstract,
  ];

  return (
    candidates
      .find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      )
      ?.trim() || ''
  );
};

const normalizeSolarTranscriptText = (value: unknown) => {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\/\/n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const buildTranscriptSegmentsFromSolarText = (
  value: unknown
): TranscriptSegment[] => {
  const lines = normalizeSolarTranscriptText(value)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  lines.forEach((line) => {
    if (current && `${current} ${line}`.length > 260) {
      chunks.push(current);
      current = line;
      return;
    }
    current = current ? `${current} ${line}` : line;
  });

  if (current) chunks.push(current);

  return chunks.map((text, index) => ({
    text,
    start: index * 6,
    duration: 6,
  }));
};

const isTranscriptSegment = (value: unknown): value is TranscriptSegment => {
  if (!value || typeof value !== 'object') return false;
  const segment = value as Partial<TranscriptSegment>;
  return (
    typeof segment.text === 'string' &&
    typeof segment.start === 'number' &&
    typeof segment.duration === 'number'
  );
};

const readTranscriptSegmentsFromArtifact = (
  value: unknown
): TranscriptSegment[] => {
  if (!value || typeof value !== 'object') return [];
  const artifact = value as {
    segments?: unknown;
    transcriptText?: unknown;
    transcript?: unknown;
  };

  if (Array.isArray(artifact.segments)) {
    const segments = artifact.segments.filter(isTranscriptSegment);
    if (segments.length > 0) return segments;
  }

  return buildTranscriptSegmentsFromSolarText(
    artifact.transcriptText || artifact.transcript
  );
};

// 服务端持久化的 chat 消息形态（GET /api/v1/youtube/ai-chat 返回）
interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId: string | null;
  createdAt: string; // ISO
}

async function persistAiChatMessage(
  videoId: string,
  role: 'user' | 'assistant',
  content: string,
  modelId: string | undefined
): Promise<void> {
  try {
    await fetch(`${config.apiBaseUrl}/api/v1/youtube/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ videoId, role, content, modelId }),
    });
  } catch (err) {
    logger.warn('Failed to persist AI chat message:', err);
  }
}

interface CommentUser {
  id: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
}

interface Comment {
  id: string;
  content: string;
  user: CommentUser;
  upvoteCount: number;
  replyCount: number;
  isEdited: boolean;
  createdAt: string;
  replies?: Comment[];
}

type YTPlayer = {
  destroy: () => void;
  getIframe?: () => HTMLIFrameElement;
  loadVideoById: (videoId: string) => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: string | HTMLElement,
        options: {
          videoId: string;
          host?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function YouTubeTLDWContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoId = searchParams?.get('videoId') || '';
  const resourceId = searchParams?.get('resourceId') || '';

  // Auth context for API calls
  const { accessToken } = useAuth();
  const { t } = useI18n();

  // 动态获取 AI 模型列表，显示 CHAT/CHAT_FAST/MULTIMODAL 类型的模型
  const { models: allAiModels } = useAIModels();
  const aiModels = allAiModels.filter(
    (m) =>
      m.modelType === 'CHAT' ||
      m.modelType === 'CHAT_FAST' ||
      m.modelType === 'MULTIMODAL'
  );

  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'transcript' | 'chat' | 'notes' | 'comments'
  >('transcript');
  const [youtubeEmbedError, setYoutubeEmbedError] = useState<
    'embed-blocked' | 'unavailable' | null
  >(null);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);

  // AI interaction states
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiModel, setAiModel] = useState(''); // 将在 aiModels 加载后设置默认值
  const [aiAnalysisUnlocked, setAiAnalysisUnlocked] = useState(false);
  const [solarVideoResource, setSolarVideoResource] =
    useState<SolarVideoResource | null>(null);
  const [solarTranscriptSegments, setSolarTranscriptSegments] = useState<
    TranscriptSegment[]
  >([]);
  const [solarTranscriptLoaded, setSolarTranscriptLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Right panel collapse state
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Translation control states
  const [showTranslation, setShowTranslation] = useState(false);
  const [translations, setTranslations] = useState<Map<number, string>>(
    new Map()
  );
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationProgress, setTranslationProgress] = useState({
    current: 0,
    total: 0,
  });

  const [notesRefreshKey, setNotesRefreshKey] = useState(0);
  const activeAIModel = aiModels.find((m) => m.modelId === aiModel);
  const solarVideoDescription = getSolarVideoDescription(solarVideoResource);
  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const youtubeThumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const isYoutubeEmbedBlocked = youtubeEmbedError === 'embed-blocked';

  useEffect(() => {
    setAiAnalysisUnlocked(false);
    setActiveTab('transcript');
    setAiMessages([]);
    setTranscript([]);
    setTopics([]);
    setTranscriptStatus('');
    setYoutubeEmbedError(null);
  }, [videoId]);

  useEffect(() => {
    if (!videoId) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      youtubeWatchUrl
    )}&format=json`;

    const checkYoutubeEmbedPermission = async () => {
      try {
        const response = await fetch(oEmbedUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (
          !cancelled &&
          !response.ok &&
          (response.status === 401 || response.status === 403)
        ) {
          setYoutubeEmbedError('embed-blocked');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.warn('YouTube oEmbed permission check failed:', error);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void checkYoutubeEmbedPermission();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [videoId, youtubeWatchUrl]);

  useEffect(() => {
    if (!videoId) {
      setSolarVideoResource(null);
      return;
    }

    let cancelled = false;
    setSolarVideoResource(null);

    const readResource = async (url: string) => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;
      const result = await response.json();
      return (result?.data ?? result) as unknown;
    };

    const loadSolarVideoResource = async () => {
      try {
        if (resourceId) {
          const resource = (await readResource(
            `${config.apiUrl}/resources/${resourceId}`
          )) as SolarVideoResource | null;

          if (!cancelled && resource) {
            setSolarVideoResource(resource);
            return;
          }
        }

        const result = await readResource(
          `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=1200&skip=0`
        );
        const rows = Array.isArray(result)
          ? result
          : Array.isArray((result as { data?: unknown[] } | null)?.data)
            ? ((result as { data: unknown[] }).data as unknown[])
            : [];
        const resource = rows.find((row) => {
          const item = row as SolarVideoResource;
          return (
            item.metadata?.videoId === videoId ||
            item.sourceUrl?.includes(`v=${videoId}`)
          );
        }) as SolarVideoResource | undefined;

        if (!cancelled) {
          setSolarVideoResource(resource || null);
        }
      } catch (error) {
        logger.warn('Failed to load Solar YouTube video resource:', error);
        if (!cancelled) {
          setSolarVideoResource(null);
        }
      }
    };

    void loadSolarVideoResource();

    return () => {
      cancelled = true;
    };
  }, [videoId, resourceId]);

  // Key moments states
  const [keyMoments, setKeyMoments] = useState<KeyMoment[]>([]);

  // Comments states
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsTotalCount, setCommentsTotalCount] = useState(0);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const videoShellRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Translation persistence: pending segments waiting to be flushed to server cache
  const pendingTranslationsRef = useRef<Map<number, TranslatedSegment>>(
    new Map()
  );
  // Lock pending queue to a specific videoId so URL-driven videoId switches
  // don't cause us to write old-video translations to the new video's cache
  const pendingVideoIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TRANSLATION_FLUSH_DEBOUNCE_MS = 5000;

  // 合并字幕为语义块
  const mergedTranscript = useMemo(() => {
    return mergeTranscriptBySentence(transcript);
  }, [transcript]);

  // 根据当前播放时间找到活跃的合并块索引
  const activeMergedIndex = useMemo(() => {
    if (mergedTranscript.length === 0 || activeSegmentIndex === -1) return -1;
    return mergedTranscript.findIndex((segment) =>
      segment.originalIndices.includes(activeSegmentIndex)
    );
  }, [mergedTranscript, activeSegmentIndex]);

  // 设置默认 AI 模型 — 严格 BYOK：用户 key 模型优先（pickPreferredModel）
  useEffect(() => {
    if (aiModels.length > 0 && !aiModel) {
      const defaultModel = pickPreferredModel(aiModels);
      if (defaultModel) setAiModel(defaultModel.modelId);
    }
  }, [aiModels, aiModel]);

  // Initialize YouTube Player
  useEffect(() => {
    if (!videoId) return;

    const loadYouTubeAPI = () => {
      if (window.YT) {
        initializePlayer();
        return;
      }

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        initializePlayer();
      };
    };

    const initializePlayer = () => {
      if (!playerContainerRef.current) return;

      playerRef.current = new window.YT!.Player(playerContainerRef.current, {
        videoId: videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 0,
          controls: 1,
          enablejsapi: 1,
          modestbranding: 1,
          origin: window.location.origin,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            const iframe = event.target.getIframe?.();
            iframe?.setAttribute(
              'allow',
              'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
            );
            iframe?.setAttribute('allowfullscreen', 'true');
            iframe?.setAttribute('title', `YouTube video ${videoId}`);
            setYoutubeEmbedError((current) =>
              current === 'embed-blocked' ? current : null
            );
            startPlaybackTracking();
          },
          onError: (event) => {
            const errorCode = Number(event.data);
            setYoutubeEmbedError(
              errorCode === 101 || errorCode === 150
                ? 'embed-blocked'
                : 'unavailable'
            );
          },
        },
      });
    };

    loadYouTubeAPI();

    return () => {
      stopPlaybackTracking();
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (err) {
          logger.error('Failed to destroy player', err);
        }
      }
    };
  }, [videoId]);

  const startPlaybackTracking = useCallback(() => {
    if (playbackIntervalRef.current) return;

    playbackIntervalRef.current = setInterval(() => {
      if (playerRef.current) {
        try {
          const time = playerRef.current.getCurrentTime();
          setCurrentTime(time);
        } catch (err) {
          // Ignore errors
        }
      }
    }, 500);
  }, []);

  const stopPlaybackTracking = useCallback(() => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
  }, []);

  const toggleVideoFullscreen = useCallback(async () => {
    if (videoFullscreen && !document.fullscreenElement) {
      setVideoFullscreen(false);
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }

    const shell = videoShellRef.current;
    if (!shell) return;

    try {
      await shell.requestFullscreen?.();
    } catch (error) {
      logger.warn('Native fullscreen request failed:', error);
      setVideoFullscreen(true);
    }
  }, [videoFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setVideoFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    setSolarTranscriptSegments([]);
    setSolarTranscriptLoaded(false);

    if (!videoId) {
      setSolarTranscriptLoaded(true);
      return;
    }

    let cancelled = false;
    const metadata = solarVideoResource?.metadata || {};
    const embeddedSegments = buildTranscriptSegmentsFromSolarText(
      metadata.solarTranscript
    );
    const metadataTranscriptUrl =
      typeof metadata.solarTranscriptUrl === 'string'
        ? metadata.solarTranscriptUrl
        : '';
    const transcriptUrls = Array.from(
      new Set(
        [
          metadataTranscriptUrl,
          `/local-data/solar-youtube-transcripts/${encodeURIComponent(
            videoId
          )}.json`,
        ].filter(Boolean)
      )
    );

    const loadSolarTranscript = async () => {
      if (embeddedSegments.length > 0) {
        if (!cancelled) {
          setSolarTranscriptSegments(embeddedSegments);
          setSolarTranscriptLoaded(true);
        }
        return;
      }

      for (const transcriptUrl of transcriptUrls) {
        try {
          const response = await fetch(transcriptUrl, { cache: 'no-store' });
          if (!response.ok) continue;
          const artifact = await response.json();
          const segments = readTranscriptSegmentsFromArtifact(artifact);
          if (segments.length > 0) {
            if (!cancelled) {
              setSolarTranscriptSegments(segments);
              setSolarTranscriptLoaded(true);
            }
            return;
          }
        } catch (error) {
          logger.warn('Failed to load Solar YouTube transcript:', error);
        }
      }

      if (!cancelled) {
        setSolarTranscriptSegments([]);
        setSolarTranscriptLoaded(true);
      }
    };

    void loadSolarTranscript();

    return () => {
      cancelled = true;
    };
  }, [videoId, solarVideoResource]);

  // Fetch transcript status
  const [transcriptStatus, setTranscriptStatus] = useState<string>('');

  // Fetch transcript using smart fetching (server first, then client fallback)
  useEffect(() => {
    if (!videoId) return;

    const mockTopics: Topic[] = [
      {
        title: 'Organizing your closet feels like shopping.',
        timestamp: 48,
        color: 'bg-orange-400',
      },
      {
        title: 'Fans: Underrated comfort saving money and planet.',
        timestamp: 61,
        color: 'bg-purple-400',
      },
      {
        title: 'Digital detox: an eye-opening monthly reset.',
        timestamp: 55,
        color: 'bg-red-400',
      },
      {
        title: 'A better desk chair boosts motivation.',
        timestamp: 56,
        color: 'bg-green-400',
      },
    ];

    if (!solarTranscriptLoaded) {
      setLoading(true);
      setTranscriptStatus('正在加载 Solar-harness 字幕...');
      return;
    }

    if (solarTranscriptSegments.length > 0) {
      setTranscript(solarTranscriptSegments);
      setTranscriptStatus(
        `已从 Solar-harness 获取字幕（${solarTranscriptSegments.length} 段）`
      );
      setTopics(mockTopics);
      setLoading(false);
      return;
    }

    const fetchTranscriptData = async () => {
      setLoading(true);
      setTranscriptStatus('正在获取字幕...');

      try {
        // 使用智能获取：先服务器，失败则客户端获取并缓存
        const result = await fetchTranscriptSmart(
          videoId,
          config.apiBaseUrl,
          'en',
          setTranscriptStatus
        );

        if (result && result.transcript.length > 0) {
          setTranscript(result.transcript);
          setTranscriptStatus(
            result.source === 'cache'
              ? '已从缓存获取'
              : result.source === 'client'
                ? '已通过客户端获取'
                : '已获取字幕'
          );

          setTopics(mockTopics);
        } else {
          setTranscriptStatus('暂无字幕');
        }
      } catch (error) {
        logger.error('Failed to fetch transcript:', error);
        setTranscriptStatus('获取字幕失败');
      } finally {
        setLoading(false);
      }
    };

    fetchTranscriptData();
  }, [videoId, solarTranscriptLoaded, solarTranscriptSegments]);

  // Fetch comments when tab is switched to comments
  const fetchComments = useCallback(async () => {
    if (!videoId) return;

    setCommentsLoading(true);
    setCommentsError(null);

    try {
      const source = `youtube:${videoId}`;
      const [commentsRes, statsRes] = await Promise.all([
        fetch(
          `${config.apiBaseUrl}/api/v1/comments/source/${encodeURIComponent(source)}`
        ),
        fetch(
          `${config.apiBaseUrl}/api/v1/comments/source/${encodeURIComponent(source)}/stats`
        ),
      ]);

      if (commentsRes.ok) {
        const result = await commentsRes.json();
        // API returns { success, data: [...] } format
        const data = result?.data ?? result;
        setComments(Array.isArray(data) ? data : []);
      } else {
        setCommentsError('Failed to load comments');
      }

      if (statsRes.ok) {
        const result = await statsRes.json();
        // API returns { success, data: { total } } format
        const stats = result?.data ?? result;
        setCommentsTotalCount(stats.total || 0);
      }
    } catch (error) {
      logger.error('Failed to fetch comments:', error);
      setCommentsError('Failed to load comments. Please try again.');
    } finally {
      setCommentsLoading(false);
    }
  }, [videoId]);

  // Load comments when tab changes to comments
  useEffect(() => {
    if (activeTab === 'comments') {
      fetchComments();
    }
  }, [activeTab, fetchComments]);

  // Submit a new comment
  const submitComment = async () => {
    if (!newComment.trim() || !videoId || !accessToken) return;

    setSubmittingComment(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: `youtube:${videoId}`,
          content: newComment.trim(),
        }),
      });

      if (response.ok) {
        setNewComment('');
        fetchComments(); // Refresh comments
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to post comment');
      }
    } catch (error) {
      logger.error('Failed to submit comment:', error);
      toast.error('Failed to post comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Upvote a comment
  const upvoteComment = async (commentId: string) => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/comments/${commentId}/upvote`,
        { method: 'POST' }
      );
      if (response.ok) {
        // Update local state
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId ? { ...c, upvoteCount: c.upvoteCount + 1 } : c
          )
        );
      }
    } catch (error) {
      logger.error('Failed to upvote:', error);
    }
  };

  // Track active segment
  useEffect(() => {
    if (!transcript || transcript.length === 0) {
      setActiveSegmentIndex(-1);
      return;
    }

    const nextIndex = transcript.findIndex((segment, index) => {
      const start = segment.start;
      const nextSegment = transcript[index + 1];
      const end = nextSegment?.start ?? segment.start + segment.duration;
      return currentTime >= start && currentTime < end;
    });

    if (nextIndex !== -1 && nextIndex !== activeSegmentIndex) {
      setActiveSegmentIndex(nextIndex);
    }
  }, [currentTime, transcript, activeSegmentIndex]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (!autoScroll || activeSegmentIndex < 0) return;

    if (activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeSegmentIndex, autoScroll]);

  // Generate key moments from transcript
  useEffect(() => {
    if (!transcript || transcript.length === 0) {
      setKeyMoments([]);
      return;
    }

    // Generate mock key moments based on transcript segments
    // In production, this would come from AI analysis
    const moments: KeyMoment[] = [
      {
        id: '1',
        timestamp: transcript[Math.floor(transcript.length * 0.1)]?.start || 0,
        title: 'Introduction & Overview',
        summary: 'Opening remarks and introduction to the main topic',
        importance: 'high',
        tags: ['intro', 'overview'],
      },
      {
        id: '2',
        timestamp: transcript[Math.floor(transcript.length * 0.3)]?.start || 0,
        title: 'Key Concept Explanation',
        summary: 'Detailed explanation of the core concept',
        importance: 'high',
        tags: ['concept', 'explanation'],
      },
      {
        id: '3',
        timestamp: transcript[Math.floor(transcript.length * 0.5)]?.start || 0,
        title: 'Practical Examples',
        summary: 'Real-world examples and use cases',
        importance: 'medium',
        tags: ['examples', 'practical'],
      },
      {
        id: '4',
        timestamp: transcript[Math.floor(transcript.length * 0.7)]?.start || 0,
        title: 'Advanced Topics',
        summary: 'Deep dive into advanced techniques',
        importance: 'medium',
        tags: ['advanced', 'techniques'],
      },
      {
        id: '5',
        timestamp: transcript[Math.floor(transcript.length * 0.9)]?.start || 0,
        title: 'Summary & Conclusion',
        summary: 'Recap of key points and final thoughts',
        importance: 'high',
        tags: ['summary', 'conclusion'],
      },
    ];

    setKeyMoments(moments);
  }, [transcript]);

  const handleSeekToTopic = (timestamp: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(timestamp, true);
      playerRef.current.playVideo();
    }
  };

  const handleSeekToSegment = (start: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(start, true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages]);

  // Load persisted AI chat history when (videoId, accessToken) changes.
  // Anon users (no token) keep an empty in-memory log only.
  useEffect(() => {
    if (!videoId || !accessToken || !aiAnalysisUnlocked) {
      setAiMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/youtube/ai-chat?videoId=${encodeURIComponent(videoId)}`,
          { headers: { ...getAuthHeader() } }
        );
        if (!res.ok) return;
        const result = await res.json();
        const data = result?.data ?? result;
        const messages: PersistedChatMessage[] = Array.isArray(data?.messages)
          ? data.messages
          : [];
        if (cancelled) return;
        setAiMessages(
          messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt),
          }))
        );
      } catch (err) {
        logger.warn('Failed to load AI chat history:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, accessToken, aiAnalysisUnlocked]);

  // Clear persisted AI chat history (per user × videoId)
  const clearAIChatHistory = useCallback(async () => {
    if (!videoId) return;
    if (!accessToken) {
      setAiMessages([]);
      return;
    }
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/youtube/ai-chat/${encodeURIComponent(videoId)}`,
        { method: 'DELETE', headers: { ...getAuthHeader() } }
      );
      if (!res.ok) {
        toast.error('清空失败');
        return;
      }
      setAiMessages([]);
      toast.success('已清空对话');
    } catch (err) {
      logger.error('Failed to clear chat history:', err);
      toast.error('清空失败');
    }
  }, [videoId, accessToken]);

  /**
   * Save selected AI-chat text to notes. Invoked by TextSelectionToolbar
   * when the user picks "Add to Notes" from the floating selection toolbar
   * — so the browser's native right-click menu (copy / search / inspect)
   * stays untouched.
   */
  const saveTextToNotes = useCallback(
    async (text: string) => {
      if (!videoId) return;
      const content = text?.trim();
      if (!content) return;

      if (!accessToken) {
        toast.warning('Please sign in to save notes');
        return;
      }

      try {
        // Note: YouTube videoId is not a UUID — persist via the `source` field
        // rather than a resourceId link.
        const response = await fetch(`${config.apiBaseUrl}/api/v1/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
            source: `youtube:${videoId}`,
            tags: ['AI-Generated', 'YouTube', videoId],
            isPublic: false,
          }),
        });

        if (response.ok) {
          setNotesRefreshKey((prev) => prev + 1);
          toast.success('已添加到笔记');
        } else {
          const errorData: { message?: string } = await response
            .json()
            .catch(() => ({ message: undefined }));
          logger.error('Failed to save note:', {
            status: response.status,
            error: errorData,
          });
          toast.error(
            `Failed to save note: ${errorData.message || 'Unknown error'}`
          );
        }
      } catch (error) {
        logger.error('Failed to save note:', error);
        toast.error('Failed to save note');
      }
    },
    [videoId, accessToken]
  );

  // Send AI message with video context
  const sendAIMessage = async (inputOverride?: string) => {
    const currentInput = (inputOverride || aiInput).trim();
    if (!currentInput || !videoId) return;
    if (!aiAnalysisUnlocked && !inputOverride) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
    };

    setAiMessages((prev) => [...prev, userMessage]);
    setAiInput('');
    setAiAnalysisUnlocked(true);
    setIsStreaming(true);

    // 持久化：登录用户的消息写库（fire-and-forget，失败不阻塞 UI）
    if (accessToken) {
      void persistAiChatMessage(videoId, 'user', currentInput, undefined);
    }

    // 累积 assistant 内容，stream 正常结束后再 POST，避免每个 chunk 一次写
    let assistantContent = '';
    let streamFailed = false;

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Build context for YouTube video
      const transcriptText = transcript
        .map((seg) => `[${formatTime(seg.start)}] ${seg.text}`)
        .join('\n');

      let context = `=== RESOURCE TYPE: YouTube Video ===\n\n`;
      context += `VIDEO ID: ${videoId}\n`;
      context += `CURRENT PLAYBACK TIME: ${formatTime(currentTime)}\n\n`;

      if (solarVideoResource?.title) {
        context += `SOLAR-HARNESS TITLE: ${solarVideoResource.title}\n\n`;
      }

      if (solarVideoDescription) {
        context += `SOLAR-HARNESS COLLECTED DESCRIPTION:\n${solarVideoDescription.substring(0, 5000)}\n\n`;
      }

      if (transcriptText) {
        context += `VIDEO TRANSCRIPT:\n${transcriptText.substring(0, 15000)}\n\n`;
      }

      if (topics.length > 0) {
        context += `VIDEO TOPICS:\n`;
        topics.forEach((topic) => {
          context += `- [${formatTime(topic.timestamp)}] ${topic.title}\n`;
        });
      }

      // BYOK: Include auth header so backend can use user's personal API key
      const res = await fetch('/api/ai-service/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          message: currentInput,
          context: context,
          model: aiModel,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) throw new Error('Failed to fetch');

      // Handle SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      const assistantMessage: AIMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setAiMessages((prev) => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                assistantContent += parsed.content;
                setAiMessages((prev) => {
                  const newMessages = [...prev];
                  // Always update the last message (assistant's response)
                  const lastIndex = newMessages.length - 1;
                  if (
                    lastIndex >= 0 &&
                    newMessages[lastIndex].role === 'assistant'
                  ) {
                    newMessages[lastIndex] = {
                      ...newMessages[lastIndex],
                      content: newMessages[lastIndex].content + parsed.content,
                    };
                  }
                  return newMessages;
                });
              }
            } catch (e) {
              logger.debug('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: unknown) {
      streamFailed = true;
      // Check if it was an abort
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('AI message streaming was stopped by user');
        // 用户主动停止：仍持久化已收到的部分（如果非空），保留对话连续性
        if (accessToken && assistantContent) {
          void persistAiChatMessage(
            videoId,
            'assistant',
            assistantContent,
            aiModel || undefined
          );
        }
        return;
      }
      logger.error('Failed to send message:', error);
      const errorMessage: AIMessage = {
        role: 'assistant',
        content: 'AI 服务暂时不可用，请稍后重试。如果问题持续，请联系管理员。',
        timestamp: new Date(),
      };
      setAiMessages((prev) => [...prev, errorMessage]);
      // 不持久化错误占位文案，避免污染历史
    } finally {
      // 正常完成：persist 完整 assistant 内容
      if (!streamFailed && accessToken && assistantContent) {
        void persistAiChatMessage(
          videoId,
          'assistant',
          assistantContent,
          aiModel || undefined
        );
      }
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const startAIAnalysis = () => {
    setActiveTab('chat');
    setAiAnalysisUnlocked(true);
    void sendAIMessage(
      '请基于 Solar-harness 采集到的视频介绍和当前可用字幕，做一份中文结构化解读：核心观点、关键技术、值得关注的人或机构、可追踪的问题，以及我下一步应该重点看哪些片段。'
    );
  };

  // Stop AI streaming
  const stopAIStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  // Flush pending translations to server cache (global shared, all users benefit)
  // Uses pendingVideoIdRef (not closure videoId) so a videoId switch that races
  // with the flush still writes to the original video's cache.
  const flushPendingTranslations = useCallback(async () => {
    const ownerVideoId = pendingVideoIdRef.current;
    if (!ownerVideoId || pendingTranslationsRef.current.size === 0) return;
    const pending = Array.from(pendingTranslationsRef.current.values());
    pendingTranslationsRef.current = new Map();
    pendingVideoIdRef.current = null;
    try {
      const ok = await saveTranslationToCache(
        ownerVideoId,
        pending,
        'zh-CN',
        config.apiBaseUrl
      );
      if (!ok) {
        // re-queue under the same owner so retry stays on the right video
        if (!pendingVideoIdRef.current)
          pendingVideoIdRef.current = ownerVideoId;
        for (const seg of pending) {
          if (pendingTranslationsRef.current.size < 500) {
            pendingTranslationsRef.current.set(seg.start, seg);
          }
        }
        logger.warn(
          `Failed to persist ${pending.length} translation segments for ${ownerVideoId}, re-queued`
        );
      } else {
        logger.debug(
          `Persisted ${pending.length} translation segments for ${ownerVideoId}`
        );
      }
    } catch (e) {
      logger.error('flushPendingTranslations error:', e);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flushPendingTranslations();
    }, TRANSLATION_FLUSH_DEBOUNCE_MS);
  }, [flushPendingTranslations]);

  // Preload saved translations when video / merged transcript becomes available
  useEffect(() => {
    if (!videoId || mergedTranscript.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await fetchSavedTranslation(videoId, config.apiBaseUrl);
        if (cancelled || !saved || saved.length === 0) return;

        // Match each saved chinese segment to merged index by closest start time
        const startToIndex = new Map<number, number>();
        mergedTranscript.forEach((m, i) => startToIndex.set(m.start, i));

        const next = new Map<number, string>();
        for (const seg of saved) {
          // exact match first
          if (startToIndex.has(seg.start)) {
            next.set(startToIndex.get(seg.start)!, seg.text);
            continue;
          }
          // fallback: find merged segment whose [start, start+duration) contains seg.start
          const idx = mergedTranscript.findIndex(
            (m) => seg.start >= m.start && seg.start < m.start + m.duration
          );
          if (idx >= 0) next.set(idx, seg.text);
        }
        if (next.size > 0) {
          setTranslations((prev) => {
            const merged = new Map(prev);
            next.forEach((v, k) => {
              if (!merged.has(k)) merged.set(k, v);
            });
            return merged;
          });
          logger.debug(
            `Preloaded ${next.size} cached translations for ${videoId}`
          );
        }
      } catch (e) {
        logger.warn('Preload saved translation failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, mergedTranscript]);

  // Translate current merged segment when it's played (on-demand translation)
  useEffect(() => {
    const translateCurrentMergedSegment = async () => {
      if (
        !showTranslation ||
        activeMergedIndex === -1 ||
        mergedTranscript.length === 0
      )
        return;

      // Check if already translated (use merged index as key)
      if (translations.has(activeMergedIndex)) return;

      const currentMerged = mergedTranscript[activeMergedIndex];
      if (!currentMerged || !currentMerged.text) return;

      setTranslationLoading(true);
      try {
        // BYOK: Include auth header so backend can use user's personal API key
        const res = await fetch('/api/ai-service/ai/translate-single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            text: currentMerged.text,
            targetLanguage: 'zh-CN',
          }),
        });

        if (!res.ok) {
          throw new Error('Failed to translate');
        }

        const result = await res.json();
        // API returns { success, data: { translation } } format
        const data = result?.data ?? result;
        const translatedText = data.translation || currentMerged.text;

        // Update translations map using merged index
        setTranslations((prev) => {
          const newMap = new Map(prev);
          newMap.set(activeMergedIndex, translatedText);
          return newMap;
        });

        // Queue for global cache persistence (skip if AI returned empty/fallback)
        if (data.translation) {
          // If the queue already belongs to a different video (URL switched),
          // flush old owner first to avoid cross-contamination.
          if (
            pendingVideoIdRef.current &&
            pendingVideoIdRef.current !== videoId
          ) {
            void flushPendingTranslations();
          }
          pendingVideoIdRef.current = videoId;
          pendingTranslationsRef.current.set(currentMerged.start, {
            text: currentMerged.text,
            start: currentMerged.start,
            duration: currentMerged.duration,
            translatedText,
          });
          scheduleFlush();
        }

        logger.debug(
          `Translated merged segment ${activeMergedIndex}: "${currentMerged.text.substring(0, 50)}..." -> "${data.translation?.substring(0, 50)}..."`
        );
      } catch (error: unknown) {
        logger.error(
          'Failed to translate segment:',
          error instanceof Error ? error.message : String(error)
        );
        // Fallback to original text on error
        setTranslations((prev) => {
          const newMap = new Map(prev);
          newMap.set(activeMergedIndex, currentMerged.text);
          return newMap;
        });
      } finally {
        setTranslationLoading(false);
      }
    };

    translateCurrentMergedSegment();
  }, [
    showTranslation,
    activeMergedIndex,
    mergedTranscript,
    translations,
    scheduleFlush,
    videoId,
    flushPendingTranslations,
  ]);

  // Flush pending translations on unload / tab hidden / unmount
  useEffect(() => {
    const flushNow = () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      void flushPendingTranslations();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
      flushNow();
    };
  }, [flushPendingTranslations]);

  if (!videoId) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-600">
              {t('youtube.emptyState.noVideo')}
            </p>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Main Content - 2 Column Layout */}
      <main className="flex min-h-0 flex-1 overflow-hidden overflow-x-hidden">
        {/* Left Column - Video & Topics */}
        <div
          className={`flex min-h-0 flex-col overflow-y-auto border-r border-gray-200 p-4 transition-all duration-300 ${
            rightPanelCollapsed ? 'w-full' : 'w-1/2'
          }`}
        >
          {/* Back Button */}
          <button
            onClick={() => router.push('/explore?tab=youtube')}
            className="mb-4 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
          >
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span>返回 YouTube 列表</span>
          </button>

          {/* Video Player */}
          <div
            ref={videoShellRef}
            className={`relative mb-6 overflow-hidden rounded-lg bg-black ${
              videoFullscreen
                ? 'fixed inset-0 z-50 mb-0 flex items-center justify-center rounded-none p-4'
                : ''
            }`}
          >
            <div
              className={`aspect-video w-full overflow-hidden rounded-lg bg-black ${
                isYoutubeEmbedBlocked
                  ? 'pointer-events-none opacity-0'
                  : ''
              }`}
            >
              <div ref={playerContainerRef} className="h-full w-full" />
            </div>

            {isYoutubeEmbedBlocked ? null : (
              <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-end gap-2">
                <a
                  href={youtubeWatchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md bg-black/70 px-3 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/85"
                >
                  <ExternalLink className="h-4 w-4" />
                  YouTube
                </a>
                <button
                  type="button"
                  onClick={toggleVideoFullscreen}
                  className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md bg-black/70 px-3 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/85"
                  aria-label={videoFullscreen ? '退出全屏' : '全屏播放'}
                  title={videoFullscreen ? '退出全屏' : '全屏播放'}
                >
                  {videoFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                  {videoFullscreen ? '退出' : '全屏'}
                </button>
              </div>
            )}

            {isYoutubeEmbedBlocked ? (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center bg-black px-6 text-center text-white"
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.88), rgba(0,0,0,.72)), url("${youtubeThumbnailUrl}")`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                }}
              >
                <div className="max-w-lg">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-950/40">
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <h2 className="text-xl font-bold">
                    该视频不能在 GenesisPod 内播放
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-gray-100">
                    YouTube 视频所有者禁止站外嵌入。这里保留字幕、关键时刻、笔记和 AI 解读；观看原视频请打开 YouTube。
                  </p>
                  <a
                    href={youtubeWatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-950/30 transition-colors hover:bg-red-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    在 YouTube 打开
                  </a>
                </div>
              </div>
            ) : null}

            {!isYoutubeEmbedBlocked && youtubeEmbedError ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-6 text-center text-white">
                <div className="max-w-md">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-600">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <h2 className="text-base font-semibold">
                    视频暂时无法播放
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-gray-200">
                    YouTube 返回了播放器错误。请稍后重试，或直接打开
                    YouTube 原视频。
                  </p>
                  <a
                    href={youtubeWatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    在 YouTube 上观看
                  </a>
                </div>
              </div>
            ) : null}
          </div>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                Solar-harness 视频介绍
              </span>
              {typeof solarVideoResource?.metadata?.channelName ===
                'string' && (
                <span>{String(solarVideoResource.metadata.channelName)}</span>
              )}
            </div>
            <h1 className="line-clamp-2 text-lg font-semibold text-gray-900">
              {solarVideoResource?.title || `YouTube 视频 ${videoId}`}
            </h1>
            <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-gray-700">
              {solarVideoDescription || 'Solar-harness 暂未采集到该视频介绍'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={startAIAnalysis}
                disabled={isStreaming}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                {isStreaming ? 'AI 正在解读...' : '开始 AI 解读'}
              </button>
              <span className="text-xs text-gray-500">
                不会在打开视频时自动调用模型
              </span>
            </div>
          </section>

          {/* Key Moments Section - Below Video */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">关键时刻</h3>
                  <p className="text-xs text-gray-500">
                    {keyMoments.length} 个重点
                  </p>
                </div>
              </div>
            </div>

            {/* Key Moments List */}
            <div className="p-3">
              {keyMoments.length === 0 ? (
                <EmptyState size="sm" type="search" title="暂无关键时刻" />
              ) : (
                <div className="space-y-2">
                  {keyMoments.map((moment) => {
                    const isActive =
                      currentTime >= moment.timestamp &&
                      (keyMoments.find((m) => m.timestamp > currentTime)
                        ?.timestamp || Infinity) > moment.timestamp;

                    const importanceConfig = {
                      high: {
                        icon: '■',
                        color: 'bg-blue-50 border-blue-200 text-blue-900',
                        badgeColor: 'bg-blue-600 text-white',
                        hoverColor: 'hover:border-blue-300 hover:bg-blue-100',
                      },
                      medium: {
                        icon: '■',
                        color: 'bg-slate-50 border-slate-200 text-slate-900',
                        badgeColor: 'bg-slate-500 text-white',
                        hoverColor: 'hover:border-slate-300 hover:bg-slate-100',
                      },
                      low: {
                        icon: '■',
                        color: 'bg-gray-50 border-gray-200 text-gray-700',
                        badgeColor: 'bg-gray-400 text-white',
                        hoverColor: 'hover:border-gray-300 hover:bg-gray-100',
                      },
                    };

                    const config = importanceConfig[moment.importance];

                    return (
                      <div
                        key={moment.id}
                        onClick={() => {
                          if (playerRef.current) {
                            playerRef.current.seekTo(moment.timestamp, true);
                          }
                        }}
                        className={`group cursor-pointer rounded-lg border-2 p-3 transition-all ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 shadow-md'
                            : `${config.color} ${config.hoverColor}`
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xl">{config.icon}</span>
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-bold ${
                                isActive
                                  ? 'bg-blue-600 text-white'
                                  : config.badgeColor
                              }`}
                            >
                              {formatTime(moment.timestamp)}
                            </span>
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4
                              className={`text-sm font-semibold leading-snug ${
                                isActive ? 'text-blue-900' : 'text-gray-900'
                              }`}
                            >
                              {moment.title}
                            </h4>

                            {moment.summary && (
                              <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                                {moment.summary}
                              </p>
                            )}

                            {moment.tags && moment.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {moment.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium text-gray-700"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Transcript */}
        {!rightPanelCollapsed && (
          <div className="flex min-h-0 w-1/2 flex-col overflow-hidden">
            {/* Tabs Header */}
            <div className="border-b border-gray-100 bg-gray-50 px-2 py-2">
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={() => setActiveTab('transcript')}
                    className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                      activeTab === 'transcript'
                        ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                        : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                    }`}
                  >
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
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <span className="leading-tight">Transcript</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                      activeTab === 'chat'
                        ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                        : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                    }`}
                  >
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
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                    <span className="leading-tight">AI Chat</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                      activeTab === 'notes'
                        ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                        : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                    }`}
                  >
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
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    <span className="leading-tight">Notes</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('comments')}
                    className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                      activeTab === 'comments'
                        ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                        : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                    }`}
                  >
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
                        d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                      />
                    </svg>
                    <span className="leading-tight">Comments</span>
                  </button>
                </div>

                {/* Toggle Buttons Group */}
                <div className="flex items-center gap-1">
                  {/* Translation Toggle */}
                  <button
                    onClick={() => {
                      const newShowTranslation = !showTranslation;
                      setShowTranslation(newShowTranslation);
                      // 重新打开翻译时，清除缓存以便重新翻译
                      if (newShowTranslation) {
                        setTranslations(new Map());
                      }
                    }}
                    className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      showTranslation
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                      />
                    </svg>
                    <span>翻译</span>
                    <div
                      className={`h-4 w-8 rounded-full transition-colors ${
                        showTranslation ? 'bg-purple-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                          showTranslation ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </button>

                  {/* Auto Scroll Toggle */}
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      autoScroll
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <span>Auto</span>
                    <div
                      className={`h-4 w-8 rounded-full transition-colors ${
                        autoScroll ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                          autoScroll ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </button>

                  {/* Subtitle Export Button - pass local merged transcript + translations
                      so the PDF includes Chinese even when translations were only
                      computed on-demand in the UI (not saved to backend). */}
                  <SubtitleExportButton
                    videoId={videoId}
                    variant="icon"
                    englishSegments={mergedTranscript.map((m) => ({
                      text: m.text,
                      start: m.start,
                      duration: m.duration,
                    }))}
                    chineseSegments={mergedTranscript.map((m, i) => ({
                      text: translations.get(i) ?? '',
                      start: m.start,
                      duration: m.duration,
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Transcript Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'transcript' && (
                <div className="space-y-0">
                  {loading ? (
                    <LoadingState
                      size="md"
                      text={transcriptStatus || '加载字幕中...'}
                    />
                  ) : mergedTranscript.length === 0 ? (
                    <EmptyState
                      size="sm"
                      icon={<FileText className="h-8 w-8" />}
                      title="暂无字幕"
                      description="该视频可能没有字幕，或字幕暂时无法获取"
                      action={
                        videoId ? (
                          <a
                            href={`https://www.youtube.com/watch?v=${videoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-600"
                          >
                            <svg
                              className="h-3 w-3"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                            </svg>
                            在 YouTube 上观看
                          </a>
                        ) : undefined
                      }
                    />
                  ) : (
                    mergedTranscript.map((segment, index) => {
                      const isActive = index === activeMergedIndex;
                      const bgColor =
                        BLOCK_COLORS[segment.blockIndex % BLOCK_COLORS.length];
                      return (
                        <div
                          key={`merged-${segment.start}-${index}`}
                          ref={isActive ? activeSegmentRef : null}
                          onClick={() => handleSeekToSegment(segment.start)}
                          className={`group cursor-pointer px-3 py-3 text-sm transition-all duration-200 ${bgColor} ${
                            isActive
                              ? 'border-l-4 border-red-500 shadow-sm'
                              : 'border-l-4 border-transparent hover:brightness-95'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`flex-shrink-0 text-xs font-medium ${
                                isActive ? 'text-red-600' : 'text-gray-400'
                              }`}
                            >
                              {formatTime(segment.start)}
                            </span>
                            <div className="flex-1">
                              <div
                                className={`leading-relaxed ${
                                  isActive
                                    ? 'font-medium text-gray-900'
                                    : 'text-gray-700'
                                }`}
                              >
                                {segment.text}
                              </div>
                              {showTranslation && (
                                <div className="mt-1.5 text-sm leading-relaxed text-blue-600">
                                  {/* 使用合并块索引获取翻译 */}
                                  {translationLoading && isActive
                                    ? '翻译中...'
                                    : translations.get(index) ||
                                      (isActive ? '' : '')}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activeTab === 'chat' && (
                <div className="flex h-full flex-col">
                  {!aiAnalysisUnlocked ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-base font-semibold text-gray-900">
                          AI 解读未启动
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                          打开视频只加载播放器、字幕和 Solar-harness
                          采集介绍。点击按钮后才会调用模型分析。
                        </p>
                        <button
                          type="button"
                          onClick={startAIAnalysis}
                          disabled={isStreaming}
                          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Sparkles className="h-4 w-4" />
                          开始 AI 解读
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* History toolbar — only shown when there are persisted messages */}
                      {accessToken && aiMessages.length > 0 && (
                        <div className="flex items-center justify-end border-b border-gray-100 bg-white px-4 py-2">
                          <button
                            onClick={() => void clearAIChatHistory()}
                            disabled={isStreaming}
                            className="text-xs text-gray-500 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="清空当前视频的对话历史"
                          >
                            清空对话
                          </button>
                        </div>
                      )}
                      {/* Chat Messages - wrapped with TextSelectionToolbar so users
                      keep the browser's native right-click menu (copy / search /
                      inspect) and get a Papers-style floating toolbar only when
                      they actually select text. */}
                      <TextSelectionToolbar
                        onAddToNotes={(text) => void saveTextToNotes(text)}
                        className="flex-1 overflow-y-auto"
                      >
                        <div className="flex-1 space-y-2">
                          {aiMessages.length > 0 ? (
                            <>
                              {aiMessages.map((msg, i) => (
                                <div
                                  key={i}
                                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                  <div
                                    className={`group relative max-w-[90%] rounded-xl px-4 py-3 ${
                                      msg.role === 'user'
                                        ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md'
                                        : 'cursor-text select-text border border-gray-100 bg-white text-gray-800 shadow-sm'
                                    }`}
                                  >
                                    {msg.role === 'assistant' && (
                                      <button
                                        onClick={() => {
                                          navigator.clipboard
                                            .writeText(msg.content)
                                            .then(() => toast.success('已复制'))
                                            .catch(() => {});
                                        }}
                                        className="absolute right-2 top-2 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
                                        title="复制"
                                      >
                                        <svg
                                          className="h-3.5 w-3.5"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                          />
                                        </svg>
                                      </button>
                                    )}
                                    <AIMessageRenderer
                                      content={msg.content}
                                      isDark={msg.role === 'user'}
                                    />
                                    <div
                                      className={`mt-2 border-t pt-2 text-[11px] ${
                                        msg.role === 'user'
                                          ? 'border-white/20 text-red-100'
                                          : 'border-gray-100 text-gray-400'
                                      }`}
                                    >
                                      <ClientDate
                                        date={msg.timestamp}
                                        format="time"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {/* AI Thinking Indicator */}
                              {isStreaming && (
                                <div className="flex justify-start">
                                  <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-600">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-red-600" />
                                    <span className="text-sm">
                                      {activeAIModel?.name || 'AI'} 正在分析...
                                    </span>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : isStreaming ? (
                            <div className="flex h-full items-center justify-center">
                              <div className="flex flex-col items-center gap-3 text-gray-600">
                                <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-300 border-t-red-600" />
                                <div className="text-sm font-medium">
                                  {activeAIModel?.name || 'AI'}{' '}
                                  正在分析视频内容...
                                </div>
                                <div className="text-xs text-gray-400">
                                  这通常只需要几秒钟
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <div className="text-center">
                                <svg
                                  className="mx-auto h-12 w-12 text-gray-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                  />
                                </svg>
                                <h3 className="mt-2 text-sm font-semibold text-gray-900">
                                  Chat with AI
                                </h3>
                                <p className="mt-1 text-sm text-gray-600">
                                  Ask questions about the video content
                                </p>
                              </div>
                            </div>
                          )}
                          <div ref={chatEndRef} />
                        </div>
                      </TextSelectionToolbar>

                      {/* Chat Input */}
                      <div className="border-t border-gray-200 bg-white p-4">
                        {/* BYOK Required Banner — 严格 BYOK 模式下没配 key 调用必败 */}
                        {aiModels.length > 0 && !userHasBYOK(aiModels) && (
                          <div className="mb-3">
                            <BYOKRequiredBanner compact />
                          </div>
                        )}
                        {/* Model Selector - Dropdown */}
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">
                            AI 模型:
                          </span>
                          <div className="min-w-[200px] flex-1">
                            <ModelSelect
                              value={aiModel}
                              onChange={setAiModel}
                              models={aiModels}
                              disabled={isStreaming}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={aiInput}
                            onChange={(e) => setAiInput(e.target.value)}
                            onKeyPress={(e) =>
                              e.key === 'Enter' &&
                              !e.shiftKey &&
                              void sendAIMessage()
                            }
                            placeholder="Ask about the video..."
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                            disabled={isStreaming}
                          />
                          {isStreaming ? (
                            <button
                              onClick={stopAIStreaming}
                              className="rounded-lg bg-gradient-to-br from-gray-600 to-gray-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-gray-700 hover:to-gray-800 hover:shadow-md"
                              title="Stop generating"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <rect
                                  x="6"
                                  y="6"
                                  width="12"
                                  height="12"
                                  rx="1"
                                />
                              </svg>
                            </button>
                          ) : (
                            <button
                              onClick={() => void sendAIMessage()}
                              disabled={!aiInput.trim()}
                              className="rounded-lg bg-gradient-to-br from-red-500 to-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                            >
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
                                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'notes' && (
                <div className="h-full overflow-y-auto">
                  <NotesList
                    source={`youtube:${videoId}`}
                    refreshKey={notesRefreshKey}
                    showActions
                  />
                </div>
              )}

              {activeTab === 'comments' && (
                <div className="flex h-full flex-col overflow-hidden">
                  {/* Comments Header */}
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-5 w-5 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                        />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">
                        {commentsTotalCount > 0
                          ? `${commentsTotalCount.toLocaleString()} Comments`
                          : 'Comments'}
                      </span>
                    </div>
                    <button
                      onClick={fetchComments}
                      disabled={commentsLoading}
                      className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                    >
                      {commentsLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>

                  {/* New Comment Input */}
                  {accessToken && (
                    <div className="border-b border-gray-100 px-4 py-3">
                      <div className="flex gap-2">
                        <textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Write a comment..."
                          className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-red-300 focus:outline-none focus:ring-1 focus:ring-red-300"
                          rows={2}
                        />
                        <button
                          onClick={submitComment}
                          disabled={!newComment.trim() || submittingComment}
                          className="self-end rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {submittingComment ? 'Posting...' : 'Post'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Comments List */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {commentsLoading && comments.length === 0 ? (
                      <LoadingState size="lg" text="" />
                    ) : commentsError ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <svg
                          className="mb-3 h-12 w-12 text-gray-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <p className="text-sm text-gray-500">{commentsError}</p>
                        <button
                          onClick={fetchComments}
                          className="mt-3 text-sm text-red-500 hover:underline"
                        >
                          Try again
                        </button>
                      </div>
                    ) : comments.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <svg
                          className="mb-3 h-12 w-12 text-gray-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                          />
                        </svg>
                        <p className="text-sm text-gray-500">
                          No comments yet. Be the first to comment!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
                          >
                            {/* Author Row */}
                            <div className="mb-2 flex items-start gap-3">
                              {comment.user.avatarUrl ? (
                                <img
                                  src={comment.user.avatarUrl}
                                  alt={comment.user.username}
                                  className="h-8 w-8 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-red-600 text-xs font-medium text-white">
                                  {(
                                    comment.user.fullName ||
                                    comment.user.username
                                  )
                                    .charAt(0)
                                    .toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-gray-800">
                                    {comment.user.fullName ||
                                      comment.user.username}
                                  </span>
                                  {comment.isEdited && (
                                    <span className="text-xs text-gray-400">
                                      (edited)
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-400">
                                    <ClientDate
                                      date={comment.createdAt}
                                      format="date"
                                    />
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Comment Text */}
                            <p className="mb-2 whitespace-pre-wrap text-sm text-gray-700">
                              {comment.content}
                            </p>

                            {/* Stats Row */}
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <button
                                onClick={() => upvoteComment(comment.id)}
                                className="flex items-center gap-1 transition-colors hover:text-red-500"
                              >
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
                                    d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                                  />
                                </svg>
                                <span>
                                  {comment.upvoteCount > 0
                                    ? comment.upvoteCount.toLocaleString()
                                    : '0'}
                                </span>
                              </button>
                              {comment.replyCount > 0 && (
                                <div className="flex items-center gap-1">
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
                                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                                    />
                                  </svg>
                                  <span>{comment.replyCount} replies</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Collapse Button */}
        <button
          onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-l-lg bg-white p-2 shadow-lg transition-all hover:bg-gray-50"
          title={rightPanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
        >
          <svg
            className={`h-5 w-5 text-gray-600 transition-transform ${
              rightPanelCollapsed ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </main>
    </AppShell>
  );
}

export default function YouTubeTLDW() {
  return (
    <Suspense fallback={<YouTubeLoadingFallback />}>
      <YouTubeTLDWContent />
    </Suspense>
  );
}

function YouTubeLoadingFallback() {
  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex w-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">加载中...</p>
        </div>
      </div>
    </div>
  );
}
