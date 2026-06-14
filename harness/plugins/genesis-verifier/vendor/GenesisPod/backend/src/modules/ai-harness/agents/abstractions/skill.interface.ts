/**
 * Skill — SKILL.md 风格的可复用指令包（SOTA 2025-2026）
 *
 * 区别于 ai-engine/skills/（老 CRUD 风格 skill record），
 * Harness Skill 是：frontmatter + instructions + 工具绑定 + hook 绑定。
 */

import type { IHookBinding, HookEvent } from "./hook.interface";
import type { IContextEnvelope } from "./context-envelope.interface";

/** Skill frontmatter 元数据 */
export interface ISkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  tags?: readonly string[];
  allowedTools?: readonly string[];
  allowedModels?: readonly string[];
  /** 仅在特定 Role 下激活 */
  activateFor?: readonly string[];
}

/** Skill 激活上下文（Skill 可修改 envelope） */
export interface ISkillActivationContext {
  readonly envelope: IContextEnvelope;
  /** 添加 system reminder */
  addReminder: (content: string, priority?: "low" | "medium" | "high") => void;
  /** 注册临时 hook（agent 运行结束后自动 unregister） */
  registerHook: <E extends HookEvent>(binding: IHookBinding<E>) => void;
}

/** Skill 定义 */
export interface ISkill {
  readonly frontmatter: ISkillFrontmatter;
  /** Markdown 指令文本 */
  readonly instructions: string;
  /** 激活时回调，可注入 reminder 或注册 hook */
  activate?(context: ISkillActivationContext): void | Promise<void>;
}

/** Skill 加载器接口（从文件/DB 加载 SKILL.md） */
export interface ISkillLoader {
  loadById(id: string): Promise<ISkill | null>;
  loadAll(): Promise<readonly ISkill[]>;
}

/**
 * Skill 提供者端口（2026-05-01）
 *
 * SkillActivator 在 BuiltinSkillCatalog 没命中时按序查询的二级源。
 * ai-engine 侧（DB-backed SkillRegistry，含 Admin UI / API CRUD）通过实现这个
 * 端口把用户自定义 skill 透出给 harness agent 运行时，无需 harness 反向
 * 依赖 ai-engine。
 */
export interface ISkillProvider {
  /** 提供者标识（日志 / observability 用） */
  readonly id: string;
  /**
   * 按 name 查找；找不到返回 null。
   * 同步实现优先（避免 SkillActivator 整链路 async），
   * DB-backed 实现可返回 Promise。
   */
  resolveByName(name: string): ISkill | null | Promise<ISkill | null>;
}

/** DI token: SkillActivator 注入的 ISkillProvider 集合（可空） */
export const SKILL_PROVIDERS = Symbol("SKILL_PROVIDERS");
