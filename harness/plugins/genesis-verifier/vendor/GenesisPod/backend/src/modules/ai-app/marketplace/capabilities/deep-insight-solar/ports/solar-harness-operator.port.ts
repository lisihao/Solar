import { Inject, Injectable, Optional } from "@nestjs/common";
import { spawn } from "node:child_process";
import { AIFacade } from "@/modules/ai-harness/facade";

export type SolarOperatorStatus =
  | "succeeded"
  | "failed"
  | "degraded"
  | "timed_out";

export interface SolarOperatorRequest {
  readonly missionId: string;
  readonly userId?: string;
  readonly capabilityId: "deep-insight-solar";
  readonly pipelineId: "deep-insight-solar";
  readonly stepId: string;
  readonly operatorId:
    | "BrowserLeaderPlanner"
    | "BrowserResearcher"
    | "BrowserAnalyst"
    | "BrowserLongformWriter"
    | "BrowserCritic"
    | "TechnologyDiagramPainter";
  readonly idempotencyKey: string;
  readonly inputStateHash: string;
  readonly topic: string;
  readonly depth: "quick" | "standard" | "deep";
  readonly language: "zh-CN" | "en-US";
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
}

export interface SolarOperatorResult {
  readonly status: SolarOperatorStatus;
  readonly structured?: unknown;
  readonly markdown?: string;
  readonly evidence?: readonly unknown[];
  readonly artifacts?: readonly unknown[];
  readonly metrics?: Readonly<Record<string, unknown>>;
  readonly rawTranscriptUri?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface SolarHarnessOperatorPort {
  runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult>;
}

function parseArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to conservative whitespace split for local dev ergonomics.
  }
  return raw.split(/\s+/).filter(Boolean);
}

function parseSolarOperatorResult(raw: string): SolarOperatorResult | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as SolarOperatorResult;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function modelStrategyFromRequest(
  request: SolarOperatorRequest,
): Record<string, unknown> {
  const constraints = request.constraints as
    | { modelStrategy?: unknown }
    | undefined;
  const strategy = constraints?.modelStrategy;
  return strategy && typeof strategy === "object"
    ? (strategy as Record<string, unknown>)
    : {};
}

@Injectable()
export class SubprocessSolarHarnessOperatorPort
  implements SolarHarnessOperatorPort
{
  constructor(
    @Optional()
    @Inject(AIFacade)
    private readonly aiFacade?: AIFacade,
  ) {}

  private async buildModelEnv(
    request: SolarOperatorRequest,
  ): Promise<NodeJS.ProcessEnv> {
    const strategy = modelStrategyFromRequest(request);
    const nativeFastModelId =
      typeof strategy.nativeFastModelId === "string"
        ? strategy.nativeFastModelId.trim()
        : "";
    if (!nativeFastModelId || !this.aiFacade) return {};

    try {
      const config = await this.aiFacade.getFullModelConfig(
        nativeFastModelId,
        request.userId,
      );
      if (!config?.apiKey) return {};
      const provider = String(config.provider ?? "").toLowerCase();
      const endpoint = config.apiEndpoint?.trim();
      const modelId = config.modelId?.trim() || nativeFastModelId;
      if (!provider.includes("deepseek") && !endpoint?.includes("deepseek")) {
        return {};
      }
      return {
        DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY: config.apiKey,
        DEEP_INSIGHT_SOLAR_DEEPSEEK_MODEL: modelId,
        GENESISPOD_SOLAR_MODEL_ENV_SOURCE: "aiFacade.getFullModelConfig",
        GENESISPOD_SOLAR_MODEL_ENV_USER_ID_PRESENT: request.userId ? "1" : "0",
        GENESISPOD_SOLAR_MODEL_ENV_MODEL_ID: modelId,
        GENESISPOD_SOLAR_MODEL_ENV_PROVIDER: provider || "N/A",
        GENESISPOD_SOLAR_MODEL_ENV_API_KEY_PRESENT: "1",
        ...(endpoint ? { DEEP_INSIGHT_SOLAR_DEEPSEEK_BASE_URL: endpoint } : {}),
      };
    } catch {
      return {};
    }
  }

  async runOperator(
    request: SolarOperatorRequest,
  ): Promise<SolarOperatorResult> {
    const command = process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    if (!command) {
      return {
        status: "failed",
        error: {
          code: "SOLAR_OPERATOR_CMD_MISSING",
          message:
            "GENESISPOD_SOLAR_OPERATOR_CMD is not configured; cannot call Solar browser-agent operator.",
          retryable: false,
        },
      };
    }

    const timeoutMs = Number(
      process.env.GENESISPOD_SOLAR_OPERATOR_TIMEOUT_MS ?? "900000",
    );
    const args = parseArgs(process.env.GENESISPOD_SOLAR_OPERATOR_ARGS);
    const modelEnv = await this.buildModelEnv(request);

    return new Promise<SolarOperatorResult>((resolve) => {
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...modelEnv,
          GENESISPOD_SOLAR_OPERATOR_REQUEST: request.idempotencyKey,
        },
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          status: "timed_out",
          error: {
            code: "SOLAR_OPERATOR_TIMEOUT",
            message: `Solar operator ${request.operatorId} timed out after ${timeoutMs}ms.`,
            retryable: true,
          },
        });
      }, Math.max(1000, timeoutMs));

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          status: "failed",
          error: {
            code: "SOLAR_OPERATOR_SPAWN_FAILED",
            message: err.message,
            retryable: true,
          },
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const parsed = parseSolarOperatorResult(stdout);
          if (parsed) {
            resolve(parsed);
            return;
          }
          resolve({
            status: "failed",
            error: {
              code: "SOLAR_OPERATOR_NONZERO_EXIT",
              message:
                stderr.trim() ||
                `Solar operator ${request.operatorId} exited with code ${code}.`,
              retryable: true,
            },
          });
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as SolarOperatorResult;
          resolve(parsed);
        } catch {
          resolve({
            status: "failed",
            markdown: stdout,
            error: {
              code: "SOLAR_OPERATOR_INVALID_JSON",
              message: "Solar operator stdout is not valid SolarOperatorResult JSON.",
              retryable: false,
            },
          });
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`);
      child.stdin.end();
    });
  }
}
