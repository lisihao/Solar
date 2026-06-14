/**
 * Journey Runner - executes user journey YAML definitions
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Page, Browser } from "playwright-core";
import { chromium } from "playwright-core";
import { injectAuth, clearCachedTokens } from "./auth-manager";
import { DEFAULT_CONFIG } from "./config";

export interface JourneyStep {
  navigate?: string;
  wait?: string;
  click?: string;
  fill?: Record<string, string>;
  wait_for_network?: string;
  assert?: Record<string, string>;
  cleanup?: Record<string, string>;
}

export interface JourneyDefinition {
  id: string;
  tier: string;
  auth: string;
  steps: JourneyStep[];
}

export interface JourneyResult {
  id: string;
  passed: boolean;
  duration: number;
  failedStep?: number;
  error?: string;
  steps: Array<{
    step: number;
    action: string;
    passed: boolean;
    error?: string;
  }>;
}

const JOURNEY_DIR = path.resolve(__dirname, "../../.ui-patrol/journeys");

/**
 * Load journey definitions from YAML files
 */
export function loadJourneys(tier?: string): JourneyDefinition[] {
  if (!fs.existsSync(JOURNEY_DIR)) {
    return [];
  }

  const journeys: JourneyDefinition[] = [];
  const files = fs
    .readdirSync(JOURNEY_DIR)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(JOURNEY_DIR, file), "utf-8");
      const parsed = yaml.load(content) as JourneyDefinition;
      if (parsed && parsed.id) {
        if (!tier || parsed.tier === tier) {
          journeys.push(parsed);
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not parse journey file ${file}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return journeys;
}

/**
 * Execute a single step
 */
async function executeStep(
  page: Page,
  step: JourneyStep,
  baseUrl: string,
): Promise<{ action: string; passed: boolean; error?: string }> {
  if (step.navigate) {
    const url = `${baseUrl}${step.navigate}`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      return { action: `navigate: ${step.navigate}`, passed: true };
    } catch (error) {
      return {
        action: `navigate: ${step.navigate}`,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (step.wait) {
    try {
      // Try multiple selectors separated by comma
      const selectors = step.wait.split(",").map((s) => s.trim());
      let found = false;
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          found = true;
          break;
        } catch {
          // Try next selector
        }
      }
      if (!found) {
        return {
          action: `wait: ${step.wait}`,
          passed: false,
          error: "No matching selector found",
        };
      }
      return { action: `wait: ${step.wait}`, passed: true };
    } catch (error) {
      return {
        action: `wait: ${step.wait}`,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (step.click) {
    try {
      const selectors = step.click.split(",").map((s) => s.trim());
      let clicked = false;
      for (const selector of selectors) {
        try {
          await page.click(selector, { timeout: 5000 });
          clicked = true;
          break;
        } catch {
          // Try next selector
        }
      }
      if (!clicked) {
        return {
          action: `click: ${step.click}`,
          passed: false,
          error: "No clickable element found",
        };
      }
      return { action: `click: ${step.click}`, passed: true };
    } catch (error) {
      return {
        action: `click: ${step.click}`,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (step.fill) {
    for (const [selector, value] of Object.entries(step.fill)) {
      try {
        const selectors = selector.split(",").map((s) => s.trim());
        let filled = false;
        for (const sel of selectors) {
          try {
            await page.fill(sel, value, { timeout: 5000 });
            filled = true;
            break;
          } catch {
            // Try next selector
          }
        }
        if (!filled) {
          return {
            action: `fill: ${selector}`,
            passed: false,
            error: "No fillable element found",
          };
        }
      } catch (error) {
        return {
          action: `fill: ${selector}`,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { action: "fill", passed: true };
  }

  if (step.wait_for_network) {
    try {
      await page.waitForLoadState("networkidle");
      return { action: "wait_for_network", passed: true };
    } catch (error) {
      return {
        action: "wait_for_network",
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (step.assert) {
    const failures: string[] = [];
    for (const [key, value] of Object.entries(step.assert)) {
      try {
        if (key === "url_contains") {
          const url = page.url();
          if (!url.includes(value)) {
            failures.push(`URL "${url}" does not contain "${value}"`);
          }
        } else if (key === "text_not_contains") {
          const text = await page.evaluate(() => document.body.innerText || "");
          if (text.includes(value)) {
            failures.push(`Page text contains forbidden: "${value}"`);
          }
        } else if (key === "text_contains") {
          const text = await page.evaluate(() => document.body.innerText || "");
          if (!text.includes(value)) {
            failures.push(`Page text does not contain: "${value}"`);
          }
        } else if (key === "element_visible") {
          const selectors = value.split(",").map((s) => s.trim());
          let visible = false;
          for (const sel of selectors) {
            try {
              const el = await page.$(sel);
              if (el && (await el.isVisible())) {
                visible = true;
                break;
              }
            } catch {
              // Try next
            }
          }
          if (!visible) {
            failures.push(`No visible element matching: ${value}`);
          }
        }
      } catch (error) {
        failures.push(
          `Assert error for ${key}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (failures.length > 0) {
      return { action: "assert", passed: false, error: failures.join("; ") };
    }
    return { action: "assert", passed: true };
  }

  // Cleanup steps are informational only
  if (step.cleanup) {
    return { action: "cleanup (skipped)", passed: true };
  }

  return { action: "unknown", passed: true };
}

/**
 * Execute a full journey
 */
export async function runJourney(
  journey: JourneyDefinition,
  baseUrl: string = DEFAULT_CONFIG.baseUrl,
): Promise<JourneyResult> {
  const startTime = Date.now();
  const stepResults: JourneyResult["steps"] = [];

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });

    try {
      const page = await context.newPage();
      await injectAuth(page, journey.auth, baseUrl);

      for (let i = 0; i < journey.steps.length; i++) {
        const result = await executeStep(page, journey.steps[i], baseUrl);
        stepResults.push({ step: i, ...result });

        if (!result.passed) {
          return {
            id: journey.id,
            passed: false,
            duration: Date.now() - startTime,
            failedStep: i,
            error: result.error,
            steps: stepResults,
          };
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    clearCachedTokens();
  }

  return {
    id: journey.id,
    passed: true,
    duration: Date.now() - startTime,
    steps: stepResults,
  };
}

/**
 * Run all journeys and print results
 */
export async function runAllJourneys(
  tier?: string,
  baseUrl?: string,
): Promise<JourneyResult[]> {
  const journeys = loadJourneys(tier);
  console.log(
    `Running ${journeys.length} journeys${tier ? ` (tier: ${tier})` : ""}...`,
  );

  const results: JourneyResult[] = [];

  for (const journey of journeys) {
    process.stdout.write(`  ${journey.id}...`);
    try {
      const result = await runJourney(journey, baseUrl);
      results.push(result);
      if (result.passed) {
        process.stdout.write(` PASS (${result.duration}ms)\n`);
      } else {
        process.stdout.write(
          ` FAIL at step ${result.failedStep}: ${result.error}\n`,
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      process.stdout.write(` ERROR: ${errMsg.substring(0, 80)}\n`);
      results.push({
        id: journey.id,
        passed: false,
        duration: 0,
        error: errMsg,
        steps: [],
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nJourneys: ${passed}/${results.length} passed`);

  return results;
}
