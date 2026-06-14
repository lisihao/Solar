/**
 * Route Discovery - scans frontend/app directory for routes
 */

import * as fs from "fs";
import * as path from "path";
import type { PageTier, RouteConfig } from "./config";
import { resolveRoute, routeRequiresAuth } from "./route-resolver";

// tsx executes in CJS mode where __dirname is always available.
// If running under ESM, pass FRONTEND_APP_DIR via discoverRoutes() parameter.
const DEFAULT_FRONTEND_APP_DIR = path.resolve(__dirname, "../../frontend/app");

/** Tier classification rules */
const TIER_RULES: { pattern: RegExp; tier: PageTier }[] = [
  { pattern: /^\/ai-research/, tier: "critical" },
  { pattern: /^\/library/, tier: "critical" },
  { pattern: /^\/ai-teams/, tier: "critical" },
  { pattern: /^\/ai-ask/, tier: "important" },
  { pattern: /^\/ai-writing/, tier: "important" },
  { pattern: /^\/rag/, tier: "important" },
  { pattern: /^\/ai-office/, tier: "important" },
  { pattern: /^\/ai-social/, tier: "important" },
  { pattern: /^\/profile/, tier: "important" },
  { pattern: /^\/admin/, tier: "standard" },
  { pattern: /^\/auth/, tier: "standard" },
  { pattern: /^\/changelog/, tier: "standard" },
  { pattern: /^\/explore/, tier: "standard" },
  { pattern: /^\/share/, tier: "standard" },
];

/** Routes to skip (API routes, internal routes) */
const SKIP_PATTERNS = [/^\/api/, /^\/notion/];

function classifyTier(route: string): PageTier {
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(route)) {
      return rule.tier;
    }
  }
  return "standard";
}

/**
 * Recursively scan the app directory for page.tsx files
 */
function scanRoutes(dir: string, prefix: string = ""): string[] {
  const routes: string[] = [];

  if (!fs.existsSync(dir)) {
    return routes;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Skip route groups (parentheses dirs)
      const dirName = entry.name;
      if (dirName.startsWith("(") && dirName.endsWith(")")) {
        // Route group - recurse without adding to path
        routes.push(...scanRoutes(path.join(dir, dirName), prefix));
      } else {
        // Regular directory - add to path
        const segment = dirName;
        routes.push(
          ...scanRoutes(path.join(dir, dirName), `${prefix}/${segment}`),
        );
      }
    } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
      routes.push(prefix || "/");
    }
  }

  return routes;
}

/**
 * Discover all routes and classify them
 */
export function discoverRoutes(
  appDir: string = DEFAULT_FRONTEND_APP_DIR,
): RouteConfig[] {
  if (!fs.existsSync(appDir)) {
    throw new Error(`Frontend app directory not found: ${appDir}`);
  }
  const rawRoutes = scanRoutes(appDir);
  const configs: RouteConfig[] = [];

  for (const route of rawRoutes) {
    // Skip API and internal routes
    if (SKIP_PATTERNS.some((p) => p.test(route))) {
      continue;
    }

    const tier = classifyTier(route);
    const auth = routeRequiresAuth(route);

    configs.push({
      pattern: route,
      tier,
      auth,
      description: route,
    });
  }

  // Sort: critical first, then important, then standard
  const tierOrder: Record<PageTier, number> = {
    critical: 0,
    important: 1,
    standard: 2,
  };
  configs.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  return configs;
}

/**
 * Get concrete URLs from route configs, resolving dynamic params
 */
export function getConcreteUrls(configs: RouteConfig[]): Array<{
  url: string;
  tier: PageTier;
  auth: boolean;
  pattern: string;
}> {
  const urls: Array<{
    url: string;
    tier: PageTier;
    auth: boolean;
    pattern: string;
  }> = [];

  for (const config of configs) {
    const resolved = resolveRoute(config.pattern);
    for (const url of resolved) {
      urls.push({
        url,
        tier: config.tier,
        auth: config.auth,
        pattern: config.pattern,
      });
    }
  }

  return urls;
}
