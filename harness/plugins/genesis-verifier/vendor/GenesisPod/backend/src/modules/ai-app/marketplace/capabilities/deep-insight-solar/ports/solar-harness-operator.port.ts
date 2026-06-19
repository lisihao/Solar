import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";

export type SolarOperatorStatus =
  | "succeeded"
  | "failed"
  | "degraded"
  | "timed_out";

export interface SolarOperatorRequest {
  readonly missionId: string;
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

@Injectable()
export class SubprocessSolarHarnessOperatorPort
  implements SolarHarnessOperatorPort
{
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

    return new Promise<SolarOperatorResult>((resolve) => {
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
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
