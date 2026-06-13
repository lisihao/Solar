/**
 * Domain Concept —— 业务领域概念的统一描述
 *
 * Topic Insights 7 个核心概念（topic / mission / dimension / sub-topic / evidence /
 * source / report / section）当前散落在各 service。本注册表让 Harness 能"理解"它们，
 * 多个 AI App 可复用同名概念（业务模块 都有 topic / report）。
 *
 * 设计原则：
 *   - 概念是元数据级（描述、字段类型、关系），不是 Prisma 表
 *   - Adapter 把业务 Prisma 行 ↔ DomainEntity 互转，Harness 只看 DomainEntity
 *   - Loop 调用方用 conceptRegistry.get('{app}.dimension') 拿描述，按需查询
 */

export interface ConceptField {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "date" | "json" | "ref";
  /** type=ref 时：ref 概念 id，e.g. '{app}.topic' */
  readonly refConcept?: string;
  /** 是否必填 */
  readonly required?: boolean;
  /** 人话描述 */
  readonly description?: string;
}

export interface ConceptRelation {
  readonly name: string;
  readonly kind: "belongs_to" | "has_many" | "has_one";
  readonly to: string; // 目标 concept id
}

export interface DomainConceptSpec {
  /** 概念 id：'<module>.<name>'，全局唯一 */
  readonly id: string;
  /** 人话名称 */
  readonly displayName: string;
  /** 描述 */
  readonly description: string;
  /** 字段定义 */
  readonly fields: readonly ConceptField[];
  /** 关系定义 */
  readonly relations?: readonly ConceptRelation[];
  /** 模块所属 */
  readonly moduleId: string;
}

/**
 * DomainEntity —— 概念的运行时实例。
 *
 * conceptId + id 唯一定位一个实体；data 是字段值字典。
 */
export interface DomainEntity<TData = Record<string, unknown>> {
  readonly conceptId: string;
  readonly id: string;
  readonly data: TData;
}
