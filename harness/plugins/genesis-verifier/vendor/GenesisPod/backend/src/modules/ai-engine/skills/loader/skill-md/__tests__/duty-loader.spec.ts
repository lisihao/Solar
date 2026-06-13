/**
 * duty-loader.spec.ts — renderDuty / buildPromptFromDuty
 *
 * 2026-05-15 PR-E：数据源已单源化为 SKILL.md。loadDuty/loadSoul/legacy fallback
 * 路径全部删除。buildPromptFromDuty 直接委托 loadSkill；本 spec mock loadSkill
 * 返回 ParsedSkill 验证拼接 + 模板渲染逻辑。renderDuty 纯字符串处理与 fs 无关。
 */

jest.mock("../skill-md-loader", () => ({
  loadSkill: jest.fn(),
  clearSkillCache: jest.fn(),
}));

import {
  renderDuty,
  buildPromptFromDuty,
  clearDutyCache,
} from "../duty-loader";
import { loadSkill } from "../skill-md-loader";

const mockLoadSkill = loadSkill as jest.MockedFunction<typeof loadSkill>;

describe("renderDuty", () => {
  beforeEach(() => {
    clearDutyCache();
    jest.clearAllMocks();
  });

  it("replaces simple {{var}} tokens", () => {
    expect(renderDuty("Hello {{name}}!", { name: "World" })).toBe(
      "Hello World!",
    );
  });

  it("replaces numeric variable", () => {
    expect(renderDuty("Count: {{count}}", { count: 42 })).toBe("Count: 42");
  });

  it("replaces boolean variable", () => {
    expect(renderDuty("Flag: {{flag}}", { flag: true })).toBe("Flag: true");
  });

  it("leaves {{this}} and {{@index}} untouched outside each", () => {
    expect(renderDuty("{{this}} {{@index}}", { this: "X" })).toBe(
      "{{this}} {{@index}}",
    );
  });

  it("replaces missing var with empty string", () => {
    expect(renderDuty("Hi {{missing}}", {})).toBe("Hi ");
  });

  it("handles nested dot access {{a.b.c}}", () => {
    expect(renderDuty("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("handles nested dot access missing → empty string", () => {
    expect(renderDuty("{{a.b.c}}", { a: {} })).toBe("");
  });

  it("{{#if truthy}} renders body", () => {
    expect(renderDuty("{{#if show}}YES{{/if}}", { show: true })).toBe("YES");
  });

  it("{{#if falsy}} removes body", () => {
    expect(renderDuty("{{#if show}}YES{{/if}}", { show: false })).toBe("");
  });

  it("{{#if empty string}} removes body", () => {
    expect(renderDuty("{{#if s}}TEXT{{/if}}", { s: "" })).toBe("");
  });

  it("{{#if non-empty string}} renders body", () => {
    expect(renderDuty("{{#if s}}TEXT{{/if}}", { s: "hello" })).toBe("TEXT");
  });

  it("{{#if 0}} removes body", () => {
    expect(renderDuty("{{#if n}}BODY{{/if}}", { n: 0 })).toBe("");
  });

  it("{{#if empty array}} removes body", () => {
    expect(renderDuty("{{#if arr}}ITEMS{{/if}}", { arr: [] })).toBe("");
  });

  it("{{#if non-empty array}} renders body", () => {
    expect(renderDuty("{{#if arr}}ITEMS{{/if}}", { arr: [1] })).toBe("ITEMS");
  });

  it("{{#each}} renders object array fields directly", () => {
    expect(
      renderDuty("{{#each items}}{{val}},{{/each}}", {
        items: [{ val: "a" }, { val: "b" }, { val: "c" }],
      }),
    ).toBe("a,b,c,");
  });

  it("{{#each}} object fields by name", () => {
    expect(
      renderDuty("{{#each items}}{{name}};{{/each}}", {
        items: [{ name: "Alice" }, { name: "Bob" }],
      }),
    ).toBe("Alice;Bob;");
  });

  it("{{#each}} empty array → empty string", () => {
    expect(renderDuty("{{#each items}}{{this}}{{/each}}", { items: [] })).toBe(
      "",
    );
  });

  it("{{#each}} undefined array → empty string", () => {
    expect(renderDuty("{{#each items}}{{this}}{{/each}}", {})).toBe("");
  });

  it("JSON.stringify used for object var", () => {
    expect(renderDuty("{{obj}}", { obj: { x: 1 } })).toBe(
      JSON.stringify({ x: 1 }),
    );
  });

  it("nested if inside each", () => {
    expect(
      renderDuty("{{#each items}}{{#if active}}{{name}}{{/if}}{{/each}}", {
        items: [
          { name: "A", active: true },
          { name: "B", active: false },
        ],
      }),
    ).toBe("A");
  });
});

describe("buildPromptFromDuty", () => {
  beforeEach(() => {
    clearDutyCache();
    jest.clearAllMocks();
  });

  it("combines soul + duty with --- separator when soul exists", () => {
    mockLoadSkill.mockReturnValue({
      frontmatter: {
        id: "playground.leader",
        name: "Leader",
        allowedTools: [],
        allowedModels: [],
        duties: ["plan"],
      },
      soul: "Soul content",
      duties: { plan: "Duty content with {{topic}}" },
    });
    const result = buildPromptFromDuty("leader", "plan", { topic: "AI" });
    expect(result).toContain("Soul content");
    expect(result).toContain("---");
    expect(result).toContain("Duty content with AI");
  });

  it("returns only duty when soul is null", () => {
    mockLoadSkill.mockReturnValue({
      frontmatter: {
        id: "playground.x",
        name: "X",
        allowedTools: [],
        allowedModels: [],
        duties: ["only"],
      },
      soul: null,
      duties: { only: "Duty only {{x}}" },
    });
    const result = buildPromptFromDuty("x", "only", { x: "test" });
    expect(result).toBe("Duty only test");
    expect(result).not.toContain("---");
  });

  it("applies variable rendering to combined prompt", () => {
    mockLoadSkill.mockReturnValue({
      frontmatter: {
        id: "playground.researcher",
        name: "Researcher",
        allowedTools: [],
        allowedModels: [],
        duties: ["collect"],
      },
      soul: "Hello {{name}}",
      duties: { collect: "Task: {{task}}" },
    });
    const result = buildPromptFromDuty("researcher", "collect", {
      name: "Bob",
      task: "research",
    });
    expect(result).toContain("Hello Bob");
    expect(result).toContain("Task: research");
  });

  it("throws when SKILL.md does not declare requested duty", () => {
    mockLoadSkill.mockReturnValue({
      frontmatter: {
        id: "playground.leader",
        name: "Leader",
        allowedTools: [],
        allowedModels: [],
        duties: ["plan"],
      },
      soul: "soul",
      duties: { plan: "plan body" },
    });
    expect(() => buildPromptFromDuty("leader", "nonexistent", {})).toThrowError(
      /does not declare duty "nonexistent"/,
    );
  });

  it("propagates SKILL.md not found error from loadSkill", () => {
    mockLoadSkill.mockImplementation(() => {
      throw new Error("SKILL.md not found");
    });
    expect(() => buildPromptFromDuty("missing", "plan", {})).toThrowError(
      /SKILL.md not found/,
    );
  });
});

describe("clearDutyCache", () => {
  it("delegates to clearSkillCache", () => {
    const { clearSkillCache } = jest.requireMock("../skill-md-loader");
    clearDutyCache();
    expect(clearSkillCache).toHaveBeenCalled();
  });
});
