/**
 * Stage S2 — Platform schema probe
 *
 *   reads  ctx: input.platforms, contextIds, billing, pool
 *   writes ctx: probeResults (PlatformProbeOutput)
 */

import type {
  MissionInvariants,
  PlanPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runPlatformProbeStage(
  ctx: MissionInvariants & PlanPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const { missionId, userId, input, contextIds, pool, billing } = ctx;

  await narrate(deps.emit, missionId, userId, {
    stage: "s2-platform-probe",
    role: "platform-probe",
    tag: "searching",
    text: `开始探测 ${input.platforms.length} 个平台 schema`,
  });

  const probeResult = await deps.platformProbe.run({
    input: {
      platforms: [...input.platforms],
      contextIds: { ...contextIds },
    },
    ctx: {
      missionId,
      userId,
      agentId: `platform-probe-${missionId}`,
      role: "platform-probe",
      envAdapter: billing,
    },
    pool,
  });

  if (probeResult.state === "failed" || !probeResult.output) {
    throw new Error(`[s2] PlatformProbe failed for mission ${missionId}`);
  }

  ctx.probeResults = probeResult.output;

  const probeStates = probeResult.output.results
    .map((r) => `${r.platform}=${r.probeResult}`)
    .join(", ");
  await narrate(deps.emit, missionId, userId, {
    stage: "s2-platform-probe",
    role: "platform-probe",
    tag: "success",
    text: `平台探测完成：${probeStates}`,
  });
}
