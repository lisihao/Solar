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
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ParallelMergeAdapter } from "../../adapters/parallel-merge.adapter";
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
  triggerMessage: {
    id: "msg-user-1",
    sessionId: "s-1",
    role: "user",
    content: "Compare options",
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
    mode: AskRoomMode.PARALLEL_MERGE,
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

function streamErr(msg: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { content: "", done: true, error: msg };
  })();
}

describe("ParallelMergeAdapter", () => {
  let adapter: ParallelMergeAdapter;
  let chatStream: jest.Mock;

  beforeEach(async () => {
    chatStream = jest
      .fn()
      .mockImplementation(({ messages }: { messages: { role: string }[] }) => {
        // Synthesis call has system prompt mentioning "PARALLEL_MERGE"
        const sys = messages[0]?.role === "system" ? messages[0] : null;
        const isSynthesis =
          sys &&
          (sys as { content?: string }).content?.includes("PARALLEL_MERGE");
        return streamOf(isSynthesis ? "SYNTHESIS" : "INDIVIDUAL_REPLY");
      });
    const module = await Test.createTestingModule({
      providers: [
        ParallelMergeAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
      ],
    }).compile();
    adapter = module.get(ParallelMergeAdapter);
  });

  it("returns N+1 messages (N participants + leader synthesis)", async () => {
    const a = mkMember({ id: "a", displayName: "A" });
    const b = mkMember({ id: "b", displayName: "B" });
    const c = mkMember({
      id: "c",
      displayName: "C",
      role: AskRoomMemberRole.LEADER,
    });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b, c]), (e) =>
      events.push(e),
    );

    expect(result.messages).toHaveLength(4); // 3 + 1 synthesis
    expect(
      result.messages.find((m) => m.content === "SYNTHESIS"),
    ).toBeDefined();
    expect(
      events.find((e) => e.kind === "leader.synthesis.started"),
    ).toBeDefined();
    expect(
      events.find((e) => e.kind === "leader.synthesis.done"),
    ).toBeDefined();
    expect(chatStream).toHaveBeenCalledTimes(4);
  });

  it("falls back to order=0 leader when no role=LEADER set", async () => {
    const a = mkMember({ id: "a", order: 0, displayName: "A" });
    const b = mkMember({ id: "b", order: 1, displayName: "B" });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    const synthesis = result.messages.find((m) => m.content === "SYNTHESIS");
    expect(synthesis?.senderMemberId).toBe("a");
  });

  it("single failed member does not block others; partial result with allFailed=false", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamOf("OK_A"))
      .mockReturnValueOnce(streamErr("rate limit"))
      .mockReturnValueOnce(streamOf("SYNTH"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b", role: AskRoomMemberRole.LEADER });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    expect(result.metadata.successCount).toBe(1);
    expect(result.metadata.allFailed).toBeUndefined();
    // 失败成员仍生成消息但 content="[error] rate limit"
    expect(
      result.messages.find((m) => m.content.startsWith("[error]")),
    ).toBeDefined();
  });

  it("when ALL members fail, no synthesis call and metadata.allFailed=true", async () => {
    chatStream.mockReset();
    chatStream.mockImplementation(() => streamErr("provider down"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b" });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    expect(result.metadata.allFailed).toBe(true);
    // 2026-05-08：N 条成员错误占位 + 1 条 system.notice（"所有成员暂不可用..."）
    const aiMessages = result.messages.filter((m) => m.senderType === "AI");
    const sysMessages = result.messages.filter(
      (m) => m.senderType === "SYSTEM",
    );
    expect(aiMessages).toHaveLength(2);
    expect(aiMessages.every((m) => m.content.startsWith("[error]"))).toBe(true);
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0].content).toContain("所有成员暂时不可用");
    // 仅 2 次 chatStream（无 synthesis）
    expect(chatStream).toHaveBeenCalledTimes(2);
  });

  it("respects roomConfig.leaderModelId for leader selection", async () => {
    const a = mkMember({ id: "a", modelId: "claude" });
    const b = mkMember({ id: "b", modelId: "gpt", order: 1 });
    const result = await adapter.execute(
      mkContext([a, b], { leaderModelId: "gpt" }),
      () => {},
    );
    const synthesis = result.messages.find((m) => m.content === "SYNTHESIS");
    expect(synthesis?.senderMemberId).toBe("b");
  });

  it("members succeed but synthesis fails: returns N member messages + 1 error placeholder", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamOf("OK_A"))
      .mockReturnValueOnce(streamOf("OK_B"))
      .mockReturnValueOnce(streamErr("synthesis failed"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b", role: AskRoomMemberRole.LEADER });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    expect(result.metadata.synthesisOk).toBe(false);
    expect(result.metadata.successCount).toBe(2);
    // 2026-05-08：N 条成员消息 + 1 条 synthesis-failed 占位（持久化让 reload 后仍可见）
    expect(result.messages).toHaveLength(3);
    expect(result.messages.find((m) => m.content === "OK_A")).toBeDefined();
    expect(result.messages.find((m) => m.content === "OK_B")).toBeDefined();
    const failPlaceholder = result.messages.find((m) =>
      m.content.includes("综合答复生成失败"),
    );
    expect(failPlaceholder).toBeDefined();
    expect(failPlaceholder?.senderMemberId).toBe("b");
  });

  it("error message is sanitized for unsafe text (no provider stack leak)", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(
        streamErr("Internal server error: Stack at provider.x.y(token=abc)"),
      )
      .mockReturnValueOnce(streamOf("OK"))
      .mockReturnValueOnce(streamOf("SYNTH"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b", role: AskRoomMemberRole.LEADER });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    const errorMsg = result.messages.find((m) =>
      m.content.startsWith("[error]"),
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.content).not.toContain("token=abc");
    expect(errorMsg?.content).toContain("AI 服务暂时不可用");
  });

  it("error message preserves user-visible patterns (rate limit / timeout)", async () => {
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamErr("rate limit exceeded for org"))
      .mockReturnValueOnce(streamOf("OK"))
      .mockReturnValueOnce(streamOf("SYNTH"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b", role: AskRoomMemberRole.LEADER });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    const errorMsg = result.messages.find((m) =>
      m.content.startsWith("[error]"),
    );
    expect(errorMsg?.content).toContain("rate limit");
  });

  it("emits monotonically increasing sequenceNum across all events", async () => {
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b" });
    const c = mkMember({ id: "c", role: AskRoomMemberRole.LEADER });
    const events: AskRoomServerEvent[] = [];
    await adapter.execute(mkContext([a, b, c]), (e) => events.push(e));
    const seqs = events.map((e) => e.sequenceNum);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("failed-member participant.done event carries sanitized error content (no empty stream/persist drift)", async () => {
    // 2026-05-08 R2 评审：之前 fanOut 失败成员的 participant.done 推 content=""，
    // 与持久化的 sanitizeErrorMessage 双源不一致。修复后事件也带脱敏占位。
    chatStream.mockReset();
    chatStream
      .mockReturnValueOnce(streamOf("OK_A"))
      .mockReturnValueOnce(streamErr("rate limit hit"))
      .mockReturnValueOnce(streamOf("SYNTH"));
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b", role: AskRoomMemberRole.LEADER });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b]), (e) =>
      events.push(e),
    );
    const failedDone = events.find(
      (e): e is Extract<AskRoomServerEvent, { kind: "participant.done" }> =>
        e.kind === "participant.done" &&
        typeof e.content === "string" &&
        e.content.startsWith("[error]"),
    );
    expect(failedDone).toBeDefined();
    // 事件 content 与 messages[].content 一致（均含 "rate limit"）
    const failedMsg = result.messages.find((m) =>
      m.content.startsWith("[error]"),
    );
    expect(failedMsg?.content).toBe(failedDone?.content);
  });
});
