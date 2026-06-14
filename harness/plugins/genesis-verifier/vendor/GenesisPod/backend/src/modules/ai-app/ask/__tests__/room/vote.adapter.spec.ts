import { Test } from "@nestjs/testing";
import {
  AskRoomMember,
  AskRoomMemberRole,
  AskRoomMemberType,
  AskRoomMode,
  AskRoomTurn,
  AskSession,
  AskSenderType,
  AskMessage,
  AskTurnStatus,
  AskSessionMode,
} from "@prisma/client";
import { ChatFacade, VotingManager } from "@/modules/ai-harness/facade";
import { VoteAdapter } from "../../adapters/vote.adapter";
import type { ModeContext } from "../../adapters/mode-adapter.interface";
import type { AskRoomServerEvent } from "../../gateway/ask-room-events.types";

const mkMember = (overrides: Partial<AskRoomMember> = {}): AskRoomMember => ({
  id: overrides.id ?? "m-1",
  sessionId: "s-1",
  memberType: AskRoomMemberType.VIRTUAL,
  agentId: null,
  modelId: overrides.modelId ?? "model-x",
  displayName: overrides.displayName ?? "Alice",
  role: overrides.role ?? AskRoomMemberRole.MEMBER,
  systemPrompt: null,
  persona: null,
  order: overrides.order ?? 0,
  enabled: overrides.enabled ?? true,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mkContext = (
  members: AskRoomMember[],
  modeOptions?: Record<string, unknown>,
): ModeContext => ({
  session: {
    id: "s-1",
    userId: "u-1",
    title: "Room",
    summary: null,
    modelId: null,
    isBookmarked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    mode: AskSessionMode.ROOM,
    roomConfig: {},
  } as AskSession,
  members,
  triggerMessage: {
    id: "msg-user-1",
    sessionId: "s-1",
    role: "user",
    content: "Should we adopt X?",
    modelId: null,
    modelName: null,
    tokens: 0,
    webSearch: false,
    createdAt: new Date(),
    senderType: AskSenderType.USER,
    senderMemberId: null,
    mentionedMemberIds: [],
    turnId: null,
    parentMessageId: null,
    sequenceNum: 1,
  } as AskMessage,
  history: [],
  turn: {
    id: "t-1",
    sessionId: "s-1",
    triggerMessageId: "msg-user-1",
    mode: AskRoomMode.VOTE,
    status: AskTurnStatus.RUNNING,
    participantIds: [],
    partialDeltas: null,
    metadata: null,
    startedAt: new Date(),
    endedAt: null,
  } as AskRoomTurn,
  modeOptions,
  userId: "u-1",
  sequenceNumStart: 1,
  signal: new AbortController().signal,
});

type StreamChunk = { content: string; done: boolean; error?: string };

function streamOf(content: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { content, done: false };
    yield { content: "", done: true };
  })();
}

function streamErr(msg: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { content: "", done: true, error: msg };
  })();
}

describe("VoteAdapter", () => {
  let adapter: VoteAdapter;
  let chatStream: jest.Mock;

  beforeEach(async () => {
    chatStream = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        VoteAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
        { provide: VotingManager, useValue: new VotingManager() },
      ],
    }).compile();
    adapter = module.get(VoteAdapter);
  });

  it("uses explicit voteOptions and tallies majority winner", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: A is better"))
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: agree"))
      .mockReturnValueOnce(streamOf("VOTE: b\nREASON: prefer B"));
    const leader = mkMember({ id: "leader", role: AskRoomMemberRole.LEADER });
    const v1 = mkMember({ id: "v1", displayName: "V1" });
    const v2 = mkMember({ id: "v2", displayName: "V2" });
    const v3 = mkMember({ id: "v3", displayName: "V3" });
    const events: AskRoomServerEvent[] = [];

    const result = await adapter.execute(
      mkContext([leader, v1, v2, v3], {
        voteOptions: [
          { id: "a", label: "Adopt" },
          { id: "b", label: "Reject" },
        ],
      }),
      (e) => events.push(e),
    );

    expect(events.find((e) => e.kind === "vote.open")).toBeDefined();
    const closed = events.find((e) => e.kind === "vote.closed");
    expect(closed).toBeDefined();
    expect(result.metadata.winner).toBe("a");
    expect(result.metadata.consensus).toBe(true);
    // 3 voters + 1 conclusion = 4 messages
    expect(result.messages).toHaveLength(4);
  });

  it("generates options via leader chat when no explicit voteOptions", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamOf("- [a] Adopt\n- [b] Reject"))
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: r"))
      .mockReturnValueOnce(streamOf("VOTE: b\nREASON: r"));
    const leader = mkMember({ id: "leader", role: AskRoomMemberRole.LEADER });
    const v1 = mkMember({ id: "v1" });
    const v2 = mkMember({ id: "v2" });
    const result = await adapter.execute(mkContext([leader, v1, v2]), () => {});
    // 1 options gen + 2 voters + 1 conclusion = 4
    expect(result.messages).toHaveLength(4);
    expect(result.metadata.voteCount).toBe(2);
  });

  it("rejects with insufficient_members when only 1 enabled (returns SYSTEM notice)", async () => {
    const m = mkMember({ id: "m" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([m]), (e) => events.push(e));
    expect(result.metadata.reason).toBe("insufficient_members");
    // 2026-05-08 R2：返回 1 条 system.notice 让前端 UI 看到为何中止
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderType).toBe("SYSTEM");
    expect(result.messages[0].content).toContain("VOTE 模式至少需要 2 名");
    expect(events.some((e) => e.kind === "system.notice")).toBe(true);
  });

  it("invalid optionId returned by member is recorded but not counted", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: ok"))
      .mockReturnValueOnce(streamOf("VOTE: zzz\nREASON: bad"));
    const leader = mkMember({ id: "leader", role: AskRoomMemberRole.LEADER });
    const v1 = mkMember({ id: "v1" });
    const v2 = mkMember({ id: "v2" });
    const result = await adapter.execute(
      mkContext([leader, v1, v2], {
        voteOptions: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
      () => {},
    );
    // 仅 v1 的投票被计数（v2 invalid）
    expect(result.metadata.voteCount).toBe(1);
  });

  it("emits monotonically increasing sequenceNum", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: r"))
      .mockReturnValueOnce(streamOf("VOTE: b\nREASON: r"));
    const leader = mkMember({ id: "leader", role: AskRoomMemberRole.LEADER });
    const v1 = mkMember({ id: "v1" });
    const v2 = mkMember({ id: "v2" });
    const events: AskRoomServerEvent[] = [];
    await adapter.execute(
      mkContext([leader, v1, v2], {
        voteOptions: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
      (e) => events.push(e),
    );
    const seqs = events.map((e) => e.sequenceNum);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("generateOptions chat() failure falls back to default options + emits system.notice", async () => {
    // 2026-05-08 R2 评审：之前 generateOptions 失败裸抛让整 turn FAIL；
    // 修复后捕获异常 + 默认 a/支持 b/反对 + system.notice。
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamErr("provider down"))
      // 两个投票者各 vote 一次（用默认选项）
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: yes"))
      .mockReturnValueOnce(streamOf("VOTE: a\nREASON: yes"));
    const leader = mkMember({ id: "leader", role: AskRoomMemberRole.LEADER });
    const v1 = mkMember({ id: "v1" });
    const v2 = mkMember({ id: "v2" });
    const events: AskRoomServerEvent[] = [];
    // 不传 voteOptions → 触发 generateOptions 路径
    const result = await adapter.execute(mkContext([leader, v1, v2]), (e) =>
      events.push(e),
    );
    // notice 出现在 messages 头部
    const notice = result.messages.find((m) => m.senderType === "SYSTEM");
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("默认选项");
    expect(events.some((e) => e.kind === "system.notice")).toBe(true);
    // 投票仍正常完成（默认选项 a=支持 胜出）
    expect(result.metadata.winner).toBe("a");
  });
});
