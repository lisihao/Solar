/**
 * Tests for contexts/AuthContext.tsx
 *
 * Tests AuthProvider initialization, token validation logic, login/logout
 * actions, and the useAuth hook guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockGetAuthTokens,
  mockGetCurrentUser,
  mockSaveAuthTokens,
  mockSaveCurrentUser,
  mockClearAuthTokens,
  mockLoginWithGoogle,
  mockLogout,
  mockIsUserAdmin,
} = vi.hoisted(() => ({
  mockGetAuthTokens: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockSaveAuthTokens: vi.fn(),
  mockSaveCurrentUser: vi.fn(),
  mockClearAuthTokens: vi.fn(),
  mockLoginWithGoogle: vi.fn(),
  mockLogout: vi.fn(),
  mockIsUserAdmin: vi.fn(),
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: mockGetAuthTokens,
  getCurrentUser: mockGetCurrentUser,
  saveAuthTokens: mockSaveAuthTokens,
  saveCurrentUser: mockSaveCurrentUser,
  clearAuthTokens: mockClearAuthTokens,
  loginWithGoogle: mockLoginWithGoogle,
  logout: mockLogout,
  isUserAdmin: mockIsUserAdmin,
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    streamApiUrl: 'http://test-backend',
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { AuthProvider, useAuth } from '../AuthContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(AuthProvider, null, children);

const USER = {
  id: 'u-1',
  email: 'test@example.com',
  username: 'tester',
  createdAt: '2026-01-01',
  role: 'USER' as const,
  isAdmin: false,
};

const TOKENS = { accessToken: 'access-123', refreshToken: 'refresh-456' };

function okResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function statusResponse(status: number) {
  return Promise.resolve(new Response('', { status }));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockIsUserAdmin.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Initialization — no stored tokens
// ---------------------------------------------------------------------------

describe('AuthProvider initialization without tokens', () => {
  it('sets isLoading to false when no tokens are stored', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    mockGetCurrentUser.mockReturnValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Initialization — tokens present, validation succeeds (200)
// ---------------------------------------------------------------------------

describe('AuthProvider initialization with valid token', () => {
  it('sets user from API response when token is valid', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(okResponse({ success: true, data: USER }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual(USER);
    expect(result.current.accessToken).toBe('access-123');
    expect(mockSaveCurrentUser).toHaveBeenCalledWith(USER);
  });

  it('passes Authorization header to /auth/me', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(okResponse({ success: true, data: USER }));

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-backend/auth/me',
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-123' },
        })
      );
    });
  });

  it('unwraps plain user when response is not wrapped', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(okResponse(USER));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toEqual(USER);
  });
});

// ---------------------------------------------------------------------------
// Initialization — 401 clears auth state
// ---------------------------------------------------------------------------

describe('AuthProvider initialization with 401 response', () => {
  it('clears tokens and sets user to null on 401', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(statusResponse(401));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockClearAuthTokens).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Initialization — 5xx keeps cached user
// ---------------------------------------------------------------------------

describe('AuthProvider initialization with 5xx response', () => {
  it('keeps cached user on 503 (CDN error)', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(statusResponse(503));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual(USER);
    expect(result.current.accessToken).toBe('access-123');
    expect(mockClearAuthTokens).not.toHaveBeenCalled();
  });

  it('keeps cached user on 500', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(statusResponse(500));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual(USER);
  });
});

// ---------------------------------------------------------------------------
// Initialization — network error keeps cached user
// ---------------------------------------------------------------------------

describe('AuthProvider initialization with network error', () => {
  it('keeps cached user when fetch throws', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual(USER);
    expect(result.current.accessToken).toBe('access-123');
  });
});

// ---------------------------------------------------------------------------
// login action
// ---------------------------------------------------------------------------

describe('login', () => {
  it('sets user and tokens in state', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    mockGetCurrentUser.mockReturnValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.login(USER, 'new-access', 'new-refresh');
    });

    expect(result.current.user).toEqual(USER);
    expect(result.current.accessToken).toBe('new-access');
    expect(result.current.refreshToken).toBe('new-refresh');
    expect(mockSaveAuthTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(mockSaveCurrentUser).toHaveBeenCalledWith(USER);
  });
});

// ---------------------------------------------------------------------------
// logout action
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('clears state and calls authLogout', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue(USER);
    mockFetch.mockReturnValue(okResponse({ success: true, data: USER }));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
    expect(result.current.refreshToken).toBeNull();
    expect(mockClearAuthTokens).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loginWithGoogle action
// ---------------------------------------------------------------------------

describe('loginWithGoogle', () => {
  it('calls authLoginWithGoogle', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    mockGetCurrentUser.mockReturnValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.loginWithGoogle();
    });

    expect(mockLoginWithGoogle).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isAdmin computed value
// ---------------------------------------------------------------------------

describe('isAdmin', () => {
  it('reflects isUserAdmin result for logged-in user', async () => {
    mockGetAuthTokens.mockReturnValue(TOKENS);
    mockGetCurrentUser.mockReturnValue({ ...USER, role: 'ADMIN' });
    mockFetch.mockReturnValue(
      okResponse({ ...USER, role: 'ADMIN', isAdmin: true })
    );
    mockIsUserAdmin.mockReturnValue(true);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(true);
  });

  it('returns false when user is null', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    mockGetCurrentUser.mockReturnValue(null);
    mockIsUserAdmin.mockReturnValue(false);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useAuth guard
// ---------------------------------------------------------------------------

describe('useAuth guard', () => {
  it('throws when used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });
});
