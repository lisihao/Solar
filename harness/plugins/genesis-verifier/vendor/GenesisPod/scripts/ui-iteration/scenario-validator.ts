/**
 * Scenario Validator - validates page state against scenario assertions
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Page } from "playwright-core";

export interface ScenarioAssertion {
  selector?: string;
  exists?: boolean;
  count?: string;
  text_contains?: string;
  text_not_contains?: string;
}

export interface Scenario {
  id: string;
  route: string;
  auth: string;
  assertions: ScenarioAssertion[];
}

export interface ScenarioResult {
  scenarioId: string;
  route: string;
  passed: boolean;
  failures: string[];
}

/**
 * Load scenarios from YAML files
 */
export function loadScenarios(scenarioDir: string): Scenario[] {
  if (!fs.existsSync(scenarioDir)) {
    return [];
  }

  const scenarios: Scenario[] = [];
  const files = fs
    .readdirSync(scenarioDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(scenarioDir, file), "utf-8");
      const parsed = yaml.load(content) as Scenario[];
      if (Array.isArray(parsed)) {
        scenarios.push(...parsed);
      }
    } catch (error) {
      console.warn(
        `Warning: Could not parse scenario file ${file}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return scenarios;
}

/**
 * Validate a single scenario against a loaded page
 */
export async function validateScenario(
  page: Page,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const failures: string[] = [];

  for (const assertion of scenario.assertions) {
    try {
      if (assertion.selector && assertion.exists !== undefined) {
        const elements = await page.$$(assertion.selector);
        if (assertion.exists && elements.length === 0) {
          failures.push(
            `Expected element "${assertion.selector}" to exist, but not found`,
          );
        }
        if (!assertion.exists && elements.length > 0) {
          failures.push(
            `Expected element "${assertion.selector}" to not exist, but found ${elements.length}`,
          );
        }
      }

      if (assertion.selector && assertion.count) {
        const elements = await page.$$(assertion.selector);
        const countExpr = assertion.count;
        if (countExpr.startsWith(">=")) {
          const min = parseInt(countExpr.slice(2).trim(), 10);
          if (elements.length < min) {
            failures.push(
              `Expected >= ${min} elements for "${assertion.selector}", got ${elements.length}`,
            );
          }
        } else if (countExpr.startsWith("<=")) {
          const max = parseInt(countExpr.slice(2).trim(), 10);
          if (elements.length > max) {
            failures.push(
              `Expected <= ${max} elements for "${assertion.selector}", got ${elements.length}`,
            );
          }
        } else {
          const exact = parseInt(countExpr, 10);
          if (elements.length !== exact) {
            failures.push(
              `Expected ${exact} elements for "${assertion.selector}", got ${elements.length}`,
            );
          }
        }
      }

      if (assertion.text_contains) {
        const text = await page.evaluate(() => document.body.innerText || "");
        if (!text.includes(assertion.text_contains)) {
          failures.push(
            `Expected page text to contain "${assertion.text_contains}"`,
          );
        }
      }

      if (assertion.text_not_contains) {
        const text = await page.evaluate(() => document.body.innerText || "");
        if (text.includes(assertion.text_not_contains)) {
          failures.push(
            `Expected page text NOT to contain "${assertion.text_not_contains}"`,
          );
        }
      }
    } catch (error) {
      failures.push(
        `Assertion error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return {
    scenarioId: scenario.id,
    route: scenario.route,
    passed: failures.length === 0,
    failures,
  };
}
