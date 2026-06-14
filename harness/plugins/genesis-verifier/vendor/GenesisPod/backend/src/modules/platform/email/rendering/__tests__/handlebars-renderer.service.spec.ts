import { Logger } from "@nestjs/common";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { HandlebarsRendererService } from "../handlebars-renderer.service";

jest.mock("node:fs", () => ({ existsSync: jest.fn() }));
jest.mock("node:fs/promises", () => ({ readFile: jest.fn() }));

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe("HandlebarsRendererService", () => {
  let service: HandlebarsRendererService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new HandlebarsRendererService();
    await service.onModuleInit(); // loads real handlebars + registers helpers
  });

  /** Render an inline template through the service's isolated hbs instance.
   *  Uses a unique template name per call so the internal compile cache never
   *  collides across assertions. */
  let inlineSeq = 0;
  const renderInline = async (tpl: string, ctx: Record<string, unknown>) => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(tpl as never);
    return service.render(`inline-${inlineSeq++}`, "zh-CN", ctx);
  };

  describe("onModuleInit", () => {
    it("initializes without throwing and is ready to render", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("hello {{name}}" as never);
      await expect(
        service.render("t", "zh-CN", { name: "world" }),
      ).resolves.toBe("hello world");
    });
  });

  describe("render — file resolution", () => {
    it("renders the zh template for a zh-CN locale", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("zh {{v}}" as never);
      const out = await service.render("radar", "zh-CN", { v: 1 });
      expect(out).toBe("zh 1");
      const readPath = String(mockReadFile.mock.calls[0][0]);
      expect(readPath.replace(/\\/g, "/")).toContain("radar.zh.hbs");
    });

    it("renders the en template for an en-US locale", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("en {{v}}" as never);
      await service.render("radar", "en-US", { v: 2 });
      const readPath = String(mockReadFile.mock.calls[0][0]);
      expect(readPath.replace(/\\/g, "/")).toContain("radar.en.hbs");
    });

    it("caches a compiled template (reads file only once)", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("cached {{v}}" as never);
      await service.render("c", "zh-CN", { v: 1 });
      await service.render("c", "zh-CN", { v: 2 });
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it("falls back to en when the zh template is missing", async () => {
      // zh path missing, en fallback present
      mockExistsSync.mockImplementation((p) => String(p).includes(".en.hbs"));
      mockReadFile.mockResolvedValue("fallback {{v}}" as never);
      const out = await service.render("only-en", "zh-CN", { v: 9 });
      expect(out).toBe("fallback 9");
      const readPath = String(mockReadFile.mock.calls[0][0]);
      expect(readPath.replace(/\\/g, "/")).toContain("only-en.en.hbs");
    });

    it("throws when neither zh nor en fallback exists", async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(service.render("missing", "zh-CN", {})).rejects.toThrow(
        /email template not found/,
      );
    });

    it("throws when an en-US template is missing (no further fallback)", async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(service.render("missing", "en-US", {})).rejects.toThrow(
        /email template not found/,
      );
    });
  });

  describe("helpers", () => {
    it("length: array / string length, 0 otherwise", async () => {
      expect(await renderInline("{{length arr}}", { arr: [1, 2, 3] })).toBe(
        "3",
      );
      expect(await renderInline("{{length s}}", { s: "abcd" })).toBe("4");
      expect(await renderInline("{{length n}}", { n: 42 })).toBe("0");
    });

    it("eq: strict equality", async () => {
      expect(
        await renderInline("{{#if (eq a b)}}Y{{else}}N{{/if}}", { a: 1, b: 1 }),
      ).toBe("Y");
      expect(
        await renderInline("{{#if (eq a b)}}Y{{else}}N{{/if}}", { a: 1, b: 2 }),
      ).toBe("N");
    });

    it("gt: numeric greater-than, false for non-numbers", async () => {
      expect(
        await renderInline("{{#if (gt a b)}}Y{{else}}N{{/if}}", { a: 5, b: 3 }),
      ).toBe("Y");
      expect(
        await renderInline("{{#if (gt a b)}}Y{{else}}N{{/if}}", { a: 1, b: 3 }),
      ).toBe("N");
      expect(
        await renderInline("{{#if (gt a b)}}Y{{else}}N{{/if}}", {
          a: "x",
          b: 3,
        }),
      ).toBe("N");
    });

    it("join: array with separator, default comma, empty for non-array", async () => {
      expect(
        await renderInline("{{join arr '-'}}", { arr: ["a", "b", "c"] }),
      ).toBe("a-b-c");
      expect(await renderInline("{{join arr}}", { arr: ["a", "b"] })).toBe(
        "a, b",
      );
      expect(await renderInline("{{join arr '-'}}", { arr: "notarray" })).toBe(
        "",
      );
    });

    it("add: numeric addition with coercion", async () => {
      expect(await renderInline("{{add a b}}", { a: 2, b: 3 })).toBe("5");
      expect(await renderInline("{{add a b}}", { a: "10", b: 5 })).toBe("15");
      expect(await renderInline("{{add a b}}", { a: "x", b: 5 })).toBe("5");
    });

    it("detailUrl: builds a signal URL, empty on bad input", async () => {
      const out = await renderInline("{{detailUrl sig topic base}}", {
        sig: "s1",
        topic: "t1",
        base: "https://app.test",
      });
      expect(out).toBe("https://app.test/ai-radar/topic/t1/signal/s1");

      const dflt = await renderInline("{{detailUrl sig topic base}}", {
        sig: "s1",
        topic: "t1",
        base: 123,
      });
      expect(dflt).toContain(
        "https://app.example.com/ai-radar/topic/t1/signal/s1",
      );

      const bad = await renderInline("{{detailUrl sig topic base}}", {
        sig: 123,
        topic: "t1",
        base: "https://app.test",
      });
      expect(bad).toBe("");
    });
  });
});
