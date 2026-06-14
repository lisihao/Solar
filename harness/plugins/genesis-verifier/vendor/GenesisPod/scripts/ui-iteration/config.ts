/**
 * UI Patrol Configuration
 */

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export const VIEWPORTS: ViewportConfig[] = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

export interface PatrolConfig {
  /** Base URL of the dev server */
  baseUrl: string;
  /** Auth profile to use */
  authProfile: string;
  /** Viewports to test */
  viewports: ViewportConfig[];
  /** Max time to wait for page load (ms) */
  pageTimeout: number;
  /** Max time to wait for network idle (ms) */
  networkIdleTimeout: number;
  /** Output directory for reports and screenshots */
  outputDir: string;
  /** Screenshot directory */
  screenshotDir: string;
  /** Report directory */
  reportDir: string;
  /** Evaluation directory */
  evaluationDir: string;
  /** Skip auth injection (for public pages or remote servers) */
  skipAuth?: boolean;
}

export const DEFAULT_CONFIG: PatrolConfig = {
  baseUrl: "http://localhost:3000",
  authProfile: "demo",
  viewports: VIEWPORTS,
  pageTimeout: 30000,
  networkIdleTimeout: 5000,
  outputDir: ".ui-patrol",
  screenshotDir: ".ui-patrol/screenshots",
  reportDir: ".ui-patrol/reports",
  evaluationDir: ".ui-patrol/evaluations",
};

/** Page tier classification */
export type PageTier = "critical" | "important" | "standard";

export interface RouteConfig {
  pattern: string;
  tier: PageTier;
  auth: boolean;
  /** Description for reporting */
  description: string;
}

/**
 * Detection thresholds - tunable per iteration
 */
export interface DetectionThresholds {
  /** Min DOM nodes to not be considered blank page */
  minDomNodes: number;
  /** Max console errors before flagging */
  maxConsoleErrors: number;
  /** Patterns to always flag in page text */
  forbiddenPatterns: RegExp[];
  /** Wait for loading to complete before checking (ms) */
  loadingWaitTime: number;
}

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  minDomNodes: 10,
  maxConsoleErrors: 0,
  forbiddenPatterns: [
    /\[object Object\]/,
    /\bundefined\b/,
    /\bNaN\b/,
    /Error:/i,
  ],
  loadingWaitTime: 3000,
};
