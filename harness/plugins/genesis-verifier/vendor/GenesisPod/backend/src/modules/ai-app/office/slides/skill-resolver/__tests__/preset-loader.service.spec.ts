import { PresetLoader } from "../preset-loader.service";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { SlidesSlot } from "../slot-ids";

/**
 * Covers PresetLoader branches:
 *  - missing dir (graceful degrade)
 *  - malformed JSON
 *  - missing required fields
 *  - unknown slot (typo guard)
 *  - happy path
 *  - empty skillId dropped
 */
describe("PresetLoader", () => {
  let tmpDir: string;
  let loader: PresetLoader;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "preset-loader-"));
    loader = new PresetLoader();
    // Point to tmp dir via reflection (presetsDir is private but readonly)
    (loader as unknown as { presetsDir: string }).presetsDir = tmpDir;
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  async function writePreset(name: string, content: unknown): Promise<void> {
    const body =
      typeof content === "string" ? content : JSON.stringify(content);
    await fs.writeFile(path.join(tmpDir, name), body, "utf8");
  }

  it("loads a valid preset", async () => {
    await writePreset("a.json", {
      id: "sample.a",
      description: "ok",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-exec" },
    });

    await loader.loadAll();

    const p = loader.get("sample.a");
    expect(p).toBeDefined();
    expect(p?.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-exec");
  });

  it("ignores non-JSON files in the directory", async () => {
    await fs.writeFile(path.join(tmpDir, "readme.md"), "# notes", "utf8");
    await writePreset("b.json", {
      id: "sample.b",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-b" },
    });

    await loader.loadAll();

    expect(loader.list()).toHaveLength(1);
    expect(loader.get("sample.b")).toBeDefined();
  });

  it("gracefully handles missing directory", async () => {
    const missing = path.join(tmpDir, "does-not-exist");
    (loader as unknown as { presetsDir: string }).presetsDir = missing;
    await expect(loader.loadAll()).resolves.toBeUndefined();
    expect(loader.list()).toHaveLength(0);
  });

  it("skips malformed JSON without throwing", async () => {
    await writePreset("bad.json", "this is not json");
    await writePreset("good.json", {
      id: "good",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "x" },
    });

    await loader.loadAll();

    expect(loader.get("good")).toBeDefined();
  });

  it("rejects preset missing 'id'", async () => {
    await writePreset("noid.json", {
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "x" },
    });

    await loader.loadAll();

    expect(loader.list()).toHaveLength(0);
  });

  it("rejects preset missing 'bindings'", async () => {
    await writePreset("nob.json", { id: "no-bindings" });

    await loader.loadAll();

    expect(loader.get("no-bindings")).toBeUndefined();
  });

  it("rejects preset referencing unknown slot", async () => {
    await writePreset("bad-slot.json", {
      id: "bad",
      bindings: { "plan.typo": "x" },
    });

    await loader.loadAll();

    expect(loader.get("bad")).toBeUndefined();
  });

  it("drops empty skillId in bindings (treated as fall-through)", async () => {
    await writePreset("empty.json", {
      id: "empty-skill",
      bindings: {
        [SlidesSlot.PLAN_OUTLINE]: "",
        [SlidesSlot.POLISH_FACT_CHECK]: "fact-checker",
      },
    });

    await loader.loadAll();

    const p = loader.get("empty-skill");
    expect(p?.bindings[SlidesSlot.PLAN_OUTLINE]).toBeUndefined();
    expect(p?.bindings[SlidesSlot.POLISH_FACT_CHECK]).toBe("fact-checker");
  });

  // ─── Additional branch coverage (deep review gap-fills) ───

  it("rejects preset with empty 'id' string", async () => {
    await writePreset("empty-id.json", {
      id: "",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "x" },
    });

    await loader.loadAll();

    expect(loader.list()).toHaveLength(0);
  });

  it("rejects preset whose bindings is not an object", async () => {
    await writePreset("nonobj-bindings.json", {
      id: "bad-bindings",
      bindings: "oops",
    });

    await loader.loadAll();

    expect(loader.get("bad-bindings")).toBeUndefined();
  });

  it("drops bindings whose skillId is not a string (type guard)", async () => {
    await writePreset("nonstring-skill.json", {
      id: "non-string",
      bindings: {
        [SlidesSlot.PLAN_OUTLINE]: 42,
        [SlidesSlot.POLISH_FACT_CHECK]: "fact-checker",
      },
    });

    await loader.loadAll();

    const p = loader.get("non-string");
    expect(p).toBeDefined();
    expect(p?.bindings[SlidesSlot.PLAN_OUTLINE]).toBeUndefined();
    expect(p?.bindings[SlidesSlot.POLISH_FACT_CHECK]).toBe("fact-checker");
  });

  it("drops appliesTo when it is not an object", async () => {
    await writePreset("bad-applies.json", {
      id: "applies-bad",
      appliesTo: "oops",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "x" },
    });

    await loader.loadAll();

    const p = loader.get("applies-bad");
    expect(p).toBeDefined();
    expect(p?.appliesTo).toBeUndefined();
  });

  it("rejects a JSON top-level primitive (null / string / number)", async () => {
    await writePreset("null.json", "null");
    await writePreset("str.json", '"just a string"');
    await writePreset("num.json", "123");

    await loader.loadAll();

    expect(loader.list()).toHaveLength(0);
  });

  it("preserves appliesTo when present", async () => {
    await writePreset("c.json", {
      id: "c",
      appliesTo: { sourceType: "topic-insights", audience: "executive" },
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-c" },
    });

    await loader.loadAll();

    const p = loader.get("c");
    expect(p?.appliesTo?.sourceType).toBe("topic-insights");
    expect(p?.appliesTo?.audience).toBe("executive");
  });
});
