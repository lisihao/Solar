/**
 * AI Image Service Utility Functions
 *
 * This file contains utility functions that don't depend on service dependencies
 */

import {
  PromptInformationArchitecture,
  PromptEngineeringInsights,
} from "./image.types";
import {
  STYLE_ENHANCEMENTS,
  ASPECT_RATIO_DIMENSIONS,
  ENFORCED_NEGATIVE_KEYWORDS,
} from "./image.constants";

/**
 * Normalize a value to a string or undefined
 */
export function normalizeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * Convert various input types to a string array
 */
export function toArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (typeof item === "number" || typeof item === "boolean") {
          return String(item);
        }
        return "";
      })
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\r\n;,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  return [];
}

/**
 * Add style to a prompt
 */
export function addStyleToPrompt(prompt: string, style?: string): string {
  const enhancement = style ? STYLE_ENHANCEMENTS[style] : "";
  return enhancement ? `${prompt}, ${enhancement}` : prompt;
}

/**
 * Get dimensions for a given aspect ratio
 */
export function getDimensions(aspectRatio: string): {
  width: number;
  height: number;
} {
  return ASPECT_RATIO_DIMENSIONS[aspectRatio] || ASPECT_RATIO_DIMENSIONS["1:1"];
}

/**
 * Merge negative prompts from multiple sources
 */
export function mergeNegativePrompts(
  base: string | undefined,
  extras: string[],
): string | undefined {
  const tokens = new Map<string, string>();

  const addToken = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (!tokens.has(key)) {
      tokens.set(key, cleaned);
    }
  };

  if (base) {
    base
      .split(/[,;\r\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach(addToken);
  }

  extras.forEach(addToken);

  // Add enforced negatives
  ENFORCED_NEGATIVE_KEYWORDS.forEach(addToken);

  if (tokens.size === 0) {
    return undefined;
  }

  return Array.from(tokens.values()).join(", ");
}

/**
 * Format a list for display in processing steps
 */
export function formatListForStep(items: string[]): string | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Format information architecture for display in processing steps
 */
export function formatInformationArchitectureStep(
  info: PromptInformationArchitecture,
): string | undefined {
  const lines: string[] = [];
  if (info.title) {
    lines.push(`Title: ${info.title}`);
  }
  if (info.subtitle) {
    lines.push(`Subtitle: ${info.subtitle}`);
  }
  if (info.heroStatement) {
    lines.push(`Hero statement: ${info.heroStatement}`);
  }
  info.sections.forEach((section, index) => {
    const sectionTitle = section.title || `Section ${index + 1}`;
    const details: string[] = [];
    if (section.summary) {
      details.push(section.summary);
    }
    if (section.bullets.length > 0) {
      details.push(`Bullets: ${section.bullets.join(", ")}`);
    }
    if (section.metrics.length > 0) {
      details.push(
        `Metrics: ${section.metrics
          .map((metric) => {
            const parts = [];
            if (metric.label) parts.push(metric.label);
            if (metric.value) parts.push(metric.value);
            if (metric.comparison) parts.push(`(${metric.comparison})`);
            return parts.join(" ");
          })
          .join(", ")}`,
      );
    }
    lines.push(`${sectionTitle}: ${details.join("; ")}`);
  });
  if (info.callToAction) {
    lines.push(`Call to action: ${info.callToAction}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Parse URL input with optional description
 * Format: "https://example.com optional description"
 */
export function parseUrlInput(urlInput: string): {
  url: string;
  description: string | null;
} {
  const trimmedInput = urlInput.trim();
  const urlMatch = trimmedInput.match(/^(https?:\/\/\S+)(?:\s+(.*))?$/i);

  if (urlMatch) {
    return {
      url: urlMatch[1],
      description: urlMatch[2]?.trim() || null,
    };
  }

  return {
    url: trimmedInput,
    description: null,
  };
}

/**
 * Check if URL is a YouTube URL
 */
export function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/**
 * Check if URL is a Bilibili URL
 */
export function isBilibiliUrl(url: string): boolean {
  return url.includes("bilibili.com");
}

/**
 * Get step title based on URL type
 */
export function getUrlStepTitle(
  url: string,
  action: "extracting" | "extracted",
): string {
  const isYouTube = isYouTubeUrl(url);
  const isBilibili = isBilibiliUrl(url);

  if (action === "extracting") {
    return isYouTube
      ? "Extracting YouTube Subtitles"
      : isBilibili
        ? "Extracting Bilibili Content"
        : "Extracting Web Content";
  } else {
    return isYouTube
      ? "YouTube Content Extracted"
      : isBilibili
        ? "Bilibili Content Extracted"
        : "Web Content Extracted";
  }
}

/**
 * Validate if insights contain sufficient data
 */
export function validateInsights(insights: PromptEngineeringInsights): boolean {
  return !!(insights.imagePrompt && insights.imagePrompt.length >= 5);
}

/**
 * Extract clean content by removing markdown-style tags
 */
export function extractCleanContent(content: string): string {
  return content.replace(/\[.*?\]/g, "").trim();
}
