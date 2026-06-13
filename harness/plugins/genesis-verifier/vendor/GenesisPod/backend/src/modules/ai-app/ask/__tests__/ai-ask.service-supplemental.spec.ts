/**
 * AiAskService Supplemental Tests
 *
 * Targets uncovered paths (~43 lines):
 * - sanitizeMessageContent: base64 replacement, markdown image, long-message truncation
 * - extractTitleFromMessage: empty/null, markdown cleanup, truncation at punctuation/space
 * - buildSystemPromptWithContext: project-related query, ragContext, history context
 * - buildSystemPromptForChat: project-related query, ragContext
 * - getModelConfig: null modelId fallback, no model found throws
 * - regenerateMessage: session not found, message not found, previous messages empty
 * - getMessages: with/without `before` filter, hasMore pagination
 * - deleteSession: kernel process cleanup
 * - getAvailableTools: tool capability unavailable
 */

import { NotFoundException } from "@nestjs/common";
import { AiAskService } from "../ai-ask.service";

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------
function buildService(overrides: Record<string, unknown> = {}): AiAskService {
  const mockPrisma = {
    askSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    askMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockChatFacade = {
    chat: jest.fn(),
    getModelById: jest.fn(),
    getDefaultTextModel: jest.fn(),
  };

  const mockToolFacade = {
    isToolExecutionAvailable: jest.fn().mockReturnValue(true),
    isToolAvailable: jest.fn().mockReturnValue(true),
    chatWithToolsStream: jest.fn(),
    listModuleCapabilities: jest.fn().mockReturnValue([]),
  };

  const mockRagFacade = {
    sessionMemoryGet: jest.fn().mockResolvedValue(null),
    sessionMemorySet: jest.fn().mockResolvedValue(undefined),
    sessionMemoryClear: jest.fn().mockResolvedValue(undefined),
  };

  const mockAgentFacade = {
    routeIntent: jest.fn().mockResolvedValue(null),
  };

  const service = new AiAskService(
    mockPrisma as any,
    mockChatFacade as any,
    mockToolFacade as any,
    mockRagFacade as any,
    mockAgentFacade as any,
    null as any, // ragPipelineService
    null as any, // creditsService
    undefined, // missionExecutor
    undefined, // kernelMemory
  );

  // Expose internal mocks for test assertions
  Object.assign(service as any, {
    _mockPrisma: mockPrisma,
    _mockChatFacade: mockChatFacade,
    _mockToolFacade: mockToolFacade,
    _mockRagFacade: mockRagFacade,
    _mockAgentFacade: mockAgentFacade,
    ...overrides,
  });

  return service;
}

// ---------------------------------------------------------------------------

describe("AiAskService (supplemental)", () => {
  // =========================================================================
  // sanitizeMessageContent (private, accessed via reflection)
  // =========================================================================
  describe("sanitizeMessageContent", () => {
    let service: AiAskService;

    beforeEach(() => {
      service = buildService();
    });

    const sanitize = (s: AiAskService, content: string): string =>
      (s as any).sanitizeMessageContent(content);

    it("returns content unchanged when no base64 or markdown images", () => {
      const input = "Hello, this is a normal message.";
      expect(sanitize(service, input)).toBe(input);
    });

    it("replaces inline data:image base64 with placeholder", () => {
      const input = "See image: data:image/png;base64,iVBORw0KGgo=";
      const result = sanitize(service, input);
      expect(result).toContain("[图片已省略]");
      expect(result).not.toContain("iVBORw0KGgo=");
    });

    it("replaces markdown image with base64 src with placeholder", () => {
      const input = "![alt](data:image/jpeg;base64,/9j/4AAQSkZJRg==)";
      const result = sanitize(service, input);
      expect(result).toContain("[图片已省略]");
    });

    it("truncates messages longer than 20000 characters", () => {
      const longMessage = "a".repeat(21000);
      const result = sanitize(service, longMessage);
      expect(result.length).toBeLessThanOrEqual(21000);
      expect(result).toContain("[消息内容已截断]");
    });

    it("returns falsy content as-is (empty string)", () => {
      expect(sanitize(service, "")).toBe("");
    });
  });

  // =========================================================================
  // extractTitleFromMessage (private)
  // =========================================================================
  describe("extractTitleFromMessage", () => {
    let service: AiAskService;

    beforeEach(() => {
      service = buildService();
    });

    const extract = (s: AiAskService, msg: string): string =>
      (s as any).extractTitleFromMessage(msg);

    it("returns 'New Chat' for empty string", () => {
      expect(extract(service, "")).toBe("New Chat");
    });

    it("returns 'New Chat' for non-string input (null)", () => {
      expect(extract(service, null as any)).toBe("New Chat");
    });

    it("returns message as-is when <= 40 characters", () => {
      const short = "Short message here";
      expect(extract(service, short)).toBe(short);
    });

    it("strips markdown image syntax before extracting title", () => {
      const msg = "![photo](https://img.example.com/photo.jpg) Hello world";
      const result = extract(service, msg);
      expect(result).not.toContain("![");
    });

    it("strips HTML tags", () => {
      const msg = "<b>Bold text</b> is great for titles";
      const result = extract(service, msg);
      expect(result).not.toContain("<b>");
    });

    it("strips markdown code blocks and replaces with [代码]", () => {
      const msg = "```javascript\nconsole.log('hi');\n``` some text";
      const result = extract(service, msg);
      expect(result).toContain("[代码]");
    });

    it("truncates at Chinese punctuation when title > 40 chars", () => {
      const msg =
        "这是一个很长的中文标题，它超过了四十个字符，需要在标点处截断";
      const result = extract(service, msg);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it("truncates at last space when no Chinese punctuation", () => {
      const msg = "This is a very long English title that exceeds forty chars";
      const result = extract(service, msg);
      // Should truncate at word boundary
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it("replaces markdown link with link text only", () => {
      const msg = "[Click here](https://example.com) for info";
      const result = extract(service, msg);
      expect(result).toContain("Click here");
      expect(result).not.toContain("https://example.com");
    });
  });

  // =========================================================================
  // getAvailableTools
  // =========================================================================
  describe("getAvailableTools", () => {
    it("returns empty array when tool capability unavailable", () => {
      const service = buildService();
      (service as any)._mockToolFacade.isToolExecutionAvailable.mockReturnValue(
        false,
      );
      // Patch the toolFacade on the service instance
      (service as any).toolFacade = (service as any)._mockToolFacade;
      expect(service.getAvailableTools()).toEqual([]);
    });

    it("returns filtered tools when capability is available", () => {
      const service = buildService();
      const mockToolFacade = {
        isToolExecutionAvailable: jest.fn().mockReturnValue(true),
        isToolAvailable: jest.fn().mockReturnValue(true),
      };
      (service as any).toolFacade = mockToolFacade;
      const tools = service.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("filters out unavailable tools", () => {
      const service = buildService();
      const mockToolFacade = {
        isToolExecutionAvailable: jest.fn().mockReturnValue(true),
        isToolAvailable: jest.fn().mockReturnValue(false),
      };
      (service as any).toolFacade = mockToolFacade;
      const tools = service.getAvailableTools();
      expect(tools).toEqual([]);
    });
  });

  // =========================================================================
  // getModelConfig (private)
  // =========================================================================
  describe("getModelConfig", () => {
    it("returns model config when modelId is found", async () => {
      const service = buildService();
      const mockModel = {
        id: "model-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        apiEndpoint: null,
        maxTokens: 4000,
      };
      (service as any).chatFacade = {
        getModelById: jest.fn().mockResolvedValue(mockModel),
        getDefaultTextModel: jest.fn(),
      };
      const config = await (service as any).getModelConfig("model-1");
      expect(config.modelId).toBe("gpt-4o");
      expect(config.name).toBe("GPT-4o");
    });

    it("falls back to default model when modelId not found", async () => {
      const service = buildService();
      const mockDefault = {
        id: "default-model",
        modelId: "claude-3",
        displayName: "Claude 3",
        provider: "anthropic",
        maxTokens: 8000,
      };
      (service as any).chatFacade = {
        getModelById: jest.fn().mockResolvedValue(null),
        getDefaultTextModel: jest.fn().mockResolvedValue(mockDefault),
      };
      const config = await (service as any).getModelConfig("nonexistent");
      expect(config.modelId).toBe("claude-3");
    });

    it("uses default model when no modelId given", async () => {
      const service = buildService();
      const mockDefault = {
        id: "default-model",
        modelId: "default-model-id",
        displayName: "Default",
        provider: "openai",
        maxTokens: 4000,
      };
      (service as any).chatFacade = {
        getModelById: jest.fn(),
        getDefaultTextModel: jest.fn().mockResolvedValue(mockDefault),
      };
      const config = await (service as any).getModelConfig(null);
      expect(config.modelId).toBe("default-model-id");
    });

    it("throws NotFoundException when no model available at all", async () => {
      const service = buildService();
      (service as any).chatFacade = {
        getModelById: jest.fn().mockResolvedValue(null),
        getDefaultTextModel: jest.fn().mockResolvedValue(null),
      };
      await expect((service as any).getModelConfig(null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // getSession — session not found
  // =========================================================================
  describe("getSession", () => {
    it("throws NotFoundException when session not found", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(service.getSession("nonexistent", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns session with messages and warms cache when messages exist", async () => {
      const service = buildService();
      const mockSession = { id: "s1", userId: "u1", title: "Test" };
      const mockMessages = [
        {
          id: "m1",
          sessionId: "s1",
          role: "user",
          content: "Hi",
          createdAt: new Date(),
        },
      ];
      const mockRagFacade = {
        sessionMemoryGet: jest.fn().mockResolvedValue(null),
        sessionMemorySet: jest.fn().mockResolvedValue(undefined),
        sessionMemoryClear: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(mockSession) },
        askMessage: { findMany: jest.fn().mockResolvedValue(mockMessages) },
      };
      (service as any).ragFacade = mockRagFacade;
      const result = await service.getSession("s1", "u1");
      expect(result.session).toEqual(mockSession);
      expect(result.messages).toHaveLength(1);
      expect(mockRagFacade.sessionMemorySet).toHaveBeenCalled();
    });

    it("skips cache warming when session has no messages", async () => {
      const service = buildService();
      const mockSession = { id: "s1", userId: "u1", title: "Empty" };
      const mockRagFacade = {
        sessionMemorySet: jest.fn(),
        sessionMemoryClear: jest.fn(),
      };
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(mockSession) },
        askMessage: { findMany: jest.fn().mockResolvedValue([]) },
      };
      (service as any).ragFacade = mockRagFacade;
      await service.getSession("s1", "u1");
      expect(mockRagFacade.sessionMemorySet).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getMessages — with before parameter and pagination
  // =========================================================================
  describe("getMessages", () => {
    it("throws NotFoundException when session not found", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(
        service.getMessages("bad-session", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns messages without hasMore when count <= limit", async () => {
      const service = buildService();
      const msgs = [
        { id: "m1", content: "Hello", createdAt: new Date() },
        { id: "m2", content: "World", createdAt: new Date() },
      ];
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
        askMessage: { findMany: jest.fn().mockResolvedValue(msgs) },
      };
      const result = await service.getMessages("s1", "u1", 50);
      expect(result.hasMore).toBe(false);
      expect(result.messages).toHaveLength(2);
    });

    it("sets hasMore=true when result count exceeds limit", async () => {
      const service = buildService();
      // Return limit+1 messages
      const msgs = Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`,
        content: `msg ${i}`,
        createdAt: new Date(),
      }));
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
        askMessage: { findMany: jest.fn().mockResolvedValue(msgs) },
      };
      const result = await service.getMessages("s1", "u1", 5);
      expect(result.hasMore).toBe(true);
      expect(result.messages).toHaveLength(5);
    });

    it("passes before filter when provided", async () => {
      const service = buildService();
      const beforeDate = new Date("2024-01-01");
      const mockFindMany = jest.fn().mockResolvedValue([]);
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
        askMessage: { findMany: mockFindMany },
      };
      await service.getMessages("s1", "u1", 10, beforeDate);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: beforeDate },
          }),
        }),
      );
    });
  });

  // =========================================================================
  // regenerateMessage — error paths
  // =========================================================================
  describe("regenerateMessage", () => {
    it("throws NotFoundException when session not found", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(
        service.regenerateMessage("s1", "msg-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when message not found", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
        askMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(
        service.regenerateMessage("s1", "msg-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when message is not from assistant", async () => {
      const service = buildService();
      const userMsg = {
        id: "msg-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
      };
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
        askMessage: { findFirst: jest.fn().mockResolvedValue(userMsg) },
      };
      await expect(
        service.regenerateMessage("s1", "msg-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when no previous user messages", async () => {
      const service = buildService();
      const assistantMsg = {
        id: "msg-2",
        role: "assistant",
        content: "Hi",
        modelId: "gpt-4",
        createdAt: new Date(),
      };
      (service as any).prisma = {
        askSession: {
          findFirst: jest.fn().mockResolvedValue({ id: "s1", userId: "u1" }),
        },
        askMessage: {
          findFirst: jest.fn().mockResolvedValue(assistantMsg),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      await expect(
        service.regenerateMessage("s1", "msg-2", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // deleteSession — memory + kernel process cleanup
  // =========================================================================
  describe("deleteSession", () => {
    it("throws NotFoundException when session not found", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(service.deleteSession("s1", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("clears session memory on delete", async () => {
      const service = buildService();
      const mockRagFacade = {
        sessionMemoryClear: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).prisma = {
        askSession: {
          findFirst: jest.fn().mockResolvedValue({ id: "s1" }),
          delete: jest.fn().mockResolvedValue(undefined),
        },
      };
      (service as any).ragFacade = mockRagFacade;
      const result = await service.deleteSession("s1", "u1");
      expect(result.success).toBe(true);
      expect(mockRagFacade.sessionMemoryClear).toHaveBeenCalledWith("s1");
    });

    it("completes kernel process when processId tracked", async () => {
      const service = buildService();
      const mockMissionExecutor = {
        complete: jest.fn().mockResolvedValue(undefined),
      };
      const mockRagFacade = {
        sessionMemoryClear: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).prisma = {
        askSession: {
          findFirst: jest.fn().mockResolvedValue({ id: "s1" }),
          delete: jest.fn().mockResolvedValue(undefined),
        },
      };
      (service as any).ragFacade = mockRagFacade;
      (service as any).missionExecutor = mockMissionExecutor;
      // Simulate tracked session process
      (service as any).sessionProcessIds.set("s1", "process-xyz");

      const result = await service.deleteSession("s1", "u1");
      expect(result.success).toBe(true);
      expect(mockMissionExecutor.complete).toHaveBeenCalledWith("process-xyz", {
        reason: "session_deleted",
      });
    });
  });

  // =========================================================================
  // searchSessions
  // =========================================================================
  describe("searchSessions", () => {
    it("returns matching sessions", async () => {
      const service = buildService();
      const sessions = [{ id: "s1", title: "AI Chat" }];
      (service as any).prisma = {
        askSession: { findMany: jest.fn().mockResolvedValue(sessions) },
      };
      const result = await service.searchSessions("user-1", "AI");
      expect(result).toEqual(sessions);
    });

    it("returns empty array when no match", async () => {
      const service = buildService();
      (service as any).prisma = {
        askSession: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const result = await service.searchSessions("user-1", "nonexistent");
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // buildSystemPromptWithContext (private)
  // =========================================================================
  describe("buildSystemPromptWithContext", () => {
    it("includes project context for project-related queries", () => {
      const service = buildService();
      // isProjectRelatedQuery returns true for "genesis" related query
      const prompt = (service as any).buildSystemPromptWithContext(
        [],
        undefined,
        "gens.team 的 research 功能怎么用",
      );
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("includes RAG context when provided", () => {
      const service = buildService();
      const prompt = (service as any).buildSystemPromptWithContext(
        [],
        "RAG context text here",
        "some question",
      );
      expect(prompt).toContain("RAG context text here");
    });

    it("includes conversation history when contextMessages has multiple entries", () => {
      const service = buildService();
      const context = [
        { role: "user" as const, content: "First message" },
        { role: "assistant" as const, content: "Response" },
        { role: "user" as const, content: "Current question" },
      ];
      const prompt = (service as any).buildSystemPromptWithContext(
        context,
        undefined,
        "question",
      );
      expect(prompt).toContain("First message");
    });
  });

  // =========================================================================
  // buildSystemPromptForChat (private)
  // =========================================================================
  describe("buildSystemPromptForChat", () => {
    it("returns a string prompt", () => {
      const service = buildService();
      const prompt = (service as any).buildSystemPromptForChat(
        "What is the weather?",
        undefined,
      );
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("includes RAG context section when ragContext provided", () => {
      const service = buildService();
      const prompt = (service as any).buildSystemPromptForChat(
        "Tell me about AI",
        "Some RAG context",
      );
      expect(prompt).toContain("Some RAG context");
    });
  });
});
