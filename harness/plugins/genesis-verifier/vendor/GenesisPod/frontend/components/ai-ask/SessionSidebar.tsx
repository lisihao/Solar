'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { config } from '@/lib/utils/config';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingInline } from '@/components/ui/states/LoadingState';
import { Search as SearchIcon, MessageSquare } from 'lucide-react';

import { logger } from '@/lib/utils/logger';
interface Session {
  id: string;
  title: string;
  summary?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  isBookmarked?: boolean;
}

interface GroupedSessions {
  today: Session[];
  yesterday: Session[];
  lastWeek: Session[];
  older: Session[];
  bookmarked: Session[];
}

interface SessionSidebarProps {
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function SessionSidebar({
  currentSessionId,
  onSelectSession,
  onNewSession,
  isOpen,
  onToggle,
}: SessionSidebarProps) {
  const { accessToken: token } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    if (!token) return;

    try {
      setLoading(true);
      const response = await fetch(`${config.apiUrl}/ask/sessions?limit=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: { sessions: [...] } }
        const data = result?.data ?? result;
        setSessions(data?.sessions || []);
      }
    } catch (error) {
      logger.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Group sessions by date
  const groupSessions = (sessions: Session[]): GroupedSessions => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups: GroupedSessions = {
      bookmarked: [],
      today: [],
      yesterday: [],
      lastWeek: [],
      older: [],
    };

    sessions.forEach((session) => {
      // 书签优先显示在独立分组
      if (session.isBookmarked) {
        groups.bookmarked.push(session);
        return;
      }

      const updatedAt = new Date(session.updatedAt);
      if (updatedAt >= today) {
        groups.today.push(session);
      } else if (updatedAt >= yesterday) {
        groups.yesterday.push(session);
      } else if (updatedAt >= lastWeek) {
        groups.lastWeek.push(session);
      } else {
        groups.older.push(session);
      }
    });

    return groups;
  };

  // Filter sessions by search query
  const filteredSessions = searchQuery
    ? sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.summary?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  const groupedSessions = groupSessions(filteredSessions);

  // Toggle dropdown menu
  const toggleMenu = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === sessionId ? null : sessionId);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Toggle bookmark
  const handleToggleBookmark = async (sessionId: string) => {
    if (!token) return;

    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const newBookmarkState = !session.isBookmarked;

    // Optimistic update
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, isBookmarked: newBookmarkState } : s
      )
    );
    setOpenMenuId(null);

    try {
      await fetch(`${config.apiUrl}/ask/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isBookmarked: newBookmarkState }),
      });
    } catch (error) {
      // Revert on error
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, isBookmarked: !newBookmarkState } : s
        )
      );
      logger.error('Failed to toggle bookmark:', error);
    }
  };

  // Delete session
  const handleDeleteSession = async (sessionId: string) => {
    if (!token) return;

    setOpenMenuId(null);

    try {
      const response = await fetch(
        `${config.apiUrl}/ask/sessions/${sessionId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          onNewSession();
        }
      }
    } catch (error) {
      logger.error('Failed to delete session:', error);
    }
  };

  // Rename session
  const handleStartRename = (session: Session) => {
    setEditingSessionId(session.id);
    setEditTitle(session.title);
    setOpenMenuId(null);
  };

  const handleSaveRename = async () => {
    if (!token || !editingSessionId || !editTitle.trim()) return;

    try {
      const response = await fetch(
        `${config.apiUrl}/ask/sessions/${editingSessionId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: editTitle.trim() }),
        }
      );

      if (response.ok) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === editingSessionId ? { ...s, title: editTitle.trim() } : s
          )
        );
      }
    } catch (error) {
      logger.error('Failed to rename session:', error);
    }
    setEditingSessionId(null);
  };

  // Render session item
  const renderSessionItem = (session: Session) => {
    const isEditing = editingSessionId === session.id;
    const isSelected = currentSessionId === session.id;
    const isMenuOpen = openMenuId === session.id;

    return (
      <div
        key={session.id}
        className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
          isSelected
            ? 'bg-purple-100 text-purple-700'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        onClick={() => !isEditing && onSelectSession(session.id)}
      >
        {/* Chat icon or bookmark icon */}
        {session.isBookmarked ? (
          <svg
            className="h-4 w-4 shrink-0 text-amber-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4 shrink-0 text-gray-400"
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
        )}
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSaveRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename();
              if (e.key === 'Escape') setEditingSessionId(null);
            }}
            className="flex-1 truncate rounded bg-white px-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate text-sm">{session.title}</span>
        )}
        {/* Three-dot menu button */}
        {!isEditing && (
          <div className="relative" ref={isMenuOpen ? menuRef : undefined}>
            <button
              className={`rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${
                isMenuOpen
                  ? 'visible bg-gray-200 text-gray-600'
                  : 'invisible group-hover:visible'
              }`}
              onClick={(e) => toggleMenu(e, session.id)}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {/* Bookmark */}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleBookmark(session.id);
                  }}
                >
                  {session.isBookmarked ? (
                    <>
                      <svg
                        className="h-4 w-4 text-amber-500"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      取消书签
                    </>
                  ) : (
                    <>
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
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                      书签
                    </>
                  )}
                </button>

                {/* Rename */}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartRename(session);
                  }}
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
                  重命名
                </button>

                {/* Delete */}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render session group
  const renderGroup = (title: string, sessions: Session[]) => {
    if (sessions.length === 0) return null;

    return (
      <div className="mb-4">
        <div className="mb-1 px-3 text-xs font-medium text-gray-400">
          {title}
        </div>
        <div className="space-y-0.5">{sessions.map(renderSessionItem)}</div>
      </div>
    );
  };

  if (!isOpen) {
    return (
      <div className="flex h-full w-10 flex-col items-center bg-gray-50 pt-3">
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200"
          title="Show chat history"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Sidebar */}
      <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="font-medium text-gray-800">Chat History</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onNewSession}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              title="New chat"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
            <button
              onClick={onToggle}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              title="Hide sidebar"
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
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-sm focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingInline text="" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <EmptyState
              size="sm"
              icon={
                searchQuery ? (
                  <SearchIcon className="h-8 w-8" />
                ) : (
                  <MessageSquare className="h-8 w-8" />
                )
              }
              title={searchQuery ? 'No matching chats' : 'No chat history yet'}
            />
          ) : (
            <>
              {renderGroup('⭐ 书签', groupedSessions.bookmarked)}
              {renderGroup('Today', groupedSessions.today)}
              {renderGroup('Yesterday', groupedSessions.yesterday)}
              {renderGroup('Last 7 Days', groupedSessions.lastWeek)}
              {renderGroup('Older', groupedSessions.older)}
            </>
          )}
        </div>
      </div>
    </>
  );
}
