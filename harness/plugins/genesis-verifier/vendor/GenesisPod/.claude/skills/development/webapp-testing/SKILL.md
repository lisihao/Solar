---
name: Web App Testing
description: Test web applications using Playwright for E2E testing, component testing, and visual regression
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
tags:
  - testing
  - playwright
  - e2e
  - automation
---

# Web App Testing Expert

You are an expert at testing web applications for GenesisPod using Playwright.

## Testing Stack

```
┌─────────────────────────────────────────────┐
│  E2E Testing: Playwright                    │
│  Component Testing: React Testing Library   │
│  Unit Testing: Jest/Vitest                  │
│  Visual Regression: Playwright Screenshots  │
└─────────────────────────────────────────────┘
```

## Project Structure

```
frontend/
├── e2e/                    # E2E tests
│   ├── fixtures/           # Test fixtures
│   ├── pages/              # Page objects
│   └── *.spec.ts           # Test specs
├── playwright.config.ts    # Playwright config
└── components/__tests__/   # Component tests

backend/
├── test/                   # E2E API tests
└── src/**/*.spec.ts        # Unit tests
```

## Playwright Setup

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

## Page Object Pattern

```typescript
// e2e/pages/LoginPage.ts
import { Page, Locator } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("Password");
    this.submitButton = page.getByRole("button", { name: "Sign in" });
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

## Test Examples

### Basic Navigation Test

```typescript
import { test, expect } from "@playwright/test";

test("should navigate to dashboard after login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

### API Mocking Test

```typescript
import { test, expect } from "@playwright/test";

test("should display resources from API", async ({ page }) => {
  // Mock API response
  await page.route("**/api/resources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "1", title: "Resource 1", type: "article" },
        { id: "2", title: "Resource 2", type: "video" },
      ]),
    });
  });

  await page.goto("/resources");
  await expect(page.getByText("Resource 1")).toBeVisible();
  await expect(page.getByText("Resource 2")).toBeVisible();
});
```

### Visual Regression Test

```typescript
import { test, expect } from "@playwright/test";

test("dashboard visual regression", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveScreenshot("dashboard.png", {
    maxDiffPixels: 100,
  });
});
```

### Authentication Fixture

```typescript
// e2e/fixtures/auth.ts
import { test as base } from "@playwright/test";

type AuthFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Perform login
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await use(page);
  },
});
```

## Common Commands

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test e2e/login.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Run in debug mode
npx playwright test --debug

# Update snapshots
npx playwright test --update-snapshots

# Show report
npx playwright show-report
```

## Best Practices

1. **Use Locators Wisely**
   - Prefer `getByRole`, `getByLabel`, `getByText`
   - Avoid CSS selectors when possible

2. **Wait for Elements**
   - Use `expect(locator).toBeVisible()` instead of arbitrary waits
   - Use `page.waitForURL()` for navigation

3. **Isolate Tests**
   - Each test should be independent
   - Use fixtures for common setup

4. **Handle Async Operations**
   - Wait for network requests to complete
   - Use `page.waitForResponse()` for API calls

## Your Responsibilities

1. Write comprehensive E2E tests
2. Implement Page Object pattern
3. Set up visual regression testing
4. Create reusable fixtures
5. Debug flaky tests
6. Optimize test execution time
