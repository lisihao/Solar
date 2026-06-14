import { test as setup, expect } from "@playwright/test";

/**
 * Auth Setup — Logs in (or registers + logs in) and saves browser state.
 *
 * Env vars:
 *   E2E_EMAIL    — login email (default: e2e-test@genesis.local)
 *   E2E_PASSWORD — login password (default: E2eTest!2026)
 *   BASE_URL     — app URL
 *   API_BASE_URL — backend API URL (defaults to BASE_URL)
 */

const AUTH_FILE = ".auth/user.json";

setup("authenticate", async ({ page, baseURL }) => {
  const email = process.env.E2E_EMAIL || "e2e-test@genesis.local";
  const password = process.env.E2E_PASSWORD || "E2eTest!2026";
  const apiBase = process.env.API_BASE_URL || baseURL || "";

  // Try login first
  let loginRes = await page.request.post(`${apiBase}/api/v1/auth/login`, {
    data: { email, password },
  });

  // If login fails, register the test user first
  if (!loginRes.ok()) {
    const regRes = await page.request.post(`${apiBase}/api/v1/auth/register`, {
      data: {
        email,
        password,
        username: "e2e-tester",
        fullName: "E2E Test User",
      },
    });

    if (regRes.ok()) {
      // Registration succeeded — now login
      loginRes = await page.request.post(`${apiBase}/api/v1/auth/login`, {
        data: { email, password },
      });
    } else {
      // Registration also failed — log details
      const regBody = await regRes.text();
      throw new Error(
        `Cannot authenticate. Login: ${loginRes.status()}, Register: ${regRes.status()} ${regBody}`,
      );
    }
  }

  expect(loginRes.ok(), `Login failed: ${loginRes.status()}`).toBeTruthy();
  const body = await loginRes.json();
  // API wraps response in { success, data: { user, accessToken, refreshToken } }
  const payload = body.data ?? body;
  const { accessToken, refreshToken } = payload;

  expect(
    accessToken,
    "accessToken must be present in login response",
  ).toBeTruthy();

  // Inject tokens into localStorage (mirrors frontend auth.ts)
  await page.goto(baseURL || "http://localhost:3000");
  await page.evaluate(
    ({ tokens, user }) => {
      localStorage.setItem("deepdive_auth_tokens", JSON.stringify(tokens));
      if (user) {
        localStorage.setItem("deepdive_user", JSON.stringify(user));
      }
    },
    {
      tokens: { accessToken, refreshToken },
      user: payload.user ?? null,
    },
  );

  // Save state for reuse
  await page.context().storageState({ path: AUTH_FILE });
});
