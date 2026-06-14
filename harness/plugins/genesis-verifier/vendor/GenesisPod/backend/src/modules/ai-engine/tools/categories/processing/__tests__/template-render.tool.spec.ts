/**
 * TemplateRenderTool Unit Tests
 */

import {
  TemplateRenderTool,
  TemplateRenderInput,
} from "../templates/template-render.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "template-render",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("TemplateRenderTool", () => {
  let tool: TemplateRenderTool;

  beforeEach(() => {
    tool = new TemplateRenderTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("template-render");
      expect(tool.category).toBe("processing");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true when template and variables are provided", () => {
      const input: TemplateRenderInput = {
        template: "Hello {{name}}",
        variables: { name: "World" },
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when template is missing", () => {
      const input = {
        variables: { name: "World" },
      } as unknown as TemplateRenderInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when variables is missing", () => {
      const input = { template: "Hello" } as unknown as TemplateRenderInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return true when template has no placeholders", () => {
      const input: TemplateRenderInput = {
        template: "Static text with no variables",
        variables: {},
      };
      expect(tool.validateInput(input)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Basic rendering
  // --------------------------------------------------------------------------

  describe("basic variable substitution", () => {
    it("should substitute a simple {{name}} variable", async () => {
      const input: TemplateRenderInput = {
        template: "Hello, {{name}}!",
        variables: { name: "Alice" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toBe("Hello, Alice!");
    });

    it("should substitute multiple variables", async () => {
      const input: TemplateRenderInput = {
        template: "{{greeting}}, {{name}}! You are {{age}} years old.",
        variables: { greeting: "Hi", name: "Bob", age: 30 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("Hi, Bob! You are 30 years old.");
    });

    it("should render empty string for undefined variable in non-strict mode", async () => {
      const input: TemplateRenderInput = {
        template: "Hello, {{unknownVar}}!",
        variables: {},
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toBe("Hello, !");
      expect(result.data?.undefinedVariables).toContain("unknownVar");
    });
  });

  // --------------------------------------------------------------------------
  // Handlebars conditionals
  // --------------------------------------------------------------------------

  describe("handlebars conditionals", () => {
    it("should render if block when condition is truthy", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if isAdmin}}Admin panel{{/if}}",
        variables: { isAdmin: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toContain("Admin panel");
    });

    it("should not render if block when condition is falsy", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if isAdmin}}Admin panel{{/if}}",
        variables: { isAdmin: false },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).not.toContain("Admin panel");
    });
  });

  // --------------------------------------------------------------------------
  // Handlebars loops
  // --------------------------------------------------------------------------

  describe("handlebars loops", () => {
    it("should iterate over an array with #each", async () => {
      const input: TemplateRenderInput = {
        template: "{{#each items}}{{this}},{{/each}}",
        variables: { items: ["a", "b", "c"] },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toContain("a,");
      expect(result.data?.result).toContain("b,");
      expect(result.data?.result).toContain("c,");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — string operations
  // --------------------------------------------------------------------------

  describe("custom helpers — string operations", () => {
    it("should uppercase string with uppercase helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{uppercase name}}",
        variables: { name: "alice" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("ALICE");
    });

    it("should return empty string from uppercase when value is not string", async () => {
      const input: TemplateRenderInput = {
        template: "{{uppercase val}}",
        variables: { val: 123 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });

    it("should lowercase string with lowercase helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{lowercase name}}",
        variables: { name: "ALICE" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("alice");
    });

    it("should return empty string from lowercase when value is not string", async () => {
      const input: TemplateRenderInput = {
        template: "{{lowercase val}}",
        variables: { val: 42 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });

    it("should capitalize string with capitalize helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{capitalize name}}",
        variables: { name: "alice" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("Alice");
    });

    it("should return empty string from capitalize for empty input", async () => {
      const input: TemplateRenderInput = {
        template: "{{capitalize name}}",
        variables: { name: "" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });

    it("should return empty string from capitalize when value is not string", async () => {
      const input: TemplateRenderInput = {
        template: "{{capitalize val}}",
        variables: { val: 99 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — date/number formatting
  // --------------------------------------------------------------------------

  describe("custom helpers — date and number", () => {
    it("should format date as ISO string", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatDate date 'iso'}}",
        variables: { date: "2024-01-15T00:00:00.000Z" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toContain("2024-01-15");
    });

    it("should format date as short format", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatDate date 'short'}}",
        variables: { date: "2024-01-15" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      // toLocaleDateString returns a string
      expect(typeof result.data?.result).toBe("string");
    });

    it("should format date as long format", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatDate date 'long'}}",
        variables: { date: "2024-01-15" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
    });

    it("should return original value when date is invalid", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatDate date 'iso'}}",
        variables: { date: "not-a-date" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("not-a-date");
    });

    it("should format number to fixed decimals", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatNumber num 2}}",
        variables: { num: 3.14159 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("3.14");
    });

    it("should return original value when number is invalid", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatNumber val}}",
        variables: { val: "not-a-number" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("not-a-number");
    });

    it("should use explicit decimals for formatNumber when provided", async () => {
      const input: TemplateRenderInput = {
        template: "{{formatNumber num 3}}",
        variables: { num: 1.5 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("1.500");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — comparison
  // --------------------------------------------------------------------------

  describe("custom helpers — comparison", () => {
    it("should return true with eq helper when values are equal", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (eq a b)}}equal{{/if}}",
        variables: { a: "foo", b: "foo" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("equal");
    });

    it("should return empty with eq helper when values differ", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (eq a b)}}equal{{/if}}",
        variables: { a: "foo", b: "bar" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });

    it("should work with ne helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (ne a b)}}not equal{{/if}}",
        variables: { a: "foo", b: "bar" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("not equal");
    });

    it("should work with gt helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (gt a b)}}greater{{/if}}",
        variables: { a: 5, b: 3 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("greater");
    });

    it("should work with lt helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (lt a b)}}less{{/if}}",
        variables: { a: 2, b: 5 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("less");
    });

    it("should work with gte helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (gte a b)}}gte{{/if}}",
        variables: { a: 5, b: 5 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("gte");
    });

    it("should work with lte helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (lte a b)}}lte{{/if}}",
        variables: { a: 3, b: 5 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("lte");
    });

    it("should work with and helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (and a b)}}both{{/if}}",
        variables: { a: true, b: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("both");
    });

    it("should work with or helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (or a b)}}either{{/if}}",
        variables: { a: false, b: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("either");
    });

    it("should work with not helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{#if (not val)}}negated{{/if}}",
        variables: { val: false },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("negated");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — array operations
  // --------------------------------------------------------------------------

  describe("custom helpers — arrays", () => {
    it("should join array with join helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{join tags ', '}}",
        variables: { tags: ["a", "b", "c"] },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("a, b, c");
    });

    it("should return empty string from join when not an array", async () => {
      const input: TemplateRenderInput = {
        template: "{{join val}}",
        variables: { val: "not-array" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("");
    });

    it("should get length of array with length helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{length items}}",
        variables: { items: [1, 2, 3, 4] },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("4");
    });

    it("should return 0 from length helper when not an array", async () => {
      const input: TemplateRenderInput = {
        template: "{{length val}}",
        variables: { val: "string" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("0");
    });

    it("should get first element with first helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{first items}}",
        variables: { items: ["alpha", "beta", "gamma"] },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("alpha");
    });

    it("should get last element with last helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{last items}}",
        variables: { items: ["alpha", "beta", "gamma"] },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("gamma");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — JSON
  // --------------------------------------------------------------------------

  describe("custom helpers — JSON", () => {
    it("should serialize object with json helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{json data}}",
        variables: { data: { key: "value" } },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(() => JSON.parse(result.data?.result ?? "")).not.toThrow();
      const parsed = JSON.parse(result.data?.result ?? "");
      expect(parsed.key).toBe("value");
    });

    it("should serialize object inline with jsonInline helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{jsonInline data}}",
        variables: { data: { key: "value" } },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe('{"key":"value"}');
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — math
  // --------------------------------------------------------------------------

  describe("custom helpers — math", () => {
    it("should add numbers with add helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{add a b}}",
        variables: { a: 5, b: 3 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("8");
    });

    it("should subtract numbers with subtract helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{subtract a b}}",
        variables: { a: 10, b: 4 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("6");
    });

    it("should multiply numbers with multiply helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{multiply a b}}",
        variables: { a: 3, b: 7 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("21");
    });

    it("should divide numbers with divide helper", async () => {
      const input: TemplateRenderInput = {
        template: "{{divide a b}}",
        variables: { a: 10, b: 2 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("5");
    });

    it("should return 0 from divide when divisor is 0", async () => {
      const input: TemplateRenderInput = {
        template: "{{divide a b}}",
        variables: { a: 10, b: 0 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("0");
    });
  });

  // --------------------------------------------------------------------------
  // Custom helpers — default value
  // --------------------------------------------------------------------------

  describe("custom helpers — default", () => {
    it("should use default value when variable is undefined", async () => {
      const input: TemplateRenderInput = {
        template: "{{default val 'fallback'}}",
        variables: {},
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("fallback");
    });

    it("should use provided value when it is not null/undefined", async () => {
      const input: TemplateRenderInput = {
        template: "{{default val 'fallback'}}",
        variables: { val: "actual" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("actual");
    });

    it("should use default value when variable is null", async () => {
      const input: TemplateRenderInput = {
        template: "{{default val 'fallback'}}",
        variables: { val: null },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("fallback");
    });
  });

  // --------------------------------------------------------------------------
  // usedVariables and undefinedVariables tracking
  // --------------------------------------------------------------------------

  describe("variable tracking", () => {
    it("should list all used variables", async () => {
      const input: TemplateRenderInput = {
        template: "{{name}} is {{age}} years old",
        variables: { name: "Alice", age: 30 },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.usedVariables).toContain("name");
      expect(result.data?.usedVariables).toContain("age");
    });

    it("should list undefined variables separately", async () => {
      const input: TemplateRenderInput = {
        template: "{{name}} from {{city}}",
        variables: { name: "Alice" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.undefinedVariables).toContain("city");
      expect(result.data?.undefinedVariables).not.toContain("name");
    });

    it("should track nested variable paths", async () => {
      const input: TemplateRenderInput = {
        template: "{{user.name}} lives in {{user.city}}",
        variables: { user: { name: "Alice" } },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.usedVariables).toContain("user.name");
      expect(result.data?.undefinedVariables).toContain("user.city");
    });

    it("should track variables with custom delimiters", async () => {
      const input: TemplateRenderInput = {
        template: "<<name>> and <<city>>",
        variables: { name: "Alice" },
        options: {
          delimiters: { start: "<<", end: ">>" },
        },
      };
      const context = createMockContext();
      // Custom delimiters only affect extractVariables tracking, not Handlebars rendering
      const result = await tool.execute(input, context);

      // The template with custom delimiters is tracked by extractVariables
      expect(result.data?.usedVariables).toContain("name");
    });
  });

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  describe("statistics", () => {
    it("should report template and output lengths", async () => {
      const template = "Hello, {{name}}!";
      const input: TemplateRenderInput = {
        template,
        variables: { name: "World" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.statistics.templateLength).toBe(template.length);
      expect(result.data?.statistics.outputLength).toBe("Hello, World!".length);
      expect(result.data?.statistics.variableCount).toBe(1);
      expect(result.data?.statistics.renderTime).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // format option
  // --------------------------------------------------------------------------

  describe("format option", () => {
    it("should pretty-print valid JSON output when format=json", async () => {
      const input: TemplateRenderInput = {
        template: '{"key":"{{value}}"}',
        variables: { value: "hello" },
        format: "json",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      // Should be reformatted JSON
      const parsed = JSON.parse(result.data?.result ?? "");
      expect(parsed.key).toBe("hello");
    });

    it("should keep result as-is when format=json but output is not valid JSON", async () => {
      const input: TemplateRenderInput = {
        template: "not json: {{name}}",
        variables: { name: "Alice" },
        format: "json",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // When JSON.parse fails, it keeps original output
      expect(result.success).toBe(true);
      expect(result.data?.result).toContain("Alice");
    });

    it("should return plain text for format=text", async () => {
      const input: TemplateRenderInput = {
        template: "Plain: {{value}}",
        variables: { value: "content" },
        format: "text",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.result).toBe("Plain: content");
    });

    it("should work with format=markdown", async () => {
      const input: TemplateRenderInput = {
        template: "# {{title}}\n\n{{body}}",
        variables: { title: "My Doc", body: "Content here" },
        format: "markdown",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toContain("My Doc");
    });

    it("should work with format=html", async () => {
      const input: TemplateRenderInput = {
        template: "<h1>{{title}}</h1>",
        variables: { title: "Test" },
        format: "html",
        options: { escapeHtml: false },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toContain("Test");
    });
  });

  // --------------------------------------------------------------------------
  // Strict mode
  // --------------------------------------------------------------------------

  describe("strict mode", () => {
    it("should throw in strict mode when variable is undefined", async () => {
      const input: TemplateRenderInput = {
        template: "Hello {{missingVar}}",
        variables: {},
        options: { strict: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // In strict mode, Handlebars throws - BaseTool wraps it as success:false
      expect(result.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // escapeHtml option
  // --------------------------------------------------------------------------

  describe("escapeHtml option", () => {
    it("should escape HTML when escapeHtml=true is explicitly set", async () => {
      const input: TemplateRenderInput = {
        template: "{{content}}",
        variables: { content: "<script>alert('xss')</script>" },
        options: { escapeHtml: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // HTML should be escaped
      expect(result.data?.result).toContain("&lt;script&gt;");
    });

    it("should not escape HTML when escapeHtml=false (default behavior uses noEscape)", async () => {
      const input: TemplateRenderInput = {
        template: "{{content}}",
        variables: { content: "<b>bold</b>" },
        options: { escapeHtml: false },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // noEscape=true means raw HTML is output
      expect(result.data?.result).toContain("<b>bold</b>");
    });

    it("should bypass escaping with triple braces", async () => {
      const input: TemplateRenderInput = {
        template: "{{{content}}}",
        variables: { content: "<b>bold</b>" },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // Triple braces bypass escaping in Handlebars
      expect(result.data?.result).toContain("<b>bold</b>");
    });
  });

  // --------------------------------------------------------------------------
  // Radar email helpers — security contract (§7.3.3-bis)
  // --------------------------------------------------------------------------

  describe("radar helpers — urlEncode", () => {
    it("should percent-encode a query string value", async () => {
      const input: TemplateRenderInput = {
        template: "{{urlEncode val}}",
        variables: { val: "hello world & <test>" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("hello%20world%20%26%20%3Ctest%3E");
    });

    it("should strip \\r\\n\\t to prevent SMTP header injection", async () => {
      const input: TemplateRenderInput = {
        template: "{{urlEncode val}}",
        variables: { val: "line1\r\nBcc: attacker@evil.com\ttab" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).not.toContain("%0D");
      expect(result.data?.result).not.toContain("%0A");
      expect(result.data?.result).not.toContain("%09");
    });

    it("should return empty string for null", async () => {
      const input: TemplateRenderInput = {
        template: "{{urlEncode val}}",
        variables: { val: null },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });
  });

  describe("radar helpers — truncate", () => {
    it("should truncate to maxN-1 chars and append ellipsis", async () => {
      const input: TemplateRenderInput = {
        template: "{{truncate val 6}}",
        variables: { val: "ABCDEFGH" },
      };
      const result = await tool.execute(input, createMockContext());
      // 5 chars + ellipsis
      expect(result.data?.result).toBe("ABCDE…");
    });

    it("should not truncate when string length <= maxN", async () => {
      const input: TemplateRenderInput = {
        template: "{{truncate val 10}}",
        variables: { val: "short" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("short");
    });

    it("should handle emoji safely (codepoint boundary)", async () => {
      const input: TemplateRenderInput = {
        template: "{{truncate val 3}}",
        variables: { val: "AB😀CD" }, // "AB😀CD"
      };
      const result = await tool.execute(input, createMockContext());
      // Array.from splits emoji correctly: ['A','B','😀','C','D'] → slice(0,2) = 'AB' + '…'
      expect(result.data?.result).toBe("AB…");
    });

    it("should return empty string for null input", async () => {
      const input: TemplateRenderInput = {
        template: "{{truncate val 10}}",
        variables: { val: null },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });
  });

  describe("radar helpers — tierBadge", () => {
    it("should return three stars for tier 3", async () => {
      const input: TemplateRenderInput = {
        template: "{{tierBadge tier}}",
        variables: { tier: 3 },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("⭐⭐⭐");
    });

    it("should return two stars for tier 2", async () => {
      const input: TemplateRenderInput = {
        template: "{{tierBadge tier}}",
        variables: { tier: 2 },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("⭐⭐");
    });

    it("should return one star for tier 1", async () => {
      const input: TemplateRenderInput = {
        template: "{{tierBadge tier}}",
        variables: { tier: 1 },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("⭐");
    });

    it("should fallback to one star for out-of-range value", async () => {
      const input: TemplateRenderInput = {
        template: "{{tierBadge tier}}",
        variables: { tier: 99 },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("⭐");
    });

    it("should fallback to one star for non-numeric string", async () => {
      const input: TemplateRenderInput = {
        template: "{{tierBadge tier}}",
        variables: { tier: "invalid" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("⭐");
    });
  });

  describe("radar helpers — detailUrl", () => {
    it("should return full URL for valid UUID", async () => {
      const input: TemplateRenderInput = {
        template: "{{detailUrl id}}",
        variables: { id: "550e8400-e29b-41d4-a716-446655440000" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toContain(
        "/ai-radar/signal/550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("should return empty string for non-UUID string", async () => {
      const input: TemplateRenderInput = {
        template: "{{detailUrl id}}",
        variables: { id: "not-a-uuid" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });

    it("should return empty string for null input", async () => {
      const input: TemplateRenderInput = {
        template: "{{detailUrl id}}",
        variables: { id: null },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });

    it("should reject XSS payload in signalId", async () => {
      const input: TemplateRenderInput = {
        template: "{{detailUrl id}}",
        variables: { id: "<script>alert(1)</script>" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });
  });

  describe("radar helpers — evidenceSources", () => {
    it("should join source names with ' / ' separator", async () => {
      const input: TemplateRenderInput = {
        template: "{{evidenceSources sources}}",
        variables: {
          sources: [
            { name: "NVIDIA Blog", url: "https://blogs.nvidia.com" },
            { name: "CNBC", url: "https://cnbc.com" },
          ],
        },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("NVIDIA Blog / CNBC");
    });

    it("should return empty string for non-array input", async () => {
      const input: TemplateRenderInput = {
        template: "{{evidenceSources sources}}",
        variables: { sources: "not-array" },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("");
    });

    it("should skip items without a name field", async () => {
      const input: TemplateRenderInput = {
        template: "{{evidenceSources sources}}",
        variables: {
          sources: [{ name: "Reuters" }, { url: "https://evil.com" }, null],
        },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("Reuters");
    });

    it("should not include URL fields in output (name-only)", async () => {
      const input: TemplateRenderInput = {
        template: "{{evidenceSources sources}}",
        variables: {
          sources: [{ name: "Source A", url: "https://attacker.com/xss" }],
        },
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.result).toBe("Source A");
      expect(result.data?.result).not.toContain("attacker.com");
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle template with no variables", async () => {
      const input: TemplateRenderInput = {
        template: "No variables here at all.",
        variables: {},
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toBe("No variables here at all.");
      expect(result.data?.usedVariables).toHaveLength(0);
    });

    it("should handle empty variables object with template", async () => {
      const input: TemplateRenderInput = {
        template: "Static content",
        variables: {},
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toBe("Static content");
    });

    it("should handle deeply nested variable access", async () => {
      const input: TemplateRenderInput = {
        template: "{{user.address.city}}",
        variables: { user: { address: { city: "NYC" } } },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.result).toBe("NYC");
    });
  });
});
