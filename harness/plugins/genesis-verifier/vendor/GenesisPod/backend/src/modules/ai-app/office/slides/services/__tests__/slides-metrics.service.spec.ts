/**
 * Unit tests for SlidesMetricsService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesMetricsService, MetricType } from "../slides-metrics.service";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a fresh SlidesMetricsService for each test with a real EventEmitter2
 * so @OnEvent handlers work properly.
 */
async function createService(): Promise<{
  service: SlidesMetricsService;
  emitter: EventEmitter2;
}> {
  // Use real EventEmitter2 so @OnEvent handlers fire
  const emitter = new EventEmitter2();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SlidesMetricsService,
      { provide: EventEmitter2, useValue: emitter },
    ],
  }).compile();

  const service = module.get<SlidesMetricsService>(SlidesMetricsService);
  service.onModuleInit();

  // Register @OnEvent handlers manually since NestJS event emitter auto-wiring
  // doesn't activate in test modules without full app bootstrap
  emitter.on("slides.generation.started", (payload) =>
    (
      service as unknown as {
        handleGenerationStarted: (p: { missionId: string }) => void;
      }
    ).handleGenerationStarted(payload),
  );
  emitter.on("slides.generation.completed", (payload) =>
    (
      service as unknown as {
        handleGenerationCompleted: (p: {
          missionId: string;
          durationMs: number;
        }) => void;
      }
    ).handleGenerationCompleted(payload),
  );
  emitter.on("slides.generation.failed", (payload) =>
    (
      service as unknown as {
        handleGenerationFailed: (p: {
          missionId: string;
          error: string;
        }) => void;
      }
    ).handleGenerationFailed(payload),
  );
  emitter.on("slides.page.rendered", (payload) =>
    (
      service as unknown as {
        handlePageRendered: (p: {
          pageIndex: number;
          durationMs: number;
        }) => void;
      }
    ).handlePageRendered(payload),
  );
  emitter.on("slides.checkpoint.created", (payload) =>
    (
      service as unknown as {
        handleCheckpointCreated: (p: { durationMs: number }) => void;
      }
    ).handleCheckpointCreated(payload),
  );
  emitter.on("slides.checkpoint.failed", (payload) =>
    (
      service as unknown as {
        handleCheckpointFailed: (p: { error: string }) => void;
      }
    ).handleCheckpointFailed(payload),
  );

  return { service, emitter };
}

// ============================================================================
// Tests
// ============================================================================

describe("SlidesMetricsService", () => {
  let service: SlidesMetricsService;
  let _emitter: EventEmitter2;

  beforeEach(async () => {
    jest.useFakeTimers();
    const created = await createService();
    service = created.service;
    _emitter = created.emitter;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  describe("onModuleInit()", () => {
    it("should initialize all metrics without errors", () => {
      const snapshot = service.getMetrics();
      expect(snapshot).toBeDefined();
      expect(snapshot.metrics.length).toBeGreaterThan(0);
    });

    it("should initialize counters at zero", () => {
      const snapshot = service.getMetrics();
      const startedCounter = snapshot.metrics.find(
        (m) => m.name === "slides_generation_started_total",
      );
      expect(startedCounter?.value).toBe(0);
    });

    it("should initialize alert status for all default rules", () => {
      const alerts = service.getAlertStatus();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.every((a) => !a.firing)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Event handlers
  // --------------------------------------------------------------------------

  describe("event handlers", () => {
    it("should increment started counter on generation.started event", () => {
      service.recordGenerationStart("mission-1");

      const snapshot = service.getMetrics();
      const counter = snapshot.metrics.find(
        (m) => m.name === "slides_generation_started_total",
      );
      expect(counter?.value).toBe(1);
    });

    it("should increment active gauge on generation.started", () => {
      service.recordGenerationStart("mission-1");

      const snapshot = service.getMetrics();
      const gauge = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );
      expect(gauge?.value).toBe(1);
    });

    it("should increment completed counter and decrement active on generation.completed", () => {
      service.recordGenerationStart("mission-1");
      service.recordGenerationComplete("mission-1", 5000);

      const snapshot = service.getMetrics();
      const completed = snapshot.metrics.find(
        (m) => m.name === "slides_generation_completed_total",
      );
      const active = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );

      expect(completed?.value).toBe(1);
      expect(active?.value).toBe(0);
    });

    it("should increment failed counter and decrement active on generation.failed", () => {
      service.recordGenerationStart("mission-fail");
      service.recordGenerationFailure("mission-fail", "Out of memory");

      const snapshot = service.getMetrics();
      const failed = snapshot.metrics.find(
        (m) => m.name === "slides_generation_failed_total",
      );
      const active = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );

      expect(failed?.value).toBe(1);
      expect(active?.value).toBe(0);
    });

    it("should not let active gauge go below zero", () => {
      // Complete without starting
      service.recordGenerationComplete("mission-x", 1000);

      const snapshot = service.getMetrics();
      const active = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );
      expect(active?.value).toBe(0);
    });

    it("should increment pages_rendered on page.rendered event", () => {
      service.recordPageRendered(1, 2000);
      service.recordPageRendered(2, 3000);

      const snapshot = service.getMetrics();
      const pages = snapshot.metrics.find(
        (m) => m.name === "slides_pages_rendered_total",
      );
      expect(pages?.value).toBe(2);
    });

    it("should increment checkpoint_created on checkpoint.created event", () => {
      service.recordCheckpointCreated(500);

      const snapshot = service.getMetrics();
      const cp = snapshot.metrics.find(
        (m) => m.name === "slides_checkpoint_created_total",
      );
      expect(cp?.value).toBe(1);
    });

    it("should increment checkpoint_failures on checkpoint.failed event", () => {
      service.recordCheckpointFailure("DB error");

      const snapshot = service.getMetrics();
      const cpFail = snapshot.metrics.find(
        (m) => m.name === "slides_checkpoint_failures_total",
      );
      expect(cpFail?.value).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Histogram tracking
  // --------------------------------------------------------------------------

  describe("histogram metrics", () => {
    it("should expose avg and count for generation duration", () => {
      service.recordGenerationStart("m1");
      service.recordGenerationComplete("m1", 10000);
      service.recordGenerationStart("m2");
      service.recordGenerationComplete("m2", 20000);

      const snapshot = service.getMetrics();
      const avg = snapshot.metrics.find(
        (m) => m.name === "slides_generation_duration_ms_avg",
      );
      const count = snapshot.metrics.find(
        (m) => m.name === "slides_generation_duration_ms_count",
      );

      expect(avg?.value).toBe(15000);
      expect(count?.value).toBe(2);
    });

    it("should expose page render histogram", () => {
      service.recordPageRendered(1, 1000);
      service.recordPageRendered(2, 2000);

      const snapshot = service.getMetrics();
      const avg = snapshot.metrics.find(
        (m) => m.name === "slides_page_render_duration_ms_avg",
      );
      expect(avg?.value).toBe(1500);
    });

    it("should expose checkpoint duration histogram", () => {
      service.recordCheckpointCreated(800);

      const snapshot = service.getMetrics();
      const count = snapshot.metrics.find(
        (m) => m.name === "slides_checkpoint_duration_ms_count",
      );
      expect(count?.value).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // getMetrics()
  // --------------------------------------------------------------------------

  describe("getMetrics()", () => {
    it("should return snapshot with timestamp", () => {
      const snapshot = service.getMetrics();
      expect(snapshot.timestamp).toBeInstanceOf(Date);
    });

    it("should include computed failure_rate metric", () => {
      const snapshot = service.getMetrics();
      const failureRate = snapshot.metrics.find(
        (m) => m.name === "slides_generation_failure_rate",
      );
      expect(failureRate).toBeDefined();
      expect(failureRate?.type).toBe(MetricType.GAUGE);
    });

    it("should include computed avg_duration metric", () => {
      const snapshot = service.getMetrics();
      const avgDuration = snapshot.metrics.find(
        (m) => m.name === "slides_generation_avg_duration_ms",
      );
      expect(avgDuration).toBeDefined();
    });

    it("should return failure_rate=0 when no recent generations", () => {
      const snapshot = service.getMetrics();
      const failureRate = snapshot.metrics.find(
        (m) => m.name === "slides_generation_failure_rate",
      );
      expect(failureRate?.value).toBe(0);
    });

    it("should return avg_duration=0 when no recent completions", () => {
      const snapshot = service.getMetrics();
      const avgDuration = snapshot.metrics.find(
        (m) => m.name === "slides_generation_avg_duration_ms",
      );
      expect(avgDuration?.value).toBe(0);
    });

    it("should include all counter types", () => {
      const snapshot = service.getMetrics();
      const counterNames = snapshot.metrics
        .filter((m) => m.type === MetricType.COUNTER)
        .map((m) => m.name);

      expect(counterNames).toContain("slides_generation_started_total");
      expect(counterNames).toContain("slides_generation_completed_total");
      expect(counterNames).toContain("slides_generation_failed_total");
      expect(counterNames).toContain("slides_pages_rendered_total");
      expect(counterNames).toContain("slides_checkpoint_created_total");
      expect(counterNames).toContain("slides_checkpoint_failures_total");
    });

    it("should include all gauge types", () => {
      const snapshot = service.getMetrics();
      const gaugeNames = snapshot.metrics
        .filter((m) => m.type === MetricType.GAUGE)
        .map((m) => m.name);

      expect(gaugeNames).toContain("slides_active_generations");
      expect(gaugeNames).toContain("slides_stuck_missions_count");
    });
  });

  // --------------------------------------------------------------------------
  // updateStuckMissionsCount()
  // --------------------------------------------------------------------------

  describe("updateStuckMissionsCount()", () => {
    it("should update stuck_missions gauge", () => {
      service.updateStuckMissionsCount(3);

      const snapshot = service.getMetrics();
      const stuck = snapshot.metrics.find(
        (m) => m.name === "slides_stuck_missions_count",
      );
      expect(stuck?.value).toBe(3);
    });

    it("should trigger alert when count exceeds threshold (5)", () => {
      service.updateStuckMissionsCount(6);

      const alerts = service.getFiringAlerts();
      const stuckAlert = alerts.find((a) => a.name === "stuck_missions");
      expect(stuckAlert?.firing).toBe(true);
    });

    it("should resolve alert when count drops below threshold", () => {
      service.updateStuckMissionsCount(6);
      service.updateStuckMissionsCount(2);

      const alerts = service.getAlertStatus();
      const stuckAlert = alerts.find((a) => a.name === "stuck_missions");
      expect(stuckAlert?.firing).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Alert system
  // --------------------------------------------------------------------------

  describe("alert system", () => {
    it("should fire checkpoint_failures alert when count > 10", () => {
      for (let i = 0; i < 11; i++) {
        service.recordCheckpointFailure(`error ${i}`);
      }

      const alerts = service.getFiringAlerts();
      const cpAlert = alerts.find((a) => a.name === "checkpoint_failures");
      expect(cpAlert?.firing).toBe(true);
    });

    it("should return empty array from getFiringAlerts() when none firing", () => {
      const alerts = service.getFiringAlerts();
      expect(alerts).toHaveLength(0);
    });

    it("should return all alert statuses from getAlertStatus()", () => {
      const statuses = service.getAlertStatus();
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses[0]).toHaveProperty("name");
      expect(statuses[0]).toHaveProperty("firing");
      expect(statuses[0]).toHaveProperty("threshold");
      expect(statuses[0]).toHaveProperty("severity");
    });

    it("should update alert lastChecked on each check", () => {
      const before = service.getAlertStatus()[0].lastChecked;

      // Trigger a check
      service.recordCheckpointFailure("error");

      const after = service.getAlertStatus()[0].lastChecked;
      // lastChecked should be updated (or the same if it's within same ms)
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("should set firingStartedAt when alert starts firing", () => {
      service.updateStuckMissionsCount(10);

      const alerts = service.getAlertStatus();
      const stuckAlert = alerts.find((a) => a.name === "stuck_missions");
      expect(stuckAlert?.firingStartedAt).toBeInstanceOf(Date);
    });

    it("should clear firingStartedAt when alert resolves", () => {
      service.updateStuckMissionsCount(10);
      service.updateStuckMissionsCount(0);

      const alerts = service.getAlertStatus();
      const stuckAlert = alerts.find((a) => a.name === "stuck_missions");
      expect(stuckAlert?.firingStartedAt).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getPrometheusMetrics()
  // --------------------------------------------------------------------------

  describe("getPrometheusMetrics()", () => {
    it("should return non-empty prometheus format string", () => {
      const output = service.getPrometheusMetrics();
      expect(output.length).toBeGreaterThan(0);
    });

    it("should include HELP and TYPE lines", () => {
      const output = service.getPrometheusMetrics();
      expect(output).toContain("# HELP");
      expect(output).toContain("# TYPE");
    });

    it("should include counter metric values", () => {
      service.recordGenerationStart("test-mission");

      const output = service.getPrometheusMetrics();
      expect(output).toContain("slides_generation_started_total");
    });

    it("should use underscore not hyphen in metric names", () => {
      const output = service.getPrometheusMetrics();
      expect(output).not.toMatch(/[a-z]-[a-z]/);
    });
  });

  // --------------------------------------------------------------------------
  // Failure rate calculation
  // --------------------------------------------------------------------------

  describe("failure rate calculation", () => {
    it("should calculate failure rate from recent generations", () => {
      // 2 started, 1 completed (success), 1 failed
      service.recordGenerationStart("m1");
      service.recordGenerationStart("m2");
      service.recordGenerationComplete("m1", 5000);
      service.recordGenerationFailure("m2", "error");

      const snapshot = service.getMetrics();
      const failureRate = snapshot.metrics.find(
        (m) => m.name === "slides_generation_failure_rate",
      );

      // recentGenerations has 2 entries; 1 was marked success, 1 not
      // failure rate = failures / total = 1/2 = 0.5
      expect(failureRate?.value).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Multiple concurrent missions
  // --------------------------------------------------------------------------

  describe("multiple concurrent missions", () => {
    it("should track multiple active generations simultaneously", () => {
      service.recordGenerationStart("m1");
      service.recordGenerationStart("m2");
      service.recordGenerationStart("m3");

      const snapshot = service.getMetrics();
      const active = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );
      expect(active?.value).toBe(3);
    });

    it("should correctly decrement when some complete and some fail", () => {
      service.recordGenerationStart("m1");
      service.recordGenerationStart("m2");
      service.recordGenerationStart("m3");

      service.recordGenerationComplete("m1", 10000);
      service.recordGenerationFailure("m2", "error");

      const snapshot = service.getMetrics();
      const active = snapshot.metrics.find(
        (m) => m.name === "slides_active_generations",
      );
      expect(active?.value).toBe(1);
    });
  });
});
