/**
 * playground-catalog.spec.ts —— 工作流货架 meta.catalog 防漂移守护
 *
 * meta.catalog 是工作流货架 display 单源（与执行态 PLAYGROUND_PIPELINE 同活）。
 * 锁死 stages 数量与 pipeline.steps 对齐，避免改了 pipeline 忘了改 catalog（或反之）。
 * 角色 agent 的投影守护见 contracts/__tests__/agent-spec-catalog.spec.ts。
 */
import { PLAYGROUND_PIPELINE } from "../runtime/playground.config";
import { readPipelineCatalogMeta } from "../../contracts/pipeline-catalog.contract";

describe("playground catalog meta (工作流货架 drift 守护)", () => {
  const catalog = readPipelineCatalogMeta(PLAYGROUND_PIPELINE.meta);

  it("meta.catalog 存在", () => {
    expect(catalog).toBeDefined();
  });

  it("catalog.stages 数量与 pipeline.steps 对齐", () => {
    expect(catalog?.stages.length).toBe(PLAYGROUND_PIPELINE.steps.length);
  });
});
