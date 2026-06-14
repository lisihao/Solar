import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { FixtureStore } from "../fixture-store";

describe("FixtureStore", () => {
  let tmpDir: string;
  let store: FixtureStore;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fixture-store-test-"));
    store = new FixtureStore();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const makeRun = (agentId = "test-agent") => ({
    version: 1 as const,
    agentId,
    input: { query: "test" },
    events: [
      { type: "thinking", payload: { content: "step 1" }, timestamp: 1000 },
      { type: "output", payload: { output: "result" }, timestamp: 2000 },
    ],
    recordedAt: Date.now(),
  });

  describe("write / read", () => {
    it("writes and reads a fixture", async () => {
      const filePath = path.join(tmpDir, "test.json");
      const run = makeRun();
      await store.write(filePath, run);
      const loaded = await store.read(filePath);
      expect(loaded.agentId).toBe("test-agent");
      expect(loaded.events).toHaveLength(2);
      expect(loaded.version).toBe(1);
    });

    it("creates parent directories automatically", async () => {
      const filePath = path.join(tmpDir, "sub/dir/deep.json");
      await store.write(filePath, makeRun("sub-agent"));
      const loaded = await store.read(filePath);
      expect(loaded.agentId).toBe("sub-agent");
    });

    it("throws on unsupported version", async () => {
      const filePath = path.join(tmpDir, "bad-version.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          version: 2,
          agentId: "x",
          events: [],
          input: {},
          recordedAt: 0,
        }),
      );
      await expect(store.read(filePath)).rejects.toThrow(
        /Unsupported fixture version 2/,
      );
    });

    it("preserves input data", async () => {
      const filePath = path.join(tmpDir, "preserve.json");
      const run = {
        ...makeRun(),
        input: { complex: { nested: true, array: [1, 2, 3] } },
      };
      await store.write(filePath, run);
      const loaded = await store.read(filePath);
      expect(loaded.input).toEqual(run.input);
    });
  });

  describe("replay", () => {
    it("yields all events in fast mode", async () => {
      const filePath = path.join(tmpDir, "replay.json");
      await store.write(filePath, makeRun());
      const events: unknown[] = [];
      for await (const ev of store.replay(filePath)) {
        events.push(ev);
      }
      expect(events).toHaveLength(2);
    });

    it("yields events in order", async () => {
      const filePath = path.join(tmpDir, "ordered.json");
      await store.write(filePath, makeRun());
      const timestamps: number[] = [];
      for await (const ev of store.replay(filePath)) {
        timestamps.push((ev as { timestamp: number }).timestamp);
      }
      expect(timestamps).toEqual([1000, 2000]);
    });

    it("handles empty events array", async () => {
      const filePath = path.join(tmpDir, "empty.json");
      const run = { ...makeRun(), events: [] };
      await store.write(filePath, run);
      const events: unknown[] = [];
      for await (const ev of store.replay(filePath)) {
        events.push(ev);
      }
      expect(events).toHaveLength(0);
    });

    it("replays with non-fast mode (uses delays)", async () => {
      const filePath = path.join(tmpDir, "slow.json");
      const run = {
        ...makeRun(),
        events: [
          { type: "thinking", payload: {}, timestamp: 1000 },
          { type: "output", payload: {}, timestamp: 1001 }, // 1ms delay
        ],
      };
      await store.write(filePath, run);
      const events: unknown[] = [];
      for await (const ev of store.replay(filePath, { fast: false })) {
        events.push(ev);
      }
      expect(events).toHaveLength(2);
    });
  });
});
