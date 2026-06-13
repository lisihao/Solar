/**
 * AI Engine - Skill Registry
 *
 * ⚠️ NAME COLLISION WARNING — there are TWO classes called `SkillRegistry`
 * in this codebase. They are distinct concepts and **must not be mixed**:
 *
 * 1. THIS class — `ai-engine/skills/registry/skill.registry.ts`
 *    - CRUD-style registry of `ISkill` instances (programmatic skill objects).
 *    - Indexed by `domain` (Map<string, Set<id>>) and `layer` (Map<string, Set<id>>).
 *    - Backed by DB via `SkillContentService`.
 *    - Used by skills-api (open-api layer) for external skill management UI.
 *    - Symbol: `import { SkillRegistry } from "@/modules/ai-engine/facade"`.
 *
 * 2. The other one — `ai-harness/agents/skill-runtime/skill-registry.ts`
 *    - In-memory registry of SKILL.md files (parsed frontmatter + body).
 *    - Indexed by skill `name` (Map<string, ISkill>).
 *    - Loaded at boot by `SkillLoader` from .skill.md / SKILL.md files in
 *      ai-app/research/skills, writing/skills, {app}/skills, etc.
 *    - Used by `ReActLoop` / `SkillActivator` for runtime instruction packs.
 *    - Symbol: `import { SkillRegistry } from "@/modules/ai-harness/facade"`.
 *
 * Renaming one of them (e.g. SkillMdRegistry for the harness one) is tracked
 * by audit P1-3 but deferred — the rename touches ~65 files.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  BaseRegistry,
  IRegistry,
  RegistryStats,
} from "@/modules/ai-engine/facade/abstractions/registry.interface";
import {
  ISkill,
  SkillLayer,
  SkillDefinition,
  TriggerRule,
} from "../abstractions/skill.interface";

/**
 * 技能注册表
 */
@Injectable()
export class SkillRegistry
  extends BaseRegistry<ISkill>
  implements IRegistry<ISkill>
{
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly byLayer = new Map<string, Set<string>>();
  private readonly byDomain = new Map<string, Set<string>>();
  private readonly byTag = new Map<string, Set<string>>();
  private readonly factories = new Map<string, () => ISkill>();

  /**
   * 注册技能
   */
  override register(skill: ISkill): void {
    super.register(skill);

    // 索引层次
    if (!this.byLayer.has(skill.layer)) {
      this.byLayer.set(skill.layer, new Set());
    }
    this.byLayer.get(skill.layer)!.add(skill.id);

    // 索引领域
    if (!this.byDomain.has(skill.domain)) {
      this.byDomain.set(skill.domain, new Set());
    }
    this.byDomain.get(skill.domain)!.add(skill.id);

    // 索引标签
    if (skill.tags) {
      for (const tag of skill.tags) {
        if (!this.byTag.has(tag)) {
          this.byTag.set(tag, new Set());
        }
        this.byTag.get(tag)!.add(skill.id);
      }
    }
  }

  /**
   * 注册技能定义
   */
  registerDefinition<TInput, TOutput>(
    definition: SkillDefinition<TInput, TOutput>,
  ): void {
    if (definition.factory) {
      this.factories.set(definition.id, definition.factory);
    }
  }

  /**
   * 注销技能
   */
  override unregister(id: string): boolean {
    const skill = this.tryGet(id);
    if (!skill) {
      return false;
    }

    this.byLayer.get(skill.layer)?.delete(id);
    this.byDomain.get(skill.domain)?.delete(id);

    if (skill.tags) {
      for (const tag of skill.tags) {
        this.byTag.get(tag)?.delete(id);
      }
    }

    // Clean up factory
    this.factories.delete(id);

    return super.unregister(id);
  }

  /**
   * 按层次获取技能
   */
  getByLayer(layer: SkillLayer): ISkill[] {
    const ids = this.byLayer.get(layer);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.tryGet(id))
      .filter((s): s is ISkill => s !== undefined);
  }

  /**
   * 按领域获取技能
   */
  getByDomain(domain: string): ISkill[] {
    const ids = this.byDomain.get(domain);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.tryGet(id))
      .filter((s): s is ISkill => s !== undefined);
  }

  /**
   * 按标签获取技能
   */
  getByTag(tag: string): ISkill[] {
    const ids = this.byTag.get(tag);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.tryGet(id))
      .filter((s): s is ISkill => s !== undefined);
  }

  /**
   * 获取所有层次
   */
  getLayers(): SkillLayer[] {
    return Array.from(this.byLayer.keys());
  }

  /**
   * 获取所有领域
   */
  getDomains(): string[] {
    return Array.from(this.byDomain.keys());
  }

  /**
   * 获取所有标签
   */
  getTags(): string[] {
    return Array.from(this.byTag.keys());
  }

  /**
   * 获取统计信息
   */
  override getStats(): SkillRegistryStats {
    const baseStats = super.getStats();
    const byLayer: Record<string, number> = {};
    const byDomain: Record<string, number> = {};

    for (const [layer, ids] of this.byLayer.entries()) {
      byLayer[layer] = ids.size;
    }
    for (const [domain, ids] of this.byDomain.entries()) {
      byDomain[domain] = ids.size;
    }

    return {
      ...baseStats,
      byLayer,
      byDomain,
    };
  }

  /**
   * 比较版本号（semver）
   * 返回：1（a > b）, -1（a < b）, 0（相等）
   */
  compareVersions(versionA: string, versionB: string): number {
    const partsA = versionA.split(".").map(Number);
    const partsB = versionB.split(".").map(Number);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const a = partsA[i] || 0;
      const b = partsB[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }

    return 0;
  }

  /**
   * 检查技能版本是否兼容（major 版本一致）
   */
  isVersionCompatible(skillId: string, requiredVersion: string): boolean {
    const skill = this.tryGet(skillId);
    if (!skill?.version) return true; // 无版本信息视为兼容

    const currentMajor = parseInt(skill.version.split(".")[0], 10);
    const requiredMajor = parseInt(requiredVersion.split(".")[0], 10);

    if (isNaN(currentMajor) || isNaN(requiredMajor)) {
      this.logger.warn(
        `Invalid version format for skill ${skillId}: current=${skill.version}, required=${requiredVersion}`,
      );
      return true; // 格式无效时宽松兼容
    }

    return currentMajor === requiredMajor;
  }

  /**
   * 检测常见 ReDoS 模式（嵌套量词）
   */
  private isSafeRegex(pattern: string): boolean {
    // 检测 (a+)+、(a*)* 等危险嵌套量词
    return !/([\+\*\?]\)[\+\*]|\(\?:[^)]+\|[^)]+\)[\+\*])/.test(pattern);
  }

  /**
   * 根据触发条件匹配技能
   */
  matchByTrigger(triggerType: TriggerRule["type"], value: string): ISkill[] {
    const matched: Array<{ skill: ISkill; priority: number }> = [];

    for (const skill of this.getAll()) {
      if (!skill.triggers) continue;

      for (const trigger of skill.triggers) {
        if (trigger.type !== triggerType) continue;

        let isMatch = false;
        if (triggerType === "keyword") {
          isMatch = value
            .toLowerCase()
            .includes(trigger.condition.toLowerCase());
        } else if (triggerType === "intent") {
          isMatch = value === trigger.condition;
        } else if (triggerType === "context" || triggerType === "event") {
          if (!this.isSafeRegex(trigger.condition)) {
            this.logger.warn(
              `Potentially unsafe regex skipped: ${trigger.condition}`,
            );
            continue;
          }
          try {
            isMatch = new RegExp(trigger.condition, "i").test(value);
          } catch {
            this.logger.warn(
              `Invalid regex in skill trigger: ${trigger.condition}`,
            );
          }
        }

        if (isMatch) {
          matched.push({ skill, priority: trigger.priority ?? 0 });
          break; // 同一技能只匹配一次
        }
      }
    }

    // 按优先级降序排列
    return matched.sort((a, b) => b.priority - a.priority).map((m) => m.skill);
  }

  /**
   * 搜索技能
   */
  search(query: SkillSearchQuery): ISkill[] {
    let results = this.getAll();

    if (query.keyword) {
      const keyword = query.keyword.toLowerCase();
      results = results.filter(
        (skill) =>
          skill.id.toLowerCase().includes(keyword) ||
          skill.name.toLowerCase().includes(keyword) ||
          skill.description.toLowerCase().includes(keyword),
      );
    }

    if (query.layer) {
      results = results.filter((skill) => skill.layer === query.layer);
    }

    if (query.domain) {
      results = results.filter((skill) => skill.domain === query.domain);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(
        (skill) =>
          skill.tags && query.tags!.some((tag) => skill.tags!.includes(tag)),
      );
    }

    return results;
  }
}

/**
 * 技能注册表统计
 */
export interface SkillRegistryStats extends RegistryStats {
  byLayer: Record<string, number>;
  byDomain: Record<string, number>;
}

/**
 * 技能搜索查询
 */
export interface SkillSearchQuery {
  keyword?: string;
  layer?: SkillLayer;
  domain?: string;
  tags?: string[];
}
