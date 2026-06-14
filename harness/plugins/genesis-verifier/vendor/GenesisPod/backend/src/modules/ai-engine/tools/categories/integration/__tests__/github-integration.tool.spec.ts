/**
 * GitHubIntegrationTool Unit Tests
 *
 * Tests the github-integration tool in isolation (no external dependencies).
 * This tool uses internal mock data (no real HTTP calls), so no mocking needed.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  GitHubIntegrationTool,
  GitHubIntegrationInput,
  GitHubIntegrationOutput,
} from "../github-integration.tool";
import { ToolContext, ToolResult } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-gh-int-001",
    toolId: "github-integration",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GitHubIntegrationTool", () => {
  let tool: GitHubIntegrationTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GitHubIntegrationTool],
    }).compile();

    tool = module.get<GitHubIntegrationTool>(GitHubIntegrationTool);
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'github-integration'", () => {
      expect(tool.id).toBe("github-integration");
    });

    it("should belong to the 'integration' category", () => {
      expect(tool.category).toBe("integration");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for GET_REPO with required fields", () => {
      expect(
        tool.validateInput({
          operation: "GET_REPO",
          owner: "torvalds",
          repo: "linux",
        }),
      ).toBe(true);
    });

    it("should return false when operation is missing", () => {
      expect(
        tool.validateInput({
          operation: undefined as unknown as "GET_REPO",
          owner: "owner",
          repo: "repo",
        }),
      ).toBe(false);
    });

    it("should return false when owner is missing", () => {
      expect(
        tool.validateInput({ operation: "GET_REPO", owner: "", repo: "repo" }),
      ).toBe(false);
    });

    it("should return false when repo is missing", () => {
      expect(
        tool.validateInput({ operation: "GET_REPO", owner: "owner", repo: "" }),
      ).toBe(false);
    });

    it("should return false for CREATE_ISSUE without title", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_ISSUE",
          owner: "owner",
          repo: "repo",
          data: {},
        }),
      ).toBe(false);
    });

    it("should return true for CREATE_ISSUE with title", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_ISSUE",
          owner: "owner",
          repo: "repo",
          data: { title: "Bug: something broken" },
        }),
      ).toBe(true);
    });

    it("should return false for CLOSE_ISSUE without issueNumber", () => {
      expect(
        tool.validateInput({
          operation: "CLOSE_ISSUE",
          owner: "o",
          repo: "r",
          data: {},
        }),
      ).toBe(false);
    });

    it("should return true for CLOSE_ISSUE with issueNumber", () => {
      expect(
        tool.validateInput({
          operation: "CLOSE_ISSUE",
          owner: "o",
          repo: "r",
          data: { issueNumber: 42 },
        }),
      ).toBe(true);
    });

    it("should return false for MERGE_PR without prNumber", () => {
      expect(
        tool.validateInput({
          operation: "MERGE_PR",
          owner: "o",
          repo: "r",
          data: {},
        }),
      ).toBe(false);
    });

    it("should return false for CREATE_COMMENT without issueNumber and commentBody", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_COMMENT",
          owner: "o",
          repo: "r",
          data: { issueNumber: 1 },
        }),
      ).toBe(false);
    });

    it("should return false for GET_FILE without path", () => {
      expect(
        tool.validateInput({
          operation: "GET_FILE",
          owner: "o",
          repo: "r",
          data: {},
        }),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path - various operations
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true for GET_REPO", async () => {
      const result: ToolResult<GitHubIntegrationOutput> = await tool.execute(
        { operation: "GET_REPO", owner: "torvalds", repo: "linux" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("GET_REPO");
      expect(result.data?.data?.fullName).toBe("torvalds/linux");
      expect(result.data?.data?.defaultBranch).toBe("main");
    });

    it("should return issue data for CREATE_ISSUE", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_ISSUE",
          owner: "owner",
          repo: "repo",
          data: { title: "New bug", body: "Description here" },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.state).toBe("open");
      expect(result.data?.data?.title).toBe("New bug");
      expect(result.data?.data?.number).toBeDefined();
    });

    it("should return PR data for CREATE_PR", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_PR",
          owner: "owner",
          repo: "repo",
          data: {
            title: "Feature: Add tests",
            headBranch: "feature/tests",
            baseBranch: "main",
          },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.state).toBe("open");
    });

    it("should return branches list for LIST_BRANCHES", async () => {
      const result = await tool.execute(
        { operation: "LIST_BRANCHES", owner: "owner", repo: "repo" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.branches).toBeDefined();
      expect(Array.isArray(result.data?.data?.branches)).toBe(true);
      expect(result.data?.data?.branches?.length).toBeGreaterThan(0);
    });

    it("should return commits list for LIST_COMMITS", async () => {
      const result = await tool.execute(
        { operation: "LIST_COMMITS", owner: "owner", repo: "repo" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.commits).toBeDefined();
      expect(result.data?.data?.commits?.length).toBeGreaterThan(0);
      expect(result.data?.data?.commits?.[0]).toHaveProperty("sha");
      expect(result.data?.data?.commits?.[0]).toHaveProperty("message");
    });

    it("should return file content for GET_FILE", async () => {
      const result = await tool.execute(
        {
          operation: "GET_FILE",
          owner: "owner",
          repo: "repo",
          data: { path: "README.md" },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.content).toBeDefined();
      expect(result.data?.data?.sha).toBeDefined();
    });

    it("should return closed state for CLOSE_ISSUE", async () => {
      const result = await tool.execute(
        {
          operation: "CLOSE_ISSUE",
          owner: "owner",
          repo: "repo",
          data: { issueNumber: 42 },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.state).toBe("closed");
    });

    it("should return merged state for MERGE_PR", async () => {
      const result = await tool.execute(
        {
          operation: "MERGE_PR",
          owner: "owner",
          repo: "repo",
          data: { prNumber: 7 },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.state).toBe("merged");
    });

    it("should return URL for CREATE_FILE", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_FILE",
          owner: "owner",
          repo: "repo",
          data: {
            path: "docs/new-file.md",
            content: "# New File",
            message: "Add new file",
          },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.sha).toBeDefined();
    });

    it("should return comment URL for CREATE_COMMENT", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_COMMENT",
          owner: "owner",
          repo: "repo",
          data: {
            issueNumber: 1,
            commentBody: "Thanks for the report!",
          },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.url).toContain("comments");
    });

    it("should include correct operation in output", async () => {
      const result = await tool.execute(
        { operation: "LIST_BRANCHES", owner: "owner", repo: "repo" },
        makeContext(),
      );

      expect(result.data?.operation).toBe("LIST_BRANCHES");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false in data for unsupported operation", async () => {
      const result = await tool.execute(
        {
          operation: "UNKNOWN_OP" as GitHubIntegrationInput["operation"],
          owner: "owner",
          repo: "repo",
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { operation: "GET_REPO", owner: "owner", repo: "repo" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
    });
  });
});
