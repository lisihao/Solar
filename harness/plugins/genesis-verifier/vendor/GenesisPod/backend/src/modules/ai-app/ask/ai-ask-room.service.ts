/**
 * AskRoomService - 房间 / 成员 CRUD
 *
 * 设计：teams-mode.md §3.1 ai-app/ask 模块、§8 API
 * 范围（W2 PR3）：
 *   - 创建 room（新建或从 SOLO 升级）
 *   - 成员增删改（软删）
 *   - 房间详情（含 members + 最近 turns）
 *   - 用户消息落库（USER -> AskMessage）
 *   - turn 生命周期方法（create / update status / cancel）
 *
 * 不在本服务：实际编排（在 AskRoomRuntimeService）、流式 emit（在 gateway）
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import {
  AskMessage,
  AskRoomMember,
  AskRoomMemberRole,
  AskRoomMemberType,
  AskRoomMode,
  AskRoomTurn,
  AskSession,
  AskSessionMode,
  AskTurnStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AddMemberDto, UpdateMemberDto } from "./dto/add-member.dto";
import { CreateRoomDto, RoomConfigDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";

const ROOM_DEFAULT_TITLE = "AI Room";

@Injectable()
export class AskRoomService {
  private readonly logger = new Logger(AskRoomService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============ Room ============

  async createRoom(userId: string, dto: CreateRoomDto): Promise<AskSession> {
    if (dto.fromSessionId) {
      return this.upgradeSoloToRoom(userId, dto);
    }
    return this.createFreshRoom(userId, dto);
  }

  private async createFreshRoom(
    userId: string,
    dto: CreateRoomDto,
  ): Promise<AskSession> {
    this.assertMemberCount(dto.initialMembers?.length ?? 0, dto.roomConfig);

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.askSession.create({
        data: {
          userId,
          title: dto.title ?? ROOM_DEFAULT_TITLE,
          mode: AskSessionMode.ROOM,
          roomConfig: this.normalizeRoomConfig(dto.roomConfig),
        },
      });
      if (dto.initialMembers && dto.initialMembers.length > 0) {
        for (let i = 0; i < dto.initialMembers.length; i += 1) {
          const m = dto.initialMembers[i];
          this.validateMemberPayload(m);
          await tx.askRoomMember.create({
            data: {
              sessionId: session.id,
              memberType: m.memberType,
              agentId:
                m.memberType === AskRoomMemberType.REGISTERED
                  ? (m.agentId ?? null)
                  : null,
              modelId: m.modelId,
              displayName: m.displayName,
              role: m.role ?? AskRoomMemberRole.MEMBER,
              systemPrompt: m.systemPrompt,
              persona: this.toJsonInput(m.persona),
              order: m.order ?? i,
              enabled: m.enabled ?? true,
            },
          });
        }
      }
      this.logger.log(
        `Created room session ${session.id} (members=${dto.initialMembers?.length ?? 0})`,
      );
      return session;
    });
  }

  private async upgradeSoloToRoom(
    userId: string,
    dto: CreateRoomDto,
  ): Promise<AskSession> {
    if (!dto.fromSessionId) {
      throw new BadRequestException("fromSessionId required for upgrade");
    }
    const existing = await this.prisma.askSession.findFirst({
      where: { id: dto.fromSessionId, userId },
    });
    if (!existing) {
      throw new NotFoundException("Source session not found");
    }
    if (existing.mode === AskSessionMode.ROOM) {
      throw new BadRequestException("Session already a room");
    }

    this.assertMemberCount(dto.initialMembers?.length ?? 0, dto.roomConfig);

    return this.prisma.$transaction(async (tx) => {
      const upgraded = await tx.askSession.update({
        where: { id: existing.id },
        data: {
          mode: AskSessionMode.ROOM,
          roomConfig: this.normalizeRoomConfig(dto.roomConfig),
        },
      });
      if (dto.initialMembers && dto.initialMembers.length > 0) {
        for (let i = 0; i < dto.initialMembers.length; i += 1) {
          const m = dto.initialMembers[i];
          this.validateMemberPayload(m);
          await tx.askRoomMember.create({
            data: {
              sessionId: existing.id,
              memberType: m.memberType,
              agentId:
                m.memberType === AskRoomMemberType.REGISTERED
                  ? (m.agentId ?? null)
                  : null,
              modelId: m.modelId,
              displayName: m.displayName,
              role: m.role ?? AskRoomMemberRole.MEMBER,
              systemPrompt: m.systemPrompt,
              persona: this.toJsonInput(m.persona),
              order: m.order ?? i,
              enabled: m.enabled ?? true,
            },
          });
        }
      }
      this.logger.log(`Upgraded session ${existing.id} to ROOM`);
      return upgraded;
    });
  }

  async getRoom(
    sessionId: string,
    userId: string,
  ): Promise<{
    session: AskSession;
    members: AskRoomMember[];
    messages: AskMessage[];
    recentTurns: AskRoomTurn[];
  }> {
    const session = await this.findUserRoom(sessionId, userId);
    const members = await this.prisma.askRoomMember.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { order: "asc" },
    });
    // 2026-05-09（screenshot 44 / "进入 room 没有任何历史信息"）：之前 getRoom
    // 不返 messages，前端 RoomChatPage initialLoad 总以空 messages 渲染。
    // 改为返回最近 200 条消息（按 sequenceNum desc 取 + reverse 让 UI 升序），
    // 让用户进入房间能看到历史对话。turn 流式仍走 socket.io，新消息追加到末尾。
    const recentDesc = await this.prisma.askMessage.findMany({
      where: { sessionId },
      orderBy: [
        { sequenceNum: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 200,
    });
    const messages = recentDesc.reverse();
    const recentTurns = await this.prisma.askRoomTurn.findMany({
      where: { sessionId },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    return { session, members, messages, recentTurns };
  }

  async updateRoom(
    sessionId: string,
    userId: string,
    dto: UpdateRoomDto,
  ): Promise<AskSession> {
    await this.findUserRoom(sessionId, userId);
    return this.prisma.askSession.update({
      where: { id: sessionId },
      data: {
        roomConfig: dto.roomConfig
          ? (this.normalizeRoomConfig(dto.roomConfig) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  // ============ Members ============

  async addMember(
    sessionId: string,
    userId: string,
    dto: AddMemberDto,
  ): Promise<AskRoomMember> {
    await this.findUserRoom(sessionId, userId);
    this.validateMemberPayload(dto);

    const activeCount = await this.prisma.askRoomMember.count({
      where: { sessionId, deletedAt: null, enabled: true },
    });
    const session = await this.prisma.askSession.findUnique({
      where: { id: sessionId },
    });
    const cfg = (session?.roomConfig ?? {}) as Record<string, unknown>;
    const cap =
      typeof cfg.maxParticipants === "number" ? cfg.maxParticipants : 8;
    if (activeCount >= cap) {
      throw new BadRequestException(`Room reached max participants (${cap})`);
    }

    return this.prisma.askRoomMember.create({
      data: {
        sessionId,
        memberType: dto.memberType,
        agentId:
          dto.memberType === AskRoomMemberType.REGISTERED
            ? (dto.agentId ?? null)
            : null,
        modelId: dto.modelId,
        displayName: dto.displayName,
        role: dto.role ?? AskRoomMemberRole.MEMBER,
        systemPrompt: dto.systemPrompt,
        persona: this.toJsonInput(dto.persona),
        order: dto.order ?? activeCount,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateMember(
    sessionId: string,
    memberId: string,
    userId: string,
    dto: UpdateMemberDto,
  ): Promise<AskRoomMember> {
    await this.findUserRoom(sessionId, userId);
    const member = await this.prisma.askRoomMember.findFirst({
      where: { id: memberId, sessionId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException("Member not found");
    }
    return this.prisma.askRoomMember.update({
      where: { id: memberId },
      data: {
        displayName: dto.displayName,
        role: dto.role,
        systemPrompt: dto.systemPrompt,
        persona: this.toJsonInput(dto.persona),
        order: dto.order,
        enabled: dto.enabled,
      },
    });
  }

  async removeMember(
    sessionId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    await this.findUserRoom(sessionId, userId);
    const member = await this.prisma.askRoomMember.findFirst({
      where: { id: memberId, sessionId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException("Member not found");
    }
    // 软删（评审收敛 R2 P1-9：保留历史发言者）
    await this.prisma.askRoomMember.update({
      where: { id: memberId },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  // ============ User message + Turn lifecycle（runtime 调用） ============

  async appendUserMessage(
    sessionId: string,
    content: string,
    mentionedMemberIds: string[],
    minSeq = 0,
  ) {
    // 评审 W2 v3 R1 阻塞：sequenceNum 并发竞态防护。
    // 依赖 schema 的 partial unique index `(session_id, sequence_num) WHERE sequence_num IS NOT NULL`。
    // 拿到 max+1 后 create，若并发拿到相同值会 P2002，retry 最多 5 次。
    //
    // 2026-05-09（screenshot 48-49 / "AI 思考显示在问题的上方"）：
    // 多 turn 场景下，turn 1 仍在流式中（in-flight emitted seq 已到 30）但 AI 消息
    // 尚未持久化（DB MAX 仍是 turn 1 的 user msg seq=1）。turn 2 用户发消息时
    // nextSequenceNum 只看 DB → 返回 2 → user_2 emit seq=2 < turn 1 in-flight
    // events seq 2-30 → 前端按 emit seq 升序排，user_2 落到 turn 1 events 中间或之前。
    // 修法：runtime 调用本方法时传入 sessionMaxEmittedSeq（in-memory 单进程跟踪），
    // 这里取 max(dbMax, minSeq) + 1，确保 user msg emit seq 永远在所有 in-flight
    // 事件之后。db-seq / emit-seq 解耦保留（reload 后按 db-seq 升序仍单调）。
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      const seq = await this.nextSequenceNum(sessionId, minSeq);
      try {
        return await this.prisma.askMessage.create({
          data: {
            sessionId,
            role: "user",
            senderType: "USER",
            content,
            mentionedMemberIds,
            sequenceNum: seq,
          },
        });
      } catch (err) {
        if (this.isUniqueViolation(err) && attempt < 5) {
          await this.delay(20 * attempt);
          continue;
        }
        throw err;
      }
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err !== null &&
      typeof err === "object" &&
      (err as { code?: string }).code === "P2002"
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async createTurn(input: {
    sessionId: string;
    triggerMessageId: string;
    mode: AskRoomMode;
    participantIds: string[];
  }): Promise<AskRoomTurn> {
    return this.prisma.askRoomTurn.create({
      data: {
        sessionId: input.sessionId,
        triggerMessageId: input.triggerMessageId,
        mode: input.mode,
        status: AskTurnStatus.RUNNING,
        participantIds: input.participantIds,
      },
    });
  }

  async finalizeTurn(
    turnId: string,
    status: AskTurnStatus,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.askRoomTurn.update({
      where: { id: turnId },
      data: {
        status,
        endedAt: new Date(),
        metadata: this.toJsonInput(metadata),
      },
    });
  }

  async cancelTurn(
    sessionId: string,
    turnId: string,
    userId: string,
  ): Promise<AskRoomTurn> {
    await this.findUserRoom(sessionId, userId);
    const turn = await this.prisma.askRoomTurn.findFirst({
      where: { id: turnId, sessionId },
    });
    if (!turn) {
      throw new NotFoundException("Turn not found");
    }
    // 2026-05-09（screenshot 42 / "停止按钮无效"）：cancel 改为幂等。
    // 之前 turn 已 COMPLETED/FAILED/CANCELLED 时抛 400，前端流式终态事件
    // 偶尔被 seq 过滤丢弃 → 用户看到 停止 按钮残留 → 多次点击 → 4×400。
    // 已结束的 turn 直接返回当前 turn 视为 noop，与"用户取消"语义一致。
    if (
      turn.status !== AskTurnStatus.RUNNING &&
      turn.status !== AskTurnStatus.PENDING
    ) {
      this.logger.debug?.(
        `[cancelTurn] turn=${turnId} already ${turn.status}; returning idempotent ok`,
      );
      return turn;
    }
    return this.prisma.askRoomTurn.update({
      where: { id: turnId },
      data: { status: AskTurnStatus.CANCELLED, endedAt: new Date() },
    });
  }

  async nextSequenceNum(sessionId: string, minSeq = 0): Promise<number> {
    const max = await this.prisma.askMessage.aggregate({
      where: { sessionId, sequenceNum: { not: null } },
      _max: { sequenceNum: true },
    });
    const dbMax = max._max.sequenceNum ?? 0;
    return Math.max(dbMax, minSeq) + 1;
  }

  // ============ Helpers ============

  /** 校验 session 归属 + 是 ROOM */
  async findUserRoom(sessionId: string, userId: string): Promise<AskSession> {
    const session = await this.prisma.askSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (session.userId !== userId) {
      throw new ForbiddenException("Not your session");
    }
    if (session.mode !== AskSessionMode.ROOM) {
      throw new BadRequestException("Session is not a room");
    }
    return session;
  }

  private validateMemberPayload(payload: {
    memberType: AskRoomMemberType;
    agentId?: string;
  }): void {
    if (
      payload.memberType === AskRoomMemberType.REGISTERED &&
      (!payload.agentId || payload.agentId.trim() === "")
    ) {
      throw new BadRequestException(
        "agentId is required when memberType is REGISTERED",
      );
    }
  }

  private assertMemberCount(
    requested: number,
    cfg: RoomConfigDto | undefined,
  ): void {
    const cap = cfg?.maxParticipants ?? 8;
    if (requested > cap) {
      throw new BadRequestException(
        `initialMembers exceeds maxParticipants (${cap})`,
      );
    }
  }

  private normalizeRoomConfig(
    cfg: RoomConfigDto | undefined,
  ): Prisma.InputJsonValue {
    if (!cfg) return {} as Prisma.InputJsonValue;
    const o: Record<string, unknown> = {};
    if (cfg.defaultMode) o.defaultMode = cfg.defaultMode;
    if (cfg.leaderModelId) o.leaderModelId = cfg.leaderModelId;
    if (cfg.maxParticipants !== undefined)
      o.maxParticipants = cfg.maxParticipants;
    if (cfg.debateRounds !== undefined) o.debateRounds = cfg.debateRounds;
    return o as Prisma.InputJsonValue;
  }

  private toJsonInput(
    v: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (v === undefined) return undefined;
    return v as Prisma.InputJsonValue;
  }
}
