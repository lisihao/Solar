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
import { ChatFacade, DebatePattern } from "@/modules/ai-harness/facade";
import { DebateAdapter } from "../../adapters/debate.adapter";
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
  roomConfig: Record<string, unknown> = {},
  participants?: AskRoomMember[],
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
    roomConfig,
  } as AskSession,
  members,
  participants,
  triggerMessage: {
    id: "msg-user-1",
    sessionId: "s-1",
    role: "user",
    content: "AGI before 2030?",
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
    mode: AskRoomMode.DEBATE,
    status: AskTurnStatus.RUNNING,
    participantIds: [],
    partialDeltas: null,
    metadata: null,
    startedAt: new Date(),
    endedAt: null,
  } as AskRoomTurn,
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

describe("DebateAdapter", () => {
  let adapter: DebateAdapter;
  let chatStream: jest.Mock;

  beforeEach(async () => {
    chatStream = jest.fn().mockImplementation(() => streamOf("SPEECH"));
    const module = await Test.createTestingModule({
      providers: [
        DebateAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
        { provide: DebatePattern, useValue: new DebatePattern() },
      ],
    }).compile();
    adapter = module.get(DebateAdapter);
  });

  it("returns speeches=2*rounds for 2 members 2 rounds (no judge)", async () => {
    const red = mkMember({ id: "r", displayName: "Red", order: 0 });
    const blue = mkMember({ id: "b", displayName: "Blue", order: 1 });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(
      mkContext([red, blue], { debateRounds: 2 }),
      (e) => events.push(e),
    );

    expect(result.messages).toHaveLength(4); // 2 rounds × 2 speakers
    expect(result.metadata.rounds).toBe(2);
    expect(result.metadata.enableJudge).toBe(false);
    expect(chatStream).toHaveBeenCalledTimes(4);
  });

  it("emits round.start once per round and round.end once per round", async () => {
    const red = mkMember({ id: "r", order: 0 });
    const blue = mkMember({ id: "b", order: 1 });
    const events: AskRoomServerEvent[] = [];
    await adapter.execute(mkContext([red, blue], { debateRounds: 3 }), (e) =>
      events.push(e),
    );
    const starts = events.filter((e) => e.kind === "round.start").length;
    const ends = events.filter((e) => e.kind === "round.end").length;
    expect(starts).toBe(3);
    expect(ends).toBe(3);
  });

  it("uses LEADER member as JUDGE when 3+ members; metadata.judge populated", async () => {
    const red = mkMember({ id: "r", displayName: "Red", order: 0 });
    const blue = mkMember({ id: "b", displayName: "Blue", order: 1 });
    const judge = mkMember({
      id: "j",
      displayName: "Judge",
      role: AskRoomMemberRole.LEADER,
    });
    const result = await adapter.execute(
      mkContext([red, blue, judge], { debateRounds: 2 }),
      () => {},
    );
    expect(result.metadata.enableJudge).toBe(true);
    expect(result.metadata.judge).toBe("j");
    expect(result.messages).toHaveLength(5); // 2*2 + 1 judge
    // 末条是 JUDGE
    expect(result.messages[result.messages.length - 1].senderMemberId).toBe(
      "j",
    );
  });

  it("rejects when fewer than 2 members", async () => {
    const only = mkMember({ id: "only" });
    const result = await adapter.execute(
      mkContext([only], { debateRounds: 2 }),
      () => {},
    );
    // 2026-05-08：返回 1 条 system.notice 让前端 UI 看到为何中止（之前空 messages 让 UI 一片空白）
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderType).toBe("SYSTEM");
    expect(result.messages[0].content).toContain("DEBATE 模式至少需要 2 名");
    expect(result.metadata.reason).toBe("insufficient_members");
  });

  it("uses DEFAULT_DEBATE_ROUNDS=3 when roomConfig.debateRounds undefined", async () => {
    const red = mkMember({ id: "r", order: 0 });
    const blue = mkMember({ id: "b", order: 1 });
    const result = await adapter.execute(mkContext([red, blue]), () => {});
    expect(result.metadata.rounds).toBe(3);
    expect(result.messages).toHaveLength(6); // 3 rounds × 2
  });

  it("4+ members: extras beyond RED+BLUE+JUDGE are excluded with warn log", async () => {
    const leader = mkMember({
      id: "leader",
      role: AskRoomMemberRole.LEADER,
    });
    const a = mkMember({ id: "a", order: 0 });
    const b = mkMember({ id: "b", order: 1 });
    const c = mkMember({ id: "c", order: 2 });
    const d = mkMember({ id: "d", order: 3 });
    const result = await adapter.execute(
      mkContext([leader, a, b, c, d], { debateRounds: 1 }),
      () => {},
    );
    // 5 成员：leader=JUDGE, a=RED, b=BLUE; c,d 被排除
    expect(result.metadata.red).toBe("a");
    expect(result.metadata.blue).toBe("b");
    expect(result.metadata.judge).toBe("leader");
  });

  it("uses runtime-selected participants when mentions narrowed the debate roster", async () => {
    const leader = mkMember({
      id: "leader",
      role: AskRoomMemberRole.LEADER,
      displayName: "Leader",
    });
    const alpha = mkMember({ id: "alpha", order: 0, displayName: "Alpha" });
    const beta = mkMember({ id: "beta", order: 1, displayName: "Beta" });
    const gamma = mkMember({ id: "gamma", order: 2, displayName: "Gamma" });
    const delta = mkMember({ id: "delta", order: 3, displayName: "Delta" });

    const result = await adapter.execute(
      mkContext([leader, alpha, beta, gamma, delta], { debateRounds: 1 }, [
        alpha,
        gamma,
      ]),
      () => {},
    );

    expect(result.metadata.red).toBe("alpha");
    expect(result.metadata.blue).toBe("gamma");
    expect(result.metadata.enableJudge).toBe(false);
    expect(
      new Set(result.messages.map((message) => message.senderMemberId)),
    ).toEqual(new Set(["alpha", "gamma"]));
  });

  it("propagates abort signal into chat (cancels mid-debate)", async () => {
    const ctl = new AbortController();
    chatStream.mockImplementationOnce(() =>
      (async function* () {
        // 第一个 chunk 带内容；abort 在内容产出前触发，迫使 for-await 循环
        // 在收到下一 chunk 时抛 DebateAbortError。
        ctl.abort();
        yield { content: "R1", done: false };
        yield { content: "", done: true };
      })(),
    );
    const red = mkMember({ id: "r", order: 0 });
    const blue = mkMember({ id: "b", order: 1 });
    const ctx = mkContext([red, blue], { debateRounds: 3 });
    (ctx as { signal: AbortSignal }).signal = ctl.signal;
    await expect(adapter.execute(ctx, () => {})).rejects.toThrow();
  });

  it("runDebate-level non-abort failure emits system.notice + returns gracefully (no throw)", async () => {
    // 2026-05-08 R2 评审：之前 runDebate 自身异常裸抛让整 turn FAIL；
    // 修复后非 abort 异常捕获 + system.notice + metadata.patternFailed=true。
    // 通过 mock DebatePattern.runDebate 模拟 pattern 内部异常。
    const failingPattern = {
      runDebate: jest
        .fn()
        .mockRejectedValue(new Error("debate pattern internal failure")),
    };
    const failingModule = await Test.createTestingModule({
      providers: [
        DebateAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
        { provide: DebatePattern, useValue: failingPattern },
      ],
    }).compile();
    const failingAdapter = failingModule.get(DebateAdapter);

    const red = mkMember({ id: "r", order: 0 });
    const blue = mkMember({ id: "b", order: 1 });
    const events: AskRoomServerEvent[] = [];
    const result = await failingAdapter.execute(
      mkContext([red, blue], { debateRounds: 2 }),
      (e) => events.push(e),
    );
    expect(result.metadata.patternFailed).toBe(true);
    const notice = result.messages.find((m) => m.senderType === "SYSTEM");
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("辩论流程异常中断");
    expect(events.some((e) => e.kind === "system.notice")).toBe(true);
  });
});
