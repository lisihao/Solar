/**
 * MCP Session Manager
 *
 * 管理 MCP 会话的完整生命周期，替代原有的简单 LRU Map。
 * 每个 Session 关联权限策略、执行历史、活跃状态追踪。
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import {
  MCPSession,
  MCPPermissionPolicy,
  MCPRequestContext,
} from "../abstractions/mcp-server.interface";
import { LruMap } from "@/common/utils/lru-map";

/**
 * 默认权限策略: 最小权限原则
 * 仅允许 curated (精选) 工具，需要显式授权才能使用 bridge 工具
 */
const DEFAULT_POLICY: MCPPermissionPolicy = {
  allowedToolPatterns: [
    "genesis_*", // curated tools (genesis_ask, genesis_deep_research, etc.)
  ],
  deniedToolPatterns: [],
  maxConcurrency: 5,
  dailyQuota: 1000,
  allowStreaming: true,
  allowResources: true,
  allowPrompts: true,
};

const MAX_SESSIONS = 2000;

@Injectable()
export class MCPSessionManager {
  private readonly logger = new Logger(MCPSessionManager.name);
  private readonly sessions = new LruMap<string, MCPSession>(MAX_SESSIONS);
  private readonly dailyUsage = new Map<
    string,
    { count: number; resetAt: Date }
  >();

  /**
   * 创建新会话
   */
  createSession(
    apiKeyId: string,
    clientInfo?: { name: string; version: string },
    policy?: Partial<MCPPermissionPolicy>,
  ): MCPSession {
    const sessionId = `mcp-${randomBytes(16).toString("hex")}`;
    const now = new Date();

    const session: MCPSession = {
      sessionId,
      apiKeyId,
      clientInfo,
      permissionPolicy: { ...DEFAULT_POLICY, ...policy },
      createdAt: now,
      lastActiveAt: now,
    };

    this.sessions.set(sessionId, session);
    this.logger.log(
      `Session created: ${sessionId} (client: ${clientInfo?.name || "unknown"})`,
    );

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): MCPSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = new Date();
    }
    return session;
  }

  /**
   * 终止会话
   */
  terminateSession(sessionId: string): boolean {
    const existed = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);
    if (existed) {
      this.logger.log(`Session terminated: ${sessionId}`);
    }
    return existed;
  }

  /**
   * 检查工具权限
   */
  isToolAllowed(sessionId: string, toolName: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.permissionPolicy) return false; // fail-closed: 无会话则拒绝

    const policy = session.permissionPolicy;

    // 检查 deny 列表（优先）
    for (const pattern of policy.deniedToolPatterns) {
      if (this.matchPattern(toolName, pattern)) {
        return false;
      }
    }

    // 检查 allow 列表
    for (const pattern of policy.allowedToolPatterns) {
      if (this.matchPattern(toolName, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 原子性验证工具权限 + 消费配额
   * 避免权限检查与配额消耗之间 session 被销毁的竞态条件
   */
  validateAndConsumeQuota(
    apiKeyId: string,
    sessionId?: string,
    toolName?: string,
  ): { allowed: boolean; reason?: string } {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    // Session 权限检查（如有 session 且指定 tool）
    if (session && toolName) {
      if (!session.permissionPolicy) {
        return { allowed: false, reason: "permission_denied" };
      }
      const policy = session.permissionPolicy;
      // 检查 deny 列表（优先）
      for (const pattern of policy.deniedToolPatterns) {
        if (this.matchPattern(toolName, pattern)) {
          return { allowed: false, reason: "permission_denied" };
        }
      }
      // 检查 allow 列表
      let allowed = false;
      for (const pattern of policy.allowedToolPatterns) {
        if (this.matchPattern(toolName, pattern)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return { allowed: false, reason: "permission_denied" };
      }
    } else if (sessionId && !session) {
      // Session ID provided but session not found (may have been terminated)
      return { allowed: false, reason: "session_expired" };
    }

    // 配额消耗
    const dailyQuota =
      session?.permissionPolicy?.dailyQuota ?? DEFAULT_POLICY.dailyQuota;
    if (!this.consumeQuotaInternal(apiKeyId, dailyQuota)) {
      return { allowed: false, reason: "quota_exceeded" };
    }

    // 更新 session 活跃时间
    if (session) {
      session.lastActiveAt = new Date();
    }

    return { allowed: true };
  }

  /**
   * 检查并消费每日配额（保留向后兼容）
   */
  consumeQuota(apiKeyId: string, sessionId?: string): boolean {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    const dailyQuota =
      session?.permissionPolicy?.dailyQuota ?? DEFAULT_POLICY.dailyQuota;
    return this.consumeQuotaInternal(apiKeyId, dailyQuota);
  }

  private consumeQuotaInternal(apiKeyId: string, dailyQuota: number): boolean {
    const now = new Date();
    let usage = this.dailyUsage.get(apiKeyId);

    // 重置过期的计数器
    if (!usage || usage.resetAt <= now) {
      const resetAt = new Date(now);
      resetAt.setHours(24, 0, 0, 0);
      usage = { count: 0, resetAt };
      this.dailyUsage.set(apiKeyId, usage);
    }

    if (usage.count >= dailyQuota) {
      return false;
    }

    usage.count++;
    return true;
  }

  /**
   * 检查是否允许 Resources（同时更新 lastActiveAt）
   */
  isResourceAllowed(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    return session.permissionPolicy?.allowResources ?? false;
  }

  /**
   * 检查是否允许 Prompts（同时更新 lastActiveAt）
   */
  isPromptAllowed(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    return session.permissionPolicy?.allowPrompts ?? false;
  }

  /**
   * 获取所有活跃会话
   */
  getAllSessions(): MCPSession[] {
    const result: MCPSession[] = [];
    for (const session of this.sessions.values()) {
      result.push(session);
    }
    return result;
  }

  /**
   * 获取会话统计
   */
  getStats(): {
    activeSessions: number;
    byClient: Record<string, number>;
    byApiKey: Record<string, number>;
  } {
    const byClient: Record<string, number> = {};
    const byApiKey: Record<string, number> = {};

    for (const session of this.sessions.values()) {
      const clientName = session.clientInfo?.name || "unknown";
      byClient[clientName] = (byClient[clientName] || 0) + 1;
      byApiKey[session.apiKeyId] = (byApiKey[session.apiKeyId] || 0) + 1;
    }

    return {
      activeSessions: this.sessions.size,
      byClient,
      byApiKey,
    };
  }

  /**
   * 从 MCPRequestContext 获取或创建 Session
   */
  resolveSession(context: MCPRequestContext): MCPSession | undefined {
    if (context.sessionId) {
      return this.getSession(context.sessionId);
    }
    return undefined;
  }

  /**
   * Glob-style 通配符匹配
   * 支持: "*" (全匹配), "genesis_*" (前缀), "*_search" (后缀),
   *       "tool_web_*" (前缀), "tool_*_v2" (中间通配)
   */
  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return value === pattern;

    // Simple glob matching without regex (avoids ReDoS)
    const parts = pattern.split("*");
    let pos = 0;

    // First part must match at start
    if (parts[0] && !value.startsWith(parts[0])) return false;
    pos = parts[0].length;

    // Middle parts must match in order
    for (let i = 1; i < parts.length - 1; i++) {
      const idx = value.indexOf(parts[i], pos);
      if (idx === -1) return false;
      pos = idx + parts[i].length;
    }

    // Last part must match at end
    const lastPart = parts[parts.length - 1];
    if (lastPart && !value.endsWith(lastPart)) return false;
    if (lastPart && value.length - lastPart.length < pos) return false;

    return true;
  }
}
