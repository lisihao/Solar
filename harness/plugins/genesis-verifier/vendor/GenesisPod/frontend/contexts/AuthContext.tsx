'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  type User,
  type AuthState,
  getCurrentUser,
  getAuthTokens,
  saveAuthTokens,
  saveCurrentUser,
  clearAuthTokens,
  loginWithGoogle as authLoginWithGoogle,
  logout as authLogout,
  isUserAdmin,
} from '@/lib/utils/auth';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
interface AuthContextType extends AuthState {
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  loginWithGoogle: (input?: unknown) => void;
  isLoading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load auth state from localStorage on mount and validate token
  useEffect(() => {
    const validateAndRestoreAuth = async () => {
      const tokens = getAuthTokens();
      const cachedUser = getCurrentUser();

      if (!tokens || !cachedUser) {
        setIsLoading(false);
        return;
      }

      try {
        // Direct backend URL to bypass CDN proxy (CDN 503 must not log users out)
        const response = await fetch(`${config.streamApiUrl}/auth/me`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          // API returns { success: true, data: user } format
          const user = result?.data ?? result;
          // Token 有效，更新用户信息
          saveCurrentUser(user);
          setAuthState({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          });
        } else if (response.status === 401) {
          // Only clear on explicit 401 (token rejected by backend)
          logger.warn('Token validation failed (401), clearing auth state');
          clearAuthTokens();
        } else {
          // 5xx or other errors: keep cached state, don't log user out
          logger.warn(
            `Token validation returned ${response.status}, using cached user`
          );
          setAuthState({
            user: cachedUser,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          });
        }
      } catch (error) {
        // 网络错误时使用缓存的用户数据
        logger.warn(
          'Token validation failed due to network error, using cached user'
        );
        setAuthState({
          user: cachedUser,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      }

      setIsLoading(false);
    };

    validateAndRestoreAuth();
  }, []);

  const login = (user: User, accessToken: string, refreshToken: string) => {
    saveAuthTokens({ accessToken, refreshToken });
    saveCurrentUser(user);
    setAuthState({
      user,
      accessToken,
      refreshToken,
    });
  };

  const logout = () => {
    clearAuthTokens();
    setAuthState({
      user: null,
      accessToken: null,
      refreshToken: null,
    });
    authLogout();
  };

  const loginWithGoogle = (input?: unknown) => {
    authLoginWithGoogle(input);
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        loginWithGoogle,
        isLoading,
        isAdmin: isUserAdmin(authState.user),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
