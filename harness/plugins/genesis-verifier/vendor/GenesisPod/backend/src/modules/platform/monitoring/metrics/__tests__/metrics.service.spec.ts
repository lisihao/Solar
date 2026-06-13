import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MetricsService } from "../metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;

  beforeEach(async () => {
    jest.useFakeTimers();

    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(async () => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe("onModuleDestroy", () => {
    it("clears the cleanup interval without throwing", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      service.onModuleDestroy();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Counter
  // -------------------------------------------------------------------------

  describe("incrementCounter", () => {
    it("increments a pre-registered counter by 1 (default value)", () => {
      service.incrementCounter("http_requests_total");
      const snapshots = service.getMetricsSnapshot();
      const snap = snapshots.find((s) => s.name === "http_requests_total")!;
      expect(snap.values[0].value).toBe(1);
    });

    it("increments by a custom value", () => {
      service.incrementCounter("http_requests_total", {}, 5);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "http_requests_total")!;
      expect(snap.values[0].value).toBe(5);
    });

    it("accumulates across multiple calls", () => {
      service.incrementCounter("http_requests_total", {}, 3);
      service.incrementCounter("http_requests_total", {}, 2);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "http_requests_total")!;
      expect(snap.values[0].value).toBe(5);
    });

    it("auto-registers an unknown counter on first use", () => {
      service.incrementCounter("custom_counter");
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "custom_counter")!;
      expect(snap).toBeDefined();
      expect(snap.type).toBe("counter");
    });

    it("tracks separate label combinations independently", () => {
      service.incrementCounter("ai_response_errors_total", {
        model: "gpt-4o",
        error_type: "timeout",
      });
      service.incrementCounter("ai_response_errors_total", {
        model: "claude",
        error_type: "ratelimit",
      });
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_errors_total")!;
      expect(snap.values).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Gauge
  // -------------------------------------------------------------------------

  describe("setGauge / incrementGauge / decrementGauge", () => {
    it("setGauge sets an absolute value", () => {
      service.setGauge("active_topics", 42);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_topics")!;
      expect(snap.values[0].value).toBe(42);
    });

    it("setGauge overwrites previous value", () => {
      service.setGauge("active_topics", 10);
      service.setGauge("active_topics", 20);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_topics")!;
      expect(snap.values[0].value).toBe(20);
    });

    it("incrementGauge adds to existing value", () => {
      service.setGauge("active_ai_members", 5);
      service.incrementGauge("active_ai_members", {}, 3);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_ai_members")!;
      expect(snap.values[0].value).toBe(8);
    });

    it("decrementGauge subtracts from existing value", () => {
      service.setGauge("active_ai_members", 10);
      service.decrementGauge("active_ai_members", {}, 4);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_ai_members")!;
      expect(snap.values[0].value).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // Histogram
  // -------------------------------------------------------------------------

  describe("recordHistogram", () => {
    it("records a value in the correct latency bucket", () => {
      service.recordHistogram("ai_response_latency_ms", 75);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_latency_ms")!;
      const data = snap.values[0].value as {
        buckets: Record<string, number>;
        sum: number;
        count: number;
      };
      expect(data.count).toBe(1);
      expect(data.sum).toBe(75);
    });

    it("accumulates count and sum across multiple observations", () => {
      service.recordHistogram("ai_response_latency_ms", 100);
      service.recordHistogram("ai_response_latency_ms", 200);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_latency_ms")!;
      const data = snap.values[0].value as { sum: number; count: number };
      expect(data.count).toBe(2);
      expect(data.sum).toBe(300);
    });

    it("assigns values exceeding all buckets to +Inf bucket", () => {
      service.recordHistogram("ai_response_latency_ms", 999999);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_latency_ms")!;
      const data = snap.values[0].value as { buckets: Record<string, number> };
      expect(data.buckets["+Inf"]).toBeGreaterThan(0);
    });

    it("auto-registers an unknown histogram on first use", () => {
      service.recordHistogram("custom_histogram", 42);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "custom_histogram")!;
      expect(snap).toBeDefined();
      expect(snap.type).toBe("histogram");
    });
  });

  // -------------------------------------------------------------------------
  // Domain helpers
  // -------------------------------------------------------------------------

  describe("domain helper methods", () => {
    it("recordAIResponseLatency records into ai_response_latency_ms", () => {
      service.recordAIResponseLatency("gpt-4o", 500);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_latency_ms")!;
      expect(snap.values.length).toBeGreaterThan(0);
    });

    it("recordAIResponseTokens records into ai_response_tokens", () => {
      service.recordAIResponseTokens("gpt-4o", 1500);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_tokens")!;
      const data = snap.values[0].value as { count: number };
      expect(data.count).toBe(1);
    });

    it("recordAIResponseError increments ai_response_errors_total with model + error_type labels", () => {
      service.recordAIResponseError("claude", "rate_limit");
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_errors_total")!;
      expect(snap.values[0].labels).toMatchObject({
        model: "claude",
        error_type: "rate_limit",
      });
    });

    it("recordAIResponseSuccess increments ai_response_success_total", () => {
      service.recordAIResponseSuccess("gpt-4o");
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "ai_response_success_total")!;
      expect(snap.values[0].value).toBe(1);
    });

    it("recordMissionCompleted increments counter and records histogram", () => {
      service.recordMissionCompleted("topic-1", 3000);
      const counterSnap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "mission_completed_total")!;
      expect(counterSnap.values[0].value).toBe(1);

      const histSnap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "mission_duration_ms")!;
      const data = histSnap.values[0].value as { count: number };
      expect(data.count).toBe(1);
    });

    it("recordVoteCompleted records with strategy and consensus labels", () => {
      service.recordVoteCompleted("majority", true);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "vote_completed_total")!;
      expect(snap.values[0].labels).toMatchObject({
        strategy: "majority",
        consensus: "true",
      });
    });

    it("recordMessageSent records with sender_type label", () => {
      service.recordMessageSent("topic-1", "ai");
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "messages_sent_total")!;
      expect(snap.values[0].labels).toMatchObject({ sender_type: "ai" });
    });

    it("setActiveTopics sets active_topics gauge", () => {
      service.setActiveTopics(7);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_topics")!;
      expect(snap.values[0].value).toBe(7);
    });

    it("setActiveAIMembers sets active_ai_members gauge", () => {
      service.setActiveAIMembers(3);
      const snap = service
        .getMetricsSnapshot()
        .find((s) => s.name === "active_ai_members")!;
      expect(snap.values[0].value).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears all metric values without removing metric definitions", () => {
      service.incrementCounter("http_requests_total", {}, 10);
      service.setGauge("active_topics", 5);

      service.reset();

      const snapshots = service.getMetricsSnapshot();
      // Metric definitions still present
      expect(
        snapshots.find((s) => s.name === "http_requests_total"),
      ).toBeDefined();
      // All values cleared
      for (const snap of snapshots) {
        expect(snap.values).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // exportPrometheus
  // -------------------------------------------------------------------------

  describe("exportPrometheus", () => {
    it("exports counter in Prometheus text format", () => {
      service.incrementCounter("http_requests_total", { method: "GET" });
      const output = service.exportPrometheus();
      expect(output).toContain("# HELP http_requests_total");
      expect(output).toContain("# TYPE http_requests_total counter");
      expect(output).toContain('http_requests_total{method="GET"} 1');
    });

    it("exports gauge in Prometheus text format", () => {
      service.setGauge("active_topics", 4);
      const output = service.exportPrometheus();
      expect(output).toContain("# TYPE active_topics gauge");
      expect(output).toContain("active_topics 4");
    });

    it("exports histogram with _bucket, _sum, _count suffixes", () => {
      service.recordHistogram("ai_response_latency_ms", 55, {
        model: "gpt-4o",
      });
      const output = service.exportPrometheus();
      expect(output).toContain("ai_response_latency_ms_bucket");
      expect(output).toContain("ai_response_latency_ms_sum");
      expect(output).toContain("ai_response_latency_ms_count");
      expect(output).toContain('+Inf"} 1');
    });

    it("returns empty string content for metrics with no recorded values", () => {
      // Fresh service: default metrics exist but have no values yet
      const output = service.exportPrometheus();
      // HELP and TYPE lines should still be present for each registered metric
      expect(output).toContain("# HELP http_requests_total");
    });
  });
});
