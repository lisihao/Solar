/**
 * pipeline-catalog.contract.ts —— mission pipeline 的「市场投影」展示元数据契约
 *
 * pipeline 的**工作流货架**展示信息（货架名/描述/阶段标签）归位到 pipeline 自己的
 * `meta.catalog`（单一真相，随执行态 config 一起活），不另起手写台账。company
 * MarketplaceCatalogService 从 @Global MissionPipelineRegistry 枚举 config、读
 * `meta.catalog` 投影到**工作流货架**。
 *
 * 注：Agent 货架不走这里 —— 角色 agent 由 `agent-spec-catalog.ts` 的真 @DefineAgent
 * 类经 readDefineAgentMeta 投影（单一源、可执行解析），不在 meta.catalog 重复登记。
 *
 * 生产侧（ai-app 的 *.config.ts）import 此类型填 `meta.catalog`；
 * 消费侧（company catalog service）import 此类型读取。harness 的
 * MissionPipelineConfig.meta 仍是开放 `Record<string, unknown>`，不感知此形状。
 */

/** 一个 mission pipeline → 工作流货架的展示元数据（挂在 config.meta.catalog）。 */
export interface PipelineCatalogMeta {
  /** 货架展示名（覆盖原始 pipeline id）。 */
  name: string;
  description: string;
  category: string;
  /** 人类可读阶段标签，顺序 = 执行顺序；数量应与 config.steps 对齐（drift spec 校验）。 */
  stages: string[];
  /**
   * 该 pipeline 跑完用哪个前端 MissionKit 呈现（如 'deep-insight'）。
   * 缺省 = 暂无配套呈现面。前端 resolveMissionKit(missionType) 解析 L4 详情组件。
   */
  missionType?: string;
}

/** 从 config.meta 安全取出 catalog 展示元数据（缺省 undefined）。 */
export function readPipelineCatalogMeta(
  meta: Readonly<Record<string, unknown>> | undefined,
): PipelineCatalogMeta | undefined {
  const c = meta?.catalog;
  if (!c || typeof c !== "object") return undefined;
  return c as PipelineCatalogMeta;
}
