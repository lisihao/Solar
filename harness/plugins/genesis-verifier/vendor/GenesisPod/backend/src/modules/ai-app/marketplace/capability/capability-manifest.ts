/**
 * CapabilityManifest —— 市场能力的**版本化声明式清单**（平台共享）。
 *
 * 设计意图（面向未来公开市场，成本近零但锁住可演进性）：
 *   能力 = 一份 manifest（契约）+ 一个可插拔的 runner（实现）。今天 runner 是进程内
 *   实现；未来公开市场可把同一 manifest 的实现换成**沙箱 / 远程 / MCP server**，
 *   消费方（按 manifest.id[@version] 解析）代码不变。这就是"契约固定、实现可插拔"。
 *
 * 对标业界：npm 包(版本+不可变)、VS Code 扩展(manifest+权限)、MCP server(协议化)、
 * OCI 镜像(digest pin)。本 manifest 是这些范式在本平台的最小落点。
 */

/**
 * 市场可采用的能力类型。
 * 四货架基元：agent / skill / tool / workflow。
 * ★ 2026-06-08（用户拍板）：team 升为一等市场单元——一支预组好的完整团队（多 agent
 *   花名册 + Leader + 绑定 workflow）可整体发布/采用，"套用为我的团队"。它不是基元，
 *   而是基元的预组合捆绑，但作为可采用单元与四货架平级登记。
 */
export type CapabilityKind = "workflow" | "agent" | "skill" | "tool" | "team";

export interface CapabilityManifest {
  /** 稳定 id —— 市场 listingId 的解析键（如 "deep-insight"）。 */
  readonly id: string;
  /**
   * 语义版本。今天恒 "1.0.0"，resolve 只取 latest。
   * ★ ADR 009：未来公开市场的 range 协商 / fail-fast **复用 plugin 的 coreVersionRange**，
   *   不在此另起一套版本协商机制。
   */
  readonly version: string;
  /** 四原语类型。 */
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly description?: string;
  /** 工作流角色 id 列表（消费方据此把团队成员绑定到角色）。 */
  readonly roles?: readonly string[];
  /** 阶段展示标签（目录卡 / 详情图）。 */
  readonly stages?: readonly string[];
  /** 前端呈现面绑定键（resolveMissionKit）。 */
  readonly missionType?: string;
  /**
   * 声明式权限标签（如 "web-search"）。今天内部一方市场不强制消费。
   * ★ ADR 009：未来公开市场的权限**枚举 + 强制 + 沙箱执行复用 plugin 的 PluginCapability
   *   模型 + getService 门控 + sandbox-isolated-vm**——本字段只作 L3 声明，**不在此重造
   *   一套权限/沙箱栈**。第三方 runner 那天经 plugin-backed 适配器落地（见 ADR 009）。
   */
  readonly permissions?: readonly string[];
  /**
   * 验收 rubric —— 消费方据此对能力产出做 gate（通过/重跑）。
   * 缺省时消费方按能力类型套默认 rubric（如 deep-insight 默认 passThreshold=60）。
   */
  readonly rubric?: {
    /** 通过分数下限（0-100）；产出综合分 < 此值 → 不通过。 */
    readonly passThreshold: number;
    /** 最大验收重跑次数（含首跑），防死循环。缺省 2。 */
    readonly maxAttempts?: number;
    /** 维度权重（可选，今天 deep-insight 单一综合分即可，预留）。 */
    readonly dimensions?: ReadonlyArray<{
      id: string;
      name: string;
      weight: number;
    }>;
  };
}

/** 组合 id@version 解析键。 */
export function capabilityKey(id: string, version: string): string {
  return `${id}@${version}`;
}
