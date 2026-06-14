/**
 * AI Engine - Skill Prompt Builder Service
 *
 * 负责将 Skills 组装成 System Prompt
 * 支持上下文变量替换和 Token 管理
 */

import { Injectable, Logger } from "@nestjs/common";
import { SkillMdDefinition } from "../types/skill-md.types";
import { estimateTokens } from "../loader/parsing/skill-parser";

/**
 * Prompt 构建选项
 */
interface BuildPromptOptions {
  /** 上下文变量（用于模板替换） */
  context?: Record<string, unknown>;
  /** 最大 Token 限制 */
  maxTokens?: number;
  /** 是否包含 Skill 元数据注释 */
  includeMetadata?: boolean;
  /** 分隔符 */
  separator?: string;
}

/**
 * 构建结果
 */
interface BuildResult {
  /** 组装后的 System Prompt */
  prompt: string;
  /** 使用的 Skills */
  usedSkills: string[];
  /** Token 消耗估算 */
  estimatedTokens: number;
  /** 是否被裁剪 */
  wasTrimmed: boolean;
  /** 被跳过的 Skills（因 Token 限制） */
  skippedSkills: string[];
}

@Injectable()
export class SkillPromptBuilder {
  private readonly logger = new Logger(SkillPromptBuilder.name);

  /** 默认分隔符 */
  private readonly DEFAULT_SEPARATOR = "\n\n---\n\n";

  /** 默认最大 Token */
  private readonly DEFAULT_MAX_TOKENS = 8000;

  /**
   * 组装 System Prompt
   *
   * @param skills - Skills 列表（已按优先级排序）
   * @param options - 构建选项
   * @returns 构建结果
   */
  buildSystemPrompt(
    skills: SkillMdDefinition[],
    options: BuildPromptOptions = {},
  ): BuildResult {
    const {
      context = {},
      maxTokens = this.DEFAULT_MAX_TOKENS,
      includeMetadata = false,
      separator = this.DEFAULT_SEPARATOR,
    } = options;

    this.logger.log(
      `[Skills] 🔨 Building System Prompt from ${skills.length} skills (maxTokens=${maxTokens})`,
    );

    const usedSkills: string[] = [];
    const skippedSkills: string[] = [];
    const skillDetails: string[] = [];
    const parts: string[] = [];
    let currentTokens = 0;
    let wasTrimmed = false;

    for (const skill of skills) {
      // 跳过禁用的 Skills
      if (skill.metadata.enabled === false) {
        this.logger.debug(
          `[Skills]   └─ Skipping disabled skill: ${skill.metadata.id}`,
        );
        continue;
      }

      // 处理内容（变量替换）
      let content = this.replaceVariables(skill.content, context);

      // 添加元数据注释（可选）
      if (includeMetadata) {
        content = this.addMetadataComment(skill, content);
      }

      // Token 预算检查
      const skillTokens = estimateTokens(content);
      if (currentTokens + skillTokens > maxTokens) {
        // 尝试裁剪
        const remainingTokens = maxTokens - currentTokens;
        if (remainingTokens > 200) {
          // 至少保留 200 tokens 才裁剪
          content = this.trimToTokenLimit(content, remainingTokens);
          wasTrimmed = true;
          const trimmedTokens = estimateTokens(content);
          skillDetails.push(`${skill.metadata.id}(${trimmedTokens}t,trimmed)`);
        } else {
          skippedSkills.push(skill.metadata.id);
          continue;
        }
      } else {
        skillDetails.push(`${skill.metadata.id}(${skillTokens}t)`);
      }

      parts.push(content);
      usedSkills.push(skill.metadata.id);
      currentTokens += estimateTokens(content);
    }

    const prompt = parts.join(separator);

    // 输出构建报告
    this.logger.log(
      `[Skills] ✅ Built prompt: ${usedSkills.length} skills, ${currentTokens} tokens${wasTrimmed ? " (trimmed)" : ""}`,
    );
    this.logger.log(`[Skills]   └─ Included: [${skillDetails.join(", ")}]`);

    if (skippedSkills.length > 0) {
      this.logger.log(
        `[Skills]   └─ Skipped (budget): [${skippedSkills.join(", ")}]`,
      );
    }

    return {
      prompt,
      usedSkills,
      estimatedTokens: currentTokens,
      wasTrimmed,
      skippedSkills,
    };
  }

  /**
   * 替换模板变量
   *
   * 支持两种格式（完全兼容 Claude Code）：
   *
   * 1. Claude Code 官方格式：
   *    - $VAR - 简单变量
   *    - ${VAR} - 带花括号变量
   *    - $ARGUMENTS - 命令行参数
   *    - $1, $2, $3 - 位置参数
   *
   * 2. Handlebars 扩展格式：
   *    - {{variableName}} - 简单变量
   *    - {{object.property}} - 嵌套属性
   *    - {{variableName | default: "默认值"}} - 带默认值
   */
  private replaceVariables(
    content: string,
    context: Record<string, unknown>,
  ): string {
    let result = content;

    // 1. Claude Code 格式: ${VAR} (带花括号)
    result = result.replace(
      /\$\{([A-Z_][A-Z0-9_]*)\}/g,
      (match: string, varName: string) => {
        const value = this.getContextValue(context, varName);
        return value !== undefined ? String(value) : match;
      },
    );

    // 2. Claude Code 格式: $VAR (不带花括号，大写变量名)
    result = result.replace(
      /\$([A-Z_][A-Z0-9_]*)\b/g,
      (match: string, varName: string) => {
        const value = this.getContextValue(context, varName);
        return value !== undefined ? String(value) : match;
      },
    );

    // 3. Claude Code 格式: $1, $2, $3 (位置参数)
    result = result.replace(/\$(\d+)\b/g, (match: string, index: string) => {
      const args = context["ARGUMENTS"] || context["arguments"];
      if (Array.isArray(args)) {
        const argIndex = parseInt(index, 10) - 1; // 1-indexed
        return args[argIndex] !== undefined ? String(args[argIndex]) : match;
      }
      // 也支持 context["1"], context["2"] 等
      const positionalValue = context[index];
      return positionalValue !== undefined ? String(positionalValue) : match;
    });

    // 4. Handlebars 格式: {{variable}}
    result = result.replace(
      /\{\{([^}]+)\}\}/g,
      (match: string, expression: string) => {
        // 解析表达式
        const [varPath, ...modifiers] = expression
          .split("|")
          .map((s) => s.trim());

        // 获取值
        let value = this.getNestedValue(context, varPath);

        // 处理修饰符
        for (const modifier of modifiers) {
          if (modifier.startsWith("default:")) {
            const defaultValue = modifier
              .slice(8)
              .trim()
              .replace(/^["']|["']$/g, "");
            if (value === undefined || value === null) {
              value = defaultValue;
            }
          }
        }

        // 返回值或保留原始占位符
        if (value === undefined || value === null) {
          return match;
        }

        return typeof value === "string" ? value : JSON.stringify(value);
      },
    );

    return result;
  }

  /**
   * 获取上下文值（支持大小写不敏感的 Claude Code 变量）
   */
  private getContextValue(
    context: Record<string, unknown>,
    varName: string,
  ): unknown {
    // 优先精确匹配
    if (context[varName] !== undefined) {
      return context[varName];
    }
    // 尝试小写匹配
    const lowerName = varName.toLowerCase();
    if (context[lowerName] !== undefined) {
      return context[lowerName];
    }
    // 尝试驼峰匹配 (CLAUDE_SESSION_ID -> claudeSessionId)
    const camelName = varName
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return context[camelName];
  }

  /**
   * 获取嵌套属性值
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  /**
   * 添加元数据注释
   */
  private addMetadataComment(
    skill: SkillMdDefinition,
    content: string,
  ): string {
    const metadata = skill.metadata;
    const comment = [
      `<!-- Skill: ${metadata.id} -->`,
      `<!-- Name: ${metadata.name} -->`,
      `<!-- Version: ${metadata.version} -->`,
      `<!-- Domain: ${metadata.domain} -->`,
    ].join("\n");

    return `${comment}\n\n${content}`;
  }

  /**
   * 裁剪内容到指定 Token 限制
   */
  trimToTokenLimit(content: string, maxTokens: number): string {
    const currentTokens = estimateTokens(content);
    if (currentTokens <= maxTokens) {
      return content;
    }

    // 计算保留比例
    const ratio = maxTokens / currentTokens;
    const targetLength = Math.floor(content.length * ratio * 0.9); // 留 10% 余量

    // 优先保留开头（通常包含核心指令）
    const headLength = Math.floor(targetLength * 0.8);
    const tailLength = Math.floor(targetLength * 0.15);

    const head = content.substring(0, headLength);
    const tail = content.substring(content.length - tailLength);

    return `${head}\n\n[... content trimmed ...]\n\n${tail}`;
  }

  /**
   * 估算 Skills 的总 Token 消耗
   */
  estimateTotalTokens(skills: SkillMdDefinition[]): number {
    let total = 0;
    for (const skill of skills) {
      total += skill.metadata.tokenBudget || estimateTokens(skill.content);
    }
    return total;
  }

  /**
   * 智能选择 Skills 以适应 Token 预算
   *
   * @param skills - 候选 Skills（已按优先级排序）
   * @param maxTokens - 最大 Token 预算
   * @returns 选中的 Skills
   */
  selectSkillsForBudget(
    skills: SkillMdDefinition[],
    maxTokens: number,
  ): SkillMdDefinition[] {
    const selected: SkillMdDefinition[] = [];
    let currentTokens = 0;

    for (const skill of skills) {
      const skillTokens =
        skill.metadata.tokenBudget || estimateTokens(skill.content);

      if (currentTokens + skillTokens <= maxTokens) {
        selected.push(skill);
        currentTokens += skillTokens;
      } else {
        // 尝试找一个更小的 Skill
        this.logger.debug(
          `Skill ${skill.metadata.id} (${skillTokens} tokens) exceeds budget, skipping`,
        );
      }
    }

    return selected;
  }

  /**
   * 合并多个 Skills 的内容（去重）
   */
  mergeSkillContents(skills: SkillMdDefinition[]): string {
    const seenIds = new Set<string>();
    const contents: string[] = [];

    for (const skill of skills) {
      if (!seenIds.has(skill.metadata.id)) {
        seenIds.add(skill.metadata.id);
        contents.push(skill.content);
      }
    }

    return contents.join(this.DEFAULT_SEPARATOR);
  }
}
