'use client';

import { useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAiGroupStore } from '@/stores/ai-teams';
import {
  Topic,
  TopicMessage,
  TopicMember,
  TopicAIMember,
  TeamMission,
  MessageContentType,
  MentionType,
  TopicRole,
  AICapability,
} from '@/lib/types/ai-teams';
import { useUrlDetection } from '@/hooks';
import { LinkPreviewList } from '@/components/ai-teams/LinkPreviewCard';
import type { ParsedUrl } from '@/services/ai-teams/api';
import { getProviderBrand } from '@/lib/constants/ai-provider-logos';
import { ModelBadge } from '@/components/common/badges/ModelBadge';
import { toast, confirm } from '@/stores';

// Helper to get short capability labels and colors
const CAPABILITY_CONFIG: Record<
  AICapability,
  { label: string; color: string; icon: string }
> = {
  [AICapability.TEXT_GENERATION]: {
    label: '文本',
    color: 'bg-blue-100 text-blue-700',
    icon: '📝',
  },
  [AICapability.CODE_GENERATION]: {
    label: '代码',
    color: 'bg-purple-100 text-purple-700',
    icon: '💻',
  },
  [AICapability.CODE_REVIEW]: {
    label: '审查',
    color: 'bg-indigo-100 text-indigo-700',
    icon: '🔍',
  },
  [AICapability.IMAGE_GENERATION]: {
    label: '图像',
    color: 'bg-pink-100 text-pink-700',
    icon: '🎨',
  },
  [AICapability.IMAGE_ANALYSIS]: {
    label: '识图',
    color: 'bg-rose-100 text-rose-700',
    icon: '👁️',
  },
  [AICapability.WEB_SEARCH]: {
    label: '搜索',
    color: 'bg-green-100 text-green-700',
    icon: '🔎',
  },
  [AICapability.URL_FETCH]: {
    label: '抓取',
    color: 'bg-teal-100 text-teal-700',
    icon: '🌐',
  },
  [AICapability.DOCUMENT_ANALYSIS]: {
    label: '文档',
    color: 'bg-amber-100 text-amber-700',
    icon: '📄',
  },
  [AICapability.REASONING]: {
    label: '推理',
    color: 'bg-orange-100 text-orange-700',
    icon: '🧠',
  },
  [AICapability.MATH]: {
    label: '数学',
    color: 'bg-cyan-100 text-cyan-700',
    icon: '🔢',
  },
  [AICapability.TRANSLATION]: {
    label: '翻译',
    color: 'bg-lime-100 text-lime-700',
    icon: '🌍',
  },
  [AICapability.SUMMARIZATION]: {
    label: '摘要',
    color: 'bg-yellow-100 text-yellow-700',
    icon: '📋',
  },
};
import { useAIModels, AIModel } from '@/hooks';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import AppShell from '@/components/layout/AppShell';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { logger } from '@/lib/utils/logger';
import ClientDate from '@/components/common/ClientDate';
import { formatDateSafe } from '@/lib/utils/date';
import { Modal } from '@/components/ui/dialogs/Modal';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState, LoadingInline } from '@/components/ui';
// 懒加载条件渲染的对话框和面板组件
const TopicSettingsDialog = dynamic(
  () => import('@/components/ai-teams/TopicSettingsDialog'),
  { ssr: false }
);

const ResourcesPanel = dynamic(
  () => import('@/components/ai-teams/ResourcesPanel'),
  { ssr: false }
);

const SummaryDialog = dynamic(
  () => import('@/components/ai-teams/SummaryDialog'),
  { ssr: false }
);

const MessageSelectionToolbar = dynamic(
  () => import('@/components/ai-teams/MessageSelectionToolbar'),
  { ssr: false }
);

const CreateMissionDialog = dynamic(
  () => import('@/components/ai-teams/CreateMissionDialog'),
  { ssr: false }
);

const MissionProgressPanel = dynamic(
  () => import('@/components/ai-teams/MissionProgressPanel'),
  { ssr: false }
);

const TeamCanvasModal = dynamic(
  () => import('@/components/ai-teams/TeamCanvasModal'),
  { ssr: false }
);

// Performance constant - messages are limited in store (aiGroupStore.ts)
const MAX_MESSAGES_IN_MEMORY = 200; // Reference: actual limit is in store

// Extract base64 images from markdown content
function extractImagesFromMarkdown(content: string): {
  images: Array<{ alt: string; src: string }>;
  textContent: string;
} {
  // Match markdown image syntax with data URIs: ![alt](data:image/...;base64,...)
  // Support multiline (image may span lines) and very long base64 strings
  // Also handle cases where there might be newlines between ] and (
  const imageRegex =
    /!\[([^\]]*)\]\s*\(\s*(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)\s*\)/g;
  const images: Array<{ alt: string; src: string }> = [];
  let textContent = content;

  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    images.push({
      alt: match[1] || 'Generated Image',
      src: match[2],
    });
  }

  // Remove image markdown from text content
  textContent = content.replace(imageRegex, '').trim();

  // Also try to extract standalone base64 image data that might not be in proper markdown format
  // This handles cases where the format is broken across lines
  if (images.length === 0 && content.includes('data:image/')) {
    const standaloneBase64Regex =
      /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/g;
    let standaloneMatch;
    while ((standaloneMatch = standaloneBase64Regex.exec(content)) !== null) {
      images.push({
        alt: 'Generated Image',
        src: standaloneMatch[1],
      });
    }
    // Remove the base64 data and any surrounding markdown syntax from text content
    textContent = content
      .replace(standaloneBase64Regex, '')
      .replace(/!\[[^\]]*\]\s*\(\s*\)/g, '') // Remove empty image tags
      .replace(/!\[[^\]]*\]/g, '') // Remove orphan image alt tags
      .trim();
  }

  return { images, textContent };
}

// Standalone Image Component - renders base64 images directly
function Base64Image({ src, alt }: { src: string; alt: string }) {
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (imgError) {
    return (
      <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <span className="block text-red-600">Image failed to load</span>
        <span className="mt-1 block text-xs text-gray-500">{imgError}</span>
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-xs text-blue-600 hover:text-blue-800"
        >
          Download Image ({Math.round(src.length / 1024)} KB)
        </a>
      </div>
    );
  }

  return (
    <div className="my-3">
      {!imgLoaded && (
        <div className="animate-pulse rounded-lg bg-gray-200 p-8 text-center text-gray-500">
          Loading image ({Math.round(src.length / 1024)} KB)...
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`h-auto max-w-full rounded-lg shadow-md ${!imgLoaded ? 'hidden' : ''}`}
        style={{
          maxHeight: '500px',
          objectFit: 'contain',
        }}
        onLoad={() => setImgLoaded(true)}
        onError={() =>
          setImgError(`Failed to decode (${Math.round(src.length / 1024)} KB)`)
        }
      />
      {imgLoaded && (
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-xs text-blue-600 hover:text-blue-800"
        >
          Download Image
        </a>
      )}
    </div>
  );
}

// Markdown Image Component (fallback for non-base64 images)
function MarkdownImage({
  src,
  alt,
  ...props
}: {
  src?: string;
  alt?: string;
  [key: string]: unknown;
}) {
  if (!src) return null;

  // For data URIs, use the standalone component
  if (src.startsWith('data:')) {
    return <Base64Image src={src} alt={alt || 'Generated Image'} />;
  }

  // For regular URLs, render normally
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || 'Image'}
      className="h-auto max-w-full rounded-lg"
      {...props}
    />
  );
}

// Member Panel
function MemberPanel({
  topic,
  onlineUsers,
  typingUsers,
  typingAIs,
  onMemberClick,
  onAIClick,
  onInviteMember,
  isOwnerOrAdmin,
  findModel,
  isConnected,
}: {
  topic: Topic;
  onlineUsers: Set<string>;
  typingUsers: Set<string>;
  typingAIs: Set<string>;
  onMemberClick: (member: TopicMember) => void;
  onAIClick: (ai: TopicAIMember) => void;
  onInviteMember: () => void;
  isOwnerOrAdmin: boolean;
  findModel: (aiModel: string) => AIModel | undefined;
  isConnected: boolean;
}) {
  const [membersCollapsed, setMembersCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
      {/* Back to Topics - Top */}
      <div className="border-b border-gray-200 px-3 py-2">
        <Link
          href="/ai-teams"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
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
          Back to Teams
        </Link>
      </div>

      {/* Topic Header */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500">
            {topic.avatar ? (
              <span className="text-2xl">{topic.avatar}</span>
            ) : (
              <svg
                className="h-6 w-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <h2 className="truncate font-semibold text-gray-900">
              {topic.name}
            </h2>
            <p className="truncate text-xs text-gray-500">
              {topic.memberCount + topic.aiMemberCount} members
            </p>
          </div>
        </div>
      </div>

      {/* Members List */}
      <div className="flex-1 overflow-auto p-3">
        {/* Human Members */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => setMembersCollapsed(!membersCollapsed)}
              className="flex flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
            >
              <svg
                className={`h-3 w-3 transition-transform ${membersCollapsed ? '' : 'rotate-90'}`}
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
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Members ({topic.memberCount})
              <span
                className={`ml-auto h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'animate-pulse bg-yellow-500'}`}
                title={isConnected ? 'Connected' : 'Connecting...'}
              />
            </button>
            {isOwnerOrAdmin && (
              <button
                onClick={onInviteMember}
                className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                title="Invite member"
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
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>
            )}
          </div>
          <div className={`space-y-1 ${membersCollapsed ? 'hidden' : ''}`}>
            {(topic.members || []).map((member) => {
              const isOnline = onlineUsers.has(member.userId);
              const isTyping = typingUsers.has(member.userId);

              return (
                <button
                  key={member.id}
                  onClick={() => onMemberClick(member)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-100"
                >
                  <div className="relative">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                      {member.user.avatarUrl ? (
                        <img
                          src={member.user.avatarUrl}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        (member.user.fullName ||
                          member.user.username ||
                          'U')[0].toUpperCase()
                      )}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                        isOnline ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {member.nickname ||
                          member.user.fullName ||
                          member.user.username}
                      </span>
                      {member.role === TopicRole.OWNER && (
                        <span className="rounded bg-yellow-100 px-1 text-[10px] font-medium text-yellow-700">
                          Owner
                        </span>
                      )}
                      {member.role === TopicRole.ADMIN && (
                        <span className="rounded bg-blue-100 px-1 text-[10px] font-medium text-blue-700">
                          Admin
                        </span>
                      )}
                    </div>
                    {isTyping && (
                      <span className="text-xs italic text-gray-400">
                        typing...
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Members */}
        {topic.aiMembers && topic.aiMembers.length > 0 && (
          <div>
            <button
              onClick={() => setAiCollapsed(!aiCollapsed)}
              className="mb-2 flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
            >
              <svg
                className={`h-3 w-3 transition-transform ${aiCollapsed ? '' : 'rotate-90'}`}
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
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              AI Assistants ({topic.aiMemberCount})
            </button>
            <div className={`space-y-1 ${aiCollapsed ? 'hidden' : ''}`}>
              {(topic.aiMembers || []).map((ai) => {
                const model = findModel(ai.aiModel);
                const isTyping = typingAIs.has(ai.id);

                const providerBrand = getProviderBrand(
                  ai.aiModel || ai.displayName
                );

                return (
                  <button
                    key={ai.id}
                    onClick={() => onAIClick(ai)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-100"
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full"
                      style={{ background: providerBrand.gradient }}
                    >
                      {providerBrand.logo ? (
                        <img
                          src={providerBrand.logo}
                          alt={providerBrand.name}
                          className="h-5 w-5"
                          style={{ filter: 'brightness(0) invert(1)' }}
                        />
                      ) : model?.iconUrl ? (
                        <img
                          src={model.iconUrl}
                          alt={model.name}
                          className="h-5 w-5"
                        />
                      ) : (
                        <span className="text-sm font-bold text-white">
                          {ai.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {ai.displayName}
                      </span>
                      {ai.roleDescription && (
                        <p className="truncate text-xs text-gray-500">
                          {ai.roleDescription}
                        </p>
                      )}
                      {/* Capability tags */}
                      {ai.capabilities && ai.capabilities.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-0.5">
                          {ai.capabilities.slice(0, 3).map((cap) => {
                            const config = CAPABILITY_CONFIG[cap];
                            return config ? (
                              <span
                                key={cap}
                                className={`rounded px-1 text-[9px] font-medium ${config.color}`}
                                title={cap}
                              >
                                {config.label}
                              </span>
                            ) : null;
                          })}
                          {ai.capabilities.length > 3 && (
                            <span className="rounded bg-gray-100 px-1 text-[9px] font-medium text-gray-500">
                              +{ai.capabilities.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      {isTyping && (
                        <span className="text-xs italic text-green-500">
                          thinking...
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {ai.autoRespond && (
                        <span className="rounded bg-green-100 px-1 text-[10px] font-medium text-green-700">
                          Auto
                        </span>
                      )}
                      {ai.canMentionOtherAI && (
                        <span
                          className="rounded bg-cyan-100 px-1 text-[10px] font-medium text-cyan-700"
                          title="Can collaborate with other AIs"
                        >
                          协作
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Context Menu Component for messages
function MessageContextMenu({
  x,
  y,
  onClose,
  onReply,
  onCopy,
  onReact,
  onSelect,
  messageContent,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onReact: (emoji: string) => void;
  onSelect: () => void;
  messageContent: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button
        onClick={() => {
          onReply();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
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
            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
          />
        </svg>
        引用回复
      </button>
      <button
        onClick={() => {
          onCopy();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
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
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        复制内容
      </button>
      <button
        onClick={() => {
          onSelect();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
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
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
        多选消息
      </button>
      <div className="my-1 border-t border-gray-100" />
      <div className="px-3 py-1 text-xs text-gray-400">快速表情</div>
      <div className="flex gap-1 px-2 py-1">
        {['👍', '❤️', '😄', '🎉', '🤔', '👀'].map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              onReact(emoji);
              onClose();
            }}
            className="rounded p-1.5 text-lg hover:bg-gray-100"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// Message Bubble Component - Memoized for performance
const MessageBubble = memo(function MessageBubble({
  message,
  isOwnMessage,
  onReply,
  onReact,
  currentUserId,
  findModel,
  isSelectionMode,
  isSelected,
  onToggleSelect,
}: {
  message: TopicMessage;
  isOwnMessage: boolean;
  onReply: (message: TopicMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  currentUserId: string;
  findModel: (aiModel: string) => AIModel | undefined;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (messageId: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const isAI = !!message.aiMemberId;
  const model = isAI ? findModel(message.aiMember?.aiModel || '') : null;

  // Check if message contains an image (markdown image syntax)
  const hasImage = message.content?.includes('![');

  // Auto-expand messages with images
  const [isExpanded, setIsExpanded] = useState(hasImage);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle copy
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
  }, [message.content]);

  // Check if content exceeds 5 lines (~120px at ~24px line height)
  // But don't collapse messages with images
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is ready
    const checkCollapse = () => {
      if (contentRef.current && !hasImage) {
        const lineHeight = 24; // Approximate line height in pixels
        const maxLines = 5;
        const maxHeight = lineHeight * maxLines;
        setNeedsCollapse(contentRef.current.scrollHeight > maxHeight);
      } else if (hasImage) {
        // Messages with images should not be collapsed
        setNeedsCollapse(false);
      }
    };

    // Run immediately and also after a short delay to handle dynamic content
    checkCollapse();
    const timerId = setTimeout(checkCollapse, 100);
    return () => clearTimeout(timerId);
  }, [message.content, hasImage]);

  // formatTime removed - using ClientDate component for hydration safety

  const senderName = isAI
    ? message.aiMember?.displayName || 'AI'
    : message.sender?.fullName || message.sender?.username || 'User';

  const senderAvatar = isAI ? (
    model?.iconUrl ? (
      <img src={model.iconUrl} alt={model.name} className="h-5 w-5" />
    ) : (
      <svg
        className="h-5 w-5 text-blue-600"
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
    )
  ) : message.sender?.avatarUrl ? (
    <img
      src={message.sender.avatarUrl}
      alt=""
      className="h-full w-full rounded-full object-cover"
    />
  ) : (
    <span className="text-sm font-medium">{senderName[0].toUpperCase()}</span>
  );

  // Group reactions by emoji
  const groupedReactions = (message.reactions || []).reduce(
    (acc, r) => {
      if (!acc[r.emoji]) {
        acc[r.emoji] = { emoji: r.emoji, count: 0, hasOwn: false };
      }
      acc[r.emoji].count++;
      if (r.userId === currentUserId) {
        acc[r.emoji].hasOwn = true;
      }
      return acc;
    },
    {} as Record<string, { emoji: string; count: number; hasOwn: boolean }>
  );

  // Handle click for selection mode
  const handleClick = useCallback(() => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(message.id);
    }
  }, [isSelectionMode, onToggleSelect, message.id]);

  return (
    <div
      className={`group flex gap-3 px-4 py-2 transition-colors hover:bg-gray-50 ${isOwnMessage ? 'flex-row-reverse' : ''} ${isSelected ? 'bg-blue-50' : ''} ${isSelectionMode ? 'cursor-pointer' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      {/* Context Menu */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onReply={() => onReply(message)}
          onCopy={handleCopy}
          onReact={(emoji) => onReact(message.id, emoji)}
          onSelect={() => onToggleSelect?.(message.id)}
          messageContent={message.content || ''}
        />
      )}

      {/* Selection Checkbox */}
      {isSelectionMode && (
        <div className="flex flex-shrink-0 items-center">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-500'
                : 'border-gray-300 bg-white hover:border-blue-400'
            }`}
          >
            {isSelected && (
              <svg
                className="h-3 w-3 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Avatar */}
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
          isAI
            ? 'bg-gradient-to-br from-green-100 to-blue-100'
            : 'bg-gray-200 text-gray-600'
        }`}
      >
        {senderAvatar}
      </div>

      {/* Content */}
      <div
        className={`max-w-[85%] overflow-hidden ${isOwnMessage ? 'items-end' : 'items-start'}`}
      >
        {/* Header */}
        <div
          className={`mb-1 flex items-center gap-2 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
        >
          <span
            className={`text-sm font-medium ${isAI ? 'text-green-700' : 'text-gray-900'}`}
          >
            {senderName}
          </span>
          <span className="text-xs text-gray-400">
            <ClientDate
              date={message.createdAt}
              format="time"
              timeOptions={{ hour: '2-digit', minute: '2-digit' }}
            />
          </span>
          {isAI && message.modelUsed && (
            <ModelBadge modelId={message.modelUsed} variant="subtle" />
          )}
        </div>

        {/* Reply To */}
        {message.replyTo && (
          <div className="mb-1 rounded border-l-2 border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-500">
            <span className="font-medium">
              {message.replyTo.sender?.fullName ||
                message.replyTo.aiMember?.displayName}
              :
            </span>{' '}
            <span className="line-clamp-1">{message.replyTo.content}</span>
          </div>
        )}

        {/* Message Content */}
        <div
          className={`rounded-2xl px-4 py-2 ${
            isOwnMessage
              ? 'bg-blue-600 text-white'
              : isAI
                ? 'bg-gradient-to-br from-green-50 to-blue-50 text-gray-800'
                : 'bg-gray-100 text-gray-800'
          }`}
        >
          {/* AI messages: Extract images and render separately, then render text as Markdown */}
          {isAI ? (
            (() => {
              const { images, textContent } = extractImagesFromMarkdown(
                message.content || ''
              );
              return (
                <>
                  {/* Render extracted images */}
                  {images.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {images.map((img, idx) => (
                        <Base64Image key={idx} src={img.src} alt={img.alt} />
                      ))}
                    </div>
                  )}
                  {/* Then render text content */}
                  {textContent && (
                    <div
                      ref={contentRef}
                      className={`relative ${
                        !isExpanded && needsCollapse
                          ? 'max-h-[120px] overflow-hidden'
                          : ''
                      }`}
                    >
                      <div className="prose prose-sm prose-headings:text-gray-800 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-gray-900 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100 max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            img: ({ node, ...props }) => (
                              <MarkdownImage {...props} />
                            ),
                            // ★ 表格渲染组件 - 确保表格正确显示
                            table: ({ children }) => (
                              <div className="my-3 overflow-x-auto">
                                <Table className="min-w-full border-collapse text-sm">
                                  {children}
                                </Table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <THead className="bg-gray-100">{children}</THead>
                            ),
                            th: ({ children }) => (
                              <Th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-900">
                                {children}
                              </Th>
                            ),
                            tbody: ({ children }) => (
                              <TBody className="divide-y divide-gray-200">
                                {children}
                              </TBody>
                            ),
                            tr: ({ children }) => (
                              <Tr className="hover:bg-gray-50">{children}</Tr>
                            ),
                            td: ({ children }) => (
                              <Td className="border border-gray-200 px-3 py-2 text-gray-700">
                                {children}
                              </Td>
                            ),
                          }}
                        >
                          {textContent}
                        </ReactMarkdown>
                      </div>
                      {/* Gradient fade for collapsed content */}
                      {!isExpanded && needsCollapse && (
                        <div
                          className={`absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-green-50 to-transparent`}
                        />
                      )}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <div
              ref={contentRef}
              className={`relative ${
                !isExpanded && needsCollapse
                  ? 'max-h-[120px] overflow-hidden'
                  : ''
              }`}
            >
              <div className="whitespace-pre-wrap break-words text-sm">
                {highlightMentions(message.content, message.mentions)}
              </div>
              {/* Gradient fade for collapsed content */}
              {!isExpanded && needsCollapse && (
                <div
                  className={`absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t ${
                    isOwnMessage
                      ? 'from-blue-600 to-transparent'
                      : 'from-gray-100 to-transparent'
                  }`}
                />
              )}
            </div>
          )}
          {/* Expand/Collapse button */}
          {needsCollapse && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsExpanded((prev) => !prev);
              }}
              className={`mt-1 text-xs font-medium ${
                isOwnMessage
                  ? 'text-blue-200 hover:text-white'
                  : 'text-blue-600 hover:text-blue-800'
              }`}
            >
              {isExpanded ? '▲ 收起' : '▼ 展开全部'}
            </button>
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                    isOwnMessage
                      ? 'bg-blue-500 text-blue-100'
                      : 'bg-gray-200 text-gray-600'
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
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  {att.name}
                </a>
              ))}
            </div>
          )}

          {/* Parsed URL Previews */}
          {message.parsedUrls && message.parsedUrls.length > 0 && (
            <div className="mt-2">
              <LinkPreviewList
                previews={
                  message.parsedUrls.filter(
                    (p) => p.status === 'success'
                  ) as ParsedUrl[]
                }
                compact={true}
                maxVisible={2}
              />
            </div>
          )}
        </div>

        {/* Reactions */}
        {Object.keys(groupedReactions).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.values(groupedReactions).map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(message.id, r.emoji)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                  r.hasOwn
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Right-click hint (shown on hover) */}
        <div className="mt-1 text-[10px] text-gray-300 opacity-0 transition-opacity group-hover:opacity-100">
          右键点击查看更多操作
        </div>
      </div>
    </div>
  );
});

// Simple Message List Component - stable and performant with message limit
function SimpleMessageList({
  messages,
  currentUserId,
  onReply,
  onReact,
  messagesEndRef,
  findModel,
  selectedMessages,
  onToggleSelect,
}: {
  messages: TopicMessage[];
  currentUserId: string;
  onReply: (message: TopicMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  findModel: (aiModel: string) => AIModel | undefined;
  selectedMessages: Set<string>;
  onToggleSelect: (messageId: string) => void;
}) {
  const isSelectionMode = selectedMessages.size > 0;

  return (
    <div className="flex flex-col gap-1 px-4 py-4">
      {(messages || []).map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isOwnMessage={message.senderId === currentUserId}
          onReply={onReply}
          onReact={onReact}
          currentUserId={currentUserId}
          findModel={findModel}
          isSelectionMode={isSelectionMode}
          isSelected={selectedMessages.has(message.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
      <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
    </div>
  );
}

// Helper function to highlight mentions
function highlightMentions(
  content: string,
  mentions: TopicMessage['mentions']
): React.ReactNode {
  if (!mentions || mentions.length === 0) {
    return content;
  }

  // Mention pattern @name (supports Unicode letters like Chinese, hyphens and underscores)
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        className="rounded bg-blue-100 px-1 font-medium text-blue-700"
      >
        {match[0]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

// Message Input Component
function MessageInput({
  topic,
  replyTo,
  onClearReply,
  onSend,
  onTyping,
  findModel,
}: {
  topic: Topic;
  replyTo: TopicMessage | null;
  onClearReply: () => void;
  onSend: (
    content: string,
    mentions: {
      userId?: string;
      aiMemberId?: string;
      mentionType: MentionType;
    }[]
  ) => void;
  onTyping: () => void;
  findModel: (aiModel: string) => AIModel | undefined;
}) {
  const [content, setContent] = useState('');
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // URL 检测和预览
  const {
    detectedUrls,
    parsedUrls,
    isParsing: isParsingUrls,
    removeUrl: removeUrlPreview,
  } = useUrlDetection(content, {
    debounceMs: 500,
    autoParseUrls: true,
    maxUrls: 5,
  });
  const [showUrlPreviews, setShowUrlPreviews] = useState(true);

  interface MentionableEntity {
    type: string;
    id: string;
    name: string;
    mention: string;
    icon: string | null;
    iconUrl?: string;
    avatar?: string | null;
  }

  const mentionableEntities: MentionableEntity[] = [
    {
      type: 'all',
      id: 'all',
      name: 'Everyone',
      mention: 'Everyone',
      icon: 'users', // SVG icon type
    },
    {
      type: 'all_ai',
      id: 'all_ai',
      name: 'All AIs',
      mention: 'AllAIs',
      icon: 'cpu', // SVG icon type
    },
    ...(topic.members || []).map((m) => {
      const displayName =
        m.nickname || m.user.fullName || m.user.username || 'User';
      return {
        type: 'user',
        id: m.userId,
        name: displayName,
        mention: displayName.replace(/\s+/g, '-'), // Replace spaces with hyphens for @mention
        icon: null,
        avatar: m.user.avatarUrl,
      };
    }),
    ...(topic.aiMembers || []).map((ai) => {
      const model = findModel(ai.aiModel);
      // Keep full display name for @mention to distinguish AI members with similar names
      // "AI-Gemini (Google)" and "AI-Gemini (Image)" need to be distinguishable
      return {
        type: 'ai',
        id: ai.id,
        name: ai.displayName,
        mention: ai.displayName.replace(/\s+/g, '-'), // Replace spaces with hyphens for @mention
        icon: 'cpu', // SVG icon type for AI
        iconUrl: model?.iconUrl,
      };
    }),
  ];

  const filteredEntities = mentionableEntities.filter((e) =>
    e.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // Check for @ mention trigger (support hyphens in names like "AI-Grok")
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([\w-]*)$/);

    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentionMenu(true);
      // Calculate position (simplified)
      const rect = e.target.getBoundingClientRect();
      setMentionPosition({ top: rect.top - 200, left: rect.left + 20 });
    } else {
      setShowMentionMenu(false);
    }

    // Typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    onTyping();
    typingTimeoutRef.current = setTimeout(() => {
      // Typing stopped
    }, 2000);
  };

  const handleMentionSelect = (entity: (typeof mentionableEntities)[0]) => {
    const cursorPos = inputRef.current?.selectionStart || 0;
    const textBeforeCursor = content.slice(0, cursorPos);
    const textAfterCursor = content.slice(cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    // Use entity.mention (no spaces) instead of entity.name for the actual @mention text
    const mentionText = `@${entity.mention} `;
    const newContent =
      textBeforeCursor.slice(0, atIndex) + mentionText + textAfterCursor;
    setContent(newContent);
    setShowMentionMenu(false);

    // Focus back to input and set cursor position after the mention
    const newCursorPos = atIndex + mentionText.length;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleSend = () => {
    if (!content.trim()) return;

    // DEBUG: Log the content and available AI members
    logger.debug('[Mentions Debug] handleSend called with content:', content);
    logger.debug('[Mentions Debug] topic.aiMembers', {
      exists: !!topic.aiMembers,
      length: topic.aiMembers?.length || 0,
    });
    logger.debug(
      '[Mentions Debug] Available AI members:',
      topic.aiMembers?.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        aiModel: a.aiModel,
      }))
    );

    // Parse mentions from content
    // Support names with letters, numbers, hyphens, underscores, spaces, and parentheses
    // e.g., "AI-Grok", "AI_Claude", "AI-Grok (xAI)", "AI-Gemini (Google)"
    const mentions: {
      userId?: string;
      aiMemberId?: string;
      mentionType: MentionType;
    }[] = [];
    // Match @name patterns including optional parenthetical suffix
    // Examples: @AI-Grok, @AI-Grok-(xAI), @AI-Gemini-(Google), @John-Doe, @小C, @小明
    // Regex: Support Unicode letters (Chinese, Japanese, etc.), numbers, hyphens, underscores
    // \p{L} matches any Unicode letter, \p{N} matches any Unicode number
    const mentionRegex = /@([\p{L}\p{N}_-]+(?:\([^)]+\))?)/gu;
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      // Normalize: remove hyphen before parentheses for display matching
      // @AI-Grok-(xAI) -> "ai-grok (xai)" for matching against "AI-Grok (xAI)"
      const name = match[1]
        .toLowerCase()
        .replace(/-\(/, ' (')
        .replace(/\($/, '');
      logger.debug('[Mentions Debug] Found mention match:', {
        match: match[0],
        name,
      });

      if (name === 'everyone') {
        mentions.push({ mentionType: MentionType.ALL });
      } else if (name === 'allais' || name === 'all_ai') {
        mentions.push({ mentionType: MentionType.ALL_AI });
      } else {
        // Find matching user or AI
        // Support both exact match and hyphenated match (e.g., @John-Doe matches "John Doe")
        const members = topic.members || [];
        const aiMembers = topic.aiMembers || [];

        const user = members.find((m) => {
          const displayName = (
            m.nickname ||
            m.user.fullName ||
            m.user.username ||
            ''
          ).toLowerCase();
          // Match against both original name and hyphenated version
          const hyphenatedName = displayName.replace(/\s+/g, '-');
          return displayName === name || hyphenatedName === name;
        });
        // Try matching AI members with flexible matching:
        // Priority: exact match > prefix match (to avoid ai-gemini matching ai-gemini-image)
        const normalizeForMatch = (str: string) => {
          return str
            .toLowerCase()
            .replace(/\s*\([^)]*\)\s*/g, '') // Remove (xAI), (Google), etc.
            .trim()
            .replace(/\s+/g, '-'); // Replace spaces with hyphens
        };

        const normalizedName = normalizeForMatch(name);
        const nameWithHyphens = name.replace(/\s+/g, '-').toLowerCase();
        logger.debug('[Mentions Debug] Normalized input name:', normalizedName);
        logger.debug('[Mentions Debug] Name with hyphens:', nameWithHyphens);

        // First pass: exact match with full name including parentheses (highest priority)
        // This ensures @AI-Gemini-(Image) matches "AI-Gemini (Image)" not "AI-Gemini (Gemini3)"
        let ai = aiMembers.find((a) => {
          const displayNameWithHyphens = a.displayName
            .toLowerCase()
            .replace(/\s+/g, '-');
          return displayNameWithHyphens === nameWithHyphens;
        });

        // Second pass: exact match after removing parentheses
        if (!ai) {
          ai = aiMembers.find((a) => {
            const normalizedDisplayName = normalizeForMatch(a.displayName);
            return normalizedDisplayName === normalizedName;
          });
        }

        // Third pass: match by parentheses content (e.g., @Image matches "AI-Gemini (Image)")
        if (!ai) {
          const inputLower = name.toLowerCase().replace(/-/g, ' ').trim();
          ai = aiMembers.find((a) => {
            // Extract content inside parentheses
            const parenMatch = a.displayName.match(/\(([^)]+)\)/);
            if (parenMatch) {
              const parenContent = parenMatch[1].toLowerCase();
              return (
                parenContent === inputLower || parenContent.includes(inputLower)
              );
            }
            return false;
          });
        }

        // Fourth pass: prefix match (only if no exact match found)
        // This allows @AI-Grok to match "AI-Grok (xAI)" but won't incorrectly
        // match "AI-Gemini Image" when user types @AI-Gemini
        if (!ai) {
          // Sort by name length (longer first) to prefer more specific matches
          // e.g., "AI-Gemini (Image)" should match before "AI-Gemini (Gemini3)"
          const sortedAiMembers = [...aiMembers].sort(
            (a, b) =>
              normalizeForMatch(b.displayName).length -
              normalizeForMatch(a.displayName).length
          );
          ai = sortedAiMembers.find((a) => {
            const normalizedDisplayName = normalizeForMatch(a.displayName);
            return normalizedDisplayName.startsWith(normalizedName);
          });
        }

        // Fifth pass: suffix/contains match (for cases like @Image matching "AI-Gemini Image")
        if (!ai) {
          ai = aiMembers.find((a) => {
            const normalizedDisplayName = normalizeForMatch(a.displayName);
            // Check if displayName ends with the input (e.g., "ai-gemini-image" ends with "image")
            return normalizedDisplayName.endsWith(normalizedName);
          });
        }

        // Sixth pass: contains match (last resort)
        if (!ai) {
          ai = aiMembers.find((a) => {
            const normalizedDisplayName = normalizeForMatch(a.displayName);
            return normalizedDisplayName.includes(normalizedName);
          });
        }

        logger.debug('[Mentions Debug] Final match', {
          normalizedName,
          aiDisplayName: ai?.displayName || 'none',
        });

        // Debug: log all AI member names for comparison
        logger.debug(
          '[Mentions Debug] AI members available:',
          aiMembers.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            lowercase: a.displayName.toLowerCase(),
            hyphenated: a.displayName.toLowerCase().replace(/\s+/g, '-'),
          }))
        );
        logger.debug('[Mentions Debug] Matching result', {
          name,
          userId: user?.userId,
          aiId: ai?.id,
        });

        if (user) {
          mentions.push({ userId: user.userId, mentionType: MentionType.USER });
        } else if (ai) {
          mentions.push({ aiMemberId: ai.id, mentionType: MentionType.AI });
        }
      }
    }

    logger.debug('[Mentions Debug] Final mentions array:', mentions);
    onSend(content.trim(), mentions);
    setContent('');
  };

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      {/* Reply Preview */}
      {replyTo && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <svg
              className="h-4 w-4 text-gray-400"
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
            <span className="text-gray-500">Replying to</span>
            <span className="font-medium text-gray-700">
              {replyTo.sender?.fullName || replyTo.aiMember?.displayName}
            </span>
            <span className="line-clamp-1 text-gray-400">
              {replyTo.content}
            </span>
          </div>
          <button
            onClick={onClearReply}
            className="text-gray-400 hover:text-gray-600"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Mention Menu */}
      {showMentionMenu && filteredEntities.length > 0 && (
        <div className="mb-2 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filteredEntities.map((entity) => (
            <button
              key={`${entity.type}-${entity.id}`}
              onClick={() => handleMentionSelect(entity)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50"
            >
              {entity.iconUrl ? (
                <img
                  src={entity.iconUrl}
                  alt={entity.name}
                  className="h-5 w-5"
                />
              ) : entity.icon === 'users' ? (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100">
                  <svg
                    className="h-4 w-4 text-blue-600"
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
                </div>
              ) : entity.icon === 'cpu' ? (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-100">
                  <svg
                    className="h-4 w-4 text-cyan-600"
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
                </div>
              ) : entity.avatar ? (
                <img
                  src={entity.avatar}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                  {entity.name[0].toUpperCase()}
                </div>
              )}
              <span className="font-medium text-gray-900">{entity.name}</span>
              {entity.type === 'all' && (
                <span className="text-xs text-gray-500">
                  Notify all members
                </span>
              )}
              {entity.type === 'all_ai' && (
                <span className="text-xs text-gray-500">Ask all AIs</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2">
        {/* Input Field */}
        <div className="flex-1">
          <textarea
            ref={inputRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... Use @ to mention"
            rows={1}
            className="max-h-32 min-h-[44px] w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />

          {/* URL Preview Section */}
          {showUrlPreviews && (parsedUrls.length > 0 || isParsingUrls) && (
            <div className="mt-2">
              {isParsingUrls && parsedUrls.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <svg
                    className="h-3 w-3 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Detecting links...</span>
                </div>
              )}
              {parsedUrls.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{parsedUrls.length} link(s) detected</span>
                    <button
                      onClick={() => setShowUrlPreviews(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      Hide previews
                    </button>
                  </div>
                  <LinkPreviewList
                    previews={parsedUrls}
                    onRemove={removeUrlPreview}
                    compact={true}
                    maxVisible={3}
                  />
                </div>
              )}
            </div>
          )}

          {/* Show URL preview toggle when hidden */}
          {!showUrlPreviews && detectedUrls.length > 0 && (
            <button
              onClick={() => setShowUrlPreviews(true)}
              className="mt-1 text-xs text-blue-500 hover:text-blue-600"
            >
              Show {detectedUrls.length} link preview(s)
            </button>
          )}
        </div>

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={!content.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
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
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Main Topic Page Component
export default function TopicPage() {
  const params = useParams();
  const router = useRouter();
  const topicId = params?.topicId as string;
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const { models: aiModels } = useAIModels();

  const isAuthenticated = !!accessToken;

  const {
    topics,
    currentTopic,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    isConnected,
    onlineUsers,
    typingUsers,
    typingAIs,
    fetchTopics,
    fetchTopic,
    fetchMessages,
    sendMessage,
    addReaction,
    removeReaction,
    connectSocket,
    disconnectSocket,
    joinTopicRoom,
    leaveTopicRoom,
    sendTyping,
    clearMessages,
    generateAIResponse,
    missions,
    fetchMissions,
    cancelMission,
    resumeMission,
    retryMission,
  } = useAiGroupStore();

  // Message selection state
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(
    new Set()
  );

  // Toggle message selection
  const handleToggleSelect = useCallback((messageId: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  // Clear all selections
  const handleClearSelection = useCallback(() => {
    setSelectedMessages(new Set());
  }, []);

  // Export all chat messages
  const handleExportAll = useCallback(async () => {
    if (!messages || messages.length === 0) {
      toast.warning('没有可导出的消息');
      return;
    }

    setIsExporting(true);
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const topicName = currentTopic?.name || 'AI-Teams';

      // Build export content
      let content = `# ${topicName} - 聊天记录导出\n`;
      content += `导出时间: ${formatDateSafe(new Date(), 'datetime')}\n`;
      content += `消息总数: ${messages.length}\n\n`;
      content += '---\n\n';

      // Collect participants
      const participants = new Set<string>();
      messages.forEach((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        participants.add(sender);
      });

      content += '## 参与者\n';
      content += Array.from(participants)
        .map((p) => `- ${p}`)
        .join('\n');
      content += '\n\n---\n\n';

      content += '## 消息记录\n\n';

      // Sort messages by time and add to content
      const sortedMessages = [...messages].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      sortedMessages.forEach((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        const isAI = !!m.aiMemberId;
        const time = formatDateSafe(m.createdAt, 'datetime');
        const modelInfo = m.modelUsed ? ` [${m.modelUsed}]` : '';

        content += `### ${isAI ? '🤖 ' : '👤 '}${sender}${modelInfo}\n`;
        content += `*${time}*\n\n`;

        // Handle reply context
        if (m.replyTo) {
          const replyToSender =
            m.replyTo.sender?.fullName ||
            m.replyTo.sender?.username ||
            m.replyTo.aiMember?.displayName ||
            'Unknown';
          content += `> 回复 ${replyToSender}: ${m.replyTo.content?.substring(0, 100)}${(m.replyTo.content?.length || 0) > 100 ? '...' : ''}\n\n`;
        }

        content += `${m.content || ''}\n\n`;
        content += '---\n\n';
      });

      // Create and download file
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${topicName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_聊天记录_${timestamp}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Export failed:', error);
      toast.error('导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  }, [messages, currentTopic]);

  // 查找模型：优先用 modelId 匹配（新方式），兼容旧数据
  const findModel = useCallback(
    (aiModel: string) => {
      const models = aiModels || [];
      return (
        models.find((m) => m.modelId === aiModel) ||
        models.find((m) => m.modelName === aiModel) ||
        models.find((m) => m.id === aiModel)
      );
    },
    [aiModels]
  );

  const [replyTo, setReplyTo] = useState<TopicMessage | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inviteSearchResults, setInviteSearchResults] = useState<
    Array<{
      id: string;
      email: string;
      username?: string;
      fullName?: string;
      avatarUrl?: string;
    }>
  >([]);
  const [selectedInviteUser, setSelectedInviteUser] = useState<{
    id: string;
    email: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
  } | null>(null);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [showMissionDialog, setShowMissionDialog] = useState(false);
  const [showMissionPanel, setShowMissionPanel] = useState(false);
  const [mainViewMode, setMainViewMode] = useState<'chat' | 'canvas'>('canvas');
  const [selectedMission, setSelectedMission] = useState<TeamMission | null>(
    null
  );
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const isLoadingOlderRef = useRef(false); // Track if we're loading older messages

  // Load topic, messages, and topics list (for forward feature)
  useEffect(() => {
    if (!authLoading && isAuthenticated && topicId) {
      fetchTopic(topicId);
      clearMessages();
      fetchMessages(topicId);
      // Fetch topics list for forward dialog
      fetchTopics();
    }
  }, [
    authLoading,
    isAuthenticated,
    topicId,
    fetchTopic,
    fetchMessages,
    clearMessages,
    fetchTopics,
  ]);

  // Connect to WebSocket
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      connectSocket(user.id);
    }

    return () => {
      disconnectSocket();
    };
  }, [isAuthenticated, user?.id, connectSocket, disconnectSocket]);

  // Join topic room - 关键：必须在 isConnected 变化时重新执行
  // 因为 WebSocket 连接是异步的，可能在 useEffect 第一次执行时还未连接
  useEffect(() => {
    if (topicId && isConnected) {
      logger.debug('[Page] WebSocket connected, joining topic room:', topicId);
      joinTopicRoom(topicId);

      return () => {
        leaveTopicRoom(topicId);
      };
    }
  }, [topicId, isConnected, joinTopicRoom, leaveTopicRoom]);

  // Fallback polling for messages when WebSocket might not be connected
  // This ensures messages are refreshed even if WebSocket fails
  useEffect(() => {
    if (!topicId || !isAuthenticated) return;

    // Poll for new messages every 10 seconds as a fallback
    const intervalId = setInterval(() => {
      fetchMessages(topicId);
    }, 10000);

    return () => clearInterval(intervalId);
  }, [topicId, isAuthenticated, fetchMessages]);

  // Fallback: Re-sync online status when WebSocket reconnects or periodically
  // This helps in proxy environments where WebSocket events might be lost
  useEffect(() => {
    if (!topicId || !isConnected) return;

    // Re-join room periodically to sync online status (every 30 seconds)
    // This helps recover from missed member:online/offline events
    const syncInterval = setInterval(() => {
      joinTopicRoom(topicId);
    }, 30000);

    return () => clearInterval(syncInterval);
  }, [topicId, isConnected, joinTopicRoom]);

  // Fetch missions when canvas view is shown
  useEffect(() => {
    if (mainViewMode === 'canvas' && topicId) {
      fetchMissions(topicId);
    }
  }, [mainViewMode, topicId, fetchMissions]);

  // Get the active mission for canvas view
  const activeMission = useMemo(() => {
    const missionsList = missions || [];
    return (
      missionsList.find(
        (m) =>
          m.status === 'IN_PROGRESS' ||
          m.status === 'PLANNING' ||
          m.status === 'REVIEW' ||
          m.status === 'PENDING'
      ) ||
      missionsList[0] ||
      null
    );
  }, [missions]);

  // Current mission being displayed (selectedMission takes priority over activeMission)
  const currentMission = selectedMission || activeMission;

  // Get AI members for canvas view
  const aiMembers = currentTopic?.aiMembers || [];

  // Auto-scroll to bottom when new messages arrive (but not when loading older messages)
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current && messages.length > 0) {
      // Skip scrolling if we're loading older messages
      if (isLoadingOlderRef.current) {
        isLoadingOlderRef.current = false;
      } else if (lastMessageCountRef.current > 0) {
        // Only scroll on new messages, not initial load
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        // On initial load, scroll instantly without animation
        messagesEndRef.current?.scrollIntoView();
      }
    }
    lastMessageCountRef.current = messages.length;
  }, [messages.length]);

  const handleSendMessage = useCallback(
    async (
      content: string,
      mentions: {
        userId?: string;
        aiMemberId?: string;
        mentionType: MentionType;
      }[]
    ) => {
      if (!topicId || !currentTopic) return;

      await sendMessage(topicId, {
        content,
        contentType: MessageContentType.TEXT,
        replyToId: replyTo?.id,
        mentions,
      });

      setReplyTo(null);
      // AI responses are handled by the backend controller automatically
      // No need to trigger them here - that would cause duplicate responses
    },
    [topicId, currentTopic, sendMessage, replyTo]
  );

  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!topicId || !user?.id) return;

      const message = (messages || []).find((m) => m.id === messageId);
      const hasReaction = message?.reactions?.some(
        (r) => r.userId === user.id && r.emoji === emoji
      );

      if (hasReaction) {
        await removeReaction(topicId, messageId, emoji);
      } else {
        await addReaction(topicId, messageId, emoji);
      }
    },
    [topicId, user?.id, messages, addReaction, removeReaction]
  );

  const handleLoadMore = useCallback(() => {
    if (hasMoreMessages && !isLoadingMessages && topicId) {
      const oldestMessage = messages[0];
      if (oldestMessage) {
        // Mark that we're loading older messages to prevent auto-scroll
        isLoadingOlderRef.current = true;
        fetchMessages(topicId, oldestMessage.id);
      }
    }
  }, [hasMoreMessages, isLoadingMessages, topicId, messages, fetchMessages]);

  // Debounced search for invite dialog
  useEffect(() => {
    if (!inviteEmail.trim() || inviteEmail.length < 2 || selectedInviteUser) {
      setInviteSearchResults([]);
      return;
    }

    const existingMemberIds = new Set(
      (currentTopic?.members || []).map((m) => m.userId)
    );

    const timer = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/users/search?query=${encodeURIComponent(inviteEmail)}&limit=10`,
          {
            headers: accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {},
          }
        );
        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: [...] }
          const users = Array.isArray(result?.data)
            ? result.data
            : Array.isArray(result)
              ? result
              : [];
          // Filter out existing members
          const filtered = users.filter(
            (u: { id: string }) => !existingMemberIds.has(u.id)
          );
          setInviteSearchResults(filtered);
        }
      } catch (err) {
        logger.error('Search failed:', err);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inviteEmail, selectedInviteUser, currentTopic?.members, accessToken]);

  // Handle invite member
  const handleInviteMember = useCallback(async () => {
    // Can invite either selected user or by email
    const userId = selectedInviteUser?.id;
    const email = inviteEmail.trim();

    if (!userId && !email.includes('@')) return;
    if (!topicId || !accessToken) return;

    setIsInviting(true);
    setInviteError('');

    try {
      let userIdToAdd = userId;

      // If no selected user but has email, search for user first
      if (!userIdToAdd && email.includes('@')) {
        const searchResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/users/search?email=${encodeURIComponent(email)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!searchResponse.ok) {
          throw new Error('User not found');
        }

        const result = await searchResponse.json();
        // Handle wrapped API response { success: true, data: T }
        const userData = result?.data ?? result;
        if (!userData || !userData.id) {
          throw new Error('User not found with this email');
        }
        userIdToAdd = userData.id;
      }

      // Add member to topic
      const addResponse = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/topics/${topicId}/members`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            userId: userIdToAdd,
            role: 'MEMBER',
          }),
        }
      );

      if (!addResponse.ok) {
        const errorData = await addResponse.json();
        throw new Error(errorData.message || 'Failed to add member');
      }

      // Refresh topic data
      await fetchTopic(topicId);

      // Close dialog and reset
      setShowInviteDialog(false);
      setInviteEmail('');
      setSelectedInviteUser(null);
      setInviteSearchResults([]);
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : 'Failed to invite member'
      );
    } finally {
      setIsInviting(false);
    }
  }, [selectedInviteUser, inviteEmail, topicId, accessToken, fetchTopic]);

  // Check if current user is owner or admin
  const currentUserMember = currentTopic?.members?.find(
    (m) => m.userId === user?.id
  );
  const isOwnerOrAdmin =
    currentUserMember?.role === TopicRole.OWNER ||
    currentUserMember?.role === TopicRole.ADMIN;

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-8">
        <h2 className="text-xl font-semibold text-gray-700">
          Please sign in to access this topic
        </h2>
        <Link href="/ai-teams" className="text-blue-600 hover:underline">
          Back to AI Teams
        </Link>
      </div>
    );
  }

  if (!currentTopic) {
    return (
      <AppShell>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <LoadingState size="lg" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Member Panel - Collapsible Sidebar */}
      <div className="relative h-full flex-shrink-0">
        {/* Sidebar Content */}
        <div
          className={`h-full transition-all duration-300 ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'}`}
        >
          <MemberPanel
            topic={currentTopic}
            onlineUsers={onlineUsers}
            typingUsers={typingUsers}
            typingAIs={typingAIs}
            onMemberClick={(member) => {
              // Could show member profile or initiate DM
              logger.debug('Member clicked:', member);
            }}
            onAIClick={(ai) => {
              // Could show AI config or quick mention
              logger.debug('AI clicked:', ai);
            }}
            onInviteMember={() => setShowInviteDialog(true)}
            isOwnerOrAdmin={isOwnerOrAdmin}
            findModel={findModel}
            isConnected={isConnected}
          />
        </div>
        {/* Toggle Button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={`absolute top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white shadow-md transition-all hover:bg-gray-100 ${
            sidebarCollapsed ? 'left-0 translate-x-1/2' : '-right-3'
          }`}
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          <svg
            className={`h-4 w-4 text-gray-600 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}
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
        </button>
      </div>

      {/* Main Chat Area - min-w-0 prevents flex item from overflowing */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500">
              {currentTopic.avatar ? (
                <span className="text-2xl">{currentTopic.avatar}</span>
              ) : (
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              )}
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                {currentTopic.name}
              </h1>
              {currentTopic.description && (
                <p className="text-sm text-gray-500">
                  {currentTopic.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* AI Team Mission Button */}
            <button
              onClick={() => setShowMissionPanel(!showMissionPanel)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                showMissionPanel
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                  : 'bg-gradient-to-r from-blue-50 to-purple-50 text-purple-700 hover:from-blue-100 hover:to-purple-100'
              }`}
              title="AI Team Mission - 启用AI团队协作任务"
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
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              AI Team
            </button>
            {/* View Mode Toggle - Chat/Canvas */}
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              <button
                onClick={() => setMainViewMode('chat')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mainViewMode === 'chat'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="聊天视图"
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
                Chat
              </button>
              <button
                onClick={() => setMainViewMode('canvas')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mainViewMode === 'canvas'
                    ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Canvas协作视图"
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
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
                Canvas
              </button>
            </div>
            {/* Export All Button */}
            <button
              onClick={handleExportAll}
              disabled={isExporting || !messages || messages.length === 0}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
              title="导出所有聊天记录"
            >
              {isExporting ? (
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
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
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              )}
              {isExporting ? '导出中...' : '导出'}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              title="Settings"
            >
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content Area - Chat or Canvas */}
        {mainViewMode === 'canvas' ? (
          /* Canvas View - Full width embedded */
          <div className="min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50">
            <TeamCanvasModal
              isOpen={true}
              onClose={() => setMainViewMode('chat')}
              mission={currentMission}
              aiMembers={aiMembers}
              typingAIs={typingAIs}
              embedded={true}
            />
          </div>
        ) : (
          /* Chat View - Messages Area */
          <div
            ref={messagesContainerRef}
            className="min-h-0 flex-1 overflow-auto"
          >
            {/* Load More Button */}
            {hasMoreMessages && (
              <div className="py-4 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMessages}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
                >
                  {isLoadingMessages ? 'Loading...' : 'Load older messages'}
                </button>
              </div>
            )}

            {/* Messages - Virtualized */}
            {(messages || []).length === 0 && !isLoadingMessages ? (
              <EmptyState
                icon={
                  <svg
                    className="h-12 w-12"
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
                }
                title="No messages yet"
                description="Start the conversation!"
                size="md"
              />
            ) : (
              <SimpleMessageList
                messages={messages}
                currentUserId={user?.id || ''}
                onReply={setReplyTo}
                onReact={handleReaction}
                messagesEndRef={messagesEndRef}
                findModel={findModel}
                selectedMessages={selectedMessages}
                onToggleSelect={handleToggleSelect}
              />
            )}

            {/* Typing Indicators */}
            {(typingUsers.size > 0 || typingAIs.size > 0) && (
              <div className="px-4 pb-2 text-sm italic text-gray-400">
                {Array.from(typingUsers)
                  .map((userId) => {
                    const member = (currentTopic?.members || []).find(
                      (m) => m.userId === userId
                    );
                    return (
                      member?.user.fullName ||
                      member?.user.username ||
                      'Someone'
                    );
                  })
                  .concat(
                    Array.from(typingAIs).map((aiId) => {
                      const ai = (currentTopic?.aiMembers || []).find(
                        (a) => a.id === aiId
                      );
                      return ai?.displayName || 'AI';
                    })
                  )
                  .join(', ')}{' '}
                {typingUsers.size + typingAIs.size > 1 ? 'are' : 'is'} typing...
              </div>
            )}
          </div>
        )}

        {/* Message Input - Only visible in Chat mode */}
        {mainViewMode === 'chat' ? (
          <MessageInput
            topic={currentTopic}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={handleSendMessage}
            onTyping={() => sendTyping(topicId)}
            findModel={findModel}
          />
        ) : (
          /* Canvas Action Bar - Quick actions for mission control */
          <div className="border-t border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-center gap-3">
              {/* Create Mission */}
              <button
                onClick={() => setShowMissionDialog(true)}
                className="flex items-center gap-2 rounded-lg bg-purple-100 px-4 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-200"
                title="创建新任务"
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
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                创建任务
              </button>

              {/* Continue Mission */}
              <button
                disabled={
                  !currentMission || currentMission.status === 'COMPLETED'
                }
                onClick={async () => {
                  if (!topicId || !currentMission) return;
                  if (currentMission.status === 'PAUSED') {
                    await resumeMission(topicId, currentMission.id);
                  } else if (
                    currentMission.status === 'FAILED' ||
                    currentMission.status === 'CANCELLED'
                  ) {
                    await retryMission(topicId, currentMission.id, {
                      mode: 'continue',
                    });
                  } else if (currentMission.leaderId) {
                    // 直接发送消息给Leader继续任务，不调用retry API
                    await handleSendMessage('@leader 继续执行当前任务', [
                      {
                        aiMemberId: currentMission.leaderId,
                        mentionType: MentionType.AI,
                      },
                    ]);
                  }
                }}
                className={[
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  !currentMission || currentMission.status === 'COMPLETED'
                    ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                    : currentMission.status === 'PAUSED'
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      : currentMission.status === 'FAILED' ||
                          currentMission.status === 'CANCELLED'
                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200',
                ].join(' ')}
                title="继续当前任务"
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
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                继续任务
              </button>

              {/* Cancel Mission */}
              <button
                disabled={
                  !currentMission ||
                  ['COMPLETED', 'CANCELLED', 'FAILED'].includes(
                    currentMission.status
                  )
                }
                onClick={async () => {
                  if (!topicId || !currentMission) return;
                  if (
                    await confirm({
                      title: '确认要取消当前任务吗？',
                      description: currentMission.title,
                      type: 'danger',
                    })
                  ) {
                    await cancelMission(topicId, currentMission.id);
                  }
                }}
                className={[
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  !currentMission ||
                  ['COMPLETED', 'CANCELLED', 'FAILED'].includes(
                    currentMission.status
                  )
                    ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                    : 'bg-red-100 text-red-700 hover:bg-red-200',
                ].join(' ')}
                title="取消当前任务"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                取消任务
              </button>

              {/* Retry Mission (Full) - only show when mission failed */}
              {currentMission && currentMission.status === 'FAILED' && (
                <button
                  onClick={async () => {
                    if (!topicId) return;
                    if (
                      await confirm({
                        title: `确定要重新规划并执行任务「${currentMission.title}」吗？`,
                        type: 'warning',
                      })
                    ) {
                      try {
                        await retryMission(topicId, currentMission.id, {
                          mode: 'full',
                        });
                      } catch (error) {
                        logger.error('Failed to retry mission:', error);
                      }
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg bg-blue-100 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-200"
                  title="完全重新规划并执行任务"
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  任务重做
                </button>
              )}

              {/* Mission Progress Panel Toggle */}
              <button
                onClick={() => setShowMissionPanel(!showMissionPanel)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  showMissionPanel
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="显示/隐藏任务进度面板"
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
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
                任务面板
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Mission Progress Panel - Right side panel */}
      {showMissionPanel && (
        <div className="h-full w-72 flex-shrink-0 border-l border-gray-200 bg-white">
          <MissionProgressPanel
            topicId={topicId}
            onCreateMission={() => setShowMissionDialog(true)}
            onFocusCanvas={(mission) => {
              setSelectedMission(mission);
              setMainViewMode('canvas');
            }}
          />
        </div>
      )}

      {/* Message Selection Toolbar */}
      <MessageSelectionToolbar
        selectedMessages={selectedMessages}
        messages={messages}
        topics={topics}
        currentTopicId={topicId}
        onClearSelection={handleClearSelection}
        onForwardSuccess={() => {
          // Refresh messages after forward
          fetchMessages(topicId);
        }}
      />

      {/* Dialogs */}
      {showSettings && (
        <TopicSettingsDialog
          topic={currentTopic}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showResources && (
        <ResourcesPanel
          topic={currentTopic}
          onClose={() => setShowResources(false)}
        />
      )}
      {showSummary && (
        <SummaryDialog
          topic={currentTopic}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* Create Mission Dialog */}
      {showMissionDialog && (
        <CreateMissionDialog
          topicId={topicId}
          onClose={() => setShowMissionDialog(false)}
          onSuccess={() => {
            // Mission created successfully
          }}
        />
      )}

      {/* Invite Member Dialog */}
      <Modal
        open={showInviteDialog}
        onClose={() => {
          setShowInviteDialog(false);
          setInviteEmail('');
          setInviteError('');
          setSelectedInviteUser(null);
          setInviteSearchResults([]);
        }}
        title="Invite Member"
        size="sm"
        footer={
          <>
            <button
              onClick={() => {
                setShowInviteDialog(false);
                setInviteEmail('');
                setInviteError('');
                setSelectedInviteUser(null);
                setInviteSearchResults([]);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              disabled={isInviting}
            >
              Cancel
            </button>
            <button
              onClick={handleInviteMember}
              disabled={
                (!selectedInviteUser &&
                  (!inviteEmail.includes('@') || !inviteEmail.includes('.'))) ||
                isInviting
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isInviting ? 'Inviting...' : 'Invite'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Search for users by name, username, or email address.
          </p>

          {/* Selected User Display */}
          {selectedInviteUser && (
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-3">
                {selectedInviteUser.avatarUrl ? (
                  <img
                    src={selectedInviteUser.avatarUrl}
                    alt={
                      selectedInviteUser.fullName ||
                      selectedInviteUser.username ||
                      'User'
                    }
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                    {(selectedInviteUser.fullName ||
                      selectedInviteUser.username ||
                      selectedInviteUser.email)[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {selectedInviteUser.fullName ||
                      selectedInviteUser.username ||
                      'User'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {selectedInviteUser.email}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedInviteUser(null)}
                className="rounded p-1 text-gray-400 hover:bg-blue-100 hover:text-gray-600"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Search Input */}
          {!selectedInviteUser && (
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700">
                Search Users or Enter Email
              </label>
              <div className="relative mt-1">
                <input
                  type="text"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Search by name, username, or enter email..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={isInviting}
                />
                {isSearchingUsers && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <LoadingInline text="" />
                  </div>
                )}
              </div>

              {/* Search Results Dropdown */}
              {inviteSearchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                  {inviteSearchResults.map((searchUser) => (
                    <button
                      key={searchUser.id}
                      onClick={() => {
                        setSelectedInviteUser(searchUser);
                        setInviteEmail('');
                        setInviteSearchResults([]);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
                    >
                      {searchUser.avatarUrl ? (
                        <img
                          src={searchUser.avatarUrl}
                          alt={
                            searchUser.fullName || searchUser.username || 'User'
                          }
                          className="h-8 w-8 rounded-full"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                          {(searchUser.fullName ||
                            searchUser.username ||
                            searchUser.email)[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {searchUser.fullName || searchUser.username || 'User'}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {searchUser.email}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* No Results Message */}
              {inviteEmail.length >= 2 &&
                !isSearchingUsers &&
                inviteSearchResults.length === 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    No users found. You can still invite by email address.
                  </div>
                )}
            </div>
          )}

          {inviteError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {inviteError}
            </div>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
