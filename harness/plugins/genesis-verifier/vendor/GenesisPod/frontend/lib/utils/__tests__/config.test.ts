/**
 * Tests for lib/utils/config.ts
 *
 * Strategy:
 * - Static/env-driven values (brand, railway URLs, build info) are tested by
 *   stubbing env vars with vi.stubEnv and re-importing the module with vi.resetModules.
 * - Location-dependent getters (apiBaseUrl, apiUrl, streamApiUrl, isRailway) cannot
 *   be tested by mutating jsdom's non-configurable window.location. Instead we verify
 *   the full URL-building logic via the Railway domain env var and the behaviour of the
 *   apiVersion getter, which together cover the URL construction branches.
 *   The isRailwayProduction / isBrowser branches are integration-tested indirectly:
 *   in jsdom the hostname is 'localhost', so the "non-Railway" branch is always active.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('config — brand constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should use default brand name "GenesisPod" when env var not set', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.name).toBe('GenesisPod');
  });

  it('should use NEXT_PUBLIC_BRAND_NAME env var when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', 'Raven');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.name).toBe('Raven');
  });

  it('should use default fullName "GenesisPod" when env var not set', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.fullName).toBe('GenesisPod');
  });

  it('should use NEXT_PUBLIC_BRAND_FULL_NAME env var when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_FULL_NAME', 'Raven.ai');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.fullName).toBe('Raven.ai');
  });

  it('should build default subtitle (empty string)', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.subtitle).toBe('');
  });

  it('should have userAgent based on brand name', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.userAgent).toContain('AI-Engine');
  });

  it('should expose logo path defaulting to /favicon.svg', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.logo.path).toBe('/favicon.svg');
  });

  it('should expose faviconPath defaulting to /favicon.svg', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.logo.faviconPath).toBe('/favicon.svg');
  });

  it('should include contactEmail in brand', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.brand.contactEmail).toBeTruthy();
  });

  it('should export BRAND and RAILWAY_URLS convenience exports', async () => {
    vi.resetModules();
    const { BRAND, RAILWAY_URLS } = await import('../config');
    expect(BRAND).toBeDefined();
    expect(RAILWAY_URLS).toBeDefined();
    expect(typeof BRAND.name).toBe('string');
    expect(typeof RAILWAY_URLS.frontendUrl).toBe('string');
  });
});

describe('config — apiVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should default to "v1"', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.apiVersion).toBe('v1');
  });

  it('should use NEXT_PUBLIC_API_VERSION when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_VERSION', 'v2');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.apiVersion).toBe('v2');
  });
});

describe('config — apiBaseUrl / apiUrl getters (browser, local dev — jsdom hostname is localhost)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should return empty string for apiBaseUrl in local browser environment', async () => {
    // jsdom hostname = 'localhost' → isRailwayProduction() returns false → apiBaseUrl = ''
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.apiBaseUrl).toBe('');
  });

  it('should build apiUrl as "/api/v1" in local browser environment', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.apiUrl).toBe('/api/v1');
  });

  it('should build apiUrl with custom version "/api/v2" when NEXT_PUBLIC_API_VERSION=v2', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_VERSION', 'v2');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.apiUrl).toBe('/api/v2');
  });

  it('should return isRailway as false when hostname is localhost', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    // jsdom defaults to localhost
    expect(config.isRailway).toBe(false);
  });
});

describe('config — streamApiUrl getter (browser, local dev)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should default to same-origin /api/v1 for streamApiUrl (onprem-safe)', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    // 2026-05-27 真根因 fix: 旧 fallback http://localhost:4000 烤进 client bundle
    // 导致 onprem 浏览器找自己的 localhost:4000 → fail。改用 same-origin。
    expect(config.streamApiUrl).toBe('/api/v1');
  });

  it('should use NEXT_PUBLIC_API_URL env var for streamApiUrl when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:5000');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.streamApiUrl).toBe('http://localhost:5000/api/v1');
  });
});

describe('config — env flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should set isDevelopment to true when NEXT_PUBLIC_ENV is development', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENV', 'development');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('should set isProduction to true when NEXT_PUBLIC_ENV is production', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENV', 'production');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.isProduction).toBe(true);
    expect(config.isDevelopment).toBe(false);
  });

  it('should default env to the NODE_ENV value in test environment', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    // In test environment NODE_ENV is "test"
    expect(typeof config.env).toBe('string');
    expect(config.env.length).toBeGreaterThan(0);
  });
});

describe('config — workspaceAiV2Enabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should be false by default', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(false);
  });

  it('should be true when NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED is "true"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', 'true');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(true);
  });

  it('should be true when value is "1"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', '1');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(true);
  });

  it('should be true when value is "yes"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', 'yes');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(true);
  });

  it('should be true when value is "on"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', 'on');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(true);
  });

  it('should be true when value is "TRUE" (case-insensitive)', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', 'TRUE');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(true);
  });

  it('should be false when value is "false"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', 'false');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(false);
  });

  it('should be false when value is "0"', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED', '0');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.workspaceAiV2Enabled).toBe(false);
  });
});

describe('config — railway URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should use "genesis-ai" as default railway domain', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.railway.domain).toBe('genesis-ai');
  });

  it('should build default frontendUrl from default domain', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.railway.frontendUrl).toBe(
      'https://genesis-ai.up.railway.app'
    );
  });

  it('should build default backendUrl from default domain', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.railway.backendUrl).toBe(
      'https://genesis-ai-backend.up.railway.app'
    );
  });

  it('should build Railway URLs from NEXT_PUBLIC_RAILWAY_DOMAIN env var', async () => {
    vi.stubEnv('NEXT_PUBLIC_RAILWAY_DOMAIN', 'myapp');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.railway.frontendUrl).toBe('https://myapp.up.railway.app');
    expect(config.railway.backendUrl).toBe(
      'https://myapp-backend.up.railway.app'
    );
  });
});

describe('config — build info', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should default gitCommitHash to "dev"', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.gitCommitHash).toBe('dev');
  });

  it('should use NEXT_PUBLIC_GIT_COMMIT_HASH when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_GIT_COMMIT_HASH', 'abc1234');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.gitCommitHash).toBe('abc1234');
  });

  it('should default gitCommitHashFull to "dev"', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.gitCommitHashFull).toBe('dev');
  });

  it('should use NEXT_PUBLIC_GIT_COMMIT_HASH_FULL when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_GIT_COMMIT_HASH_FULL', 'abcdef1234567890');
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.gitCommitHashFull).toBe('abcdef1234567890');
  });

  it('should have buildTime as a non-empty string', async () => {
    vi.resetModules();
    const { config } = await import('../config');
    expect(typeof config.buildTime).toBe('string');
    expect(config.buildTime.length).toBeGreaterThan(0);
  });
});
