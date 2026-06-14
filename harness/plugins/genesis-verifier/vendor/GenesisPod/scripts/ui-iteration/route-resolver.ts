/**
 * Route Resolver - fills dynamic route params with test data IDs
 */

// These must match the IDs in backend/prisma/seed-ui-patrol.ts
export const TEST_IDS = {
  researchTopic: {
    macro: "a0000001-0000-4000-8000-000000000001",
    technology: "a0000001-0000-4000-8000-000000000002",
    company: "a0000001-0000-4000-8000-000000000003",
  },
  resource: {
    paper: "b0000001-0000-4000-8000-000000000001",
    blog: "b0000001-0000-4000-8000-000000000002",
    news: "b0000001-0000-4000-8000-000000000003",
  },
  collection: "c0000001-0000-4000-8000-000000000001",
  topic: {
    public: "d0000001-0000-4000-8000-000000000001",
    private: "d0000001-0000-4000-8000-000000000002",
  },
  knowledgeBase: "e0000001-0000-4000-8000-000000000001",
  writingProject: "f0000001-0000-4000-8000-000000000001",
};

/**
 * Map of dynamic route patterns to their resolved values.
 * Each pattern can resolve to multiple URLs (for testing different data states).
 */
const ROUTE_RESOLUTIONS: Record<string, string[]> = {
  "/ai-research/topic/[id]": [
    `/ai-research/topic/${TEST_IDS.researchTopic.macro}`,
    `/ai-research/topic/${TEST_IDS.researchTopic.technology}`,
  ],
  "/library/resource/[id]": [`/library/resource/${TEST_IDS.resource.paper}`],
  "/ai-teams/[id]": [`/ai-teams/${TEST_IDS.topic.public}`],
  "/rag/[id]": [`/rag/${TEST_IDS.knowledgeBase}`],
  "/ai-writing/[id]": [`/ai-writing/${TEST_IDS.writingProject}`],
};

/**
 * Resolve a route pattern to concrete URLs.
 * Static routes return as-is. Dynamic routes are filled with test IDs.
 */
export function resolveRoute(routePattern: string): string[] {
  if (ROUTE_RESOLUTIONS[routePattern]) {
    return ROUTE_RESOLUTIONS[routePattern];
  }

  // If route has no dynamic segments, return as-is
  if (!routePattern.includes("[")) {
    return [routePattern];
  }

  // Unknown dynamic route - skip it
  console.warn(`No resolution for dynamic route: ${routePattern}`);
  return [];
}

/**
 * Check if a route requires authentication
 */
export function routeRequiresAuth(route: string): boolean {
  const publicRoutes = ["/auth", "/share", "/changelog", "/explore"];
  return !publicRoutes.some((pub) => route.startsWith(pub));
}
