/**
 * Test Generator - generates Playwright E2E tests from journeys and fixed issues
 */

import * as fs from "fs";
import * as path from "path";
import type { JourneyDefinition, JourneyStep } from "./journey-runner";
import { loadJourneys } from "./journey-runner";

const E2E_DIR = path.resolve(__dirname, "../../e2e");

/**
 * Generate a Playwright test from a journey definition
 */
function generateTestFromJourney(journey: JourneyDefinition): string {
  const steps = journey.steps
    .filter((s) => !s.cleanup)
    .map((step) => generateStepCode(step))
    .join("\n\n");

  return `import { test, expect } from "@playwright/test";

test.describe("${journey.id}", () => {
  test("should complete ${journey.id} journey", async ({ page }) => {
${steps}
  });
});
`;
}

function generateStepCode(step: JourneyStep): string {
  if (step.navigate) {
    return `    await page.goto("${step.navigate}");
    await page.waitForLoadState("networkidle");`;
  }

  if (step.wait) {
    const selector = step.wait.split(",")[0].trim();
    return `    await page.waitForSelector("${selector}", { timeout: 10000 });`;
  }

  if (step.click) {
    const selector = step.click.split(",")[0].trim();
    return `    await page.click("${selector}");`;
  }

  if (step.fill) {
    const lines: string[] = [];
    for (const [selector, value] of Object.entries(step.fill)) {
      const sel = selector.split(",")[0].trim();
      lines.push(`    await page.fill("${sel}", "${value}");`);
    }
    return lines.join("\n");
  }

  if (step.wait_for_network) {
    return `    await page.waitForLoadState("networkidle");`;
  }

  if (step.assert) {
    const assertions: string[] = [];
    for (const [key, value] of Object.entries(step.assert)) {
      if (key === "url_contains") {
        assertions.push(`    expect(page.url()).toContain("${value}");`);
      } else if (key === "text_contains") {
        assertions.push(
          `    await expect(page.locator("body")).toContainText("${value}");`,
        );
      } else if (key === "text_not_contains") {
        assertions.push(`    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("${value}");`);
      } else if (key === "element_visible") {
        const sel = value.split(",")[0].trim();
        assertions.push(
          `    await expect(page.locator("${sel}")).toBeVisible();`,
        );
      }
    }
    return assertions.join("\n");
  }

  return "    // Unknown step type";
}

/**
 * Generate all E2E tests from journey definitions
 */
export function generateJourneyTests(): string[] {
  const journeys = loadJourneys();
  const generatedFiles: string[] = [];

  const journeyDir = path.join(E2E_DIR, "journeys");
  fs.mkdirSync(journeyDir, { recursive: true });

  for (const journey of journeys) {
    const testCode = generateTestFromJourney(journey);
    const filePath = path.join(journeyDir, `${journey.id}.spec.ts`);
    fs.writeFileSync(filePath, testCode);
    generatedFiles.push(filePath);
    console.log(`  Generated: ${filePath}`);
  }

  return generatedFiles;
}

/**
 * Generate a regression test for a fixed issue
 */
export function generateRegressionTest(
  issueId: string,
  url: string,
  assertion: string,
): string {
  const regressionDir = path.join(E2E_DIR, "regressions");
  fs.mkdirSync(regressionDir, { recursive: true });

  const testCode = `import { test, expect } from "@playwright/test";

test("regression: ${issueId}", async ({ page }) => {
  await page.goto("${url}");
  await page.waitForLoadState("networkidle");
  ${assertion}
});
`;

  const filePath = path.join(regressionDir, `regression-${issueId}.spec.ts`);
  fs.writeFileSync(filePath, testCode);
  console.log(`  Generated regression test: ${filePath}`);
  return filePath;
}
