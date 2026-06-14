/**
 * BuiltinSkillCatalog (ai-harness/agents) — ReAct/Agent runtime 内置 skill 目录
 *
 * 2026-05-01 改名: 原叫 `SkillRegistry`，与 `ai-engine/skills/registry/SkillRegistry`
 * 同名异构。本类是 ReAct loop 的内置 skill 容器（SKILL.md frontmatter 解析），
 * engine 那个是业务 skill 的 CRUD store。改名后 IDE 自动补全 / 阅读不再混淆。
 *
 * 用途:
 *   - SKILL.md frontmatter 解析后注册（索引 by `name`）
 *   - 驱动 ReAct/Agent runtime 的 instruction activation
 *   - 通过 `@/modules/ai-harness/facade` 使用
 *
 * 与 ai-engine/skills/SkillRegistry 的区别:
 *   - 本类: 内存级，启动时 load SKILL.md 文件，runtime 内置
 *   - engine: DB 级，CRUD ISkill 对象，admin UI 驱动
 *
 * 支持按 id / tag / activateFor (Role id) 查找。
 *
 * 兼容说明:
 *   - `BuiltInReActSkillRegistry` 仅保留为向后兼容别名
 *   - 新代码一律使用 `BuiltinSkillCatalog`
 */

import { Injectable, Logger } from "@nestjs/common";
import type { ISkill } from "../abstractions";

@Injectable()
export class BuiltinSkillCatalog {
  private readonly logger = new Logger(BuiltinSkillCatalog.name);
  private readonly byName = new Map<string, ISkill>();

  register(skill: ISkill): void {
    const name = skill.frontmatter.name;
    if (this.byName.has(name)) {
      this.logger.warn(`Skill '${name}' already registered — overwriting.`);
    }
    this.byName.set(name, skill);
  }

  registerAll(skills: readonly ISkill[]): void {
    for (const s of skills) this.register(s);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): ISkill | undefined {
    return this.byName.get(name);
  }

  all(): readonly ISkill[] {
    return Array.from(this.byName.values());
  }

  /** 按 tag 过滤 */
  listByTag(tag: string): readonly ISkill[] {
    return this.all().filter((s) => s.frontmatter.tags?.includes(tag) ?? false);
  }

  /** 查出 activateFor 包含指定 role 的 skills */
  listForRole(roleId: string): readonly ISkill[] {
    return this.all().filter(
      (s) => s.frontmatter.activateFor?.includes(roleId) ?? false,
    );
  }

  /**
   * PR-I 修复 #10: Skill discovery —— 给 LLM 用的紧凑列表。
   *
   * 在 prompt 里注入"# Available skills"段落，agent 看到列表后可主动声明
   * "use skill: web-research"。比把每个 skill 完整 instructions 都塞进 prompt 节省 90% token。
   */
  describeForLLM(filter?: { roleId?: string; tag?: string }): string {
    let list: readonly ISkill[] = this.all();
    if (filter?.roleId) {
      list = list.filter(
        (s) => s.frontmatter.activateFor?.includes(filter.roleId!) ?? false,
      );
    }
    if (filter?.tag) {
      list = list.filter(
        (s) => s.frontmatter.tags?.includes(filter.tag!) ?? false,
      );
    }
    if (list.length === 0) return "(no skills available)";
    return list
      .map(
        (s) =>
          `- ${s.frontmatter.name}: ${s.frontmatter.description}` +
          (s.frontmatter.tags?.length
            ? ` [${s.frontmatter.tags.join(", ")}]`
            : ""),
      )
      .join("\n");
  }

  /** Skill 选择助手：根据 query 关键词找 top-K 匹配（简单 keyword overlap） */
  recommend(query: string, k = 3): readonly ISkill[] {
    const q = query.toLowerCase();
    const scored = this.all().map((s) => {
      const haystack = (
        s.frontmatter.name +
        " " +
        s.frontmatter.description +
        " " +
        (s.frontmatter.tags ?? []).join(" ")
      ).toLowerCase();
      let score = 0;
      for (const word of q.split(/\s+/).filter((w) => w.length > 2)) {
        if (haystack.includes(word)) score += 1;
      }
      return { skill: s, score };
    });
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.skill);
  }

  clear(): void {
    this.byName.clear();
  }

  size(): number {
    return this.byName.size;
  }
}

export { BuiltinSkillCatalog as BuiltInReActSkillRegistry };
