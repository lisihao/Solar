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
import { FreechatAdapter } from "../../adapters/freechat.adapter";
import type { ModeContext } from "../../adapters/mode-adapter.interface";
import type { AskRoomServerEvent } from "../../gateway/ask-room-events.types";

const mkMember = (overrides: Partial<AskRoomMember> = {}): AskRoomMember => ({
  id: overrides.id ?? "m-1",
  sessionId: overrides.sessionId ?? "s-1",
  memberType: overrides.memberType ?? AskRoomMemberType.VIRTUAL,
  agentId: overrides.agentId ?? null,
  modelId: overrides.modelId ?? "model-x",
  displayName: overrides.displayName ?? "Alice",
  role: overrides.role ?? AskRoomMemberRole.MEMBER,
  systemPrompt: overrides.systemPrompt ?? null,
  persona: overrides.persona ?? null,
  order: overrides.order ?? 0,
  enabled: overrides.enabled ?? true,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: overrides.createdAt ?? new Date(),
  updatedAt: overrides.updatedAt ?? new Date(),
});

const mkUserMessage = (overrides: Partial<AskMessage> = {}): AskMessage =>
  ({
    id: overrides.id ?? "msg-user-1",
    sessionId: overrides.sessionId ?? "s-1",
    role: overrides.role ?? "user",
    content: overrides.content ?? "Hello team",
    modelId: null,
    modelName: null,
    tokens: 0,
    webSearch: false,
    createdAt: overrides.createdAt ?? new Date(),
    senderType: overrides.senderType ?? AskSenderType.USER,
    senderMemberId: overrides.senderMemberId ?? null,
    mentionedMemberIds: overrides.mentionedMemberIds ?? [],
    turnId: overrides.turnId ?? null,
    parentMessageId: overrides.parentMessageId ?? null,
    sequenceNum: overrides.sequenceNum ?? 1,
  }) as AskMessage;

const mkSession = (): AskSession =>
  ({
    id: "s-1",
    userId: "u-1",
    title: "Test Room",
    summary: null,
    modelId: null,
    isBookmarked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    mode: AskSessionMode.ROOM,
    roomConfig: {},
  }) as AskSession;

const mkTurn = (): AskRoomTurn =>
  ({
    id: "t-1",
    sessionId: "s-1",
    triggerMessageId: "msg-user-1",
    mode: AskRoomMode.FREECHAT,
    status: AskTurnStatus.RUNNING,
    participantIds: [],
    partialDeltas: null,
    metadata: null,
    startedAt: new Date(),
    endedAt: null,
  }) as AskRoomTurn;

const mkContext = (overrides: Partial<ModeContext> = {}): ModeContext => ({
  session: overrides.session ?? mkSession(),
  members: overrides.members ?? [mkMember()],
  triggerMessage: overrides.triggerMessage ?? mkUserMessage(),
  history: overrides.history ?? [],
  turn: overrides.turn ?? mkTurn(),
  modeOptions: overrides.modeOptions,
  userId: overrides.userId ?? "u-1",
  sequenceNumStart: overrides.sequenceNumStart ?? 1,
  signal: overrides.signal ?? new AbortController().signal,
});

// 把"一段完整内容"包装成 chatFacade.chatStream 期望的 async generator chunk 流。
// chunks 默认拆成 [{content, done:false}, {content:"", done:true}]，
// 模拟 LLM 真实流式返回（首块带正文，末块仅 done=true）。
function streamOf(content: string): AsyncIterable<{
  content: string;
  done: boolean;
  error?: string;
}> {
  return (async function* () {
    yield { content, done: false };
    yield { content: "", done: true };
  })();
}

describe("FreechatAdapter", () => {
  let adapter: FreechatAdapter;
  let chatFacade: { chatStream: jest.Mock };

  beforeEach(async () => {
    chatFacade = {
      chatStream: jest.fn().mockImplementation(() => streamOf("Hi from AI")),
    };
    const module = await Test.createTestingModule({
      providers: [
        FreechatAdapter,
        { provide: ChatFacade, useValue: chatFacade },
      ],
    }).compile();
    adapter = module.get(FreechatAdapter);
  });

  it("falls back to leader when no @mention", async () => {
    const leader = mkMember({
      id: "leader",
      role: AskRoomMemberRole.LEADER,
      displayName: "Leader",
    });
    const member = mkMember({ id: "m-2", displayName: "Bob" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(
      mkContext({ members: [leader, member] }),
      (e) => events.push(e),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderMemberId).toBe("leader");
    expect(chatFacade.chatStream).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.kind === "participant.thinking")).toBeDefined();
    expect(events.find((e) => e.kind === "participant.done")).toBeDefined();
  });

  it("routes to mentioned members when @mention present", async () => {
    const a = mkMember({ id: "a", displayName: "A" });
    const b = mkMember({ id: "b", displayName: "B" });
    const c = mkMember({ id: "c", displayName: "C" });
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(
      mkContext({
        members: [a, b, c],
        triggerMessage: mkUserMessage({
          mentionedMemberIds: ["a", "c"],
        }),
      }),
      (e) => events.push(e),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.senderMemberId).sort()).toEqual([
      "a",
      "c",
    ]);
    expect(chatFacade.chatStream).toHaveBeenCalledTimes(2);
  });

  it("filters out disabled and soft-deleted members from leader fallback", async () => {
    const enabled = mkMember({ id: "ok", displayName: "OK" });
    const disabled = mkMember({
      id: "off",
      displayName: "Off",
      enabled: false,
    });
    const deleted = mkMember({
      id: "del",
      displayName: "Del",
      deletedAt: new Date(),
    });
    const result = await adapter.execute(
      mkContext({ members: [disabled, deleted, enabled] }),
      () => {},
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderMemberId).toBe("ok");
  });

  it("emits sequenceNum that monotonically increases per event", async () => {
    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b" });
    const events: AskRoomServerEvent[] = [];
    await adapter.execute(
      mkContext({
        members: [a, b],
        triggerMessage: mkUserMessage({ mentionedMemberIds: ["a", "b"] }),
        sequenceNumStart: 10,
      }),
      (e) => events.push(e),
    );
    const seqs = events.map((e) => e.sequenceNum);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("aborts when signal triggers before chat", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      adapter.execute(mkContext({ signal: ctl.signal }), () => {}),
    ).rejects.toThrow(/aborted/);
  });

  it("returns system notice when no enabled participants", async () => {
    const result = await adapter.execute(
      mkContext({
        members: [mkMember({ enabled: false })],
      }),
      () => {},
    );
    // 2026-05-08：返回 1 条 system.notice 让前端 UI 看到为何中止
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderType).toBe("SYSTEM");
    expect(result.messages[0].content).toContain("没有可用的成员");
    expect(result.metadata.reason).toBe("no_participants");
  });
});
