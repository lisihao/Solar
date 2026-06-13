import {
  PostmortemClassifierService,
  type ClassifyInput,
} from "../postmortem-classifier.service";

function makeEvent(type: string, ts = 0): { type: string; ts: number } {
  return { type, ts };
}

describe("PostmortemClassifierService", () => {
  let svc: PostmortemClassifierService;

  beforeEach(() => {
    svc = new PostmortemClassifierService();
  });

  describe("success path", () => {
    it("status=completed → mode=success, confidence=1", () => {
      const result = svc.classify({ status: "completed", events: [] });
      expect(result).toEqual({ mode: "success", signals: [], confidence: 1 });
    });
  });

  describe("cancelled paths", () => {
    it("status=cancelled + last event type includes user-cancel → user_cancel, confidence=1", () => {
      const input: ClassifyInput = {
        status: "cancelled",
        events: [
          makeEvent("playground.stage:started"),
          makeEvent("playground.user-cancel"),
        ],
      };
      const result = svc.classify(input);
      expect(result.mode).toBe("user_cancel");
      expect(result.signals).toContain("user-initiated");
      expect(result.confidence).toBe(1);
    });

    it("status=cancelled + no user-cancel event → pod_recycle, confidence=0.7", () => {
      const input: ClassifyInput = {
        status: "cancelled",
        events: [
          makeEvent("playground.stage:started"),
          makeEvent("playground.agent:lifecycle"),
        ],
      };
      const result = svc.classify(input);
      expect(result.mode).toBe("pod_recycle");
      expect(result.signals).toContain("no_user_cancel_event");
      expect(result.confidence).toBe(0.7);
    });

    it("status=cancelled + no events at all → pod_recycle", () => {
      const result = svc.classify({ status: "cancelled", events: [] });
      expect(result.mode).toBe("pod_recycle");
      expect(result.confidence).toBe(0.7);
    });
  });

  describe("failure signal detection", () => {
    it("truncationCount=10 (> threshold 5) → tool_truncation, confidence ≈ 1", () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        makeEvent("playground.tool:truncated", i),
      );
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("tool_truncation");
      expect(result.confidence).toBe(1); // 10 / (5*2) = 1.0
    });

    it("stuckRevisionCount=3 + truncationCount=2 → unknown (both below threshold)", () => {
      const events = [
        ...Array.from({ length: 3 }, (_, i) => makeEvent("revision:stuck", i)),
        ...Array.from({ length: 2 }, (_, i) =>
          makeEvent("playground.tool:truncated", i + 10),
        ),
      ];
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("unknown");
      expect(result.confidence).toBe(0);
    });

    it("stuckRevisionCount=5 (exactly at threshold) → reviewer_loop", () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEvent("revision:stuck", i),
      );
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("reviewer_loop");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("timeoutCount=6 → llm_timeout, confidence=1 (6/(3*2)=1)", () => {
      const events = Array.from({ length: 6 }, (_, i) =>
        makeEvent("playground.llm:timeout", i),
      );
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("llm_timeout");
      expect(result.confidence).toBe(1);
    });

    it("schemaRejectCount=3 (exactly at threshold) → schema_reject", () => {
      const events = Array.from({ length: 3 }, (_, i) =>
        makeEvent("playground.validation:failed", i),
      );
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("schema_reject");
    });

    it("timeoutCount=1 only → unknown (below threshold=3)", () => {
      const events = [makeEvent("playground.timeout")];
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("unknown");
    });

    it("no events at all → unknown, confidence=0", () => {
      const result = svc.classify({ status: "failed", events: [] });
      expect(result).toEqual({ mode: "unknown", signals: [], confidence: 0 });
    });

    it("dominant signal wins when multiple signals present: 8 truncations + 3 timeouts → tool_truncation", () => {
      const events = [
        ...Array.from({ length: 8 }, (_, i) =>
          makeEvent("playground.tool:truncated", i),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeEvent("playground.llm:timeout", i + 100),
        ),
      ];
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("tool_truncation");
      expect(result.signals.some((s) => s.startsWith("tool_truncation")));
      expect(result.signals.some((s) => s.startsWith("llm_timeout")));
    });
  });

  describe("signals output", () => {
    it("includes non-zero counters in signals for failed mode", () => {
      const events = [
        ...Array.from({ length: 6 }, (_, i) => makeEvent("revision:stuck", i)),
        ...Array.from({ length: 2 }, (_, i) =>
          makeEvent("playground.tool:truncated", i + 10),
        ),
      ];
      const result = svc.classify({ status: "failed", events });
      expect(result.mode).toBe("reviewer_loop");
      const signalKeys = result.signals.map((s) => s.split(":")[0]);
      expect(signalKeys).toContain("reviewer_loop");
      expect(signalKeys).toContain("tool_truncation");
    });
  });
});
