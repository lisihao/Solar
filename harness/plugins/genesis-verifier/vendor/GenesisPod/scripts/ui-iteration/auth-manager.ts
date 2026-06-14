import type { Page } from "playwright-core";

export interface AuthConfig {
  baseUrl: string;
  email: string;
  password: string;
}

// Backend API URL for authentication
// The frontend proxies API calls, so we need to call the backend directly
const BACKEND_API_URL =
  process.env.UI_PATROL_BACKEND_URL || "https://api.gens.team";

function getAuthProfiles(): Record<string, AuthConfig> {
  return {
    demo: {
      baseUrl: BACKEND_API_URL,
      email: process.env.UI_PATROL_DEMO_EMAIL || "demo@gens.team",
      password: process.env.UI_PATROL_DEMO_PASSWORD || "demo123456",
    },
    admin: {
      baseUrl: BACKEND_API_URL,
      email: process.env.UI_PATROL_ADMIN_EMAIL || "admin@gens.team",
      password: process.env.UI_PATROL_ADMIN_PASSWORD || "admin123456",
    },
  };
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

let cachedTokens: Record<string, AuthTokens> = {};

export async function getAuthTokens(
  profile: string = "demo",
  baseUrl?: string,
): Promise<AuthTokens> {
  if (cachedTokens[profile]) {
    return cachedTokens[profile];
  }

  const profiles = getAuthProfiles();
  const config = profiles[profile];
  if (!config) {
    throw new Error(
      `Unknown auth profile: ${profile}. Available: ${Object.keys(profiles).join(", ")}`,
    );
  }

  const url = baseUrl || config.baseUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Auth failed for ${profile}: ${response.status} ${text}`);
    }

    const responseData = (await response.json()) as Record<string, unknown>;

    // Handle wrapped response format: { success: true, data: { accessToken, refreshToken } }
    const data =
      responseData.success && responseData.data
        ? (responseData.data as Record<string, unknown>)
        : responseData;

    if (
      typeof data.accessToken !== "string" ||
      typeof data.refreshToken !== "string"
    ) {
      throw new Error(`Auth response missing tokens for ${profile}`);
    }

    const tokens: AuthTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: (data.user as Record<string, unknown>) || {
        id: "unknown",
        email: config.email,
        username: config.email.split("@")[0],
      },
    };

    cachedTokens[profile] = tokens;
    return tokens;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function injectAuth(
  page: Page,
  profile: string = "demo",
  baseUrl?: string,
  targetUrl?: string,
): Promise<void> {
  const authData = await getAuthTokens(profile, baseUrl);

  // Navigate to the target domain first to access its localStorage
  const domain = targetUrl ? new URL(targetUrl).origin : "https://gens.team";

  await page.goto(domain, { waitUntil: "domcontentloaded" });

  // Inject both tokens AND user info into localStorage
  // Frontend requires BOTH to recognize logged-in state (see AuthContext.tsx line 43)
  await page.evaluate(
    (data: { tokens: AuthTokens; user: Record<string, unknown> }) => {
      localStorage.setItem("deepdive_auth_tokens", JSON.stringify(data.tokens));
      localStorage.setItem("deepdive_user", JSON.stringify(data.user));
    },
    {
      tokens: {
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
      },
      user: authData.user,
    },
  );

  // Reload to apply the auth state
  await page.reload({ waitUntil: "domcontentloaded" });
}

export function clearCachedTokens(): void {
  cachedTokens = {};
}
