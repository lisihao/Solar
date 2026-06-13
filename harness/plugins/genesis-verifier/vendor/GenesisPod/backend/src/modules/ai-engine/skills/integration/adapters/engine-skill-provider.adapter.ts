/**
 * EngineSkillProvider — ai-engine SkillRegistry → harness ISkillProvider 适配器
 *
 * 2026-05-01: 让 harness SkillActivator 能透出用户在 Admin UI / API CRUD 的
 * 自定义 skill。Admin UI → DB → SkillContentService → SkillLoaderService →
 * ai-engine SkillRegistry（PromptSkillAdapter 注册）→ 本 adapter → harness。
 *
 * 工作方式：
 *   1. SkillActivator 收到 agent 的 `skills: ["my-custom"]` 列表
 *   2. built-in markdown registry 没命中 → 调本 adapter.resolveByName("my-custom")
 *   3. 本 adapter 用 SkillRegistry.tryGet 查 PromptSkillAdapter
 *   4. 把 PromptSkillAdapter 的 frontmatter / instructions 转成 harness ISkill 形状
 *
 * 用户体验：原本 @DefineAgent({ skills: [...] }) 的硬编码列表里既能写
 * built-in 名（如 "cross-dim-fact-check"）也能写自定义名（如 "my-compliance-check"），
 * harness 自动按顺序解析。
 *
 * 不引入循环依赖：本 adapter 只单向 import ai-engine 内部 + ai-harness 抽象类型。
 */

import { Injectable, Logger } from "@nestjs/common";
import { SkillRegistry } from "../../registry/skill.registry";
import type {
  IKernelSkill as IHarnessSkill,
  ISkillProvider,
} from "@/modules/ai-harness/facade";
import { PromptSkillAdapter } from "./prompt-skill.adapter";

@Injectable()
export class EngineSkillProvider implements ISkillProvider {
  readonly id = "ai-engine.skill.registry";
  private readonly logger = new Logger(EngineSkillProvider.name);

  constructor(private readonly skillRegistry: SkillRegistry) {}

  resolveByName(name: string): IHarnessSkill | null {
    // ai-engine SkillRegistry 主索引是 id，且 PromptSkillAdapter 的 id == frontmatter.name
    // 所以同一个字符串可以作为 lookup key
    const skill = this.skillRegistry.tryGet(name);
    if (!skill) return null;

    // 只把 prompt-style skill 透出给 harness（code-based skill 走自己的 SkillService 路径）
    if (!(skill instanceof PromptSkillAdapter)) {
      this.logger.debug(
        `Skill '${name}' is not a PromptSkillAdapter — skipping engine→harness bridge`,
      );
      return null;
    }

    const meta = skill.getDefinitionMetadata();
    const instructions = skill.getPromptContent();

    return {
      frontmatter: {
        name: meta.name,
        description: meta.description ?? "",
        version: meta.version,
        tags: meta.tags,
        // ai-engine SkillMdDefinition.metadata 没有 allowedTools / activateFor，
        // 留空让 harness 默认行为接管（不限制工具 / 全 role 可见）
      },
      instructions,
    };
  }
}
