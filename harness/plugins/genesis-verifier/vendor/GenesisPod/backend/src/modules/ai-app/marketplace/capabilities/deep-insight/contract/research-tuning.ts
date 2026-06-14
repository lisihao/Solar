/**
 * deep-insight 研究阶段调参（能力级单一源，平台所有）。
 *
 * researcher 的"最少 findings 阈值"原先从 playground 私有 runtime config 取
 * （`loadPlaygroundRuntimeConfig().minFindingsThreshold`）——这是能力→playground 的反依赖。
 * 此处用同一个 env 变量 + 同一默认值（`MIN_FINDINGS_THRESHOLD`，缺省 5）+ 同一 parse 工具
 * （`@/common`，非 playground）解析，**值与 playground 完全一致、不退化**，但切断了反依赖。
 */
import { parseNonNegativeIntEnv } from "@/common/utils/schema-coercion.utils";

/** researcher 至少要产出的 findings 数（本地推理模型常 plateau 在 3，故可 env 调低）。 */
export function resolveMinFindings(): number {
  return parseNonNegativeIntEnv(process.env.MIN_FINDINGS_THRESHOLD, 5);
}
