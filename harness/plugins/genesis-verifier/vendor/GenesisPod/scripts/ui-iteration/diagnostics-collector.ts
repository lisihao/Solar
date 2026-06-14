/**
 * Diagnostics Collector - gathers comprehensive page diagnostics
 */

import type { Page, ConsoleMessage, Response } from "playwright-core";
import type { PageSpec } from "./spec-loader";
import {
  detectUntranslatedChinese,
  type UntranslatedText,
} from "./i18n-checker";
import { collectPerfMetrics, type PerfMetrics } from "./perf-collector";

export interface ConsoleDiagnostic {
  type: "error" | "warning" | "log";
  text: string;
  url?: string;
  lineNumber?: number;
}

export interface NetworkDiagnostic {
  url: string;
  status: number;
  method: string;
  resourceType: string;
}

export interface DomDiagnostic {
  nodeCount: number;
  /** Truncated HTML snapshot of body */
  bodySnapshot: string;
  /** Text content visible on page */
  visibleText: string;
  /** Whether page appears blank */
  isBlank: boolean;
}

export interface StyleDiagnostic {
  /** Elements with overflow issues */
  overflowIssues: Array<{
    selector: string;
    overflow: string;
    scrollWidth: number;
    clientWidth: number;
  }>;
  /** Elements with z-index stacking issues */
  zIndexIssues: Array<{
    selector: string;
    zIndex: string;
  }>;
}

export interface A11yDiagnostic {
  /** Images without alt text */
  missingAltTexts: number;
  /** Buttons/links without accessible name */
  missingLabels: number;
  /** Heading hierarchy issues */
  headingIssues: string[];
}

export interface SpecValidation {
  structureResults: Array<{
    description: string;
    found: boolean;
    selector?: string;
  }>;
  forbiddenResults: Array<{
    pattern: string;
    found: boolean;
    context?: string;
  }>;
  i18nResults: Array<{
    expected: string;
    found: boolean;
  }>;
}

export interface PageDiagnostics {
  url: string;
  viewport: string;
  timestamp: string;
  loadTime: number;
  console: ConsoleDiagnostic[];
  networkErrors: NetworkDiagnostic[];
  dom: DomDiagnostic;
  styles: StyleDiagnostic;
  a11y: A11yDiagnostic;
  screenshotPath?: string;
  specValidation?: SpecValidation;
  i18nIssues?: UntranslatedText[];
  performance?: PerfMetrics;
}

/**
 * Collect all diagnostics from a page
 */
export async function collectDiagnostics(
  page: Page,
  url: string,
  viewportName: string,
  loadingWaitTime: number = 2000,
  spec?: PageSpec,
  allowChineseSelectors?: string[],
): Promise<PageDiagnostics> {
  const startTime = Date.now();
  const consoleMessages: ConsoleDiagnostic[] = [];
  const networkErrors: NetworkDiagnostic[] = [];
  let navigationError: string | undefined;

  // Set up listeners (store references for cleanup)
  const consoleHandler = (msg: ConsoleMessage) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      consoleMessages.push({
        type: type as "error" | "warning",
        text: msg.text(),
        url: msg.location()?.url,
        lineNumber: msg.location()?.lineNumber,
      });
    }
  };

  const responseHandler = (response: Response) => {
    const status = response.status();
    if (status >= 400) {
      networkErrors.push({
        url: response.url(),
        status,
        method: response.request().method(),
        resourceType: response.request().resourceType(),
      });
    }
  };

  page.on("console", consoleHandler);
  page.on("response", responseHandler);

  try {
    // Navigate
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (error) {
      navigationError = error instanceof Error ? error.message : String(error);
    }

    // Wait for dynamic content
    await page.waitForTimeout(loadingWaitTime);

    const loadTime = Date.now() - startTime;

    // Collect diagnostics with error handling per collector
    let dom: DomDiagnostic = {
      nodeCount: 0,
      bodySnapshot: "",
      visibleText: "",
      isBlank: true,
    };
    let styles: StyleDiagnostic = { overflowIssues: [], zIndexIssues: [] };
    let a11y: A11yDiagnostic = {
      missingAltTexts: 0,
      missingLabels: 0,
      headingIssues: [],
    };

    try {
      dom = await collectDomDiagnostics(page);
    } catch {
      // Page may be crashed; use defaults
    }

    try {
      styles = await collectStyleDiagnostics(page);
    } catch {
      // Non-critical; use defaults
    }

    try {
      a11y = await collectA11yDiagnostics(page);
    } catch {
      // Non-critical; use defaults
    }

    // If navigation failed, add it as a console error for detection
    if (navigationError) {
      consoleMessages.push({
        type: "error",
        text: `Navigation failed: ${navigationError}`,
      });
    }

    // Collect spec validation if spec provided
    let specValidation: SpecValidation | undefined;
    if (spec) {
      try {
        specValidation = await collectSpecDiagnostics(
          page,
          spec,
          dom.visibleText,
        );
      } catch {
        // Non-critical
      }
    }

    // Collect i18n issues
    let i18nIssues: UntranslatedText[] | undefined;
    try {
      const results = await detectUntranslatedChinese(
        page,
        allowChineseSelectors,
      );
      if (results.length > 0) {
        i18nIssues = results;
      }
    } catch {
      // Non-critical
    }

    // Collect performance metrics
    let perfMetrics: PerfMetrics | undefined;
    try {
      perfMetrics = await collectPerfMetrics(page);
    } catch {
      // Non-critical
    }

    return {
      url,
      viewport: viewportName,
      timestamp: new Date().toISOString(),
      loadTime,
      console: consoleMessages,
      networkErrors,
      dom,
      styles,
      a11y,
      specValidation,
      i18nIssues,
      performance: perfMetrics,
    };
  } finally {
    // Clean up listeners to prevent accumulation
    page.removeListener("console", consoleHandler);
    page.removeListener("response", responseHandler);
  }
}

async function collectDomDiagnostics(page: Page): Promise<DomDiagnostic> {
  return page.evaluate(() => {
    const body = document.body;
    const allNodes = body.querySelectorAll("*");
    const nodeCount = allNodes.length;

    // Get truncated HTML
    const bodySnapshot = body.innerHTML.substring(0, 5000);

    // Get visible text
    const visibleText = body.innerText?.substring(0, 3000) || "";

    // Check if page is blank
    const isBlank = nodeCount < 10 || visibleText.trim().length < 50;

    return {
      nodeCount,
      bodySnapshot,
      visibleText,
      isBlank,
    };
  });
}

async function collectStyleDiagnostics(page: Page): Promise<StyleDiagnostic> {
  return page.evaluate(() => {
    const overflowIssues: StyleDiagnostic["overflowIssues"] = [];
    const zIndexIssues: StyleDiagnostic["zIndexIssues"] = [];

    // Check for horizontal overflow
    const allElements = document.querySelectorAll("*");
    for (const el of Array.from(allElements).slice(0, 500)) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.scrollWidth > htmlEl.clientWidth + 5) {
        const computed = window.getComputedStyle(htmlEl);
        if (
          computed.overflowX !== "auto" &&
          computed.overflowX !== "scroll" &&
          computed.overflowX !== "hidden"
        ) {
          const tag = htmlEl.tagName.toLowerCase();
          const className = htmlEl.className?.toString().substring(0, 50) || "";
          overflowIssues.push({
            selector: `${tag}.${className}`,
            overflow: computed.overflowX,
            scrollWidth: htmlEl.scrollWidth,
            clientWidth: htmlEl.clientWidth,
          });
          if (overflowIssues.length >= 10) break;
        }
      }
    }

    // Check for extremely high z-index
    for (const el of Array.from(allElements).slice(0, 500)) {
      const computed = window.getComputedStyle(el);
      const zIndex = parseInt(computed.zIndex, 10);
      if (zIndex > 9999) {
        const tag = el.tagName.toLowerCase();
        zIndexIssues.push({
          selector: `${tag}`,
          zIndex: computed.zIndex,
        });
        if (zIndexIssues.length >= 5) break;
      }
    }

    return { overflowIssues, zIndexIssues };
  });
}

async function collectSpecDiagnostics(
  page: Page,
  spec: PageSpec,
  visibleText: string,
): Promise<SpecValidation> {
  const structureResults: SpecValidation["structureResults"] = [];
  const forbiddenResults: SpecValidation["forbiddenResults"] = [];
  const i18nResults: SpecValidation["i18nResults"] = [];

  // Check expected_structure
  for (const expected of spec.expected_structure || []) {
    if (expected.selector) {
      const found = await page
        .locator(expected.selector)
        .first()
        .isVisible()
        .catch(() => false);
      structureResults.push({
        description: expected.description,
        found,
        selector: expected.selector,
      });
    } else if (expected.text) {
      const found = visibleText.includes(expected.text);
      structureResults.push({ description: expected.description, found });
    } else {
      structureResults.push({
        description: expected.description,
        found: false,
      });
    }
  }

  // Check forbidden patterns from spec
  for (const pattern of spec.forbidden || []) {
    const found = visibleText.includes(pattern);
    forbiddenResults.push({
      pattern,
      found,
      context: found
        ? visibleText.substring(
            Math.max(0, visibleText.indexOf(pattern) - 50),
            visibleText.indexOf(pattern) + pattern.length + 50,
          )
        : undefined,
    });
  }

  // Check i18n assertions
  for (const expected of spec.i18n_assertions || []) {
    const found = visibleText.includes(expected);
    i18nResults.push({ expected, found });
  }

  return { structureResults, forbiddenResults, i18nResults };
}

async function collectA11yDiagnostics(page: Page): Promise<A11yDiagnostic> {
  return page.evaluate(() => {
    // Missing alt texts
    const images = document.querySelectorAll("img");
    let missingAltTexts = 0;
    for (const img of Array.from(images)) {
      if (
        !img.alt &&
        !img.getAttribute("aria-hidden") &&
        img.getAttribute("role") !== "presentation"
      ) {
        missingAltTexts++;
      }
    }

    // Missing labels
    let missingLabels = 0;
    const interactiveElements = document.querySelectorAll(
      "button, a, input, select, textarea",
    );
    for (const el of Array.from(interactiveElements)) {
      const hasLabel =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.textContent?.trim() ||
        (el as HTMLInputElement).placeholder;
      if (!hasLabel) {
        missingLabels++;
      }
    }

    // Heading hierarchy
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const headingIssues: string[] = [];
    let lastLevel = 0;
    for (const h of Array.from(headings)) {
      const level = parseInt(h.tagName[1], 10);
      if (level > lastLevel + 1 && lastLevel > 0) {
        headingIssues.push(`Skipped heading level: h${lastLevel} -> h${level}`);
      }
      lastLevel = level;
    }

    return { missingAltTexts, missingLabels, headingIssues };
  });
}
