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
import { HandoffAdapter } from "../../adapters/handoff.adapter";
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
    content: "Need expert advice",
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
    mode: AskRoomMode.HANDOFF,
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

describe("HandoffAdapter", () => {
  let adapter: HandoffAdapter;
  let chatStream: jest.Mock;

  beforeEach(async () => {
    chatStream = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        HandoffAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
      ],
    }).compile();
    adapter = module.get(HandoffAdapter);
  });

  it("single agent answers without handoff tag → chain length 1", async () => {
    chatStream.mockReturnValueOnce(streamOf("Final answer."));
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER });
    const b = mkMember({ id: "b" });
    const result = await adapter.execute(mkContext([a, b]), () => {});
    expect(result.metadata.chain).toEqual(["a"]);
    expect(result.metadata.depth).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Final answer.");
  });

  it("hands off via [HANDOFF: id] tag; emits handoff.request + accepted", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("I cannot answer.\n[HANDOFF: b]"))
      .mockReturnValueOnce(streamOf("I can: ..."));
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER });
    const b = mkMember({ id: "b", displayName: "Specialist" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b]), (e) =>
      events.push(e),
    );
    expect(result.metadata.chain).toEqual(["a", "b"]);
    expect(events.find((e) => e.kind === "handoff.request")).toBeDefined();
    expect(events.find((e) => e.kind === "handoff.accepted")).toBeDefined();
    // a 的消息内容已剥除标记
    expect(result.messages[0].content).not.toContain("HANDOFF");
  });

  it("rejects handoff to unknown target id", async () => {
    chatStream.mockReturnValueOnce(
      streamOf("passing.\n[HANDOFF: nonexistent]"),
    );
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER });
    const b = mkMember({ id: "b" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b]), (e) =>
      events.push(e),
    );
    expect(events.find((e) => e.kind === "handoff.rejected")).toBeDefined();
    expect(result.metadata.chain).toEqual(["a"]);
  });

  it("rejects handoff back to already-visited member (cycle prevention)", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("first\n[HANDOFF: b]"))
      .mockReturnValueOnce(streamOf("back\n[HANDOFF: a]"));
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER });
    const b = mkMember({ id: "b" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b]), (e) =>
      events.push(e),
    );
    expect(result.metadata.chain).toEqual(["a", "b"]);
    expect(events.find((e) => e.kind === "handoff.rejected")).toBeDefined();
  });

  it("prevents indirect cycle A→B→C→B", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("to b\n[HANDOFF: b]"))
      .mockReturnValueOnce(streamOf("to c\n[HANDOFF: c]"))
      .mockReturnValueOnce(streamOf("back to b\n[HANDOFF: b]"));
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER, order: 0 });
    const b = mkMember({ id: "b", order: 1 });
    const c = mkMember({ id: "c", order: 2 });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b, c]), (e) =>
      events.push(e),
    );
    expect(result.metadata.chain).toEqual(["a", "b", "c"]);
    // c 试图 handoff 到已访问的 b → rejected
    const rejected = events.filter((e) => e.kind === "handoff.rejected");
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("rejects ambiguous displayName when two members share name", async () => {
    chatStream.mockReturnValueOnce(streamOf("to expert\n[HANDOFF: Expert]"));
    const a = mkMember({
      id: "a",
      role: AskRoomMemberRole.LEADER,
      displayName: "Leader",
    });
    const b = mkMember({ id: "b", displayName: "Expert" });
    const c = mkMember({ id: "c", displayName: "Expert" }); // 同名
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b, c]), (e) =>
      events.push(e),
    );
    // 因为 Expert 有歧义，应被 rejected 而不是路由到 b 或 c
    expect(events.find((e) => e.kind === "handoff.rejected")).toBeDefined();
    expect(result.metadata.chain).toEqual(["a"]);
  });

  it("respects modeOptions.startMemberId", async () => {
    chatStream.mockReturnValueOnce(streamOf("Hi."));
    const a = mkMember({ id: "a", role: AskRoomMemberRole.LEADER });
    const b = mkMember({ id: "b" });
    const c = mkMember({ id: "c" });
    const result = await adapter.execute(
      mkContext([a, b, c], { startMemberId: "c" }),
      () => {},
    );
    expect(result.metadata.chain).toEqual(["c"]);
  });

  it("stops at MAX_HANDOFF_DEPTH=5", async () => {
    // 7 个成员，每个都把传给下一个
    const members = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) =>
      mkMember({ id, order: i }),
    );
    const next = ["b", "c", "d", "e", "f", "g"];
    for (const target of next) {
      chatStream.mockReturnValueOnce(streamOf(`bridge\n[HANDOFF: ${target}]`));
    }
    chatStream.mockReturnValueOnce(streamOf("tail"));
    const result = await adapter.execute(mkContext(members), () => {});
    // depth=5 → chain a→b→c→d→e→f (6 个 member)
    expect(result.metadata.depth).toBeLessThanOrEqual(6);
    expect(result.metadata.chain[0]).toBe("a");
    // 2026-05-08 R2 评审：max_depth 退出补 system.notice 让 UI 知道为何截断
    const sysMessages = result.messages.filter(
      (m) => m.senderType === "SYSTEM",
    );
    expect(sysMessages.some((m) => m.content.includes("最大深度"))).toBe(true);
  });

  it("mid-chain chat() failure produces error placeholder + breaks chain (no throw)", async () => {
    // 2026-05-08 R2 评审：单成员 chat() 失败之前裸抛让整 turn FAIL；
    // 现在用 error 占位 done + break 链路，与其他 adapter 一致。
    const a = mkMember({ id: "a", order: 0 });
    const b = mkMember({ id: "b", order: 1 });
    chatStream
      .mockReturnValueOnce(streamOf("first speaker\n[HANDOFF: b]"))
      .mockReturnValueOnce(streamErr("provider down"));
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a, b]), (e) =>
      events.push(e),
    );
    // 不抛错（结果正常返回）
    expect(result).toBeDefined();
    // 链路：a 正常说话 → 切到 b → b chat 失败 → 占位 + break
    expect(result.metadata.chain).toEqual(["a", "b"]);
    // b 的消息应是 error 占位
    const bMessage = result.messages.find((m) => m.senderMemberId === "b");
    expect(bMessage).toBeDefined();
    expect(bMessage?.content).toContain("[error]");
    // 仅 2 次 chat（不会继续触发后续）
    expect(chatStream).toHaveBeenCalledTimes(2);
  });

  it("emits system.notice on handoff.rejected (target not found)", async () => {
    const a = mkMember({ id: "a", order: 0 });
    chatStream.mockReturnValueOnce(streamOf("go to nobody\n[HANDOFF: ghost]"));
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(mkContext([a]), (e) => events.push(e));
    // handoff.rejected 事件 + 配套 system.notice
    expect(events.some((e) => e.kind === "handoff.rejected")).toBe(true);
    const sysMessages = result.messages.filter(
      (m) => m.senderType === "SYSTEM",
    );
    expect(sysMessages.some((m) => m.content.includes("ghost"))).toBe(true);
  });
});
