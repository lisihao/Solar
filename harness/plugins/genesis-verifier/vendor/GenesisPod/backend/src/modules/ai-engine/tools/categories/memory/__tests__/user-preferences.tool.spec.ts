import {
  UserPreferencesTool,
  PreferenceOperation,
} from "../user-preferences.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helper factory
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "user-preferences",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("UserPreferencesTool", () => {
  let tool: UserPreferencesTool;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a fresh tool instance per test to reset the in-memory store
    tool = new UserPreferencesTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false when operation is missing", () => {
      expect(
        tool.validateInput({
          operation: undefined as unknown as PreferenceOperation,
          userId: "user-1",
        }),
      ).toBe(false);
    });

    it("should return false when userId is missing", () => {
      expect(tool.validateInput({ operation: "GET", userId: "" })).toBe(false);
    });

    it("should return false for GET without key", () => {
      expect(tool.validateInput({ operation: "GET", userId: "user-1" })).toBe(
        false,
      );
    });

    it("should return true for GET with key", () => {
      expect(
        tool.validateInput({
          operation: "GET",
          userId: "user-1",
          key: "theme",
        }),
      ).toBe(true);
    });

    it("should return false for SET without key", () => {
      expect(
        tool.validateInput({
          operation: "SET",
          userId: "user-1",
          value: "dark",
        }),
      ).toBe(false);
    });

    it("should return false for SET without value", () => {
      expect(
        tool.validateInput({
          operation: "SET",
          userId: "user-1",
          key: "theme",
        }),
      ).toBe(false);
    });

    it("should return true for SET with key and value", () => {
      expect(
        tool.validateInput({
          operation: "SET",
          userId: "user-1",
          key: "theme",
          value: "dark",
        }),
      ).toBe(true);
    });

    it("should return true for SET when value is explicitly false", () => {
      expect(
        tool.validateInput({
          operation: "SET",
          userId: "user-1",
          key: "notifications",
          value: false,
        }),
      ).toBe(true);
    });

    it("should return false for DELETE without key", () => {
      expect(
        tool.validateInput({ operation: "DELETE", userId: "user-1" }),
      ).toBe(false);
    });

    it("should return true for DELETE with key", () => {
      expect(
        tool.validateInput({
          operation: "DELETE",
          userId: "user-1",
          key: "theme",
        }),
      ).toBe(true);
    });

    it("should return true for LIST without any extra params", () => {
      expect(tool.validateInput({ operation: "LIST", userId: "user-1" })).toBe(
        true,
      );
    });

    it("should return true for RESET without any extra params", () => {
      expect(tool.validateInput({ operation: "RESET", userId: "user-1" })).toBe(
        true,
      );
    });

    it("should return false for MERGE without preferences object", () => {
      expect(tool.validateInput({ operation: "MERGE", userId: "user-1" })).toBe(
        false,
      );
    });

    it("should return true for MERGE with preferences object", () => {
      expect(
        tool.validateInput({
          operation: "MERGE",
          userId: "user-1",
          preferences: { theme: "dark" },
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // GET operation
  // --------------------------------------------------------------------------

  describe("GET operation", () => {
    it("should return undefined value for a key that has not been set", async () => {
      const result = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme" },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("GET");
      expect(result.data?.value).toBeUndefined();
    });

    it("should return the default value when key is not set and defaultValue is provided", async () => {
      const result = await tool.execute(
        {
          operation: "GET",
          userId: "user-1",
          key: "theme",
          defaultValue: "light",
        },
        createMockContext(),
      );

      expect(result.data?.value).toBe("light");
    });

    it("should return the stored value after it has been set", async () => {
      // SET first
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );

      // GET
      const result = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme" },
        createMockContext(),
      );

      expect(result.data?.value).toBe("dark");
    });

    it("should support dot-notation nested key retrieval", async () => {
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          key: "theme.mode",
          value: "dark",
        },
        createMockContext(),
      );

      const result = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme.mode" },
        createMockContext(),
      );

      expect(result.data?.value).toBe("dark");
    });

    it("should isolate preferences by namespace", async () => {
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          namespace: "ui",
          key: "theme",
          value: "dark",
        },
        createMockContext(),
      );

      const result = await tool.execute(
        {
          operation: "GET",
          userId: "user-1",
          namespace: "system",
          key: "theme",
        },
        createMockContext(),
      );

      expect(result.data?.value).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // SET operation
  // --------------------------------------------------------------------------

  describe("SET operation", () => {
    it("should set a preference and return the value with affectedKeys", async () => {
      const result = await tool.execute(
        { operation: "SET", userId: "user-1", key: "language", value: "en" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("SET");
      expect(result.data?.value).toBe("en");
      expect(result.data?.affectedKeys).toEqual(["language"]);
    });

    it("should overwrite an existing preference value", async () => {
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "light" },
        createMockContext(),
      );
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );

      const result = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme" },
        createMockContext(),
      );

      expect(result.data?.value).toBe("dark");
    });

    it("should set nested preferences using dot-notation key", async () => {
      const result = await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          key: "display.fontSize",
          value: 14,
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.value).toBe(14);
    });

    it("should isolate preferences per userId", async () => {
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );
      await tool.execute(
        { operation: "SET", userId: "user-2", key: "theme", value: "light" },
        createMockContext({ userId: "user-2" }),
      );

      const user1Result = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme" },
        createMockContext(),
      );
      const user2Result = await tool.execute(
        { operation: "GET", userId: "user-2", key: "theme" },
        createMockContext({ userId: "user-2" }),
      );

      expect(user1Result.data?.value).toBe("dark");
      expect(user2Result.data?.value).toBe("light");
    });
  });

  // --------------------------------------------------------------------------
  // DELETE operation
  // --------------------------------------------------------------------------

  describe("DELETE operation", () => {
    it("should delete a previously set preference", async () => {
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );

      const deleteResult = await tool.execute(
        { operation: "DELETE", userId: "user-1", key: "theme" },
        createMockContext(),
      );

      expect(deleteResult.data?.success).toBe(true);
      expect(deleteResult.data?.operation).toBe("DELETE");
      expect(deleteResult.data?.affectedKeys).toEqual(["theme"]);

      // Verify key is gone
      const getResult = await tool.execute(
        { operation: "GET", userId: "user-1", key: "theme" },
        createMockContext(),
      );
      expect(getResult.data?.value).toBeUndefined();
    });

    it("should succeed silently when deleting a non-existent key", async () => {
      const result = await tool.execute(
        { operation: "DELETE", userId: "user-1", key: "nonexistent" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // LIST operation
  // --------------------------------------------------------------------------

  describe("LIST operation", () => {
    it("should return empty preferences for a new user", async () => {
      const result = await tool.execute(
        { operation: "LIST", userId: "brand-new-user" },
        createMockContext({ userId: "brand-new-user" }),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("LIST");
      expect(result.data?.preferences).toEqual({});
    });

    it("should return all preferences set for a user", async () => {
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "language", value: "zh" },
        createMockContext(),
      );

      const result = await tool.execute(
        { operation: "LIST", userId: "user-1" },
        createMockContext(),
      );

      expect(result.data?.preferences?.theme).toBe("dark");
      expect(result.data?.preferences?.language).toBe("zh");
    });

    it("should list preferences for the given namespace only", async () => {
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          namespace: "ui",
          key: "theme",
          value: "dark",
        },
        createMockContext(),
      );
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          namespace: "system",
          key: "locale",
          value: "zh-CN",
        },
        createMockContext(),
      );

      const result = await tool.execute(
        { operation: "LIST", userId: "user-1", namespace: "ui" },
        createMockContext(),
      );

      expect(result.data?.preferences).toHaveProperty("theme");
      expect(result.data?.preferences).not.toHaveProperty("locale");
    });
  });

  // --------------------------------------------------------------------------
  // MERGE operation
  // --------------------------------------------------------------------------

  describe("MERGE operation", () => {
    it("should deep-merge preferences with existing ones", async () => {
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          key: "display",
          value: { fontSize: 12, theme: "light" },
        },
        createMockContext(),
      );

      const result = await tool.execute(
        {
          operation: "MERGE",
          userId: "user-1",
          preferences: { display: { fontSize: 16 }, language: "en" },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("MERGE");
      expect(result.data?.affectedKeys).toContain("display");
      expect(result.data?.affectedKeys).toContain("language");
    });

    it("should set preferences when merging into an empty store", async () => {
      const result = await tool.execute(
        {
          operation: "MERGE",
          userId: "new-user",
          preferences: { theme: "dark", language: "fr" },
        },
        createMockContext({ userId: "new-user" }),
      );

      expect(result.data?.preferences?.theme).toBe("dark");
      expect(result.data?.preferences?.language).toBe("fr");
    });
  });

  // --------------------------------------------------------------------------
  // RESET operation
  // --------------------------------------------------------------------------

  describe("RESET operation", () => {
    it("should delete all preferences for the user namespace", async () => {
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "theme", value: "dark" },
        createMockContext(),
      );
      await tool.execute(
        { operation: "SET", userId: "user-1", key: "language", value: "en" },
        createMockContext(),
      );

      const resetResult = await tool.execute(
        { operation: "RESET", userId: "user-1" },
        createMockContext(),
      );

      expect(resetResult.data?.success).toBe(true);
      expect(resetResult.data?.operation).toBe("RESET");

      // Verify store is empty
      const listResult = await tool.execute(
        { operation: "LIST", userId: "user-1" },
        createMockContext(),
      );
      expect(listResult.data?.preferences).toEqual({});
    });

    it("should succeed silently when resetting a user with no preferences", async () => {
      const result = await tool.execute(
        { operation: "RESET", userId: "user-with-no-prefs" },
        createMockContext({ userId: "user-with-no-prefs" }),
      );

      expect(result.data?.success).toBe(true);
    });

    it("should only reset the specified namespace, not other namespaces", async () => {
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          namespace: "ui",
          key: "theme",
          value: "dark",
        },
        createMockContext(),
      );
      await tool.execute(
        {
          operation: "SET",
          userId: "user-1",
          namespace: "system",
          key: "locale",
          value: "zh-CN",
        },
        createMockContext(),
      );

      await tool.execute(
        { operation: "RESET", userId: "user-1", namespace: "ui" },
        createMockContext(),
      );

      const uiResult = await tool.execute(
        { operation: "LIST", userId: "user-1", namespace: "ui" },
        createMockContext(),
      );
      const systemResult = await tool.execute(
        { operation: "LIST", userId: "user-1", namespace: "system" },
        createMockContext(),
      );

      expect(uiResult.data?.preferences).toEqual({});
      expect(systemResult.data?.preferences).toHaveProperty("locale");
    });
  });
});
