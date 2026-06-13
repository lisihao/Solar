import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { CreditsService } from "../../../platform/facade";
import {
  OrganizeChatService,
  type OrganizeStreamEvent,
} from "./organize-chat.service";

/** 模拟平台 ReAct 工具循环产出的 AgentEvent 流 */
async function* mockAgentStream() {
  yield { type: "tool_call", tool: "organize-list-items", input: {} };
  yield {
    type: "tool_result",
    tool: "organize-list-items",
    output: { items: [] },
    duration: 1,
  };
  yield {
    type: "complete",
    result: {
      success: true,
      artifacts: [],
      summary: "已建集合 + 移动 12 条",
      tokensUsed: 42,
      duration: 5,
    },
  };
}

function makeService(overrides?: { creditsSufficient?: boolean }) {
  const prisma = {
    organizeSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "s1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    organizeMessage: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: data.role === "user" ? "mu" : "ma" }),
        ),
    },
  } as unknown as PrismaService;

  const chatFacade = {
    getDefaultTextModel: jest.fn().mockResolvedValue({
      modelId: "gpt-test",
      displayName: "GPT Test",
      provider: "openai",
    }),
    getModelById: jest.fn().mockResolvedValue(null),
  } as unknown as ChatFacade;

  const toolFacade = {
    chatWithToolsStream: jest.fn().mockReturnValue(mockAgentStream()),
  } as unknown as ToolFacade;

  const creditsService = {
    checkBalance: jest.fn().mockResolvedValue({
      sufficient: overrides?.creditsSufficient ?? true,
      balance: 100,
    }),
    consumeCredits: jest.fn().mockResolvedValue({ consumed: 1 }),
  } as unknown as CreditsService;

  const service = new OrganizeChatService(
    prisma,
    chatFacade,
    toolFacade,
    creditsService,
  );
  return { service, prisma, chatFacade, toolFacade, creditsService };
}

async function collect(
  gen: AsyncGenerator<OrganizeStreamEvent>,
): Promise<OrganizeStreamEvent[]> {
  const events: OrganizeStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("OrganizeChatService.streamOrganize", () => {
  it("把 AgentEvent 流转成 SSE 事件序列（session→status→tool→chunk→done）", async () => {
    const { service } = makeService();
    const events = await collect(
      service.streamOrganize("u1", { message: "整理 AI 论文" }),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session",
      "status",
      "tool", // tool_call
      "tool", // tool_result
      "chunk", // summary
      "done",
    ]);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ tokensUsed: 42, sessionId: "s1" });
  });

  it("用服务端 userId 调 chatWithToolsStream，并隔离到 organize-agent role", async () => {
    const { service, toolFacade } = makeService();
    await collect(service.streamOrganize("user-9", { message: "x" }));

    expect(toolFacade.chatWithToolsStream).toHaveBeenCalledTimes(1);
    const arg = (toolFacade.chatWithToolsStream as jest.Mock).mock.calls[0][0];
    expect(arg.context).toMatchObject({
      userId: "user-9",
      roleId: "organize-agent",
      domain: "organize",
    });
  });

  it("持久化用户消息 + 助手消息，并按 token 显式扣费", async () => {
    const { service, prisma, creditsService } = makeService();
    await collect(service.streamOrganize("u1", { message: "x" }));

    expect(prisma.organizeMessage.create).toHaveBeenCalledTimes(2);
    expect(creditsService.consumeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        moduleType: "organize-chat",
        tokenCount: 42,
      }),
    );
  });

  it("余额不足时抛错、不进入工具循环", async () => {
    const { service, toolFacade } = makeService({ creditsSufficient: false });

    await expect(
      collect(service.streamOrganize("u1", { message: "x" })),
    ).rejects.toThrow();
    expect(toolFacade.chatWithToolsStream).not.toHaveBeenCalled();
  });
});
