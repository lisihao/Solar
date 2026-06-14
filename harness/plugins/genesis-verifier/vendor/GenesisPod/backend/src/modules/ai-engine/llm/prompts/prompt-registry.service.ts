import { Injectable, Logger } from "@nestjs/common";

/**
 * 提示词定义
 */
interface PromptDefinition {
  id: string;
  name: string;
  category: string;
  versions: PromptVersion[];
  activeVersion?: string;
}

/**
 * 提示词版本
 */
interface PromptVersion {
  version: string;
  template: string;
  variables: PromptVariable[];
  metadata?: {
    author?: string;
    createdAt?: Date;
    changelog?: string;
    abWeight?: number;
  };
}

/**
 * 提示词变量
 */
interface PromptVariable {
  name: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
}

/**
 * 已解析的提示词
 */
interface ResolvedPrompt {
  id: string;
  version: string;
  content: string;
  metadata: {
    category: string;
    resolvedAt: Date;
    abGroup?: string;
  };
}

/**
 * 提示词使用统计
 */
interface PromptUsageStats {
  id: string;
  totalUses: number;
  byVersion: Record<string, number>;
  lastUsed: Date;
}

/**
 * Prompt Registry Service
 *
 * 提供集中化的提示词管理，支持：
 * - 版本控制
 * - A/B 测试
 * - 变量插值
 * - 使用统计
 */
@Injectable()
export class PromptRegistryService {
  private readonly logger = new Logger(PromptRegistryService.name);

  /**
   * 提示词定义存储
   * Key: prompt ID
   */
  private readonly prompts = new Map<string, PromptDefinition>();

  /**
   * 使用统计存储
   * Key: prompt ID
   */
  private readonly usageStats = new Map<string, PromptUsageStats>();

  /**
   * 注册单个提示词定义
   */
  register(definition: PromptDefinition): void {
    this.validateDefinition(definition);

    this.prompts.set(definition.id, definition);

    // 初始化使用统计
    if (!this.usageStats.has(definition.id)) {
      this.usageStats.set(definition.id, {
        id: definition.id,
        totalUses: 0,
        byVersion: {},
        lastUsed: new Date(),
      });
    }

    this.logger.log(
      `Registered prompt: ${definition.id} (${definition.versions.length} versions)`,
    );
  }

  /**
   * 批量注册提示词定义
   */
  registerAll(definitions: PromptDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }

    this.logger.log(`Registered ${definitions.length} prompts`);
  }

  /**
   * 解析提示词
   *
   * @param id - 提示词 ID
   * @param variables - 变量值映射
   * @param version - 指定版本（可选，默认使用 active 版本）
   * @returns 已解析的提示词
   */
  resolve(
    id: string,
    variables?: Record<string, string>,
    version?: string,
  ): ResolvedPrompt {
    const definition = this.prompts.get(id);

    if (!definition) {
      throw new Error(`Prompt not found: ${id}`);
    }

    // 选择版本
    const selectedVersion = this.selectVersion(definition, version);

    if (!selectedVersion) {
      throw new Error(`No valid version found for prompt: ${id}`);
    }

    // 变量插值
    const content = this.interpolate(
      selectedVersion.template,
      selectedVersion.variables,
      variables || {},
    );

    // 更新使用统计
    this.trackUsage(id, selectedVersion.version);

    return {
      id,
      version: selectedVersion.version,
      content,
      metadata: {
        category: definition.category,
        resolvedAt: new Date(),
        abGroup: selectedVersion.metadata?.abWeight
          ? `v${selectedVersion.version}`
          : undefined,
      },
    };
  }

  /**
   * 获取提示词定义
   */
  get(id: string): PromptDefinition | undefined {
    return this.prompts.get(id);
  }

  /**
   * 列出提示词定义
   *
   * @param category - 按类别筛选（可选）
   */
  list(category?: string): PromptDefinition[] {
    const allPrompts = Array.from(this.prompts.values());

    if (category) {
      return allPrompts.filter((p) => p.category === category);
    }

    return allPrompts;
  }

  /**
   * 获取使用统计
   *
   * @param id - 提示词 ID（可选，不传则返回所有统计）
   */
  getUsageStats(id?: string): PromptUsageStats | PromptUsageStats[] {
    if (id) {
      const stats = this.usageStats.get(id);
      if (!stats) {
        throw new Error(`Usage stats not found for prompt: ${id}`);
      }
      return stats;
    }

    return Array.from(this.usageStats.values());
  }

  /**
   * 设置活跃版本
   */
  setActiveVersion(id: string, version: string): void {
    const definition = this.prompts.get(id);

    if (!definition) {
      throw new Error(`Prompt not found: ${id}`);
    }

    const versionExists = definition.versions.some(
      (v) => v.version === version,
    );

    if (!versionExists) {
      throw new Error(`Version ${version} not found for prompt: ${id}`);
    }

    definition.activeVersion = version;
    this.logger.log(`Set active version for ${id}: ${version}`);
  }

  /**
   * 检查提示词是否存在
   */
  has(id: string): boolean {
    return this.prompts.has(id);
  }

  /**
   * 验证提示词定义
   */
  private validateDefinition(definition: PromptDefinition): void {
    if (!definition.id) {
      throw new Error("Prompt definition must have an id");
    }

    if (!definition.name) {
      throw new Error(`Prompt ${definition.id} must have a name`);
    }

    if (!definition.category) {
      throw new Error(`Prompt ${definition.id} must have a category`);
    }

    if (!definition.versions || definition.versions.length === 0) {
      throw new Error(`Prompt ${definition.id} must have at least one version`);
    }

    // 验证每个版本
    for (const version of definition.versions) {
      if (!version.version) {
        throw new Error(
          `Version in prompt ${definition.id} must have a version string`,
        );
      }

      if (!version.template) {
        throw new Error(
          `Version ${version.version} in prompt ${definition.id} must have a template`,
        );
      }
    }

    // 验证 activeVersion 存在
    if (definition.activeVersion) {
      const activeExists = definition.versions.some(
        (v) => v.version === definition.activeVersion,
      );

      if (!activeExists) {
        throw new Error(
          `Active version ${definition.activeVersion} not found in prompt ${definition.id}`,
        );
      }
    }
  }

  /**
   * 选择版本（支持 A/B 测试）
   */
  private selectVersion(
    definition: PromptDefinition,
    requestedVersion?: string,
  ): PromptVersion | undefined {
    // 如果指定了版本，直接返回
    if (requestedVersion) {
      return definition.versions.find((v) => v.version === requestedVersion);
    }

    // 如果有 activeVersion，返回它
    if (definition.activeVersion) {
      return definition.versions.find(
        (v) => v.version === definition.activeVersion,
      );
    }

    // A/B 测试逻辑
    const versionsWithWeights = definition.versions.filter(
      (v) => v.metadata?.abWeight !== undefined && v.metadata.abWeight > 0,
    );

    if (versionsWithWeights.length > 0) {
      return this.selectByWeight(versionsWithWeights);
    }

    // 默认返回最后一个版本（假设为最新）
    return definition.versions[definition.versions.length - 1];
  }

  /**
   * 根据权重选择版本（A/B 测试）
   */
  private selectByWeight(versions: PromptVersion[]): PromptVersion {
    const totalWeight = versions.reduce(
      (sum, v) => sum + (v.metadata?.abWeight || 0),
      0,
    );

    let random = Math.random() * totalWeight;

    for (const version of versions) {
      random -= version.metadata?.abWeight || 0;
      if (random <= 0) {
        return version;
      }
    }

    // 兜底：返回第一个
    return versions[0];
  }

  /**
   * 变量插值
   */
  private interpolate(
    template: string,
    variables: PromptVariable[],
    values: Record<string, string>,
  ): string {
    let result = template;

    // 检查必需变量
    for (const variable of variables) {
      if (variable.required && !values[variable.name]) {
        if (variable.defaultValue !== undefined) {
          values[variable.name] = variable.defaultValue;
        } else {
          throw new Error(`Required variable missing: ${variable.name}`);
        }
      }
    }

    // 替换变量
    const variablePattern = /\{\{(\w+)\}\}/g;
    result = result.replace(variablePattern, (match, varName: string) => {
      if (values[varName] !== undefined) {
        return values[varName];
      }

      // 检查是否有默认值
      const variable = variables.find((v) => v.name === varName);
      if (variable?.defaultValue !== undefined) {
        return variable.defaultValue;
      }

      // 如果不是必需的，保留占位符
      if (!variable?.required) {
        return match;
      }

      // 必需但未提供值（前面已检查，理论上不会到这里）
      throw new Error(`Required variable missing: ${varName}`);
    });

    return result;
  }

  /**
   * 跟踪使用情况
   */
  private trackUsage(id: string, version: string): void {
    const stats = this.usageStats.get(id);

    if (!stats) {
      this.usageStats.set(id, {
        id,
        totalUses: 1,
        byVersion: { [version]: 1 },
        lastUsed: new Date(),
      });
      return;
    }

    stats.totalUses += 1;
    stats.byVersion[version] = (stats.byVersion[version] || 0) + 1;
    stats.lastUsed = new Date();
  }
}
