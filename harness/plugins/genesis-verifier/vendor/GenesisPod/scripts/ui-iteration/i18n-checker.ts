/**
 * i18n Checker - detects untranslated Chinese text in pages
 */

import type { Page } from "playwright-core";

export interface UntranslatedText {
  /** CSS path to the element */
  selector: string;
  /** The untranslated text content */
  text: string;
  /** Surrounding context */
  context: string;
}

/**
 * Detect untranslated Chinese characters in visible page text
 */
export async function detectUntranslatedChinese(
  page: Page,
  allowSelectors: string[] = [],
): Promise<UntranslatedText[]> {
  try {
    return await page.evaluate((allowSels: string[]) => {
      const results: UntranslatedText[] = [];
      const chineseRegex = /[\u4e00-\u9fff]/;

      // Build set of allowed elements
      const allowedElements = new Set<Element>();
      for (const sel of allowSels) {
        document.querySelectorAll(sel).forEach((el) => allowedElements.add(el));
      }

      // Walk all text nodes
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
      );

      let node: Text | null;
      const seen = new Set<string>();

      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent?.trim();
        if (!text || !chineseRegex.test(text)) continue;

        const parentEl = node.parentElement;
        if (!parentEl) continue;

        // Check if inside an allowed selector
        let isAllowed = false;
        for (const allowed of Array.from(allowedElements)) {
          if (allowed.contains(parentEl)) {
            isAllowed = true;
            break;
          }
        }
        if (isAllowed) continue;

        // Skip hidden elements
        const style = window.getComputedStyle(parentEl);
        if (style.display === "none" || style.visibility === "hidden") continue;

        // Deduplicate by text content
        const key = text.substring(0, 100);
        if (seen.has(key)) continue;
        seen.add(key);

        // Build a simple selector path
        const tag = parentEl.tagName.toLowerCase();
        const cls = parentEl.className?.toString().split(" ")[0] || "";
        const selector = cls ? `${tag}.${cls}` : tag;

        results.push({
          selector,
          text: text.substring(0, 200),
          context: parentEl.innerHTML.substring(0, 300),
        });

        if (results.length >= 50) break;
      }

      return results;
    }, allowSelectors);
  } catch {
    return [];
  }
}
