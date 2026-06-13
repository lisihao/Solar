/**
 * UI Patrol CLI Entry Point
 *
 * Usage:
 *   npm run ui-patrol                                    # patrol localhost:3000
 *   npm run ui-patrol -- https://my-app.railway.app      # patrol remote
 *   npm run ui-patrol -- --tier critical                  # critical pages only
 */

import { runPatrol, type PatrolOptions } from "./patrol-runner";
import { VIEWPORTS, DEFAULT_CONFIG } from "./config";
import { updateBaselines } from "./visual-diff";

function parseArgs(): PatrolOptions {
  const args = process.argv.slice(2);
  const options: PatrolOptions = {};
  const configOverrides: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    // First positional arg that looks like a URL → base-url
    if (arg.startsWith("http://") || arg.startsWith("https://")) {
      configOverrides.baseUrl = arg.replace(/\/+$/, "");
      continue;
    }

    switch (arg) {
      case "--tier":
        if (!next || !["critical", "important", "standard"].includes(next)) {
          console.error(
            `Invalid --tier value: ${next}. Must be: critical, important, standard`,
          );
          process.exit(2);
        }
        options.tier = next as "critical" | "important" | "standard";
        i++;
        break;
      case "--routes":
        if (next) {
          options.routes = next.split(",").map((r) => r.trim());
          i++;
        }
        break;
      case "--changed":
        options.changed = true;
        break;
      case "--update-baselines":
        updateBaselines(DEFAULT_CONFIG.screenshotDir);
        process.exit(0);
        break;
      case "--base-url":
        if (next) {
          configOverrides.baseUrl = next.replace(/\/+$/, "");
          i++;
        }
        break;
      case "--viewport":
        if (next) {
          const vp = VIEWPORTS.find((v) => v.name === next);
          if (vp) {
            configOverrides.viewports = [vp];
          }
          i++;
        }
        break;
      case "--no-auth":
        configOverrides.skipAuth = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  if (Object.keys(configOverrides).length > 0) {
    options.config = configOverrides;
  }

  return options;
}

function printHelp(): void {
  console.log(`
UI Patrol - Automated UI inspection tool

Usage:
  npm run ui-patrol [-- <url>] [options]

Arguments:
  <url>               Target URL (default: http://localhost:3000)

Options:
  --tier <tier>           Only patrol: critical | important | standard
  --routes <paths>        Comma-separated routes: "/ai-research,/library"
  --changed               Only patrol routes affected by recent git changes
  --no-auth               Skip auth injection (for public pages)
  --viewport <name>       Only use viewport: desktop | tablet | mobile
  --update-baselines      Save current screenshots as visual regression baselines
  --help                  Show this help

Examples:
  npm run ui-patrol                                          # local dev
  npm run ui-patrol -- https://my-app.railway.app            # remote
  npm run ui-patrol -- https://my-app.railway.app --no-auth  # remote, no login
  npm run ui-patrol:critical                                 # critical pages only
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  try {
    const report = await runPatrol(options);

    // Exit with error code if critical issues found
    if (report.summary.bySeverity.critical > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Patrol failed:", error);
    process.exit(2);
  }
}

main();
