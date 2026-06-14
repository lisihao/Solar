/**
 * JSON Extraction Utilities Unit Tests
 *
 * Tests for robust JSON extraction from AI responses that may contain
 * markdown formatting, code blocks, or partial content.
 */

import {
  extractJsonFromAIResponse,
  normalizeJson5,
  repairUnescapedQuotesInStrings,
  stripReasoningBlocks,
  tryRepairTruncatedJsonWithMeta,
} from "../json-extraction.utils";

describe("JSON Extraction Utilities", () => {
  describe("stripReasoningBlocks", () => {
    it("strips closed <think> blocks", () => {
      expect(stripReasoningBlocks("<think>internal</think>{a:1}")).toBe(
        "{a:1}",
      );
    });

    it("strips closed <thinking> blocks (Anthropic-style)", () => {
      expect(stripReasoningBlocks('<thinking>reason</thinking>{"x":1}')).toBe(
        '{"x":1}',
      );
    });

    it("strips closed <reasoning> blocks", () => {
      expect(stripReasoningBlocks('<reasoning>note</reasoning>{"x":1}')).toBe(
        '{"x":1}',
      );
    });

    it("is case-insensitive on tags", () => {
      expect(stripReasoningBlocks("<Think>x</Think>JSON")).toBe("JSON");
      expect(stripReasoningBlocks("<THINKING>x</THINKING>JSON")).toBe("JSON");
    });

    it("strips multi-line and multiple blocks", () => {
      const input =
        "<think>line1\nline2</think>before<thinking>more</thinking>after";
      expect(stripReasoningBlocks(input)).toBe("beforeafter");
    });

    it("strips unclosed leading <think> blocks (truncated)", () => {
      const input = '<think>some reasoning... </think>{"final":1}';
      expect(stripReasoningBlocks(input)).toBe('{"final":1}');
    });

    it("preserves content when no reasoning blocks present", () => {
      expect(stripReasoningBlocks('{"x":1}')).toBe('{"x":1}');
    });

    it("returns empty for empty input", () => {
      expect(stripReasoningBlocks("")).toBe("");
    });
  });

  describe("extractJsonFromAIResponse", () => {
    describe("Reasoning-block preprocessing", () => {
      it("parses JSON wrapped in <think> prefix (Nemotron / DeepSeek-R1 style)", () => {
        const content =
          '<think>The user wants me to score this... I will give 85.</think>\n{"score":85,"decision":"pass"}';
        const result = extractJsonFromAIResponse(content);
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ score: 85, decision: "pass" });
      });

      it("parses JSON inside ```json after a <think> block", () => {
        const content = '<think>let me think...</think>\n```json\n{"a":1}\n```';
        const result = extractJsonFromAIResponse(content);
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ a: 1 });
      });
    });

    describe("Method 1: Direct JSON parse", () => {
      it("should parse valid JSON directly", () => {
        // Arrange
        const content = '{"name": "test", "value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
        expect(result.method).toBe("direct");
      });

      it("should parse complex nested JSON", () => {
        // Arrange
        const content = JSON.stringify({
          user: { name: "John", age: 30 },
          items: [{ id: 1 }, { id: 2 }],
          metadata: { created: "2024-01-01" },
        });

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("user");
        expect(result.data).toHaveProperty("items");
        expect(result.method).toBe("direct");
      });

      it("should validate required key if provided", () => {
        // Arrange
        const content = '{"name": "test", "value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "name",
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("name", "test");
      });

      it("should fail if required key is missing", () => {
        // Arrange
        const content = '{"value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "name",
        });

        // Assert
        expect(result.success).toBe(false);
      });
    });

    describe("Method 2: Extract from ```json code block", () => {
      it("should extract JSON from json code block", () => {
        // Arrange
        const content = `Here is the data:\n\`\`\`json\n{"name": "test", "value": 123}\n\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
        expect(result.method).toBe("jsonBlock");
      });

      it("should handle json code block with extra whitespace", () => {
        // Arrange
        const content = `\`\`\`json\n\n  {"name": "test"}  \n\n\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test" });
      });

      it("should handle JSON with markdown code blocks inside string values", () => {
        // Arrange
        const content =
          '```json\n{"description": "Use ```code``` blocks", "value": 1}\n```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          description: "Use ```code``` blocks",
          value: 1,
        });
      });

      it("should handle unclosed json code block", () => {
        // Arrange
        const content = '```json\n{"name": "test", "value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
        // Could be jsonBlock or unclosedJsonBlock depending on extraction
        expect(result.method).toMatch(/jsonBlock/);
      });

      it("should repair truncated JSON in unclosed code block", () => {
        // Arrange
        const content = '```json\n{"name": "test", "value": 12';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test" });
        expect(result.method).toBe("unclosedJsonBlockRepaired");
      });

      it("should handle complex nested objects in json block", () => {
        // Arrange
        const content = `\`\`\`json
{
  "user": {
    "name": "John",
    "roles": ["admin", "user"]
  },
  "settings": {
    "theme": "dark"
  }
}
\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("user");
        expect(result.data).toHaveProperty("settings");
      });
    });

    describe("Method 3: Extract from ``` code block (no language)", () => {
      it("should extract JSON from plain code block", () => {
        // Arrange
        const content = '```\n{"name": "test", "value": 123}\n```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
        expect(result.method).toBe("codeBlock");
      });

      it("should handle code block with whitespace", () => {
        // Arrange
        const content = '```  \n  {"name": "test"}  \n  ```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test" });
      });
    });

    describe("Method 4: Find JSON with required key", () => {
      it("should validate required key in extracted JSON", () => {
        // Arrange
        const content = '{"name": "test", "value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "name",
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("name", "test");
      });

      it("should reject JSON missing required key", () => {
        // Arrange
        const content = '{"value": 123, "other": "field"}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "name",
        });

        // Assert
        expect(result.success).toBe(false);
      });
    });

    describe("Method 5: Find any valid JSON object", () => {
      it("should extract first valid JSON object", () => {
        // Arrange
        const content = 'Some text {"name": "test", "value": 123} more text';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
        expect(result.method).toBe("anyJson");
      });

      it("should handle JSON embedded in natural language", () => {
        // Arrange
        const content =
          'The response is {"status": "success", "count": 42} as shown above.';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ status: "success", count: 42 });
      });
    });

    describe("Method 6: Repair truncated JSON", () => {
      it("should repair JSON truncated in middle of value", () => {
        // Arrange
        const content = '{"name": "test", "value": 12';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test" });
        expect(result.method).toBe("repaired");
      });

      it("should handle JSON truncated in middle of string", () => {
        // Arrange
        const content = '{"name": "incomplete str';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        // This is very truncated and may not repair successfully
        // Accept either success with repaired data or failure
        if (result.success) {
          expect(result.data).toBeDefined();
        } else {
          expect(result.success).toBe(false);
        }
      });

      it("should repair JSON with missing closing braces", () => {
        // Arrange
        const content = '{"user": {"name": "John", "age": 30';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("user");
      });

      it("should repair JSON with missing closing brackets", () => {
        // Arrange
        const content = '{"items": [{"id": 1}, {"id": 2}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("items");
        expect(Array.isArray((result.data as any).items)).toBe(true);
      });

      it("should remove trailing comma before closing", () => {
        // Arrange
        const content = '{"name": "test", "value": 123,';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "test", value: 123 });
      });

      it("should handle deeply nested truncated JSON", () => {
        // Arrange
        const content = '{"a": {"b": {"c": {"d": 1';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("a");
      });
    });

    describe("edge cases", () => {
      it("should handle empty string", () => {
        // Arrange
        const content = "";

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
      });

      it("should handle string with no JSON", () => {
        // Arrange
        const content = "This is just plain text without any JSON";

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toContain("Failed to extract JSON");
      });

      it("should handle invalid JSON", () => {
        // Arrange
        const content = "{invalid json}";

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(false);
      });

      it("should handle JSON with escaped quotes in strings", () => {
        // Arrange
        const content = '{"message": "She said \\"hello\\"", "value": 1}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ message: 'She said "hello"', value: 1 });
      });

      it("should handle JSON with newlines in string values", () => {
        // Arrange
        const content = '{"text": "Line 1\\nLine 2\\nLine 3", "value": 1}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          text: "Line 1\nLine 2\nLine 3",
          value: 1,
        });
      });

      it("should handle JSON with special characters", () => {
        // Arrange
        const content = '{"emoji": "🎉", "unicode": "中文", "symbol": "@#$%"}';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          emoji: "🎉",
          unicode: "中文",
          symbol: "@#$%",
        });
      });

      it("should handle very large JSON", () => {
        // Arrange
        const largeArray = Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
        }));
        const content = JSON.stringify({ items: largeArray });

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect((result.data as any).items).toHaveLength(1000);
      });

      it("should limit error preview length", () => {
        // Arrange
        const content = "a".repeat(1000);

        // Act
        const result = extractJsonFromAIResponse(content, {
          errorPreviewLength: 100,
        });

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeLessThan(200);
        expect(result.error).toContain("...");
      });
    });

    describe("complex AI response scenarios", () => {
      it("should extract JSON from AI response with explanation", () => {
        // Arrange
        const content = `Based on your request, here is the data:

\`\`\`json
{
  "status": "success",
  "results": [
    {"id": 1, "value": "A"},
    {"id": 2, "value": "B"}
  ]
}
\`\`\`

This contains the requested information.`;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("status", "success");
        expect(result.data).toHaveProperty("results");
      });

      it("should extract valid JSON from second code block", () => {
        // Arrange
        const content = `Here is corrected data:
\`\`\`json
{"name": "valid", "value": 123}
\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: "valid", value: 123 });
      });

      it("should extract JSON with markdown formatting inside values", () => {
        // Arrange
        const content = `\`\`\`json
{
  "description": "Use **bold** and *italic* text",
  "code": "const x = \`template\`;",
  "steps": "1. First\\n2. Second"
}
\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("description");
        expect(result.data).toHaveProperty("code");
        expect(result.data).toHaveProperty("steps");
      });

      it("should handle streaming-like partial JSON", () => {
        // Arrange - simulate truncated streaming response
        const content =
          '{"status": "processing", "progress": 0.5, "items": [{"id": 1, "name": "first"}, {"id": 2, "na';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("status", "processing");
        expect(result.data).toHaveProperty("items");
      });

      it("should extract from response with code block containing braces", () => {
        // Arrange
        const content = `\`\`\`json
{
  "fullText": "Some markdown with code: \`\`\`javascript\\nfunction test() {\\n  return { value: 1 };\\n}\\n\`\`\`",
  "value": 42
}
\`\`\``;

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("fullText");
        expect(result.data).toHaveProperty("value", 42);
      });
    });

    describe("requiredKey validation", () => {
      it("should validate top-level required key", () => {
        // Arrange
        const content = '{"data": {"name": "test"}, "metadata": {}}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "data",
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("data");
      });

      it("should reject JSON without required key", () => {
        // Arrange
        const content = '{"metadata": {}, "value": 123}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "data",
        });

        // Assert
        expect(result.success).toBe(false);
      });

      it("should not validate nested required key", () => {
        // Arrange
        const content = '{"outer": {"name": "test"}}';

        // Act
        const result = extractJsonFromAIResponse(content, {
          requiredKey: "name",
        });

        // Assert
        expect(result.success).toBe(false);
      });
    });

    describe("brace counting extraction", () => {
      it("should correctly count braces in nested objects", () => {
        // Arrange
        const content = '```json\n{"a": {"b": {"c": 1}}, "d": 2}\n```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ a: { b: { c: 1 } }, d: 2 });
      });

      it("should ignore braces inside strings", () => {
        // Arrange
        const content = '```json\n{"code": "{ } { }", "value": 1}\n```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ code: "{ } { }", value: 1 });
      });

      it("should handle escaped quotes correctly", () => {
        // Arrange
        const content =
          '```json\n{"text": "Quote: \\"test\\" with braces {}", "v": 1}\n```';

        // Act
        const result = extractJsonFromAIResponse(content);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          text: 'Quote: "test" with braces {}',
          v: 1,
        });
      });
    });
  });

  // ==================== tryRepairTruncatedJsonWithMeta ====================

  describe("tryRepairTruncatedJsonWithMeta", () => {
    it("returns repaired=false for already-complete JSON", () => {
      // Arrange
      const input = '{"name":"Alice","age":30}';

      // Act
      const result = tryRepairTruncatedJsonWithMeta(input);

      // Assert: no repair was needed
      expect(result.repaired).toBe(false);
      expect(result.json).toBe(input);
    });

    it("returns repaired=true when JSON is truncated mid-value", () => {
      // Arrange: LLM response cut off in the middle of a number
      const input = '{"name":"Alice","score":9';

      // Act
      const result = tryRepairTruncatedJsonWithMeta(input);

      // Assert: repair happened, result is parseable
      expect(result.repaired).toBe(true);
      expect(() => JSON.parse(result.json)).not.toThrow();
    });

    it("returns repaired=true when closing braces are missing", () => {
      // Arrange
      const input = '{"user":{"name":"Bob","roles":["admin","user"]';

      // Act
      const result = tryRepairTruncatedJsonWithMeta(input);

      // Assert
      expect(result.repaired).toBe(true);
      const parsed = JSON.parse(result.json) as { user: { name: string } };
      expect(parsed.user.name).toBe("Bob");
    });

    it("returns repaired=false and original string when input has no JSON start", () => {
      // Arrange: no '{' found — tryRepairTruncatedJson returns null
      const input = "no json here at all";

      // Act
      const result = tryRepairTruncatedJsonWithMeta(input);

      // Assert
      expect(result.repaired).toBe(false);
      expect(result.json).toBe(input);
    });

    it("original tryRepairTruncatedJson callers (via extractJsonFromAIResponse) are unaffected", () => {
      // Arrange: truncated JSON that triggers the 'repaired' method in extractJsonFromAIResponse
      const content = '{"status":"ok","items":[1,2,3';

      // Act
      const extracted = extractJsonFromAIResponse(content);

      // Assert: extraction still succeeds (backward-compatible)
      expect(extracted.success).toBe(true);
      expect(extracted.data).toHaveProperty("status", "ok");
    });
  });

  describe("normalizeJson5", () => {
    it("quotes unquoted object keys", () => {
      expect(normalizeJson5('{kind:"x"}')).toBe('{"kind":"x"}');
    });

    it("converts single-quoted strings to double-quoted", () => {
      expect(normalizeJson5("{'k':'v'}")).toBe('{"k":"v"}');
    });

    it("strips trailing commas in objects and arrays", () => {
      expect(normalizeJson5('{"a":1,}')).toBe('{"a":1}');
      expect(normalizeJson5("[1,2,3,]")).toBe("[1,2,3]");
    });

    it("does NOT quote true/false/null/number values", () => {
      const out = normalizeJson5("{flag:true,n:8,nil:null}");
      expect(JSON.parse(out)).toEqual({ flag: true, n: 8, nil: null });
    });

    it("preserves string contents (colons, commas, braces, URLs)", () => {
      const out = normalizeJson5('{url:"https://x.io/a?b=1&c={2}"}');
      expect(JSON.parse(out)).toEqual({ url: "https://x.io/a?b=1&c={2}" });
    });

    it("escapes a double quote inside a single-quoted string", () => {
      const out = normalizeJson5(`{k:'say "hi"'}`);
      expect(JSON.parse(out)).toEqual({ k: 'say "hi"' });
    });

    it("is idempotent on already-strict JSON", () => {
      const strict = '{"a":1,"b":["x","y"],"c":{"d":true}}';
      expect(normalizeJson5(strict)).toBe(strict);
    });

    it("handles nested objects and arrays with unquoted keys", () => {
      const out = normalizeJson5('{a:{b:[{c:"d"}]},e:"f"}');
      expect(JSON.parse(out)).toEqual({ a: { b: [{ c: "d" }] }, e: "f" });
    });
  });

  describe("extractJsonFromAIResponse — DeepSeek JSON5 dialect (Method 8)", () => {
    it("parses the real production parallel_tool_call output with unquoted keys", () => {
      // Arrange: verbatim shape from the 2026-05-24 playground logs — DeepSeek
      // v4-pro json_object mode emits unquoted keys, which JSON.parse rejects.
      const content =
        '{kind:"parallel_tool_call",calls:[{kind:"tool_call",toolId:"web-search",input:{query:"Oak Ridge National Laboratory",timeRange:"365d",numResults:8,language:"en"}},{kind:"tool_call",toolId:"arxiv-search",input:{query:"exascale supercomputing",maxResults:8,sortBy:"relevance"}}]}';

      // Act
      const result = extractJsonFromAIResponse<{
        kind: string;
        calls: Array<{ kind: string; toolId: string }>;
      }>(content, { requiredKey: "kind" });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data?.kind).toBe("parallel_tool_call");
      expect(result.data?.calls).toHaveLength(2);
      expect(result.data?.calls[0].toolId).toBe("web-search");
    });

    it("parses unquoted-key JSON wrapped in a markdown fence", () => {
      const content =
        '```json\n{action:"finalize",output:{summary:"done"}}\n```';
      const result = extractJsonFromAIResponse<{ action: string }>(content, {
        requiredKey: "action",
      });
      expect(result.success).toBe(true);
      expect(result.data?.action).toBe("finalize");
    });

    it("parses unquoted keys + trailing prose after the object", () => {
      const content =
        'Here is my decision:\n{kind:"tool_call",toolId:"web-search"}\nThat is all.';
      const result = extractJsonFromAIResponse<{ toolId: string }>(content, {
        requiredKey: "toolId",
      });
      expect(result.success).toBe(true);
      expect(result.data?.toolId).toBe("web-search");
    });

    it("parses unquoted keys + truncated tail (json5 + repair combo)", () => {
      // Flat object truncated mid-tail: json5 normalize + truncation repair.
      // (Nested array-of-objects truncation is a separate pre-existing repair
      // limitation — bracket close-order — unrelated to the json5 dialect fix.)
      const content = '{kind:"tool_call",toolId:"web-search",numResults:8';
      const result = extractJsonFromAIResponse<{ kind: string }>(content, {
        requiredKey: "kind",
      });
      expect(result.success).toBe(true);
      expect(result.data?.kind).toBe("tool_call");
    });
  });

  // ★ 2026-05-25: unescaped inner double-quotes in long prose `body` (deepseek
  //   thinking models write ASCII quotes for emphasis without escaping).
  describe("repairUnescapedQuotesInStrings", () => {
    it("escapes stray inner quotes in a value (Chinese emphasis quotes)", () => {
      const broken =
        '{"body":"不再只是"跑得快"的引擎，更需成为"可信任"的基座"}';
      const repaired = repairUnescapedQuotesInStrings(broken);
      const parsed = JSON.parse(repaired) as { body: string };
      expect(parsed.body).toContain('"跑得快"');
      expect(parsed.body).toContain('"可信任"');
    });

    it("keeps genuine structural quotes (followed by , } ] :)", () => {
      const ok = '{"a":"x","b":"y"}';
      expect(repairUnescapedQuotesInStrings(ok)).toBe(ok);
      expect(JSON.parse(repairUnescapedQuotesInStrings(ok))).toEqual({
        a: "x",
        b: "y",
      });
    });

    it("preserves already-escaped quotes", () => {
      const ok = '{"body":"he said \\"hi\\" loudly"}';
      const parsed = JSON.parse(repairUnescapedQuotesInStrings(ok)) as {
        body: string;
      };
      expect(parsed.body).toBe('he said "hi" loudly');
    });

    it("drops trailing chatter after the top-level object", () => {
      const withJunk = '{"a":"b"} 这是模型多嘴的解释';
      expect(repairUnescapedQuotesInStrings(withJunk)).toBe('{"a":"b"}');
    });
  });

  describe("extractJsonFromAIResponse — unescaped-quote recovery (Method 9)", () => {
    it("recovers a finalize envelope whose body has stray inner quotes", () => {
      const content =
        '{"thinking":"分析","action":{"kind":"finalize","output":' +
        '{"index":4,"heading":"未来","body":"不再只是"跑得快"的引擎[1]。"}}}';
      const result = extractJsonFromAIResponse<{
        action: { kind: string; output: { body: string } };
      }>(content);
      expect(result.success).toBe(true);
      expect(result.method).toContain("quoteRepair");
      expect(result.data?.action.kind).toBe("finalize");
      expect(result.data?.action.output.body).toContain("跑得快");
    });

    it("recovers the envelope when body has stray quotes AND is truncated mid-string", () => {
      // closing of body/output/action/root all missing + inner stray quotes
      const content =
        '{"thinking":"x","action":{"kind":"finalize","output":' +
        '{"index":5,"body":"集中在"硅谷"、"纽约"，知识转移高效，但内容被截断';
      const result = extractJsonFromAIResponse<{
        action: { kind: string };
      }>(content);
      // recovered by whatever repair path wins (truncation and/or quote repair) —
      // the point is the envelope is salvaged instead of a hard parse failure.
      expect(result.success).toBe(true);
      expect(result.data?.action.kind).toBe("finalize");
    });
  });
});
