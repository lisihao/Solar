/**
 * PlatformProbeAgent — 平台 schema 探测员
 *
 * S2 probe-platform: 通过 BrowserContextTool goto + evaluate 探测当前平台
 * saveDraft endpoint + schema 指纹 + dry-run ret code，输出 capability audit。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  platforms: z.array(z.string()).min(1),
  contextIds: z.record(z.string(), z.string()),
});

const ProbeResult = z.object({
  platform: z.string(),
  endpoint: z.string(),
  requiredFields: z.array(z.string()),
  schemaVersion: z.string(),
  probeResult: z.enum([
    "ok",
    "schema-mismatch",
    "rate-limited",
    "unauthorized",
  ]),
  evidence: z.string(),
});

const Output = z.object({
  results: z.array(ProbeResult).min(1),
});

export type PlatformProbeInput = z.infer<typeof Input>;
export type PlatformProbeOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.platform-probe",
  version: "1.0.0",
  identity: {
    role: "platform-probe",
    description:
      "平台 schema 探测员 —— goto + evaluate sniff + dry-run saveDraft",
  },
  loop: "react",
  toolCategories: ["automation"],
  taskProfile: { creativity: "deterministic", outputLength: "short" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 3_000, maxIterations: 4 },
})
export class PlatformProbeAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "platform-probe",
      "probe-platform",
      input as unknown as Record<string, unknown>,
    );
  }
}
