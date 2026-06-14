/**
 * GenesisPod Public API — thin TypeScript client.
 *
 * Usage:
 *   import { GenesisPublicApiClient } from "./genesis-public-api-client";
 *
 *   const client = new GenesisPublicApiClient({
 *     baseUrl: process.env.GENESIS_BASE_URL ?? "http://localhost:4000",
 *     apiKey: process.env.GENESIS_API_KEY ?? "",
 *   });
 *
 *   const chat = await client.chat([
 *     { role: "user", content: "Hello in one sentence." },
 *   ]);
 *   console.log(chat.content);
 *
 *   const research = await client.research({
 *     query: "On-device small language models in 2026",
 *     depth: "standard",
 *   });
 *   console.log(research.report.executiveSummary);
 *
 * No build step needed: run with `npx tsx examples/genesis-public-api-client.ts`
 * (after setting GENESIS_API_KEY) or `node --experimental-strip-types`.
 *
 * Endpoints/fields verified against:
 *   backend/src/modules/open-api/public-api/public-api.controller.ts
 *   backend/src/modules/open-api/public-api/dto/{chat,research}.dto.ts
 *   backend/src/common/interceptors/response-transform.interceptor.ts
 *   backend/src/common/filters/all-exceptions.filter.ts
 *   backend/src/main.ts (global prefix "api/v1")
 */

// ── Wire types (match the global interceptor / exception filter) ──────────

/** Success envelope produced by ResponseTransformInterceptor. */
export interface StandardResponse<T> {
  success: true;
  data: T;
  metadata: { requestId: string; timestamp: string; duration: number };
}

/** Error envelope produced by AllExceptionsFilter. */
export interface ApiErrorBody {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string;
  code: string;
  requestId?: string;
  traceId?: string;
  details?: Record<string, unknown>;
}

/** Thrown for any non-2xx response; carries the parsed error envelope. */
export class GenesisApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | undefined,
  ) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = "GenesisApiError";
  }
}

// ── Endpoint payload types ────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}
export interface ChatResult {
  content: string;
  model: string;
  tokensUsed: number;
}

export interface ResearchRequest {
  query: string;
  depth?: "quick" | "standard" | "deep";
  dimensions?: string[];
  language?: string;
}
export interface ResearchResult {
  report: {
    executiveSummary: string;
    sections: Array<{ title?: string; content?: string }>;
    conclusion: string;
    references: unknown[];
    metadata: Record<string, unknown>;
  };
  searchRounds: number;
  totalSources: number;
  duration: number;
}

// ── Client ─────────────────────────────────────────────────────────────────

export interface GenesisClientOptions {
  /** e.g. "http://localhost:4000" or "https://your-app.up.railway.app" */
  baseUrl: string;
  /** MCP-category API key value (sent as `Authorization: Bearer`). */
  apiKey: string;
}

export class GenesisPublicApiClient {
  private readonly base: string;
  private readonly apiKey: string;

  constructor(opts: GenesisClientOptions) {
    // Public API lives under the global "api/v1" prefix.
    this.base = opts.baseUrl.replace(/\/+$/, "") + "/api/v1/public";
    this.apiKey = opts.apiKey;
  }

  /** POST /api/v1/public/chat */
  async chat(
    messages: ChatMessage[],
    opts?: { modelType?: string },
  ): Promise<ChatResult> {
    return this.post<ChatResult>("/chat", { messages, ...opts });
  }

  /** POST /api/v1/public/research (synchronous; may take a while for "deep") */
  async research(req: ResearchRequest): Promise<ResearchResult> {
    return this.post<ResearchResult>("/research", req);
  }

  /** GET /api/v1/public/status (no API key required). */
  async status(): Promise<unknown> {
    return this.get<unknown>("/status");
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return this.unwrap<T>(res);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return this.unwrap<T>(res);
  }

  private async unwrap<T>(res: Response): Promise<T> {
    const json = (await res.json().catch(() => undefined)) as
      | StandardResponse<T>
      | ApiErrorBody
      | undefined;

    if (!res.ok) {
      throw new GenesisApiError(res.status, json as ApiErrorBody | undefined);
    }
    // Success responses are wrapped: { success, data, metadata }.
    return (json as StandardResponse<T>).data;
  }
}

// ── Runnable demo (executes only when run directly) ─────────────────────────

async function main(): Promise<void> {
  const client = new GenesisPublicApiClient({
    baseUrl: process.env.GENESIS_BASE_URL ?? "http://localhost:4000",
    apiKey: process.env.GENESIS_API_KEY ?? "",
  });

  try {
    const chat = await client.chat([
      { role: "system", content: "You are a concise assistant." },
      { role: "user", content: "Explain vector databases in one sentence." },
    ]);
    // eslint-disable-next-line no-console
    console.log("[chat]", chat.content, `(model=${chat.model})`);

    const research = await client.research({
      query: "State of small language models for on-device inference in 2026",
      depth: "quick",
    });
    // eslint-disable-next-line no-console
    console.log(
      "[research]",
      research.report.executiveSummary.slice(0, 200),
      `... (${research.totalSources} sources)`,
    );
  } catch (err) {
    if (err instanceof GenesisApiError) {
      // eslint-disable-next-line no-console
      console.error(
        `[error] status=${err.status} code=${err.body?.code} traceId=${err.body?.traceId}: ${err.message}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.error("[error]", err);
    }
    process.exitCode = 1;
  }
}

// Only run the demo when invoked directly, not when imported.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /genesis-public-api-client\.(ts|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  void main();
}
</content>
