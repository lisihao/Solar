/**
 * Journey CLI - runs user journey tests
 *
 * Usage:
 *   npx tsx scripts/ui-iteration/journey-cli.ts [options]
 *
 * Options:
 *   --tier critical|important  Only run specific tier
 *   --base-url http://...      Override base URL
 */

import { runAllJourneys } from "./journey-runner";

function parseArgs(): { tier?: string; baseUrl?: string } {
  const args = process.argv.slice(2);
  const options: { tier?: string; baseUrl?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tier" && args[i + 1]) {
      options.tier = args[i + 1];
      i++;
    }
    if (args[i] === "--base-url" && args[i + 1]) {
      options.baseUrl = args[i + 1];
      i++;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs();

  try {
    const results = await runAllJourneys(options.tier, options.baseUrl);
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Journey runner failed:", error);
    process.exit(2);
  }
}

main();
