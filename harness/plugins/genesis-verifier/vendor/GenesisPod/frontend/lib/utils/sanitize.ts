/**
 * HTML Sanitization Utilities
 *
 * Provides secure HTML sanitization using DOMPurify to prevent XSS attacks.
 * Use these functions whenever rendering untrusted HTML content.
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content for safe rendering
 * Removes malicious scripts, event handlers, and dangerous elements
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    // Server-side: return empty or use basic sanitization
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, 'data-removed=');
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'], // Forbid style tags to prevent CSS injection
    FORBID_ATTR: ['style'], // Allow inline styles if needed, remove this line
  });
}

/**
 * Sanitize SVG content for safe rendering
 * Allows SVG-specific elements while preventing XSS
 */
export function sanitizeSvg(svg: string): string {
  if (typeof window === 'undefined') {
    return svg
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, 'data-removed=');
  }

  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'], // Allow SVG use elements
  });
}

/**
 * Sanitize slide/presentation HTML
 * Allows style tags for slide styling while preventing XSS
 */
export function sanitizeSlideHtml(html: string): string {
  if (typeof window === 'undefined') {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, 'data-removed=');
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['style'], // Allow style tags for slides
    ADD_ATTR: ['style', 'class'], // Allow styling attributes
  });
}

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}
