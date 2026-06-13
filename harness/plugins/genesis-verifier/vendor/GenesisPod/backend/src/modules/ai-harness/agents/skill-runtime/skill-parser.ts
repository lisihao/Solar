/**
 * SkillParser — 解析 SKILL.md 文件
 *
 * SKILL.md 格式（Anthropic 2025 风格）：
 *
 *   ---
 *   name: web-research
 *   description: 网络搜索与事实核验
 *   tags: [research, web]
 *   allowedTools: [web-search, fetch]
 *   activateFor: [researcher, analyst]
 *   ---
 *
 *   # Skill instructions (Markdown body)
 *
 *   When the user asks a factual question, follow this protocol:
 *   1. Search with `web-search` first.
 *   2. Verify sources by fetching full pages.
 *   3. Cite URLs in the final answer.
 */

import * as yaml from "js-yaml";
import type { ISkill, ISkillFrontmatter } from "../abstractions";

export class SkillParseError extends Error {
  constructor(
    message: string,
    public readonly source?: string,
  ) {
    super(message);
    this.name = "SkillParseError";
  }
}

/** 解析整个 SKILL.md 文本 */
export function parseSkillMarkdown(raw: string, source = "<inline>"): ISkill {
  const { frontmatter, body } = splitFrontmatter(raw, source);
  const parsed = parseFrontmatter(frontmatter, source);
  const fm = validateFrontmatter(parsed, source);
  return {
    frontmatter: fm,
    instructions: body.trim(),
  };
}

// ─── internal ─────────────────────────────────────────────

const FRONTMATTER_DELIMITER = /^---\s*$/m;

function splitFrontmatter(
  raw: string,
  source: string,
): { frontmatter: string; body: string } {
  if (!raw.startsWith("---")) {
    throw new SkillParseError(
      "SKILL.md must start with YAML frontmatter delimiter ('---')",
      source,
    );
  }
  // Split into parts by "---" lines
  const parts = raw.split(FRONTMATTER_DELIMITER);
  // Expect ["", frontmatter, body...]
  if (parts.length < 3) {
    throw new SkillParseError(
      "SKILL.md frontmatter is not closed with '---'",
      source,
    );
  }
  const frontmatter = parts[1];
  const body = parts
    .slice(2)
    .join("---")
    .replace(/^\s*\n/, "");
  return { frontmatter, body };
}

function parseFrontmatter(text: string, source: string): unknown {
  try {
    return yaml.load(text);
  } catch (err) {
    throw new SkillParseError(
      `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
      source,
    );
  }
}

function validateFrontmatter(raw: unknown, source: string): ISkillFrontmatter {
  if (!raw || typeof raw !== "object") {
    throw new SkillParseError(
      "SKILL.md frontmatter must be a YAML mapping",
      source,
    );
  }
  const fm = raw as Record<string, unknown>;

  if (typeof fm.name !== "string" || !fm.name.trim()) {
    throw new SkillParseError("SKILL.md frontmatter missing 'name'", source);
  }
  if (typeof fm.description !== "string" || !fm.description.trim()) {
    throw new SkillParseError(
      "SKILL.md frontmatter missing 'description'",
      source,
    );
  }

  return {
    name: fm.name.trim(),
    description: fm.description.trim(),
    version: typeof fm.version === "string" ? fm.version : undefined,
    tags: asStringArray(fm.tags),
    allowedTools: asStringArray(fm.allowedTools),
    allowedModels: asStringArray(fm.allowedModels),
    activateFor: asStringArray(fm.activateFor),
  };
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}
