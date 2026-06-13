/**
 * Unit tests for MCPToolAdapter, MCPToolRegistrar, and utility functions
 */

import {
  MCPToolAdapter,
  MCPToolRegistrar,
  extractTextFromMCPResult,
  extractImagesFromMCPResult,
} from "../mcp-tool-adapter";
import type { MCPTool, MCPToolResult } from "../../abstractions/mcp.interface";
import { MCPManager } from "../../manager/mcp-manager";

// ----- helpers -----

function makeMCPTool(overrides?: Partial<MCPTool>): MCPTool {
  return {
    name: "search",
    description: "Search the web for information",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    ...overrides,
  };
}

function makeMockMCPManager() {
  return {
    callTool: jest.fn(),
    getAllToolsFlat: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<MCPManager>;
}

function makeToolResult(text: string, isError = false): MCPToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

function makeToolContext() {
  return {
    executionId: "exec-001",
    agentId: "agent-1",
    sessionId: "session-1",
    startTime: new Date(),
    timeout: 30000,
  };
}

// ----- MCPToolAdapter tests -----

describe("MCPToolAdapter", () => {
  let mockManager: jest.Mocked<MCPManager>;
  let adapter: MCPToolAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManager = makeMockMCPManager();
    adapter = new MCPToolAdapter(makeMCPTool(), "server-1", mockManager);
  });

  // ── construction ──────────────────────────────────────────────────────────

  describe("construction", () => {
    it("should build the composite id as mcp:{serverId}:{toolName}", () => {
      expect(adapter.id).toBe("mcp:server-1:search");
    });

    it("should expose the tool name", () => {
      expect(adapter.name).toBe("search");
    });

    it("should expose the tool description", () => {
      expect(adapter.description).toBe("Search the web for information");
    });

    it("should have category 'mcp'", () => {
      expect(adapter.category).toBe("mcp");
    });

    it("should include serverId and 'mcp' in tags", () => {
      expect(adapter.tags).toContain("mcp");
      expect(adapter.tags).toContain("server-1");
    });

    it("should expose the input schema from the MCPTool", () => {
      expect(adapter.inputSchema).toMatchObject({ type: "object" });
    });
  });

  // ── execute ───────────────────────────────────────────────────────────────

  describe("execute", () => {
    it("should call MCPManager.callTool with the correct args", async () => {
      const result = makeToolResult("search result");
      mockManager.callTool.mockResolvedValue(result);

      await adapter.execute({ query: "test" }, makeToolContext());

      expect(mockManager.callTool).toHaveBeenCalledWith("server-1", "search", {
        query: "test",
      });
    });

    it("should return success=true when isError is false", async () => {
      mockManager.callTool.mockResolvedValue(makeToolResult("ok", false));

      const result = await adapter.execute({ query: "x" }, makeToolContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should return success=false when isError is true", async () => {
      mockManager.callTool.mockResolvedValue(makeToolResult("error", true));

      const result = await adapter.execute({ query: "x" }, makeToolContext());

      expect(result.success).toBe(false);
    });

    it("should return success=false and error info when callTool throws", async () => {
      mockManager.callTool.mockRejectedValue(new Error("Network timeout"));

      const result = await adapter.execute({ query: "x" }, makeToolContext());

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: "MCP_TOOL_ERROR",
        message: "Network timeout",
      });
    });

    it("should populate metadata with executionId, startTime, endTime, duration", async () => {
      mockManager.callTool.mockResolvedValue(makeToolResult("ok"));

      const result = await adapter.execute({ query: "x" }, makeToolContext());

      expect(result.metadata).toMatchObject({
        executionId: "exec-001",
        startTime: expect.any(Date),
        endTime: expect.any(Date),
        duration: expect.any(Number),
      });
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ── toFunctionDefinition ──────────────────────────────────────────────────

  describe("toFunctionDefinition", () => {
    it("should return name, description, and parameters", () => {
      const def = adapter.toFunctionDefinition();

      expect(def).toMatchObject({
        name: "search",
        description: "Search the web for information",
        parameters: expect.objectContaining({ type: "object" }),
      });
    });
  });

  // ── toCompactSummary ──────────────────────────────────────────────────────

  describe("toCompactSummary", () => {
    it("should return id, name, brief, category, tags", () => {
      const summary = adapter.toCompactSummary();

      expect(summary).toMatchObject({
        id: "mcp:server-1:search",
        name: "search",
        brief: expect.any(String),
        category: "mcp",
        tags: expect.arrayContaining(["mcp", "server-1"]),
      });
    });

    it("should truncate description longer than 100 chars to 97+ellipsis", () => {
      const longDesc = "A".repeat(150);
      const longTool = makeMCPTool({ description: longDesc });
      const a = new MCPToolAdapter(longTool, "s1", mockManager);

      const summary = a.toCompactSummary();

      expect(summary.brief).toHaveLength(100);
      expect(summary.brief.endsWith("...")).toBe(true);
    });

    it("should not truncate descriptions shorter than or equal to 100 chars", () => {
      const shortTool = makeMCPTool({ description: "Short description" });
      const a = new MCPToolAdapter(shortTool, "s1", mockManager);

      const summary = a.toCompactSummary();

      expect(summary.brief).toBe("Short description");
    });
  });
});

// ----- MCPToolRegistrar tests -----

describe("MCPToolRegistrar", () => {
  let mockManager: jest.Mocked<MCPManager>;
  let registrar: MCPToolRegistrar;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManager = makeMockMCPManager();
    registrar = new MCPToolRegistrar(mockManager);
  });

  describe("syncTools", () => {
    it("should return adapters for all tools from all connected servers", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "tool-a" }) },
        { serverId: "s2", tool: makeMCPTool({ name: "tool-b" }) },
      ]);

      const adapters = await registrar.syncTools();

      expect(adapters).toHaveLength(2);
      expect(adapters.map((a) => a.name)).toEqual(
        expect.arrayContaining(["tool-a", "tool-b"]),
      );
    });

    it("should not register the same tool twice on subsequent syncs", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "tool-a" }) },
      ]);

      await registrar.syncTools();
      const secondSync = await registrar.syncTools();

      expect(secondSync).toHaveLength(0); // already registered
      expect(registrar.getRegisteredTools()).toHaveLength(1);
    });

    it("should return empty array when no tools are available", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([]);

      const adapters = await registrar.syncTools();

      expect(adapters).toEqual([]);
    });
  });

  describe("getRegisteredTools", () => {
    it("should return all registered tools", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "tool-x" }) },
      ]);
      await registrar.syncTools();

      expect(registrar.getRegisteredTools()).toHaveLength(1);
    });
  });

  describe("getToolsByServer", () => {
    it("should filter tools by server prefix", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "a" }) },
        { serverId: "s1", tool: makeMCPTool({ name: "b" }) },
        { serverId: "s2", tool: makeMCPTool({ name: "c" }) },
      ]);
      await registrar.syncTools();

      const s1Tools = registrar.getToolsByServer("s1");
      expect(s1Tools).toHaveLength(2);
      expect(s1Tools.every((t) => t.id.startsWith("mcp:s1:"))).toBe(true);
    });
  });

  describe("clearServer", () => {
    it("should remove all tools for the given server and return the count", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "t1" }) },
        { serverId: "s1", tool: makeMCPTool({ name: "t2" }) },
        { serverId: "s2", tool: makeMCPTool({ name: "t3" }) },
      ]);
      await registrar.syncTools();

      const removed = registrar.clearServer("s1");

      expect(removed).toBe(2);
      expect(registrar.getRegisteredTools()).toHaveLength(1);
      expect(registrar.getRegisteredTools()[0].id).toBe("mcp:s2:t3");
    });

    it("should return 0 when no tools are registered for the server", () => {
      expect(registrar.clearServer("non-existent")).toBe(0);
    });
  });

  describe("clearAll", () => {
    it("should remove all registered tools", async () => {
      mockManager.getAllToolsFlat.mockResolvedValue([
        { serverId: "s1", tool: makeMCPTool({ name: "t1" }) },
        { serverId: "s2", tool: makeMCPTool({ name: "t2" }) },
      ]);
      await registrar.syncTools();

      registrar.clearAll();

      expect(registrar.getRegisteredTools()).toHaveLength(0);
    });
  });
});

// ----- utility function tests -----

describe("extractTextFromMCPResult", () => {
  it("should extract and join all text content items", () => {
    const result: MCPToolResult = {
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    };

    expect(extractTextFromMCPResult(result)).toBe("Hello\nWorld");
  });

  it("should ignore non-text content", () => {
    const result: MCPToolResult = {
      content: [
        { type: "image", data: "base64data", mimeType: "image/png" },
        { type: "text", text: "Only text" },
      ],
    };

    expect(extractTextFromMCPResult(result)).toBe("Only text");
  });

  it("should return empty string when there is no text content", () => {
    const result: MCPToolResult = {
      content: [{ type: "image", data: "data", mimeType: "image/png" }],
    };

    expect(extractTextFromMCPResult(result)).toBe("");
  });

  it("should return empty string for empty content array", () => {
    expect(extractTextFromMCPResult({ content: [] })).toBe("");
  });

  it("should skip text entries with undefined text", () => {
    const result: MCPToolResult = {
      content: [
        { type: "text" }, // text is undefined
        { type: "text", text: "Valid" },
      ],
    };

    expect(extractTextFromMCPResult(result)).toBe("Valid");
  });
});

describe("extractImagesFromMCPResult", () => {
  it("should extract image content items with data and mimeType", () => {
    const result: MCPToolResult = {
      content: [
        { type: "image", data: "base64abc", mimeType: "image/png" },
        { type: "image", data: "base64def", mimeType: "image/jpeg" },
      ],
    };

    const images = extractImagesFromMCPResult(result);
    expect(images).toHaveLength(2);
    expect(images[0]).toEqual({ data: "base64abc", mimeType: "image/png" });
    expect(images[1]).toEqual({ data: "base64def", mimeType: "image/jpeg" });
  });

  it("should ignore non-image content", () => {
    const result: MCPToolResult = {
      content: [
        { type: "text", text: "text item" },
        { type: "image", data: "img", mimeType: "image/png" },
      ],
    };

    const images = extractImagesFromMCPResult(result);
    expect(images).toHaveLength(1);
  });

  it("should ignore image entries without data or mimeType", () => {
    const result: MCPToolResult = {
      content: [
        { type: "image" }, // no data or mimeType
        { type: "image", data: "d" }, // no mimeType
        { type: "image", mimeType: "image/png" }, // no data
      ],
    };

    expect(extractImagesFromMCPResult(result)).toHaveLength(0);
  });

  it("should return empty array for empty content", () => {
    expect(extractImagesFromMCPResult({ content: [] })).toEqual([]);
  });
});
