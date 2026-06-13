import { Logger } from "@nestjs/common";
import {
  SessionMemorySidecarService,
  SidecarEntry,
} from "../session-memory-sidecar.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
  category: SidecarEntry["category"],
  content: string,
  overrides?: Partial<SidecarEntry>,
): SidecarEntry {
  return {
    timestamp: new Date("2026-01-01T00:00:00Z"),
    category,
    content,
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("SessionMemorySidecarService", () => {
  let service: SessionMemorySidecarService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    service = new SessionMemorySidecarService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── initialize ─────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates an empty session with zero entries", () => {
      service.initialize("sess-1");

      expect(service.hasSession("sess-1")).toBe(true);
      expect(service.getEntryCount("sess-1")).toBe(0);
      expect(service.getEntries("sess-1")).toEqual([]);
    });

    it("applies custom config values when provided", () => {
      service.initialize("sess-cfg", { maxEntries: 5, maxSummaryChars: 100 });

      // Fill 6 entries — with maxEntries:5 the oldest should be pruned
      for (let i = 0; i < 6; i++) {
        service.addEntry("sess-cfg", makeEntry("finding", `finding-${i}`));
      }

      expect(service.getEntryCount("sess-cfg")).toBe(5);
    });
  });

  // ─── addEntry ───────────────────────────────────────────────────────────────

  describe("addEntry()", () => {
    it("stores the entry and increments count", () => {
      service.initialize("sess-1");
      const entry = makeEntry("finding", "AI market growing 40% YoY");

      service.addEntry("sess-1", entry);

      expect(service.getEntryCount("sess-1")).toBe(1);
      expect(service.getEntries("sess-1")[0]).toEqual(entry);
    });

    it("auto-initializes the session when it does not exist", () => {
      expect(service.hasSession("new-sess")).toBe(false);

      service.addEntry("new-sess", makeEntry("insight", "auto-init insight"));

      expect(service.hasSession("new-sess")).toBe(true);
      expect(service.getEntryCount("new-sess")).toBe(1);
    });

    it("prunes the oldest entry when maxEntries is exceeded", () => {
      service.initialize("sess-prune", { maxEntries: 3 });

      service.addEntry("sess-prune", makeEntry("finding", "first"));
      service.addEntry("sess-prune", makeEntry("finding", "second"));
      service.addEntry("sess-prune", makeEntry("finding", "third"));
      service.addEntry("sess-prune", makeEntry("finding", "fourth")); // triggers prune

      const entries = service.getEntries("sess-prune");
      expect(entries).toHaveLength(3);
      // 'first' is the evicted entry
      expect(entries.map((e) => e.content)).toEqual([
        "second",
        "third",
        "fourth",
      ]);
    });
  });

  // ─── getEntries ─────────────────────────────────────────────────────────────

  describe("getEntries()", () => {
    it("returns an empty array for an unknown session", () => {
      expect(service.getEntries("ghost")).toEqual([]);
    });
  });

  // ─── getMarkdown ────────────────────────────────────────────────────────────

  describe("getMarkdown()", () => {
    it("returns an empty string for an empty / unknown session", () => {
      service.initialize("empty-sess");
      expect(service.getMarkdown("empty-sess")).toBe("");
      expect(service.getMarkdown("unknown-sess")).toBe("");
    });

    it("groups entries under the correct category headings", () => {
      service.initialize("md-sess");
      service.addEntry("md-sess", makeEntry("finding", "Finding Alpha"));
      service.addEntry("md-sess", makeEntry("decision", "Decision Beta"));
      service.addEntry("md-sess", makeEntry("source", "Source Gamma"));

      const markdown = service.getMarkdown("md-sess");

      expect(markdown).toContain("# Session Memory");
      expect(markdown).toContain("## Key Findings");
      expect(markdown).toContain("- Finding Alpha");
      expect(markdown).toContain("## Decisions Made");
      expect(markdown).toContain("- Decision Beta");
      expect(markdown).toContain("## Important Sources");
      expect(markdown).toContain("- Source Gamma");
    });

    it("includes dimensionName and confidence when provided", () => {
      service.initialize("md-extra");
      service.addEntry(
        "md-extra",
        makeEntry("insight", "Key insight", {
          dimensionName: "Market",
          confidence: 0.85,
        }),
      );

      const markdown = service.getMarkdown("md-extra");

      expect(markdown).toContain("[Market]");
      expect(markdown).toContain("(confidence: 85%)");
    });
  });

  // ─── getSummary ─────────────────────────────────────────────────────────────

  describe("getSummary()", () => {
    it("prioritizes findings before errors in the summary", () => {
      service.initialize("prio-sess");
      service.addEntry("prio-sess", makeEntry("error", "Some error occurred"));
      service.addEntry("prio-sess", makeEntry("finding", "Critical finding"));

      const summary = service.getSummary("prio-sess");
      const findingPos = summary.indexOf("[finding]");
      const errorPos = summary.indexOf("[error]");

      expect(findingPos).toBeGreaterThanOrEqual(0);
      expect(errorPos).toBeGreaterThanOrEqual(0);
      expect(findingPos).toBeLessThan(errorPos);
    });

    it("respects the maxChars limit and truncates output accordingly", () => {
      service.initialize("limit-sess");
      // Add many long entries
      for (let i = 0; i < 20; i++) {
        service.addEntry(
          "limit-sess",
          makeEntry(
            "finding",
            `This is finding number ${i} with some extra text to pad`,
          ),
        );
      }

      const summary = service.getSummary("limit-sess", 200);

      expect(summary.length).toBeLessThanOrEqual(200);
    });

    it("returns an empty string for an empty session", () => {
      service.initialize("empty-summary");
      expect(service.getSummary("empty-summary")).toBe("");
    });
  });

  // ─── onCompaction ───────────────────────────────────────────────────────────

  describe("onCompaction()", () => {
    it("increments the compaction counter and includes it in the summary", () => {
      service.initialize("compact-sess");
      service.addEntry("compact-sess", makeEntry("finding", "Important fact"));

      const summary1 = service.onCompaction("compact-sess");
      expect(summary1).toContain("1 compactions");

      const summary2 = service.onCompaction("compact-sess");
      expect(summary2).toContain("2 compactions");
    });

    it("returns an empty string for an unknown session", () => {
      expect(service.onCompaction("ghost-sess")).toBe("");
    });
  });

  // ─── destroy ────────────────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("returns all entries and removes the session", () => {
      service.initialize("destroy-sess");
      service.addEntry("destroy-sess", makeEntry("finding", "fact A"));
      service.addEntry("destroy-sess", makeEntry("decision", "choice B"));

      const returned = service.destroy("destroy-sess");

      expect(returned).toHaveLength(2);
      expect(returned[0].content).toBe("fact A");
      expect(returned[1].content).toBe("choice B");
      expect(service.hasSession("destroy-sess")).toBe(false);
    });

    it("returns an empty array and does not throw for an unknown session", () => {
      expect(() => service.destroy("nonexistent")).not.toThrow();
      expect(service.destroy("nonexistent")).toEqual([]);
    });
  });

  // ─── hasSession ─────────────────────────────────────────────────────────────

  describe("hasSession()", () => {
    it("returns true for an initialized session and false for an unknown one", () => {
      service.initialize("exists");

      expect(service.hasSession("exists")).toBe(true);
      expect(service.hasSession("does-not-exist")).toBe(false);
    });

    it("returns false after a session is destroyed", () => {
      service.initialize("transient");
      service.destroy("transient");

      expect(service.hasSession("transient")).toBe(false);
    });
  });
});
