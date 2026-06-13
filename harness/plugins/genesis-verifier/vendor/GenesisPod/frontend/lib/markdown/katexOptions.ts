/**
 * Unified `rehype-katex` options for Topic Insights + Ask + Share views.
 *
 * Why this exists:
 *   Previously each render site passed `{ output: 'html' }`. KaTeX's default
 *   `throwOnError: true` makes it explode on any malformed LaTeX from the LLM,
 *   and `strict: 'warn'` logs noisy console output that breaks hydration.
 *
 *   Upstream we now validate LaTeX delimiters at the LLM boundary and retry
 *   on failure. At the rendering layer we take the OPPOSITE stance:
 *   **never throw**. If something still slips through, render the raw source
 *   in red so the reader can see what went wrong, and the report keeps
 *   flowing instead of corrupting the whole view.
 */

export const KATEX_OPTIONS = {
  output: 'html' as const,
  throwOnError: false,
  errorColor: '#cc0000',
  strict: 'ignore' as const,
  trust: false,
};
