/**
 * AI Engine - SKILL.md Parser
 *
 * 解析 SKILL.md 格式的文件
 * 完全兼容 Claude Code 官方格式，同时支持我们的扩展字段
 *
 * @see https://code.claude.com/docs/en/skills.md
 */

import * as yaml from "js-yaml";
import * as crypto from "crypto";
import { Logger } from "@nestjs/common";
import {
  SkillMdDefinition,
  SkillMdFrontmatter,
  SkillSource,
  RawSkillMdFrontmatter,
} from "../../types/skill-md.types";

const logger = new Logger("SkillParser");

/**
 * 解析 SKILL.md 文件内容
 *
 * 支持两种格式：
 * 1. Claude Code 官方格式（name + description 必需）
 * 2. 我们的扩展格式（id + name + version + domain + taskTypes + priority 必需）
 *
 * @param content - 文件内容
 * @param filePath - 文件路径（可选，用于调试）
 * @returns 解析后的 SkillMdDefinition
 */
export function parseSkillMd(
  content: string,
  filePath?: string,
): SkillMdDefinition {
  // 1. 检查是否有 YAML frontmatter
  const frontmatterMatch = content.match(
    /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/,
  );

  if (!frontmatterMatch) {
    throw new Error(
      `Invalid SKILL.md format: Missing YAML frontmatter. ${filePath ? `File: ${filePath}` : ""}`,
    );
  }

  const [, frontmatterStr, markdownContent] = frontmatterMatch;

  // 2. 解析 YAML frontmatter
  let rawFrontmatter: RawSkillMdFrontmatter;
  try {
    rawFrontmatter = yaml.load(frontmatterStr) as RawSkillMdFrontmatter;
  } catch (error) {
    throw new Error(
      `Invalid YAML frontmatter: ${(error as Error).message}. ${filePath ? `File: ${filePath}` : ""}`,
    );
  }

  // 3. 标准化和验证字段
  const validatedFrontmatter = normalizeFrontmatter(
    rawFrontmatter,
    markdownContent,
    filePath,
  );

  // 4. 计算内容 hash
  const contentHash = crypto.createHash("md5").update(content).digest("hex");

  // 5. 构建完整定义
  const definition: SkillMdDefinition = {
    metadata: validatedFrontmatter,
    content: markdownContent.trim(),
    filePath,
    loadedAt: new Date(),
    contentHash,
  };

  logger.debug(
    `Parsed SKILL.md: ${definition.metadata.id} (${definition.metadata.name})`,
  );

  return definition;
}

/**
 * 标准化 frontmatter，支持 Claude Code 字段别名
 */
function normalizeFrontmatter(
  raw: RawSkillMdFrontmatter,
  markdownContent: string,
  filePath?: string,
): SkillMdFrontmatter {
  // 处理 Claude Code 官方字段别名
  // allowed-tools -> allowedTools
  const allowedTools = raw.allowedTools || raw["allowed-tools"];
  const normalizedAllowedTools = Array.isArray(allowedTools)
    ? allowedTools
    : typeof allowedTools === "string"
      ? allowedTools.split(",").map((s) => s.trim())
      : undefined;

  // user-invocable -> userInvocable
  const userInvocable = raw.userInvocable ?? raw["user-invocable"];

  // disable-model-invocation -> disableModelInvocation
  const disableModelInvocation =
    raw.disableModelInvocation ?? raw["disable-model-invocation"];

  // argument-hint -> argumentHint
  const argumentHint = raw.argumentHint ?? raw["argument-hint"];

  // id 和 name 互为别名（兼容 Claude Code）
  const id = raw.id || raw.name;
  const name = raw.name || raw.id;

  // 验证必需字段（至少需要 name/id）
  if (!id && !name) {
    throw new Error(
      `Missing required field: name or id. ${filePath ? `File: ${filePath}` : ""}`,
    );
  }

  // 从 Markdown 内容提取 description 作为默认值
  const extractedTitle = extractTitleFromContent(markdownContent);
  const description =
    raw.description || extractedTitle || `Skill: ${name || id}`;

  // Runtime 扩展字段 (kebab-case 别名)
  const outputKey = raw.outputKey ?? raw["output-key"];
  const taskProfile = raw.taskProfile ?? raw["task-profile.types"];
  const outputSchema = raw.outputSchema ?? raw["output-schema"];
  const inputSchema = raw.inputSchema ?? raw["input-schema"];
  const requiredSkills = raw.requiredSkills ?? raw["required-skills"];
  const requiredTools = raw.requiredTools ?? raw["required-tools"];
  const executionMode = raw.executionMode ?? raw["execution-mode"];

  // 设置默认值并返回标准化结果
  return {
    // Claude Code 官方字段
    name: name || id!,
    description,
    allowedTools: normalizedAllowedTools,
    model: raw.model,
    context: raw.context,
    agent: raw.agent,
    hooks: raw.hooks,
    userInvocable: userInvocable ?? true,
    disableModelInvocation: disableModelInvocation ?? false,
    argumentHint,

    // 我们的扩展字段
    id: id || name!,
    version: raw.version || "1.0.0",
    domain: raw.domain || "general",
    tags: raw.tags || [],
    taskTypes: raw.taskTypes || [], // Anthropic 风格不再依赖 taskTypes 匹配
    priority: raw.priority ?? 5,
    author: raw.author,
    source: raw.source || "local",
    sourceUrl: raw.sourceUrl,
    dependencies: raw.dependencies || [],
    updatedAt: raw.updatedAt,
    enabled: raw.enabled !== false, // 默认启用
    tokenBudget: raw.tokenBudget,

    // Runtime 扩展字段
    layer: raw.layer,
    outputKey,
    taskProfile,
    outputSchema,
    inputSchema,
    inputs: raw.inputs,
    requiredSkills,
    requiredTools,
    executionMode,
  };
}

/**
 * 序列化 SkillMdDefinition 为 SKILL.md 格式
 *
 * @param definition - Skill 定义
 * @returns SKILL.md 格式的字符串
 */
export function serializeSkillMd(definition: SkillMdDefinition): string {
  const frontmatter = yaml.dump(definition.metadata, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });

  return `---\n${frontmatter}---\n\n${definition.content}`;
}

/**
 * 从 Markdown 内容中提取标题（作为 Skill 名称/描述的后备）
 */
export function extractTitleFromContent(content: string): string | null {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : null;
}

/**
 * 估算 Skill 内容的 Token 数量
 * 使用简单的估算：中文每字约 2 token，英文每 4 字符约 1 token
 */
export function estimateTokens(content: string): number {
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = content.length - chineseChars;
  return Math.ceil(chineseChars * 2 + otherChars / 4);
}

/**
 * 验证 Skill ID 格式
 * 格式：kebab-case，允许字母、数字、连字符
 */
export function isValidSkillId(id: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

/**
 * 验证 Skill 来源类型
 */
export function isValidSkillSource(source: string): source is SkillSource {
  return ["local", "skillsmp", "custom-url"].includes(source);
}

/**
 * 解析 Skill ID 从文件名
 * 例如：chapter-writing.skill.md -> chapter-writing
 */
export function parseSkillIdFromFilename(filename: string): string | null {
  const match = filename.match(/^(.+)\.skill\.md$/);
  return match ? match[1] : null;
}

/**
 * 验证 SKILL.md 内容是否有效
 */
export function isValidSkillMd(content: string): boolean {
  try {
    parseSkillMd(content);
    return true;
  } catch {
    return false;
  }
}
