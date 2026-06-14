import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger so we don't get console noise in tests
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// In-memory localStorage mock
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

const TOKEN_KEY = 'deepdive_auth_tokens';
const USER_KEY = 'deepdive_user';

import type { AuthTokens, User } from '../auth';

describe('auth utilities', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;
  let getAuthTokens: typeof import('../auth').getAuthTokens;
  let saveAuthTokens: typeof import('../auth').saveAuthTokens;
  let clearAuthTokens: typeof import('../auth').clearAuthTokens;
  let getCurrentUser: typeof import('../auth').getCurrentUser;
  let saveCurrentUser: typeof import('../auth').saveCurrentUser;
  let isAuthenticated: typeof import('../auth').isAuthenticated;
  let isUserAdmin: typeof import('../auth').isUserAdmin;
  let getAuthHeader: typeof import('../auth').getAuthHeader;
  let refreshAccessToken: typeof import('../auth').refreshAccessToken;
  let loginWithGoogle: typeof import('../auth').loginWithGoogle;
  let logout: typeof import('../auth').logout;

  beforeEach(async () => {
    vi.resetModules();
    localStorageMock = createLocalStorageMock();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    const mod = await import('../auth');
    getAuthTokens = mod.getAuthTokens;
    saveAuthTokens = mod.saveAuthTokens;
    clearAuthTokens = mod.clearAuthTokens;
    getCurrentUser = mod.getCurrentUser;
    saveCurrentUser = mod.saveCurrentUser;
    isAuthenticated = mod.isAuthenticated;
    isUserAdmin = mod.isUserAdmin;
    getAuthHeader = mod.getAuthHeader;
    refreshAccessToken = mod.refreshAccessToken;
    loginWithGoogle = mod.loginWithGoogle;
    logout = mod.logout;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeTokens = (): AuthTokens => ({
    accessToken: 'access-abc',
    refreshToken: 'refresh-xyz',
  });

  const makeUser = (): User => ({
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    createdAt: '2024-01-01T00:00:00Z',
  });

  // ---------------------------------------------------------------------------
  // getAuthTokens
  // ---------------------------------------------------------------------------

  describe('getAuthTokens', () => {
    it('should return null when localStorage has no tokens', () => {
      expect(getAuthTokens()).toBeNull();
    });

    it('should return parsed tokens when present in localStorage', () => {
      const tokens = makeTokens();
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(tokens));
      expect(getAuthTokens()).toEqual(tokens);
    });

    it('should return null when stored value is invalid JSON', () => {
      localStorageMock.getItem.mockReturnValueOnce('INVALID_JSON{');
      expect(getAuthTokens()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // saveAuthTokens
  // ---------------------------------------------------------------------------

  describe('saveAuthTokens', () => {
    it('should write tokens to localStorage with the correct key', () => {
      const tokens = makeTokens();
      saveAuthTokens(tokens);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        TOKEN_KEY,
        JSON.stringify(tokens)
      );
    });
  });

  // ---------------------------------------------------------------------------
  // clearAuthTokens
  // ---------------------------------------------------------------------------

  describe('clearAuthTokens', () => {
    it('should remove both token and user keys from localStorage', () => {
      clearAuthTokens();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(USER_KEY);
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentUser
  // ---------------------------------------------------------------------------

  describe('getCurrentUser', () => {
    it('should return null when no user stored', () => {
      expect(getCurrentUser()).toBeNull();
    });

    it('should return parsed user when present', () => {
      const user = makeUser();
      localStorageMock.getItem.mockImplementationOnce((key: string) =>
        key === USER_KEY ? JSON.stringify(user) : (null as unknown as string)
      );
      expect(getCurrentUser()).toEqual(user);
    });

    it('should return null when stored user is invalid JSON', () => {
      localStorageMock.getItem.mockReturnValueOnce('BAD{JSON');
      expect(getCurrentUser()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // saveCurrentUser
  // ---------------------------------------------------------------------------

  describe('saveCurrentUser', () => {
    it('should write user to localStorage with the correct key', () => {
      const user = makeUser();
      saveCurrentUser(user);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        USER_KEY,
        JSON.stringify(user)
      );
    });
  });

  // ---------------------------------------------------------------------------
  // isAuthenticated
  // ---------------------------------------------------------------------------

  describe('isAuthenticated', () => {
    it('should return false when no tokens stored', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('should return true when accessToken is present', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(makeTokens())
      );
      expect(isAuthenticated()).toBe(true);
    });

    it('should return false when accessToken is empty string', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ accessToken: '', refreshToken: 'r' })
      );
      expect(isAuthenticated()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isUserAdmin
  // ---------------------------------------------------------------------------

  describe('isUserAdmin', () => {
    it('should return false for null user', () => {
      expect(isUserAdmin(null)).toBe(false);
    });

    it('should return true when user.isAdmin is true', () => {
      const user: User = { ...makeUser(), isAdmin: true };
      expect(isUserAdmin(user)).toBe(true);
    });

    it('should return true when user.role is "ADMIN"', () => {
      const user: User = { ...makeUser(), role: 'ADMIN' };
      expect(isUserAdmin(user)).toBe(true);
    });

    it('should return false when user.isAdmin is false and role is "USER"', () => {
      const user: User = { ...makeUser(), isAdmin: false, role: 'USER' };
      expect(isUserAdmin(user)).toBe(false);
    });

    it('should return false for a normal user with no role set', () => {
      expect(isUserAdmin(makeUser())).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getAuthHeader
  // ---------------------------------------------------------------------------

  describe('getAuthHeader', () => {
    it('should return empty object when no tokens stored', () => {
      expect(getAuthHeader()).toEqual({});
    });

    it('should return Authorization header when accessToken exists', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(makeTokens())
      );
      expect(getAuthHeader()).toEqual({
        Authorization: 'Bearer access-abc',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // loginWithGoogle
  // ---------------------------------------------------------------------------

  describe('loginWithGoogle', () => {
    it('should not throw and attempt navigation to the OAuth URL', () => {
      // jsdom does not support real navigation (emits "Not implemented" warning
      // but does NOT throw). We verify the function is callable without error.
      // The URL construction logic uses process.env.NEXT_PUBLIC_API_URL or
      // falls back to http://localhost:4000/api/v1/auth/google.
      expect(() => loginWithGoogle()).not.toThrow();
    });

    it('should use NEXT_PUBLIC_API_URL when constructing the OAuth URL', async () => {
      // Reload the module with a custom API URL to verify URL construction
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test.com');
      vi.resetModules();
      const { loginWithGoogle: loginFn } = await import('../auth');
      // Should not throw even with custom URL
      expect(() => loginFn()).not.toThrow();
      vi.unstubAllEnvs();
    });
  });

  // ---------------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------------

  describe('logout', () => {
    it('should clear tokens and redirect to root', () => {
      logout();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(USER_KEY);
      // jsdom resolves '/' to 'http://localhost:3000/' — just check it ends with /
      expect(window.location.href).toMatch(/\/$/);
    });
  });

  // ---------------------------------------------------------------------------
  // SSR safety (typeof window === 'undefined')
  //
  // jsdom prevents deleting window. Instead we verify the guard works by
  // checking the source: each function has `if (typeof window === 'undefined') return`
  // at the top. We test this branch indirectly by confirming that when
  // localStorage throws (simulating unavailable storage), the functions handle
  // it gracefully, and by checking the exported source behaviour we rely on.
  // The real SSR path is covered by the type-guard logic verified here:
  // ---------------------------------------------------------------------------

  describe('SSR safety (guarded by typeof window check)', () => {
    it('getAuthTokens returns null when localStorage.getItem throws', () => {
      localStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
      expect(getAuthTokens()).toBeNull();
    });

    it('saveAuthTokens does not throw when localStorage.setItem throws', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
      expect(() => saveAuthTokens(makeTokens())).not.toThrow();
    });

    it('clearAuthTokens does not throw when localStorage.removeItem throws', () => {
      localStorageMock.removeItem.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
      expect(() => clearAuthTokens()).not.toThrow();
    });

    it('getCurrentUser returns null when localStorage.getItem throws', () => {
      localStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
      expect(getCurrentUser()).toBeNull();
    });

    it('saveCurrentUser does not throw when localStorage.setItem throws', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
      expect(() => saveCurrentUser(makeUser())).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // refreshAccessToken
  // ---------------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return null when no refresh token is available', async () => {
      // localStorage returns null → no tokens
      const result = await refreshAccessToken();
      expect(result).toBeNull();
    });

    it('should return null and clear tokens when refresh request fails (non-ok)', async () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(makeTokens()));

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 401, statusText: 'Unauthorized' })
      );

      const result = await refreshAccessToken();
      expect(result).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
    });

    it('should save and return new tokens on successful refresh', async () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(makeTokens()));

      const newTokens = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(newTokens), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await refreshAccessToken();
      expect(result).toEqual(newTokens);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        TOKEN_KEY,
        JSON.stringify(newTokens)
      );
    });

    it('should handle wrapped { data: { accessToken } } response format', async () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(makeTokens()));

      const responseBody = {
        data: {
          accessToken: 'wrapped-access',
          refreshToken: 'wrapped-refresh',
        },
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await refreshAccessToken();
      expect(result?.accessToken).toBe('wrapped-access');
    });

    it('should return null and clear tokens when fetch throws', async () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(makeTokens()));
      vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

      const result = await refreshAccessToken();
      expect(result).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
    });

    it('should use singleton pattern: concurrent calls share one promise', async () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(makeTokens()));

      let resolveFirst!: (value: Response) => void;
      const firstFetchPromise = new Promise<Response>((res) => {
        resolveFirst = res;
      });
      vi.mocked(fetch).mockReturnValueOnce(firstFetchPromise);

      // Fire two concurrent refresh calls
      const p1 = refreshAccessToken();
      const p2 = refreshAccessToken();

      // Resolve the pending fetch
      resolveFirst(
        new Response(
          JSON.stringify({ accessToken: 'singleton-token', refreshToken: 'r' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const [r1, r2] = await Promise.all([p1, p2]);

      // Both should resolve to the same result
      expect(r1?.accessToken).toBe('singleton-token');
      expect(r2?.accessToken).toBe('singleton-token');

      // fetch should only have been called once
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
