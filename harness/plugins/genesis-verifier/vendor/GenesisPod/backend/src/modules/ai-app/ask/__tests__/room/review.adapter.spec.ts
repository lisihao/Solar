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
import { ReviewAdapter } from "../../adapters/review.adapter";
import type { ModeContext } from "../../adapters/mode-adapter.interface";

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
    content: "Write an article on X",
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
    mode: AskRoomMode.REVIEW,
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

describe("ReviewAdapter", () => {
  let adapter: ReviewAdapter;
  let chatStream: jest.Mock;

  beforeEach(async () => {
    chatStream = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        ReviewAdapter,
        { provide: ChatFacade, useValue: { chatStream } },
      ],
    }).compile();
    adapter = module.get(ReviewAdapter);
  });

  it("draft + N feedbacks + revision; total messages = N+2", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("DRAFT"))
      .mockReturnValueOnce(
        streamOf("STATUS: needs_revision\nSCORE: 70\nFEEDBACK: clarify intro"),
      )
      .mockReturnValueOnce(
        streamOf("STATUS: approved\nSCORE: 90\nFEEDBACK: solid"),
      )
      .mockReturnValueOnce(streamOf("FINAL_DRAFT"));

    const author = mkMember({
      id: "author",
      role: AskRoomMemberRole.LEADER,
      displayName: "Author",
    });
    const r1 = mkMember({ id: "r1", displayName: "R1" });
    const r2 = mkMember({ id: "r2", displayName: "R2" });
    const result = await adapter.execute(mkContext([author, r1, r2]), () => {});

    // 1 draft + 2 reviewer feedbacks + 1 revision = 4
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].content).toContain("初稿");
    expect(result.messages[result.messages.length - 1].content).toContain(
      "终稿",
    );
    expect(result.metadata.revisionApplied).toBe(true);
    expect(result.metadata.feedbackCount).toBe(2);
    expect(result.metadata.avgScore).toBe(80);
  });

  it("respects modeOptions.authorMemberId and reviewerMemberIds", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("DRAFT"))
      .mockReturnValueOnce(
        streamOf("STATUS: approved\nSCORE: 100\nFEEDBACK: ok"),
      )
      .mockReturnValueOnce(streamOf("FINAL"));

    const a = mkMember({ id: "a" });
    const b = mkMember({ id: "b" });
    const c = mkMember({ id: "c" });
    const result = await adapter.execute(
      mkContext([a, b, c], {
        authorMemberId: "b",
        reviewerMemberIds: ["c"],
      }),
      () => {},
    );
    expect(result.metadata.authorId).toBe("b");
    expect(result.metadata.reviewerIds).toEqual(["c"]);
    // 1 draft + 1 review + 1 revision = 3
    expect(result.messages).toHaveLength(3);
  });

  it("when ALL reviewers fail, no revision is applied", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("DRAFT"))
      .mockReturnValueOnce(streamErr("boom"))
      .mockReturnValueOnce(streamErr("boom"));
    const author = mkMember({
      id: "author",
      role: AskRoomMemberRole.LEADER,
    });
    const r1 = mkMember({ id: "r1" });
    const r2 = mkMember({ id: "r2" });
    const result = await adapter.execute(mkContext([author, r1, r2]), () => {});
    expect(result.metadata.allReviewersFailed).toBe(true);
    expect(result.metadata.revisionApplied).toBe(false);
    // 1 draft + 2 error messages + 1 SYSTEM "skip revision" message = 4
    expect(result.messages).toHaveLength(4);
    expect(chatStream).toHaveBeenCalledTimes(3); // no 4th revision call
    const systemMsg = result.messages.find((m) => m.senderType === "SYSTEM");
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain("跳过修订");
  });

  it("rejects with insufficient_members when only 1 enabled (returns SYSTEM notice)", async () => {
    const events: AskRoomServerEvent[] = [];
    const result = await adapter.execute(
      mkContext([mkMember({ id: "only" })]),
      (e) => events.push(e),
    );
    expect(result.metadata.reason).toBe("insufficient_members");
    // 2026-05-08 R2：返回 1 条 system.notice 让前端 UI 看到为何中止
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderType).toBe("SYSTEM");
    expect(result.messages[0].content).toContain("REVIEW 模式至少需要 2 名");
    // 2026-05-08 R2-second: 同时断言 system.notice 事件已 emit（与 vote 一致）
    expect(events.some((e) => e.kind === "system.notice")).toBe(true);
  });

  it("clamps invalid score to [0,100]", async () => {
    chatStream
      .mockReturnValueOnce(streamOf("DRAFT"))
      .mockReturnValueOnce(
        streamOf("STATUS: approved\nSCORE: 999\nFEEDBACK: ok"),
      )
      .mockReturnValueOnce(streamOf("FINAL"));
    const author = mkMember({ id: "author", role: AskRoomMemberRole.LEADER });
    const r1 = mkMember({ id: "r1" });
    const result = await adapter.execute(mkContext([author, r1]), () => {});
    expect(result.metadata.avgScore).toBe(100);
  });
});
