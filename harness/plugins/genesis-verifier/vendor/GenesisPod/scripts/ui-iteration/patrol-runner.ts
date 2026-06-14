/**
 * Patrol Runner - orchestrates page visits, screenshots, and diagnostics
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { chromium, type Browser, type Page } from "playwright-core";
import type { PatrolConfig, PageTier, ViewportConfig } from "./config";
import { DEFAULT_CONFIG, DEFAULT_THRESHOLDS } from "./config";
import { injectAuth, clearCachedTokens } from "./auth-manager";
import {
  collectDiagnostics,
  type PageDiagnostics,
} from "./diagnostics-collector";
import {
  analyzePageDiagnostics,
  analyzeVisualDiff,
  generateReport,
  saveReport,
  cleanupOldReports,
  resetIssueCounter,
  type PatrolIssue,
  type PatrolReport,
} from "./report-generator";
import { discoverRoutes, getConcreteUrls } from "./route-discovery";
import { loadAllSpecs, findSpecForRoute } from "./spec-loader";
import { compareWithBaseline } from "./visual-diff";

export interface PatrolOptions {
  /** Only patrol specific tiers */
  tier?: PageTier;
  /** Only patrol specific routes (comma-separated) */
  routes?: string[];
  /** Only patrol routes affected by git changes */
  changed?: boolean;
  /** Custom config overrides */
  config?: Partial<PatrolConfig>;
}

/**
 * Run UI patrol on discovered routes
 */
export async function runPatrol(
  options: PatrolOptions = {},
): Promise<PatrolReport> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const startTime = Date.now();

  console.log("UI Patrol starting...");
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  Viewports: ${config.viewports.map((v) => v.name).join(", ")}`);

  // Ensure output directories exist
  fs.mkdirSync(config.screenshotDir, { recursive: true });
  fs.mkdirSync(config.reportDir, { recursive: true });

  // Discover routes
  let routeConfigs = discoverRoutes();
  console.log(`  Discovered ${routeConfigs.length} routes`);

  // Filter by tier
  if (options.tier) {
    routeConfigs = routeConfigs.filter((r) => r.tier === options.tier);
    console.log(`  Filtered to ${routeConfigs.length} ${options.tier} routes`);
  }

  // Filter by specific routes
  if (options.routes && options.routes.length > 0) {
    routeConfigs = routeConfigs.filter((r) =>
      options.routes!.some((route) => r.pattern.startsWith(route)),
    );
    console.log(`  Filtered to ${routeConfigs.length} matching routes`);
  }

  // Filter by git changes (--changed)
  if (options.changed) {
    const changedRoutes = getChangedRoutes();
    if (changedRoutes.length > 0) {
      routeConfigs = routeConfigs.filter((r) =>
        changedRoutes.some(
          (changed) =>
            r.pattern.startsWith(changed) || changed.startsWith(r.pattern),
        ),
      );
      console.log(
        `  Filtered to ${routeConfigs.length} routes affected by git changes`,
      );
    } else {
      console.log("  Could not determine changed routes, running full patrol");
    }
  }

  // Load page specs
  const specs = loadAllSpecs();
  if (specs.size > 0) {
    console.log(`  Loaded ${specs.size} page specs`);
  }

  // Resolve dynamic routes to concrete URLs
  const concreteUrls = getConcreteUrls(routeConfigs);
  console.log(`  Total URLs to patrol: ${concreteUrls.length}`);

  // Launch browser
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
    });
  } catch (error) {
    console.error(
      "Failed to launch browser. Ensure Playwright browsers are installed:",
    );
    console.error("  npx playwright install chromium");
    throw error;
  }

  resetIssueCounter();
  const allDiagnostics: PageDiagnostics[] = [];
  const allIssues: PatrolIssue[] = [];

  try {
    for (const viewport of config.viewports) {
      console.log(
        `\nPatrolling with viewport: ${viewport.name} (${viewport.width}x${viewport.height})`,
      );

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ignoreHTTPSErrors: true,
      });

      try {
        const page = await context.newPage();

        // Inject auth for authenticated routes (skip for remote/public)
        if (!config.skipAuth) {
          await injectAuth(page, config.authProfile, undefined, config.baseUrl);
        }

        for (const urlInfo of concreteUrls) {
          const fullUrl = `${config.baseUrl}${urlInfo.url}`;
          const shortLabel = `${urlInfo.url} [${viewport.name}]`;

          process.stdout.write(`  ${shortLabel}...`);

          try {
            const spec = findSpecForRoute(urlInfo.url, specs);
            const diagnostics = await collectDiagnostics(
              page,
              fullUrl,
              viewport.name,
              DEFAULT_THRESHOLDS.loadingWaitTime,
              spec,
            );

            // Take screenshot (non-fatal if fails)
            const screenshotName = `${urlInfo.url.replace(/\//g, "_").replace(/^_/, "")}_${viewport.name}.png`;
            const screenshotPath = path.join(
              config.screenshotDir,
              screenshotName,
            );
            try {
              await page.screenshot({ path: screenshotPath, fullPage: true });
              diagnostics.screenshotPath = screenshotPath;
            } catch {
              // Screenshot failure is non-fatal
            }

            // Analyze for issues
            const issues = analyzePageDiagnostics(diagnostics);

            // Visual regression check
            if (screenshotPath && fs.existsSync(screenshotPath)) {
              const diffResult = compareWithBaseline(
                screenshotPath,
                urlInfo.url,
                viewport.name,
              );
              if (diffResult) {
                const visualIssue = analyzeVisualDiff(diffResult, fullUrl);
                if (visualIssue) {
                  issues.push(visualIssue);
                }
              }
            }

            allDiagnostics.push(diagnostics);
            allIssues.push(...issues);

            if (issues.length === 0) {
              process.stdout.write(" PASS\n");
            } else {
              process.stdout.write(` FAIL (${issues.length} issues)\n`);
            }
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            process.stdout.write(` ERROR: ${errMsg.substring(0, 80)}\n`);

            // Create a critical issue for page-level failure
            const date = new Date()
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, "");
            allIssues.push({
              id: `UI-${date}-ERR-${allIssues.length + 1}`,
              url: fullUrl,
              viewport: viewport.name,
              category: "BLANK_PAGE",
              severity: "critical",
              title: "Page patrol failed",
              description: errMsg.substring(0, 500),
              evidence: errMsg,
            });
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    clearCachedTokens();
  }

  // Generate report
  const report = generateReport(allDiagnostics, allIssues, startTime, {
    baseUrl: config.baseUrl,
    viewports: config.viewports.map((v) => v.name),
    totalRoutes: routeConfigs.length,
    reportDir: config.reportDir,
  });

  // Save report
  const reportPath = saveReport(report, config.reportDir);

  // Cleanup old reports
  cleanupOldReports(config.reportDir, 10);

  console.log(`\nPatrol complete.`);
  console.log(`  Pages: ${report.summary.totalPages}`);
  console.log(`  Issues: ${report.summary.totalIssues}`);
  console.log(`  Score: ${report.summary.score}/100`);
  console.log(`    Critical: ${report.summary.bySeverity.critical}`);
  console.log(`    Major: ${report.summary.bySeverity.major}`);
  console.log(`    Minor: ${report.summary.bySeverity.minor}`);
  console.log(
    `  Passed: ${report.summary.passedPages}, Failed: ${report.summary.failedPages}`,
  );
  if (report.trend) {
    console.log(`  Trend: ${report.trend.summary}`);
  }
  console.log(`  Report: ${reportPath}`);

  return report;
}

/**
 * Get routes affected by recent git changes
 */
function getChangedRoutes(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD~1", {
      encoding: "utf-8",
    }).trim();
    if (!output) return [];

    const files = output.split("\n");
    const routes = new Set<string>();

    for (const file of files) {
      // frontend/app/{segment}/page.tsx -> /{segment}
      const appMatch = file.match(/^frontend\/app\/(.+?)\/page\.tsx$/);
      if (appMatch) {
        const route = "/" + appMatch[1].replace(/\(.*?\)\//g, "");
        routes.add(route);
        continue;
      }

      // frontend/components/{module}/ -> /{module} (best effort)
      const compMatch = file.match(/^frontend\/components\/([a-z-]+)\//);
      if (compMatch) {
        routes.add("/" + compMatch[1]);
      }

      // frontend/app/{segment}/ (any file in route dir)
      const dirMatch = file.match(/^frontend\/app\/([^/]+)\//);
      if (dirMatch) {
        const segment = dirMatch[1].replace(/^\(.*?\)$/, "");
        if (segment) routes.add("/" + segment);
      }
    }

    return Array.from(routes);
  } catch {
    return [];
  }
}
