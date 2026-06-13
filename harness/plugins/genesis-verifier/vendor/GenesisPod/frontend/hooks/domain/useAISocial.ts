/**
 * AI Social Hook
 *
 * React hooks for social media content publishing functionality
 */

import { useState, useCallback } from 'react';
import {
  // Types
  SocialPlatformConnection,
  SocialContent,
  SocialPublishLog,
  ComplianceCheckResult,
  SocialPlatformType,
  SocialContentStatus,
  SocialContentType,
  SocialContentSourceType,
  SocialReviewStatus,
  InitConnectionResponse,
  VerifyConnectionResponse,
  // DTOs
  CreateContentDto,
  UpdateContentDto,
  ProcessUrlDto,
  ProcessSourceDto,
  PlatformConfigDto,
  // API functions
  getConnections,
  getConnection,
  getConnectionByPlatform,
  upsertConnection,
  deleteConnection,
  testConnection,
  refreshConnection,
  initConnection,
  verifyConnection,
  getContents,
  getContent,
  createContent,
  updateContent,
  deleteContent,
  processUrl,
  processSource,
  regenerateContent,
  checkCompliance,
  approveContent,
  rejectContent,
  requestRevision,
  resubmitForReview,
  publishContent,
  scheduleContent,
  cancelSchedule,
  getPublishLogs,
  getExploreSources,
  getResearchSources,
  getOfficeSources,
  getWritingSources,
  getTopicInsightsSources,
  // XHS MCP
  XhsLoginStatus,
  XhsFeed,
  XhsFeedDetail,
  XhsUserProfile,
  xhsGetLoginStatus,
  xhsListFeeds,
  xhsSearchFeeds,
  xhsGetFeedDetail,
  xhsPostComment,
  xhsGetUserProfile,
} from '@/services/ai-social/api';

// Re-export types for convenience
export type {
  SocialPlatformConnection,
  SocialContent,
  SocialPublishLog,
  ComplianceCheckResult,
  SocialPlatformType,
  SocialContentStatus,
  SocialContentType,
  SocialContentSourceType,
  SocialReviewStatus,
  InitConnectionResponse,
  VerifyConnectionResponse,
  CreateContentDto,
  UpdateContentDto,
  ProcessUrlDto,
  ProcessSourceDto,
  PlatformConfigDto,
};

// ==================== Connection Hooks ====================

/**
 * Hook for managing platform connections
 */
export function useSocialConnections() {
  const [connections, setConnections] = useState<SocialPlatformConnection[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getConnections();
      setConnections(data);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch connections';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConnection = useCallback(async (id: string) => {
    try {
      return await getConnection(id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch connection';
      setError(message);
      return null;
    }
  }, []);

  const fetchConnectionByPlatform = useCallback(
    async (platformType: SocialPlatformType) => {
      try {
        return await getConnectionByPlatform(platformType);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch connection';
        setError(message);
        return null;
      }
    },
    []
  );

  const saveConnection = useCallback(
    async (platformType: SocialPlatformType, config: PlatformConfigDto) => {
      setLoading(true);
      setError(null);
      try {
        const connection = await upsertConnection(platformType, config);
        setConnections((prev) => {
          const exists = prev.find((c) => c.id === connection.id);
          if (exists) {
            return prev.map((c) => (c.id === connection.id ? connection : c));
          }
          return [...prev, connection];
        });
        return connection;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to save connection';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const removeConnection = useCallback(
    async (platformType: SocialPlatformType) => {
      setLoading(true);
      setError(null);
      try {
        await deleteConnection(platformType);
        setConnections((prev) =>
          prev.filter((c) => c.platformType !== platformType)
        );
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete connection';
        setError(message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const testPlatformConnection = useCallback(async (id: string) => {
    try {
      return await testConnection(id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Connection test failed';
      return { success: false, message };
    }
  }, []);

  const refreshPlatformConnection = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const connection = await refreshConnection(id);
      setConnections((prev) =>
        prev.map((c) => (c.id === connection.id ? connection : c))
      );
      return connection;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to refresh connection';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const startConnection = useCallback(
    async (platformType: SocialPlatformType) => {
      setLoading(true);
      setError(null);
      try {
        const result = await initConnection(platformType);
        if (result.status === 'existing' && result.connection) {
          setConnections((prev) => {
            const exists = prev.find((c) => c.id === result.connection!.id);
            if (exists) return prev;
            return [...prev, result.connection!];
          });
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to start connection';
        setError(message);
        return { status: 'error' as const, message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const checkConnection = useCallback(
    async (platformType: SocialPlatformType) => {
      try {
        const result = await verifyConnection(platformType);
        if (result.status === 'success' && result.connection) {
          setConnections((prev) => {
            const exists = prev.find((c) => c.id === result.connection!.id);
            if (exists) {
              return prev.map((c) =>
                c.id === result.connection!.id ? result.connection! : c
              );
            }
            return [...prev, result.connection!];
          });
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to verify connection';
        return { status: 'error' as const, message };
      }
    },
    []
  );

  return {
    connections,
    loading,
    error,
    fetchConnections,
    fetchConnection,
    fetchConnectionByPlatform,
    saveConnection,
    removeConnection,
    testConnection: testPlatformConnection,
    refreshConnection: refreshPlatformConnection,
    startConnection,
    checkConnection,
  };
}

// ==================== Content Hooks ====================

/**
 * Hook for managing social contents
 */
export function useSocialContents() {
  const [contents, setContents] = useState<SocialContent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContents = useCallback(
    async (options?: {
      status?: SocialContentStatus;
      contentType?: SocialContentType;
      sourceType?: SocialContentSourceType;
      reviewStatus?: SocialReviewStatus;
      limit?: number;
      offset?: number;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getContents(options);
        setContents(data.items);
        setTotal(data.total);
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch contents';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchContent = useCallback(async (id: string) => {
    try {
      return await getContent(id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch content';
      setError(message);
      return null;
    }
  }, []);

  const addContent = useCallback(async (dto: CreateContentDto) => {
    setLoading(true);
    setError(null);
    try {
      const content = await createContent(dto);
      setContents((prev) => [content, ...prev]);
      setTotal((prev) => prev + 1);
      return content;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create content';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const editContent = useCallback(async (id: string, dto: UpdateContentDto) => {
    setLoading(true);
    setError(null);
    try {
      const content = await updateContent(id, dto);
      setContents((prev) => prev.map((c) => (c.id === id ? content : c)));
      return content;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update content';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeContent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await deleteContent(id);
      setContents((prev) => prev.filter((c) => c.id !== id));
      setTotal((prev) => prev - 1);
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete content';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    contents,
    total,
    loading,
    error,
    fetchContents,
    fetchContent,
    addContent,
    editContent,
    removeContent,
  };
}

// ==================== AI Engine Hooks ====================

/**
 * Hook for AI-powered content processing
 */
export function useSocialAIEngine() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFromUrl = useCallback(async (dto: ProcessUrlDto) => {
    setLoading(true);
    setError(null);
    try {
      return await processUrl(dto);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to process URL';
      setError(message);
      // Re-throw so component can catch with specific message
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const processFromSource = useCallback(async (dto: ProcessSourceDto) => {
    setLoading(true);
    setError(null);
    try {
      return await processSource(dto);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to process source';
      setError(message);
      // Re-throw so component can catch with specific message
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const regenerate = useCallback(async (contentId: string) => {
    setLoading(true);
    setError(null);
    try {
      return await regenerateContent(contentId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to regenerate content';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const checkContentCompliance = useCallback(async (contentId: string) => {
    setLoading(true);
    setError(null);
    try {
      return await checkCompliance(contentId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to check compliance';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    processFromUrl,
    processFromSource,
    regenerate,
    checkCompliance: checkContentCompliance,
  };
}

// ==================== Review Hooks ====================

/**
 * Hook for content review workflow
 */
export function useSocialReview() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async (contentId: string, notes?: string) => {
    setLoading(true);
    setError(null);
    try {
      return await approveContent(contentId, notes);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to approve content';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reject = useCallback(async (contentId: string, notes: string) => {
    setLoading(true);
    setError(null);
    try {
      return await rejectContent(contentId, notes);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to reject content';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const requestContentRevision = useCallback(
    async (contentId: string, notes: string) => {
      setLoading(true);
      setError(null);
      try {
        return await requestRevision(contentId, notes);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to request revision';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const resubmit = useCallback(async (contentId: string) => {
    setLoading(true);
    setError(null);
    try {
      return await resubmitForReview(contentId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to resubmit for review';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    approve,
    reject,
    requestRevision: requestContentRevision,
    resubmit,
  };
}

// ==================== Publish Hooks ====================

/**
 * Hook for content publishing
 */
export function useSocialPublish() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<SocialPublishLog[]>([]);

  const publish = useCallback(
    async (contentId: string, connectionId?: string) => {
      setLoading(true);
      setError(null);
      try {
        return await publishContent(
          contentId,
          connectionId ? { connectionId } : undefined
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to publish content';
        setError(message);
        return { success: false, errorMessage: message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const schedule = useCallback(
    async (contentId: string, scheduledAt: string, connectionId?: string) => {
      setLoading(true);
      setError(null);
      try {
        return await scheduleContent(contentId, scheduledAt, connectionId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to schedule content';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const unschedule = useCallback(async (contentId: string) => {
    setLoading(true);
    setError(null);
    try {
      return await cancelSchedule(contentId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to cancel schedule';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async (contentId: string) => {
    try {
      const data = await getPublishLogs(contentId);
      setLogs(data);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch logs';
      setError(message);
      return [];
    }
  }, []);

  return {
    loading,
    error,
    logs,
    publish,
    schedule,
    unschedule,
    fetchLogs,
  };
}

// ==================== Source Hooks ====================

/**
 * Hook for fetching available content sources
 */
export function useSocialSources() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExplore = useCallback(
    async (options?: { limit?: number; offset?: number; type?: string }) => {
      setLoading(true);
      setError(null);
      try {
        return await getExploreSources(options);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to fetch explore sources';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchResearch = useCallback(
    async (options?: { limit?: number; offset?: number }) => {
      setLoading(true);
      setError(null);
      try {
        return await getResearchSources(options);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to fetch research sources';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchOffice = useCallback(
    async (options?: { limit?: number; offset?: number }) => {
      setLoading(true);
      setError(null);
      try {
        return await getOfficeSources(options);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch office sources';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchWriting = useCallback(
    async (options?: { limit?: number; offset?: number }) => {
      setLoading(true);
      setError(null);
      try {
        return await getWritingSources(options);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to fetch writing sources';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchTopicInsights = useCallback(
    async (options?: { limit?: number; offset?: number }) => {
      setLoading(true);
      setError(null);
      try {
        return await getTopicInsightsSources(options);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to fetch topic insights sources';
        setError(message);
        return { items: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    fetchExplore,
    fetchResearch,
    fetchOffice,
    fetchWriting,
    fetchTopicInsights,
  };
}

// ==================== XHS MCP Hooks ====================

/**
 * Hook for Xiaohongshu MCP features (search, feeds, comments, profiles)
 */
export function useXhsFeatures() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getLoginStatus = useCallback(async () => {
    try {
      return await xhsGetLoginStatus();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to check XHS login';
      setError(message);
      return { loggedIn: false };
    }
  }, []);

  const listFeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await xhsListFeeds();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to list feeds';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const searchFeeds = useCallback(async (keyword: string) => {
    setLoading(true);
    setError(null);
    try {
      return await xhsSearchFeeds(keyword);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to search feeds';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getFeedDetail = useCallback(
    async (feedId: string, xsecToken: string) => {
      setLoading(true);
      setError(null);
      try {
        return await xhsGetFeedDetail(feedId, xsecToken);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to get feed detail';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const postComment = useCallback(
    async (feedId: string, xsecToken: string, content: string) => {
      setLoading(true);
      setError(null);
      try {
        return await xhsPostComment(feedId, xsecToken, content);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to post comment';
        setError(message);
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const getUserProfile = useCallback(
    async (userId: string, xsecToken: string) => {
      setLoading(true);
      setError(null);
      try {
        return await xhsGetUserProfile(userId, xsecToken);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to get user profile';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    getLoginStatus,
    listFeeds,
    searchFeeds,
    getFeedDetail,
    postComment,
    getUserProfile,
  };
}

// ==================== Combined Hook ====================

/**
 * Combined hook for all AI Social functionality
 */
export function useAISocial() {
  const connections = useSocialConnections();
  const contents = useSocialContents();
  const aiEngine = useSocialAIEngine();
  const review = useSocialReview();
  const publish = useSocialPublish();
  const sources = useSocialSources();
  const xhs = useXhsFeatures();

  return {
    connections,
    contents,
    aiEngine,
    review,
    publish,
    sources,
    xhs,
  };
}
