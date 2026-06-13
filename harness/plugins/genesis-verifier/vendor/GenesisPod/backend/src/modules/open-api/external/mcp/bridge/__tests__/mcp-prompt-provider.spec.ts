/**
 * Unit tests for MCPPromptProvider
 */

jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      name: "GenesisPod",
      fullName: "GenesisPod AI",
    },
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { MCPPromptProvider } from "../mcp-prompt-provider";

describe("MCPPromptProvider", () => {
  let provider: MCPPromptProvider;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MCPPromptProvider],
    }).compile();

    provider = module.get<MCPPromptProvider>(MCPPromptProvider);
  });

  describe("listPrompts", () => {
    it("should return an array of prompts", async () => {
      const prompts = await provider.listPrompts();
      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBeGreaterThan(0);
    });

    it("should include deep-research prompt", async () => {
      const prompts = await provider.listPrompts();
      const deepResearch = prompts.find((p) => p.name === "deep-research");
      expect(deepResearch).toBeDefined();
      expect(deepResearch?.description).toBeDefined();
    });

    it("should include content-analysis prompt", async () => {
      const prompts = await provider.listPrompts();
      const contentAnalysis = prompts.find(
        (p) => p.name === "content-analysis",
      );
      expect(contentAnalysis).toBeDefined();
    });

    it("should include team-debate prompt", async () => {
      const prompts = await provider.listPrompts();
      const teamDebate = prompts.find((p) => p.name === "team-debate");
      expect(teamDebate).toBeDefined();
    });

    it("should include writing-assist prompt", async () => {
      const prompts = await provider.listPrompts();
      const writingAssist = prompts.find((p) => p.name === "writing-assist");
      expect(writingAssist).toBeDefined();
    });

    it("should include discover-capabilities prompt", async () => {
      const prompts = await provider.listPrompts();
      const discover = prompts.find((p) => p.name === "discover-capabilities");
      expect(discover).toBeDefined();
    });

    it("should return 5 built-in prompts", async () => {
      const prompts = await provider.listPrompts();
      expect(prompts).toHaveLength(5);
    });

    it("should have name and description for each prompt", async () => {
      const prompts = await provider.listPrompts();
      for (const prompt of prompts) {
        expect(typeof prompt.name).toBe("string");
        expect(prompt.name.length).toBeGreaterThan(0);
        expect(typeof prompt.description).toBe("string");
      }
    });

    it("should include argument definitions for prompts", async () => {
      const prompts = await provider.listPrompts();
      for (const prompt of prompts) {
        expect(Array.isArray(prompt.arguments)).toBe(true);
      }
    });
  });

  describe("getPrompt - deep-research", () => {
    it("should return messages for deep-research with required topic", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "Quantum computing advances",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content.type).toBe("text");
      expect(messages[0].content.text).toContain("Quantum computing advances");
    });

    it("should use standard depth by default", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "AI trends",
      });

      expect(messages[0].content.text).toContain("standard");
    });

    it("should use provided depth", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "AI trends",
        depth: "deep",
      });

      expect(messages[0].content.text).toContain("deep");
    });

    it("should use en language by default", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "AI",
      });

      expect(messages[0].content.text).toContain("en");
    });

    it("should use provided language", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "AI",
        language: "zh",
      });

      expect(messages[0].content.text).toContain("zh");
    });

    it("should reference genesis_deep_research tool", async () => {
      const messages = await provider.getPrompt("deep-research", {
        topic: "AI",
      });

      expect(messages[0].content.text).toContain("genesis_deep_research");
    });

    it("should throw when required topic is missing", async () => {
      await expect(provider.getPrompt("deep-research", {})).rejects.toThrow(
        "Missing required argument: topic",
      );
    });

    it("should throw when topic arg is not provided at all", async () => {
      await expect(provider.getPrompt("deep-research")).rejects.toThrow(
        "Missing required argument: topic",
      );
    });
  });

  describe("getPrompt - content-analysis", () => {
    it("should return messages with content embedded", async () => {
      const messages = await provider.getPrompt("content-analysis", {
        content: "Some article text here",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toContain("Some article text here");
    });

    it("should use comprehensive type by default", async () => {
      const messages = await provider.getPrompt("content-analysis", {
        content: "text",
      });

      expect(messages[0].content.text).toContain("comprehensive");
    });

    it("should use provided analysis type", async () => {
      const messages = await provider.getPrompt("content-analysis", {
        content: "text",
        type: "sentiment",
      });

      expect(messages[0].content.text).toContain("sentiment");
    });

    it("should reference genesis_content_analysis tool", async () => {
      const messages = await provider.getPrompt("content-analysis", {
        content: "text",
      });

      expect(messages[0].content.text).toContain("genesis_content_analysis");
    });

    it("should throw when required content is missing", async () => {
      await expect(provider.getPrompt("content-analysis", {})).rejects.toThrow(
        "Missing required argument: content",
      );
    });
  });

  describe("getPrompt - team-debate", () => {
    it("should return messages with topic embedded", async () => {
      const messages = await provider.getPrompt("team-debate", {
        topic: "AI will replace programmers",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toContain("AI will replace programmers");
    });

    it("should use 3 rounds by default", async () => {
      const messages = await provider.getPrompt("team-debate", {
        topic: "AI ethics",
      });

      expect(messages[0].content.text).toContain("3");
    });

    it("should use provided rounds value", async () => {
      const messages = await provider.getPrompt("team-debate", {
        topic: "AI ethics",
        rounds: "5",
      });

      expect(messages[0].content.text).toContain("5");
    });

    it("should reference genesis_team_debate tool", async () => {
      const messages = await provider.getPrompt("team-debate", {
        topic: "AI",
      });

      expect(messages[0].content.text).toContain("genesis_team_debate");
    });

    it("should throw when required topic is missing", async () => {
      await expect(provider.getPrompt("team-debate", {})).rejects.toThrow(
        "Missing required argument: topic",
      );
    });
  });

  describe("getPrompt - writing-assist", () => {
    it("should return messages with text embedded", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "My draft text",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toContain("My draft text");
    });

    it("should use improve task by default", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "draft",
      });

      expect(messages[0].content.text).toContain("improve");
    });

    it("should use provided task", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "draft",
        task: "summarize",
      });

      expect(messages[0].content.text).toContain("summarize");
    });

    it("should include style when provided", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "draft",
        style: "academic",
      });

      expect(messages[0].content.text).toContain("academic");
    });

    it("should not include style clause when style is not provided", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "draft",
      });

      expect(messages[0].content.text).not.toContain(" in a ");
    });

    it("should reference genesis_writing_assist tool", async () => {
      const messages = await provider.getPrompt("writing-assist", {
        text: "draft",
      });

      expect(messages[0].content.text).toContain("genesis_writing_assist");
    });

    it("should throw when required text is missing", async () => {
      await expect(provider.getPrompt("writing-assist", {})).rejects.toThrow(
        "Missing required argument: text",
      );
    });
  });

  describe("getPrompt - discover-capabilities", () => {
    it("should return messages for capability discovery", async () => {
      const messages = await provider.getPrompt("discover-capabilities", {});

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("should use genesis://capabilities URI by default", async () => {
      const messages = await provider.getPrompt("discover-capabilities", {});

      expect(messages[0].content.text).toContain("genesis://capabilities");
    });

    it("should use category-specific URI when category provided", async () => {
      const messages = await provider.getPrompt("discover-capabilities", {
        category: "tools",
      });

      expect(messages[0].content.text).toContain("genesis://tools");
    });

    it("should mention the filtered category in the message", async () => {
      const messages = await provider.getPrompt("discover-capabilities", {
        category: "agents",
      });

      expect(messages[0].content.text).toContain("agents");
    });

    it("should work without providing args", async () => {
      const messages = await provider.getPrompt("discover-capabilities");
      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toContain("genesis://capabilities");
    });
  });

  describe("getPrompt - error cases", () => {
    it("should throw for unknown prompt name", async () => {
      await expect(provider.getPrompt("non-existent-prompt")).rejects.toThrow(
        "Unknown prompt: non-existent-prompt",
      );
    });

    it("should throw for empty string prompt name", async () => {
      await expect(provider.getPrompt("")).rejects.toThrow("Unknown prompt: ");
    });
  });
});
