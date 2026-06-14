import { Logger } from "@nestjs/common";
import { FailureLearnerService } from "@/modules/ai-harness/facade";
import { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";

export class AgentInvocationPolicy {
  private readonly log = new Logger(AgentInvocationPolicy.name);

  constructor(private readonly failureLearner: FailureLearnerService) {}

  async preDisableKnownFailingModels(
    billing: BillingRuntimeEnvAdapter,
    agentSpecId: string,
    promptKey: string,
  ): Promise<{ failed: string; fallback: string }[]> {
    const known = await this.failureLearner
      .lookup({ agentSpecId, systemPrompt: promptKey })
      .catch((err: unknown) => {
        this.log.warn(
          `[agent-invocation-policy] failureLearner.lookup failed for ${agentSpecId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as Awaited<ReturnType<typeof this.failureLearner.lookup>>;
      });
    const preDisabled: { failed: string; fallback: string }[] = [];
    for (const rec of known) {
      // ★ E57 (2026-05-25): 用 FailureLearner 单一权威阈值判定（count≥阈值 且
      //   未 resolved），取代此前各处硬编码的 `count >= 2`，避免阈值漂移 +
      //   避免对已 resolved 的记录误禁用。
      if (this.failureLearner.shouldAutoDisable(rec) && rec.lastFallbackModel) {
        void billing.markModelDisabled(rec.modelId, rec.lastFallbackModel);
        preDisabled.push({
          failed: rec.modelId,
          fallback: rec.lastFallbackModel,
        });
      }
    }
    return preDisabled;
  }

  resolveLoopOverride(
    auditLayers: string,
    stage:
      | "leader"
      | "researcher"
      | "reconciler"
      | "analyst"
      | "writer"
      | "reviewer"
      | "verifier"
      | "critic"
      | "steward",
  ): "react" | "reflexion" | undefined {
    if (auditLayers === "minimal") return undefined;
    const useReflexion =
      auditLayers === "thorough" || auditLayers === "thorough+";
    if (!useReflexion) return undefined;
    if (
      stage === "researcher" ||
      stage === "reconciler" ||
      stage === "verifier" ||
      stage === "critic" ||
      stage === "steward"
    ) {
      return undefined;
    }
    return "reflexion";
  }
}
