/**
 * SkillActivator — 根据 Agent Identity 激活匹配的 Skills
 *
 * 职责：
 *   - 按 identity.skills 从 registry 查出所有激活的 skill
 *   - 把每个 skill 的 instructions 拼成 system reminder（high 优先级）
 *   - 调用 skill.activate(ctx) 让 skill 可额外注入 reminder / 注册临时 hook
 *   - 返回变更后的 envelope + 注销 hook 的清理函数
 *
 * 返回的清理函数应在 agent 执行结束后调用（由 HarnessedAgent 在 finally 里触发）。
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  IAgentIdentity,
  IContextEnvelope,
  IHookBinding,
  ISkill,
  ISkillActivationContext,
  ISkillProvider,
  HookEvent,
} from "../abstractions";
import { SKILL_PROVIDERS } from "../abstractions";
import { ContextEnvelope } from "../core/context-envelope";
import { BuiltinSkillCatalog } from "./skill-registry";
import { HookRegistry } from "../core/hook-registry";

export interface SkillActivationResult {
  envelope: IContextEnvelope;
  /** 卸载本次激活期间注册的所有临时 hook */
  cleanup: () => void;
  /** 已激活的 skill 名列表（用于 observability） */
  activatedSkills: readonly string[];
}

@Injectable()
export class SkillActivator {
  private readonly logger = new Logger(SkillActivator.name);
  private readonly providers: readonly ISkillProvider[];

  constructor(
    private readonly registry: BuiltinSkillCatalog,
    private readonly hooks: HookRegistry,
    /**
     * 2026-05-01: 二级 skill 源（ai-engine DB-backed SkillRegistry / 远端 marketplace
     * 等）。built-in 没命中时按注入顺序查；用户自定义 skill 通过这条路径透出。
     */
    @Optional()
    @Inject(SKILL_PROVIDERS)
    providers?: readonly ISkillProvider[],
  ) {
    this.providers = providers ?? [];
  }

  async activate(
    identity: IAgentIdentity,
    envelope: IContextEnvelope,
  ): Promise<SkillActivationResult> {
    const requestedIds = identity.skills ?? [];
    if (requestedIds.length === 0) {
      return { envelope, cleanup: () => {}, activatedSkills: [] };
    }

    // 1. built-in 优先（in-memory 命中最快）
    // 2. 任一二级 provider 命中即返回（按注入顺序）
    const skills: ISkill[] = [];
    const missing: string[] = [];
    for (const id of requestedIds) {
      const builtIn = this.registry.get(id);
      if (builtIn) {
        skills.push(builtIn);
        continue;
      }
      const fromProvider = await this.resolveFromProviders(id);
      if (fromProvider) {
        skills.push(fromProvider);
        continue;
      }
      missing.push(id);
    }

    if (missing.length > 0) {
      this.logger.warn(
        `Skills not found in registry and skipped: ${missing.join(", ")}`,
      );
    }

    let current = envelope;
    const activated: string[] = [];
    const unregisterFns: Array<() => void> = [];

    for (const skill of skills) {
      // 1. Inject instructions as high-priority reminder
      if (current instanceof ContextEnvelope) {
        current = current.withReminder(
          `## Skill: ${skill.frontmatter.name}\n${skill.instructions}`,
          "high",
          `skill:${skill.frontmatter.name}`,
        ).envelope as ContextEnvelope;
      } else {
        current = {
          ...current,
          reminders: [
            ...current.reminders,
            {
              source: `skill:${skill.frontmatter.name}`,
              priority: "high" as const,
              content: `## Skill: ${skill.frontmatter.name}\n${skill.instructions}`,
            },
          ],
        };
      }

      // 2. Call skill.activate() with a scoped activation context
      if (skill.activate) {
        const ctx: ISkillActivationContext = {
          envelope: current,
          addReminder: (content, priority = "medium") => {
            if (current instanceof ContextEnvelope) {
              current = current.withReminder(
                content,
                priority,
                `skill:${skill.frontmatter.name}`,
              ).envelope as ContextEnvelope;
            }
          },
          registerHook: <E extends HookEvent>(binding: IHookBinding<E>) => {
            // PR-I 建议修联动：HookRegistry 现要求非 global scope 必须有 scopeTarget。
            // SkillActivator 自动用 skill name 兜底，业务方无感。
            const enriched: IHookBinding<E> = {
              ...binding,
              scopeTarget:
                binding.scopeTarget ??
                (binding.scope === "skill"
                  ? skill.frontmatter.name
                  : binding.scopeTarget),
              scope: binding.scope === "skill" ? "global" : binding.scope,
            };
            const unreg = this.hooks.register(enriched);
            unregisterFns.push(unreg);
          },
        };
        try {
          await skill.activate(ctx);
        } catch (err) {
          this.logger.warn(
            `Skill '${skill.frontmatter.name}' activate() threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      activated.push(skill.frontmatter.name);
    }

    return {
      envelope: current,
      cleanup: () => {
        for (const u of unregisterFns) {
          try {
            u();
          } catch {
            /* ignore */
          }
        }
      },
      activatedSkills: activated,
    };
  }

  /**
   * 按注入顺序查询每个 ISkillProvider，第一个命中即返回。
   * Provider 抛错时记 warn 不阻断其他 provider。
   */
  private async resolveFromProviders(name: string): Promise<ISkill | null> {
    for (const provider of this.providers) {
      try {
        const result = await provider.resolveByName(name);
        if (result) {
          this.logger.debug(
            `Skill '${name}' resolved by provider '${provider.id}'`,
          );
          return result;
        }
      } catch (err) {
        this.logger.warn(
          `SkillProvider '${provider.id}' resolveByName('${name}') threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return null;
  }
}


