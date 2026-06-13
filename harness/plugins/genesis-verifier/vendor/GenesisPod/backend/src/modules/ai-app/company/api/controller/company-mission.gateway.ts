/**
 * CompanyMissionGateway —— Socket.IO 入口（namespace: 'company'）
 *
 * 照 playground.gateway.ts 实现：
 *   - JWT 鉴权 (handshake.auth.token 或 Authorization header)
 *   - Redis blocklist 检查（fail-open on cache error）
 *   - join {missionId|teamId} 订阅房间（company:<missionId>）
 *   - EventBus + SocketBroadcastAdapter 注册（afterInit 时注册，eventTypePrefix='company.'）
 *   - emit company.* 前缀事件
 */

import { Logger, UnauthorizedException } from "@nestjs/common";
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { z } from "zod";
import { EventBus, SocketBroadcastAdapter } from "@/modules/ai-harness/facade";
import { EventRegistry } from "@/modules/ai-harness/facade";
import { wsCorsOrigin } from "@/common/config/ws-cors";
import { CacheService } from "@/common/cache/cache.service";
import { BLOCKLIST_PREFIX } from "@/modules/platform/auth/strategies/jwt.strategy";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

@WebSocketGateway({
  namespace: "company",
  cors: { origin: wsCorsOrigin, credentials: true },
})
export class CompanyMissionGateway implements OnGatewayInit {
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(CompanyMissionGateway.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly eventRegistry: EventRegistry,
  ) {}

  afterInit(): void {
    // SocketBroadcastAdapter 必须在 afterInit 注册（io 此时已绑定）
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "company.socket",
        eventTypePrefix: "company.",
        roomPrefix: "company",
      }),
    );

    // 注册 agent-trace 衍生事件类型（company.module.ts COMPANY_MISSION_EVENTS 不含，补在此处）
    // registerAll 遇已注册的 type 会 warn 并覆盖，EventRegistry.register 已有此语义。
    this.eventRegistry.registerAll([
      {
        type: "company.agent:lifecycle",
        schema: z
          .object({
            phase: z.string().optional(),
            role: z.string().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.agent:narrative",
        schema: z
          .object({
            text: z.string(),
            role: z.string().optional(),
            tag: z.string().optional(),
            dimension: z.string().optional(),
          })
          .passthrough(),
      },
      // Fix 1：company.agent:trace — 结构化过程追踪（与 playground AgentTraceSchema 对齐）
      // agentId + items[]{kind, ts, text?, toolId?} 批量格式，前端 timeline 抽屉可见。
      {
        type: "company.agent:trace",
        schema: z
          .object({
            agentId: z.string(),
            role: z.string().optional(),
            dimension: z.string().optional(),
            stepId: z.string().optional(),
            items: z.array(
              z
                .object({
                  kind: z.enum(["thought", "action", "observation"]),
                  ts: z.number(),
                  text: z.string().optional(),
                  toolId: z.string().optional(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      },
      // 放宽 company.stage:lifecycle schema，允许携带 label 字段（原 schema 仅 stage+status）
      {
        type: "company.stage:lifecycle",
        schema: z
          .object({
            stage: z.string(),
            status: z.string(),
          })
          .passthrough(),
      },
      // 能力桥接事件：dimension 研究进度（前端每维度实时任务列表）
      {
        type: "company.dimension:research:started",
        schema: z
          .object({
            dimension: z.string().optional(),
            index: z.number().optional(),
            total: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.dimension:research:completed",
        schema: z
          .object({
            dimension: z.string().optional(),
            findingsCount: z.number().optional(),
            // bindings 只发 200 字符 summaryPreview（全文 summary 不上 WS，防事件流胀爆）
            summaryPreview: z.string().optional(),
          })
          .passthrough(),
      },
      // leader 决策事件
      {
        type: "company.leader:goals-set",
        schema: z.record(z.unknown()),
      },
      {
        type: "company.leader:decision",
        schema: z.record(z.unknown()),
      },
      // 阶段指标事件
      {
        type: "company.stage:metrics",
        schema: z
          .object({
            stepId: z.string().optional(),
            dimensions: z.array(z.unknown()).optional(),
          })
          .passthrough(),
      },
      // mission postlude 事件（S12 自进化，company 侧桥接；无注册则每次 mission 结束 drop-warn）
      {
        type: "company.mission:postlude:started",
        schema: z
          .object({
            missionId: z.string().optional(),
            status: z.string().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.mission:postlude:completed",
        schema: z
          .object({
            missionId: z.string().optional(),
            status: z.string().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.mission:postlude:failed",
        schema: z
          .object({
            missionId: z.string().optional(),
            status: z.string().optional(),
          })
          .passthrough(),
      },
      // ★ Fix 5（2026-06-09）：能力核发的通用 domain 事件 → company bridge 透传。
      //   无注册则 EventBus drop+warn，每次 mission 跑完都有 warn 噪音。
      {
        type: "company.cost:tick",
        schema: z
          .object({
            stage: z.string().optional(),
            costUsd: z.number().optional(),
            tokensUsed: z.number().optional(),
            deltaTokens: z.number().optional(),
            deltaCostUsd: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.researcher:completed",
        schema: z
          .object({
            dimension: z.string().optional(),
            findingsCount: z.number().optional(),
            summary: z.string().optional(),
            state: z.string().optional(),
            wallTimeMs: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.dimension:graded",
        schema: z
          .object({
            dimension: z.string().optional(),
            grade: z.string().optional(),
            overall: z.number().optional(),
            summary: z.string().optional(),
            axes: z.record(z.unknown()).optional(),
          })
          .passthrough(),
      },
      // ★ 2026-06-10 富事件平价波：能力核新增/恢复的 domain 事件，company 桥透传需注册，
      //   否则每次 mission 刷 drop-warn。形状与 playground 侧（旧 OFF-path stage）一致。
      {
        type: "company.reconciliation:completed",
        schema: z
          .object({
            factCount: z.number().optional(),
            conflictCount: z.number().optional(),
            gapCount: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.critic:verdict",
        schema: z
          .object({
            verdict: z.string().optional(),
            blindspotCount: z.number().optional(),
            biasCount: z.number().optional(),
            warnings: z.array(z.record(z.unknown())).optional(),
          })
          .passthrough(),
      },
      {
        type: "company.verifier:verdict",
        schema: z
          .object({
            verifierId: z.string().optional(),
            score: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.leader:foreword",
        schema: z.record(z.unknown()),
      },
      {
        type: "company.leader:signed",
        schema: z
          .object({
            signed: z.boolean().optional(),
            leaderOverallScore: z.number().optional(),
            leaderVerdict: z.string().optional(),
            refusalReason: z.string().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.dimension:outline:planned",
        schema: z.object({ chapterCount: z.number().optional() }).passthrough(),
      },
      {
        type: "company.chapter:writing:started",
        schema: z
          .object({
            dimension: z.string().optional(),
            heading: z.string().optional(),
            index: z.number().optional(),
          })
          .passthrough(),
      },
      {
        type: "company.chapter:writing:completed",
        schema: z
          .object({
            dimension: z.string().optional(),
            heading: z.string().optional(),
            index: z.number().optional(),
            wordCount: z.number().optional(),
          })
          .passthrough(),
      },
    ]);

    this.log.log("CompanyMissionGateway initialized (namespace=company)");
  }

  @SubscribeMessage("join")
  async handleJoin(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
    if (!payload?.missionId) {
      return { ok: false, error: "missionId required" };
    }

    let userId: string;
    try {
      userId = await this.extractUserId(client);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "auth failed",
      };
    }

    // join room company:<missionId>
    // socket.join 是异步必须 await，否则后续 emit 时 room 未生效会丢事件
    await client.join(`company:${payload.missionId}`);
    this.log.debug(
      `client ${client.id} (user=${userId}) joined company:${payload.missionId}`,
    );
    return { ok: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.missionId) return { ok: false };
    await client.leave(`company:${payload.missionId}`);
    return { ok: true };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async extractUserId(client: Socket): Promise<string> {
    const auth = client.handshake.auth as {
      token?: string;
      Authorization?: string;
    };
    const authToken =
      auth?.token ?? auth?.Authorization?.replace(/^Bearer\s+/i, "");
    if (!authToken) throw new UnauthorizedException("no auth token");

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(authToken);
    } catch {
      throw new UnauthorizedException("invalid token");
    }

    const userId = payload.sub ?? payload.id ?? payload.userId;
    if (!userId) throw new UnauthorizedException("no user in token");

    // Redis blocklist 检查 —— fail-open on cache error（同 playground gateway）
    let isBlocked: string | undefined | null = null;
    try {
      isBlocked = await this.cache.get<string>(`${BLOCKLIST_PREFIX}${userId}`);
    } catch (err) {
      this.log.warn(
        `[ws-auth] blocklist check failed for user=${userId} — fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (isBlocked) throw new UnauthorizedException("User account is disabled");
    return userId;
  }
}
