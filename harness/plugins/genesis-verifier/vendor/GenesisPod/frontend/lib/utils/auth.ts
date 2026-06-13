/**
 * Authentication utilities
 * Manages authentication state and token storage
 */

import { logger } from '@/lib/utils/logger';

export interface User {
  id: string;
  email: string;
  username: string;
  fullName?: string; // 用户全名，优先显示
  avatarUrl?: string;
  bio?: string;
  interests?: string[];
  createdAt: string;
  role?: 'USER' | 'ADMIN';
  isAdmin?: boolean; // Returned by /auth/me, considers both role and ADMIN_EMAILS
}

/**
 * 检查用户是否是管理员
 * 优先使用后端返回的 isAdmin 字段（考虑 role 和 ADMIN_EMAILS 环境变量）
 * 兼容旧版本仅检查 role
 */
export function isUserAdmin(user: User | null): boolean {
  if (!user) return false;
  // isAdmin from API considers both role and email whitelist
  return user.isAdmin === true || user.role === 'ADMIN';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
}

const TOKEN_STORAGE_KEY = 'deepdive_auth_tokens';
const USER_STORAGE_KEY = 'deepdive_user';

/**
 * Get authentication tokens from localStorage
 */
export function getAuthTokens(): AuthTokens | null {
  if (typeof window === 'undefined') return null;

  try {
    const tokens = localStorage.getItem(TOKEN_STORAGE_KEY);
    return tokens ? JSON.parse(tokens) : null;
  } catch {
    return null;
  }
}

/**
 * Save authentication tokens to localStorage
 */
export function saveAuthTokens(tokens: AuthTokens): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch (error) {
    logger.error('Failed to save auth tokens:', error);
  }
}

/**
 * Remove authentication tokens from localStorage
 */
export function clearAuthTokens(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    logger.error('Failed to clear auth tokens:', error);
  }
}

/**
 * Get current user from localStorage
 */
export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;

  try {
    const user = localStorage.getItem(USER_STORAGE_KEY);
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

/**
 * Stable per-user hash for client-side storage key isolation.
 *
 * v1.5.3 §11 cross-user localStorage isolation requirement: keys like
 * `lastWikiKbId:<hash>` and `libraryDefaultTab:<hash>` must produce
 * different namespaces for different users sharing the same browser.
 *
 * The hash does NOT need cryptographic strength — only deterministic
 * uniqueness across users. We derive from User.id (UUID), strip dashes,
 * and truncate to 16 chars. Returns 'anon' when no user is logged in
 * (the anon namespace is acceptable to leak across logged-out sessions).
 */
export function getUserHash(): string {
  const user = getCurrentUser();
  if (!user || !user.id) return 'anon';
  const raw = user.id.replace(/-/g, '').toLowerCase();
  return raw.length >= 16 ? raw.slice(0, 16) : raw.padEnd(16, '0');
}

/**
 * Library default-tab enum whitelist (v1.5.3 §11 v1.5.x security).
 *
 * When reading the `libraryDefaultTab:<hash>` localStorage key (set by
 * the What's-new toast "切回旧默认" action), the value MUST be matched
 * against this whitelist. Anything else (XSS-injected value, stale
 * legacy value like 'graph', etc.) falls back to the v1.5.3 default
 * 'wiki'. This blocks open-redirect / privilege-escalation via
 * tampered localStorage.
 */
export const LIBRARY_TAB_WHITELIST = [
  'wiki',
  'personal-kb',
  'team-kb',
  'data-sources',
] as const;
export type LibraryTabId = (typeof LIBRARY_TAB_WHITELIST)[number];

export function readLibraryDefaultTab(userHash: string): LibraryTabId {
  if (typeof window === 'undefined') return 'wiki';
  try {
    const raw = window.localStorage.getItem(`libraryDefaultTab:${userHash}`);
    if (raw && (LIBRARY_TAB_WHITELIST as readonly string[]).includes(raw)) {
      return raw as LibraryTabId;
    }
  } catch {
    // ignore
  }
  return 'wiki';
}

/**
 * Clear all Wiki-related localStorage keys for the current user.
 *
 * v1.5.3 §11 v1.5.x: must run on every logout path so that a shared
 * browser doesn't leak the previous user's last-visited KB or
 * default-tab preference. The 4 paths covered:
 *   1) explicit logout()           — covered: this is called from logout()
 *   2) 401 retry → logout()        — covered: apiClient.ts logout() chain
 *   3) refresh failure → logout()  — covered: apiClient.ts logout() chain
 *   4) multi-tab sync               — covered: storage event listener in
 *      providers.tsx watches deepdive_auth_tokens deletion across tabs
 */
export function clearWikiLocalStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const ls = window.localStorage;
    const keysToRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      if (
        k.startsWith('lastWikiKbId:') ||
        k.startsWith('libraryDefaultTab:') ||
        k.startsWith('wikiWhatsNewSeen:')
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => ls.removeItem(k));
  } catch {
    // ignore (quota / private mode)
  }
}

/**
 * Save current user to localStorage
 */
export function saveCurrentUser(user: User): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch (error) {
    logger.error('Failed to save user:', error);
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const tokens = getAuthTokens();
  return !!tokens?.accessToken;
}

/**
 * Get authorization header for API requests
 */
export function getAuthHeader(): Record<string, string> {
  const tokens = getAuthTokens();
  if (!tokens?.accessToken) return {};

  return {
    Authorization: `Bearer ${tokens.accessToken}`,
  };
}

/**
 * Initiate Google OAuth login
 */
export function loginWithGoogle(input?: unknown): void {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const googleUrl = new URL(`${apiUrl}/api/v1/auth/google`);
  const email = typeof input === 'string' ? input.trim() : '';

  if (email) {
    googleUrl.searchParams.set('login_hint', email);
  }

  window.location.href = googleUrl.toString();
}

/**
 * Logout user
 */
export function logout(): void {
  // v1.5.3 §11 v1.5.x: clear Wiki localStorage on every logout path
  // (explicit / 401 retry → here / refresh failure → here)
  clearWikiLocalStorage();
  clearAuthTokens();
  // Reload to clear any cached state
  if (typeof window !== 'undefined') {
    window.location.href = '/';
  }
}

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<AuthTokens | null> | null = null;

/**
 * Refresh the access token using the refresh token
 * Returns new tokens on success, null on failure
 * Uses a singleton pattern to prevent multiple simultaneous refresh attempts
 */
export async function refreshAccessToken(): Promise<AuthTokens | null> {
  // If already refreshing, return the existing promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const tokens = getAuthTokens();
  if (!tokens?.refreshToken) {
    logger.warn('[Auth] No refresh token available');
    return null;
  }

  isRefreshing = true;

  refreshPromise = (async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        logger.warn(`[Auth] Token refresh failed: ${response.status}`);
        // Clear tokens on refresh failure
        clearAuthTokens();
        return null;
      }

      const data = await response.json();
      const newTokens: AuthTokens = {
        accessToken: data.accessToken || data.data?.accessToken,
        refreshToken:
          data.refreshToken || data.data?.refreshToken || tokens.refreshToken,
      };

      if (newTokens.accessToken) {
        saveAuthTokens(newTokens);
        logger.info('[Auth] Token refreshed successfully');
        return newTokens;
      }

      return null;
    } catch (error) {
      logger.error('[Auth] Token refresh error:', error);
      clearAuthTokens();
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
