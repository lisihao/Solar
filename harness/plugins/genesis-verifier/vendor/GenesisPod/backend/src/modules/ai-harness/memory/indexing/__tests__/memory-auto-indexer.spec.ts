import { MemoryAutoIndexer } from "../memory-auto-indexer";
import { NoopEmbeddingProvider } from "../../vector/embedding-provider";

function makeAgent(
  opts: {
    id?: string;
    roleId?: string;
    messages?: Array<{ role: string; content: string; timestamp?: number }>;
    userId?: string;
  } = {},
) {
  return {
    id: opts.id ?? "agent-1",
    identity: {
      role: { id: opts.roleId ?? "researcher" },
    },
    getEnvelope: () => ({
      messages: opts.messages ?? [],
      memory: { userId: opts.userId ?? "user-1", workspaceId: undefined },
    }),
  };
}

function makeEvent(type: string, payload: unknown, timestamp = Date.now()) {
  return { type, payload, timestamp };
}

describe("MemoryAutoIndexer", () => {
  describe("indexAgentTrajectory - no store", () => {
    it("returns 0 and warns when no store is wired", async () => {
      const indexer = new MemoryAutoIndexer(
        undefined,
        undefined,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({
        messages: [{ role: "assistant", content: "A".repeat(100) }],
      });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(0);
    });
  });

  describe("indexAgentTrajectory - with InMemoryStore", () => {
    it("returns 0 when no candidates", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({ messages: [] });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(0);
      expect(inMemStore.add).not.toHaveBeenCalled();
    });

    it("indexes assistant messages longer than 50 chars", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const messages = [
        { role: "user", content: "Tell me about AI" },
        { role: "assistant", content: "A".repeat(60) },
        { role: "assistant", content: "Short" }, // too short
        { role: "assistant", content: "B".repeat(80) },
      ];
      const agent = makeAgent({ messages });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(2);
      expect(inMemStore.add).toHaveBeenCalledTimes(2);
    });

    it("indexes reflection events", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({ messages: [] });
      const events = [
        makeEvent("reflection", {
          insight: "This is a major insight worth remembering for later",
        }),
      ];
      const count = await indexer.indexAgentTrajectory(agent as never, events);
      expect(count).toBe(1);
    });

    it("indexes output events with string output", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({ messages: [] });
      const events = [
        makeEvent("output", {
          output: "This is the final output of sufficient length to be indexed",
        }),
      ];
      const count = await indexer.indexAgentTrajectory(agent as never, events);
      expect(count).toBe(1);
    });

    it("indexes output events with object output", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({ messages: [] });
      const events = [
        makeEvent("output", {
          output: {
            result:
              "complex result with much more data than thirty chars total",
          },
        }),
      ];
      const count = await indexer.indexAgentTrajectory(agent as never, events);
      expect(count).toBe(1);
    });

    it("respects maxEntries option", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: "assistant",
        content: `Message ${i} with sufficient content to be indexed properly for tests`,
      }));
      const agent = makeAgent({ messages });
      // Only last 3 assistant messages are considered (slice(-3)), then maxEntries=2
      const count = await indexer.indexAgentTrajectory(agent as never, [], {
        maxEntries: 2,
      });
      expect(count).toBe(2);
    });

    it("uses custom namespace from options", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        undefined,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({
        messages: [{ role: "assistant", content: "A".repeat(60) }],
      });
      await indexer.indexAgentTrajectory(agent as never, [], {
        namespace: "custom-ns",
      });
      expect(inMemStore.add).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: "custom-ns" }),
      );
    });
  });

  describe("indexAgentTrajectory - with PrismaStore", () => {
    it("uses prisma store over inMemStore", async () => {
      const prismaStore = { addBatch: jest.fn().mockResolvedValue(1) };
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(
        prismaStore as never,
        inMemStore as never,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({
        messages: [{ role: "assistant", content: "A".repeat(60) }],
      });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(1);
      expect(prismaStore.addBatch).toHaveBeenCalled();
      expect(inMemStore.add).not.toHaveBeenCalled();
    });

    it("returns 0 and logs when prisma batch fails", async () => {
      const prismaStore = {
        addBatch: jest.fn().mockRejectedValue(new Error("DB error")),
      };
      const indexer = new MemoryAutoIndexer(
        prismaStore as never,
        undefined,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({
        messages: [{ role: "assistant", content: "A".repeat(60) }],
      });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(0);
    });

    it("uses agent userId as namespace when not provided", async () => {
      const prismaStore = { addBatch: jest.fn().mockResolvedValue(1) };
      const indexer = new MemoryAutoIndexer(
        prismaStore as never,
        undefined,
        new NoopEmbeddingProvider(4),
      );
      const agent = makeAgent({
        userId: "user-42",
        messages: [{ role: "assistant", content: "A".repeat(60) }],
      });
      await indexer.indexAgentTrajectory(agent as never, []);
      expect(prismaStore.addBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ namespace: "user-42" }),
        ]),
      );
    });
  });

  describe("with default NoopEmbeddingProvider", () => {
    it("uses NoopEmbeddingProvider when none provided", async () => {
      const inMemStore = { add: jest.fn() };
      const indexer = new MemoryAutoIndexer(undefined, inMemStore as never);
      const agent = makeAgent({
        messages: [{ role: "assistant", content: "A".repeat(60) }],
      });
      const count = await indexer.indexAgentTrajectory(agent as never, []);
      expect(count).toBe(1);
    });
  });
});
