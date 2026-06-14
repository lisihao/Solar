/**
 * Public API Controller E2E Tests
 *
 * Tests all endpoints exposed by the PublicController.
 * Mocks AI dependencies (AIFacade, ChatFacade, ToolFacade).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotImplementedException, ExecutionContext } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { PublicController } from "../public.controller";
import { AIFacade } from "../../../../ai-harness/facade/ai.facade";
import { ChatFacade, ToolFacade } from "../../../../ai-harness/facade";
import { MCPApiKeyGuard } from "../../mcp/guards/mcp-api-key.guard";

describe("PublicController", () => {
  let controller: PublicController;
  // Single shared mock object registered under all three DI tokens.
  // Each token satisfies one part of the production constructor, and
  // the shared reference lets tests assert on any method regardless of
  // which facade it belongs to in production.
  let aiFacade: {
    chat: jest.Mock;
    executeDirectResearch: jest.Mock;
    getAvailableTools: jest.Mock;
    getToolFunctionDefinitions: jest.Mock;
    getAvailableModels: jest.Mock;
    getAvailableCapabilities: jest.Mock;
  };

  beforeEach(async () => {
    // One mock object covering all three facades
    const sharedMock = {
      chat: jest.fn(),
      executeDirectResearch: jest.fn(),
      getAvailableTools: jest.fn(),
      getToolFunctionDefinitions: jest.fn(),
      getAvailableModels: jest.fn(),
      getAvailableCapabilities: jest.fn(),
    };

    // Expose via the test-suite variable so assertions can reach it
    aiFacade = sharedMock;

    // Mock MCPApiKeyGuard to always allow requests
    const mockGuard = {
      canActivate: (_context: ExecutionContext) => true,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        { provide: AIFacade, useValue: sharedMock },
        { provide: ChatFacade, useValue: sharedMock },
        { provide: ToolFacade, useValue: sharedMock },
      ],
    })
      .overrideGuard(MCPApiKeyGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<PublicController>(PublicController);

    jest.clearAllMocks();
  });

  // ==================== Self-Description ====================

  describe("getCapabilities", () => {
    it("should return API version and capabilities list", async () => {
      const result = await controller.getCapabilities();

      expect(result).toHaveProperty("version");
      expect(result.version).toBe("1.0.0");
      expect(result).toHaveProperty("capabilities");
      expect(Array.isArray(result.capabilities)).toBe(true);
      expect(result.capabilities.length).toBeGreaterThan(0);
      expect(result).toHaveProperty("authentication");
      expect(result.authentication.type).toBe("api-key");
    });

    it("should include all expected capabilities", async () => {
      const result = await controller.getCapabilities();

      const capabilityIds = result.capabilities.map((c: any) => c.id);
      expect(capabilityIds).toContain("research");
      expect(capabilityIds).toContain("ask");
      expect(capabilityIds).toContain("chat");
      expect(capabilityIds).toContain("debate");
      expect(capabilityIds).toContain("writing");
      expect(capabilityIds).toContain("content-analysis");
    });

    it("should include endpoint details for each capability", async () => {
      const result = await controller.getCapabilities();

      result.capabilities.forEach((cap: any) => {
        expect(cap).toHaveProperty("id");
        expect(cap).toHaveProperty("name");
        expect(cap).toHaveProperty("description");
        expect(cap).toHaveProperty("endpoint");
        expect(cap).toHaveProperty("method");
      });
    });
  });

  // ==================== Health / Status ====================

  describe("getStatus", () => {
    it("should return healthy status", async () => {
      const result = await controller.getStatus();

      expect(result.status).toBe("healthy");
      expect(result.service).toBe("genesis-ai");
      expect(result.version).toBe("1.0.0");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("capabilities");
      expect(Array.isArray(result.capabilities)).toBe(true);
    });

    it("should include valid ISO timestamp", async () => {
      const result = await controller.getStatus();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.toString()).not.toBe("Invalid Date");
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  // ==================== OpenClaw Config ====================

  describe("getOpenClawConfig", () => {
    it("should return OpenClaw integration config", async () => {
      const result = await controller.getOpenClawConfig();

      expect(result.provider).toBe("genesis-ai");
      expect(result.baseUrl).toBe("/api/v1/public");
      expect(result).toHaveProperty("authentication");
      expect(result.authentication.type).toBe("api-key");
      expect(result.authentication.header).toBe("Authorization");
      expect(result.authentication.prefix).toBe("Bearer");
    });

    it("should include endpoints with proper paths", async () => {
      const result = await controller.getOpenClawConfig();

      expect(result).toHaveProperty("endpoints");
      expect(Array.isArray(result.endpoints)).toBe(true);

      result.endpoints.forEach((endpoint: any) => {
        expect(endpoint).toHaveProperty("id");
        expect(endpoint).toHaveProperty("path");
        expect(endpoint).toHaveProperty("method");
        expect(endpoint).toHaveProperty("description");
        expect(endpoint.path).not.toContain("/api/v1/public");
      });
    });

    it("should include rate limiting information", async () => {
      const result = await controller.getOpenClawConfig();

      expect(result).toHaveProperty("rateLimiting");
      expect(result.rateLimiting).toHaveProperty("requestsPerMinute");
      expect(result.rateLimiting).toHaveProperty("requestsPerDay");
      expect(typeof result.rateLimiting.requestsPerMinute).toBe("number");
      expect(typeof result.rateLimiting.requestsPerDay).toBe("number");
    });
  });

  // ==================== Discovery ====================

  describe("discoverTools", () => {
    it("should return available tools from facade", async () => {
      const mockTools = [
        { id: "web_search", name: "Web Search", category: "search" },
        { id: "calculator", name: "Calculator", category: "utility" },
      ];

      const mockDefinitions = [
        {
          name: "web_search",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "calculator",
          parameters: { type: "object", properties: {} },
        },
      ];

      aiFacade.getAvailableTools.mockReturnValue(mockTools as any);
      aiFacade.getToolFunctionDefinitions.mockReturnValue(
        mockDefinitions as any,
      );

      const result = await controller.discoverTools();

      expect(result.count).toBe(2);
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]).toHaveProperty("inputSchema");
      expect(aiFacade.getAvailableTools).toHaveBeenCalledWith(undefined);
    });

    it("should filter tools by category when provided", async () => {
      const mockTools = [
        { id: "web_search", name: "Web Search", category: "search" },
      ];

      aiFacade.getAvailableTools.mockReturnValue(mockTools as any);
      aiFacade.getToolFunctionDefinitions.mockReturnValue([]);

      await controller.discoverTools("search");

      expect(aiFacade.getAvailableTools).toHaveBeenCalledWith("search");
    });

    it("should handle tools without matching definitions", async () => {
      const mockTools = [
        { id: "unknown_tool", name: "Unknown Tool", category: "other" },
      ];

      aiFacade.getAvailableTools.mockReturnValue(mockTools as any);
      aiFacade.getToolFunctionDefinitions.mockReturnValue([]);

      const result = await controller.discoverTools();

      expect(result.tools[0].inputSchema).toBeNull();
    });
  });

  describe("discoverModels", () => {
    it("should return available models from facade", async () => {
      const mockModels = [
        { id: "gpt-4", name: "GPT-4", provider: "openai" },
        { id: "claude-3", name: "Claude 3", provider: "anthropic" },
      ];

      aiFacade.getAvailableModels.mockResolvedValue(mockModels as any);

      const result = await controller.discoverModels();

      expect(result.count).toBe(2);
      expect(result.modelType).toBe(AIModelType.CHAT);
      expect(result.models).toEqual(mockModels);
      expect(aiFacade.getAvailableModels).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should filter by model type when provided", async () => {
      const mockModels = [
        { id: "dall-e-3", name: "DALL-E 3", provider: "openai" },
      ];

      aiFacade.getAvailableModels.mockResolvedValue(mockModels as any);

      const result = await controller.discoverModels("IMAGE_GENERATION");

      expect(result.modelType).toBe("IMAGE_GENERATION");
      expect(aiFacade.getAvailableModels).toHaveBeenCalledWith(
        "IMAGE_GENERATION" as AIModelType,
      );
    });
  });

  describe("discoverCapabilities", () => {
    it("should return full capability snapshot", async () => {
      const mockCapabilities = {
        tools: [{ id: "tool1", name: "Tool 1" }],
        skills: [{ id: "skill1", name: "Skill 1" }],
        mcpTools: [{ id: "mcp1", name: "MCP Tool 1" }],
      };

      aiFacade.getAvailableCapabilities.mockResolvedValue(
        mockCapabilities as any,
      );

      const result = await controller.discoverCapabilities();

      expect(result.version).toBe("1.0.0");
      expect(result).toHaveProperty("restEndpoints");
      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("mcpTools");
      expect(result.tools.count).toBe(1);
      expect(result.skills.count).toBe(1);
      expect(result.mcpTools.count).toBe(1);
    });
  });

  // ==================== Ask ====================

  describe("ask", () => {
    it("should process question and return answer", async () => {
      const mockResponse = {
        content: "This is the answer to your question.",
        model: "gpt-4o",
        tokensUsed: 150,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.ask({
        question: "What is AI?",
      });

      expect(result.answer).toBe(mockResponse.content);
      expect(result.model).toBe(mockResponse.model);
      expect(result.tokensUsed).toBe(mockResponse.tokensUsed);
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "What is AI?" }],
          modelType: AIModelType.CHAT,
          strictMode: true,
        }),
      );
    });

    it("should include context in system prompt when provided", async () => {
      const mockResponse = {
        content: "Answer with context",
        model: "gpt-4o",
        tokensUsed: 200,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      await controller.ask({
        question: "What did we discuss?",
        context: [
          { role: "user", content: "Tell me about AI" },
          { role: "assistant", content: "AI is..." },
        ],
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Conversation history"),
        }),
      );
    });

    it("should use medium creativity and output length", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "Answer",
        model: "gpt-4o",
        tokensUsed: 100,
      } as any);

      await controller.ask({ question: "Test?" });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "medium", outputLength: "medium" },
        }),
      );
    });
  });

  // ==================== Chat ====================

  describe("chat", () => {
    it("should process multi-turn conversation", async () => {
      const mockResponse = {
        content: "Chat response content",
        model: "gpt-4o",
        tokensUsed: 250,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.chat({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "How are you?" },
        ],
      });

      expect(result.content).toBe(mockResponse.content);
      expect(result.model).toBe(mockResponse.model);
      expect(result.tokensUsed).toBe(mockResponse.tokensUsed);
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Hello" }),
          ]),
          modelType: AIModelType.CHAT,
          strictMode: true,
        }),
      );
    });

    it("should handle streaming flag (not yet implemented)", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "Response",
        model: "gpt-4o",
        tokensUsed: 100,
      } as any);

      const result = await controller.chat({
        messages: [{ role: "user", content: "Test" }],
        stream: true,
      });

      expect(result).toBeDefined();
    });
  });

  // ==================== Writing ====================

  describe("writingAssist", () => {
    const testContent = "This is the original text that needs assistance.";

    it("should improve content by default", async () => {
      const mockResponse = {
        content: JSON.stringify({
          improved: "This is the improved text.",
          changes: ["Enhanced clarity"],
          summary: "Improved overall quality",
        }),
        model: "gpt-4o",
        tokensUsed: 300,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.writingAssist({
        content: testContent,
      });

      expect(result.task).toBe("improve");
      expect(result.result).toHaveProperty("improved");
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("expert editor"),
        }),
      );
    });

    it("should expand content when assistType is expand", async () => {
      const mockResponse = {
        content: JSON.stringify({
          expanded: "This is the expanded text with more details...",
          addedElements: ["Additional examples", "More context"],
        }),
        model: "gpt-4o",
        tokensUsed: 400,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.writingAssist({
        content: testContent,
        assistType: "expand",
      });

      expect(result.task).toBe("expand");
      expect(result.result).toHaveProperty("expanded");
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("expert writer"),
        }),
      );
    });

    it("should summarize content when assistType is summarize", async () => {
      const mockResponse = {
        content: JSON.stringify({
          summary: "Brief summary of the content.",
          keyPoints: ["Point 1", "Point 2"],
        }),
        model: "gpt-4o",
        tokensUsed: 200,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.writingAssist({
        content: testContent,
        assistType: "summarize",
      });

      expect(result.task).toBe("summarize");
      expect(result.result).toHaveProperty("summary");
    });

    it("should rewrite content when assistType is rewrite", async () => {
      const mockResponse = {
        content: JSON.stringify({
          rewritten: "Completely rewritten text.",
          approach: "Fresh perspective",
        }),
        model: "gpt-4o",
        tokensUsed: 350,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.writingAssist({
        content: testContent,
        assistType: "rewrite",
      });

      expect(result.task).toBe("rewrite");
      expect(result.result).toHaveProperty("rewritten");
    });

    it("should proofread content when assistType is proofread", async () => {
      const mockResponse = {
        content: JSON.stringify({
          corrected: "Corrected text.",
          issues: [
            { type: "spelling", description: "Fixed typo" },
            { type: "grammar", description: "Corrected grammar" },
          ],
        }),
        model: "gpt-4o",
        tokensUsed: 250,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.writingAssist({
        content: testContent,
        assistType: "proofread",
      });

      expect(result.task).toBe("proofread");
      expect(result.result).toHaveProperty("corrected");
      expect(result.result).toHaveProperty("issues");
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "deterministic", outputLength: "long" },
        }),
      );
    });

    it("should include tone in system prompt when provided", async () => {
      aiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ improved: "Improved text" }),
        model: "gpt-4o",
        tokensUsed: 200,
      } as any);

      await controller.writingAssist({
        content: testContent,
        tone: "professional",
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("professional"),
        }),
      );
    });

    it("should include language in system prompt when provided", async () => {
      aiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ improved: "Improved text" }),
        model: "gpt-4o",
        tokensUsed: 200,
      } as any);

      await controller.writingAssist({
        content: testContent,
        language: "Spanish",
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Spanish"),
        }),
      );
    });

    it("should handle non-JSON response gracefully", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "This is not JSON",
        model: "gpt-4o",
        tokensUsed: 100,
      } as any);

      const result = await controller.writingAssist({
        content: testContent,
      });

      expect(result.result).toHaveProperty("rawOutput");
      expect((result.result as Record<string, unknown>).rawOutput).toBe(
        "This is not JSON",
      );
    });
  });

  // ==================== Content Analysis ====================

  describe("analyzeContent", () => {
    const testContent = "This is content to analyze.";

    it("should perform comprehensive analysis by default", async () => {
      const mockResponse = {
        content: JSON.stringify({
          summary: "Content summary",
          keyFindings: ["Finding 1", "Finding 2"],
          quality: "high",
        }),
        model: "gpt-4o",
        tokensUsed: 400,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.analyzeContent({
        content: testContent,
      });

      expect(result.analysisType).toBe("comprehensive");
      expect(result.result).toHaveProperty("summary");
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("comprehensive"),
          taskProfile: { creativity: "low", outputLength: "long" },
        }),
      );
    });

    it("should perform summary analysis when specified", async () => {
      const mockResponse = {
        content: JSON.stringify({
          summary: "Brief summary",
        }),
        model: "gpt-4o",
        tokensUsed: 200,
      };

      aiFacade.chat.mockResolvedValue(mockResponse as any);

      const result = await controller.analyzeContent({
        content: testContent,
        analysisType: "summary",
      });

      expect(result.analysisType).toBe("summary");
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("summary"),
        }),
      );
    });

    it("should wrap content in user_content tags for security", async () => {
      aiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ analysis: "done" }),
        model: "gpt-4o",
        tokensUsed: 150,
      } as any);

      await controller.analyzeContent({
        content: testContent,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining("<user_content>"),
            }),
          ],
        }),
      );
    });

    it("should handle non-JSON response gracefully", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "Plain text analysis",
        model: "gpt-4o",
        tokensUsed: 100,
      } as any);

      const result = await controller.analyzeContent({
        content: testContent,
      });

      expect(result.result).toHaveProperty("rawAnalysis");
      expect((result.result as Record<string, unknown>).rawAnalysis).toBe(
        "Plain text analysis",
      );
    });
  });

  // ==================== Research ====================

  describe("startResearch", () => {
    it("should execute research and return formatted result", async () => {
      const mockResearchResult = {
        report: {
          executiveSummary: "This is the executive summary.",
          sections: [
            {
              title: "Introduction",
              content: "Introduction content",
            },
          ],
          conclusion: "Final conclusion",
          references: ["ref1", "ref2"],
          metadata: { date: "2024-01-01" },
        },
        searchRounds: [
          { sources: ["source1", "source2"] },
          { sources: ["source3"] },
        ],
        duration: 15000,
      };

      aiFacade.executeDirectResearch.mockResolvedValue(
        mockResearchResult as any,
      );

      const result = await controller.startResearch({
        query: "What is quantum computing?",
      });

      expect(result.report.executiveSummary).toBe(
        "This is the executive summary.",
      );
      expect(result.searchRounds).toBe(2);
      expect(result.totalSources).toBe(3);
      expect(result.duration).toBe(15000);
      expect(aiFacade.executeDirectResearch).toHaveBeenCalledWith({
        query: "What is quantum computing?",
        depth: "standard",
        language: "en",
        dimensions: undefined,
      });
    });

    it("should respect custom depth and language", async () => {
      aiFacade.executeDirectResearch.mockResolvedValue({
        report: {
          executiveSummary: "Summary",
          sections: [],
          conclusion: "Done",
          references: [],
          metadata: {},
        },
        searchRounds: [],
        duration: 10000,
      } as any);

      await controller.startResearch({
        query: "Test query",
        depth: "deep",
        language: "es",
      });

      expect(aiFacade.executeDirectResearch).toHaveBeenCalledWith({
        query: "Test query",
        depth: "deep",
        language: "es",
        dimensions: undefined,
      });
    });
  });

  describe("getResearchStatus", () => {
    it("should throw NotImplementedException", async () => {
      await expect(controller.getResearchStatus("test-id")).rejects.toThrow(
        NotImplementedException,
      );
    });

    it("should provide helpful error message", async () => {
      await expect(controller.getResearchStatus("test-id")).rejects.toThrow(
        "Async research status tracking is not yet implemented",
      );
    });
  });

  // ==================== Debate ====================

  describe("startDebate", () => {
    it("should execute multi-round debate and return judgment", async () => {
      const mockDebateResponses = [
        { content: "Pro argument round 1" },
        { content: "Con argument round 1" },
        { content: "Pro argument round 2" },
        { content: "Con argument round 2" },
        {
          content: JSON.stringify({
            winner: "pro",
            confidence: "high",
            conclusion: "Pro side had stronger arguments",
          }),
        },
      ];

      let callCount = 0;
      aiFacade.chat.mockImplementation(async () => {
        return mockDebateResponses[callCount++] as any;
      });

      const result = await controller.startDebate({
        topic: "AI will benefit humanity",
        rounds: 2,
      });

      expect(result.topic).toBe("AI will benefit humanity");
      expect(result.rounds).toHaveLength(2);
      expect(result.rounds[0]).toHaveProperty("proArgument");
      expect(result.rounds[0]).toHaveProperty("conArgument");
      expect(result.judgment).toHaveProperty("winner");
      expect(aiFacade.chat).toHaveBeenCalledTimes(5);
    });

    it("should limit rounds between 1 and 5", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "Argument",
      } as any);

      await controller.startDebate({
        topic: "Test topic",
        rounds: 10,
      });

      const chatCalls = aiFacade.chat.mock.calls.length;
      const expectedRounds = 5;
      expect(chatCalls).toBe(expectedRounds * 2 + 1);
    });

    it("should handle non-JSON judgment response", async () => {
      aiFacade.chat
        .mockResolvedValueOnce({ content: "Pro arg 1" } as any)
        .mockResolvedValueOnce({ content: "Con arg 1" } as any)
        .mockResolvedValueOnce({
          content: "Plain text judgment",
        } as any);

      const result = await controller.startDebate({
        topic: "Test",
        rounds: 1,
      });

      expect(result.judgment).toHaveProperty("winner", "draw");
      expect(result.judgment).toHaveProperty("confidence", "low");
      expect((result.judgment as Record<string, unknown>).conclusion).toBe(
        "Plain text judgment",
      );
    });

    it("should include language in debate prompts when provided", async () => {
      aiFacade.chat
        .mockResolvedValueOnce({ content: "Pro" } as any)
        .mockResolvedValueOnce({ content: "Con" } as any)
        .mockResolvedValueOnce({
          content: JSON.stringify({ winner: "draw" }),
        } as any);

      await controller.startDebate({
        topic: "Test topic",
        rounds: 1,
        language: "Spanish",
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Spanish"),
        }),
      );
    });
  });

  // ==================== Error Handling ====================

  describe("Error Handling", () => {
    it("should propagate errors from AIFacade.chat", async () => {
      aiFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      await expect(
        controller.ask({
          question: "Test?",
        }),
      ).rejects.toThrow("AI service unavailable");
    });

    it("should propagate errors from research agent", async () => {
      aiFacade.executeDirectResearch.mockRejectedValue(
        new Error("Research failed"),
      );

      await expect(
        controller.startResearch({
          query: "Test query",
        }),
      ).rejects.toThrow("Research failed");
    });

    it("should propagate errors from facade.getAvailableTools", async () => {
      aiFacade.getAvailableTools.mockImplementation(() => {
        throw new Error("Tool registry error");
      });

      await expect(controller.discoverTools()).rejects.toThrow(
        "Tool registry error",
      );
    });

    it("should propagate errors from facade.getAvailableModels", async () => {
      aiFacade.getAvailableModels.mockRejectedValue(
        new Error("Model fetch error"),
      );

      await expect(controller.discoverModels()).rejects.toThrow(
        "Model fetch error",
      );
    });
  });
});
