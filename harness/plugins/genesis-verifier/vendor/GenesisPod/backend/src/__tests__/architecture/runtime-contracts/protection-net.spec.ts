/**
 * protection-net.spec.ts
 *
 * Verifies four backend protection mechanisms with REVERSE EVIDENCE:
 * each test deliberately provides a "broken" payload to confirm the guard fires.
 *
 *   3a. EventBus: emit payload that fails zod schema → returns false
 *   3b. EventBus STRICT mode: same payload → throws
 *   3c. EventBus: real leader:goals-set payload shape → passes schema
 *   3d. EventBus: mutated leader:goals-set (initialRisks item is string) → fails
 *   4.  POST /api/v1/playground/error-report endpoint structure check
 */

import { z } from "zod";
import { EventRegistry } from "@/common/events/event-registry";
import { EventBus } from "@/common/events/event-bus";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// 3. EventBus schema validation (reverse evidence tests)
// ---------------------------------------------------------------------------

describe("Protection Net — EventBus contract-drift guard", () => {
  function buildBus(schema?: z.ZodTypeAny) {
    const reg = new EventRegistry();
    reg.register({ type: "test.goals-set", schema });
    return new EventBus(reg);
  }

  // ---- 3a. Default mode: invalid payload → false, not throw ----

  describe("3a. Invalid payload in default mode returns false", () => {
    it("emitting payload that fails schema returns false (does not throw)", async () => {
      const schema = z.object({
        goals: z.array(z.string()),
        initialRisks: z.array(z.object({ id: z.string(), risk: z.string() })),
      });
      const bus = buildBus(schema);

      // REVERSE EVIDENCE: payload has initialRisks as string[] (contract drift scenario)
      const result = await bus.emit({
        type: "test.goals-set",
        scope: {},
        payload: {
          goals: ["goal1"],
          initialRisks: ["this is a string not an object"],
        } as never,
        timestamp: Date.now(),
      });

      // The guard must have fired and returned false
      expect(result).toBe(false);
    });

    it("emitting completely missing required field also returns false", async () => {
      const schema = z.object({
        missionId: z.string(),
        goals: z.array(z.string()),
      });
      const bus = buildBus(schema);

      const result = await bus.emit({
        type: "test.goals-set",
        scope: {},
        payload: { goals: ["g1"] } as never, // missing missionId
        timestamp: Date.now(),
      });

      expect(result).toBe(false);
    });
  });

  // ---- 3b. STRICT mode: invalid payload → throws ----

  describe("3b. STRICT mode throws on schema violation (reverse evidence)", () => {
    const originalEnv = process.env.STRICT_DOMAIN_EVENT_VALIDATION;

    beforeEach(() => {
      process.env.STRICT_DOMAIN_EVENT_VALIDATION = "true";
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.STRICT_DOMAIN_EVENT_VALIDATION;
      } else {
        process.env.STRICT_DOMAIN_EVENT_VALIDATION = originalEnv;
      }
    });

    it("throws when STRICT=true and payload violates schema", async () => {
      const schema = z.object({ count: z.number() });
      const bus = buildBus(schema);

      await expect(
        bus.emit({
          type: "test.goals-set",
          scope: {},
          payload: { count: "not-a-number" } as never,
          timestamp: Date.now(),
        }),
      ).rejects.toThrow(/payload validation failed/);
    });

    it("does NOT throw when STRICT=true and payload is valid", async () => {
      const schema = z.object({ count: z.number() });
      const bus = buildBus(schema);

      const result = await bus.emit({
        type: "test.goals-set",
        scope: {},
        payload: { count: 42 },
        timestamp: Date.now(),
      });

      expect(result).toBe(true);
    });
  });

  // ---- 3c. Real leader:goals-set payload shape passes schema ----

  describe("3c. Production payload shape passes its own schema", () => {
    /**
     * This is the real payload shape from mission 72256e07's leader:goals-set event.
     * initialRisks is object[] — verifies our schema is correctly typed as object[].
     */
    const leaderGoalsSetSchema = z.object({
      goals: z.array(z.string()),
      initialRisks: z.array(
        z.object({
          id: z.string(),
          risk: z.string(),
          severity: z.string().optional(),
          mitigation: z.string().optional(),
        }),
      ),
    });

    it("real production payload (initialRisks as object[]) passes schema", () => {
      const realPayload = {
        goals: [
          "Provide comprehensive analysis of AI market trends",
          "Identify key players and competitive landscape",
        ],
        initialRisks: [
          {
            id: "r1",
            risk: "Data staleness — LLM knowledge cutoff",
            severity: "medium",
            mitigation: "Supplement with web search",
          },
          {
            id: "r2",
            risk: "Source bias in training data",
            severity: "low",
            mitigation: "Cross-reference multiple sources",
          },
        ],
      };

      const result = leaderGoalsSetSchema.safeParse(realPayload);
      expect(result.success).toBe(true);
    });

    it("mutated payload (initialRisks[0] is string instead of object) fails schema", () => {
      const mutatedPayload = {
        goals: ["Provide analysis"],
        initialRisks: [
          "Data staleness — this is now a bare string, contract drift!",
        ],
      };

      const result = leaderGoalsSetSchema.safeParse(mutatedPayload);
      expect(result.success).toBe(false);
      // The error should mention the path initialRisks[0]
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join("."));
        expect(paths.some((p) => p.startsWith("initialRisks"))).toBe(true);
      }
    });
  });

  // ---- Unregistered type is also dropped ----

  describe("3d. Unregistered event type is dropped", () => {
    it("emitting an unregistered event type returns false", async () => {
      const bus = new EventBus(new EventRegistry());
      const result = await bus.emit({
        type: "unregistered.event.type",
        scope: {},
        payload: { anything: true },
        timestamp: Date.now(),
      });
      expect(result).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. ErrorBoundary + error-report endpoint structural checks
// ---------------------------------------------------------------------------

describe("Protection Net — ErrorBoundary + error-report endpoint", () => {
  describe("4a. frontend error.tsx exists and imports useEffect + calls fetch", () => {
    const errorFile = path.resolve(
      __dirname,
      "../../../../../frontend/app/agent-playground/team/[missionId]/error.tsx",
    );

    it("error.tsx file exists", () => {
      expect(fs.existsSync(errorFile)).toBe(true);
    });

    it("error.tsx imports useEffect", () => {
      const content = fs.readFileSync(errorFile, "utf8");
      expect(content).toMatch(/useEffect/);
    });

    it("error.tsx calls the error-report endpoint", () => {
      const content = fs.readFileSync(errorFile, "utf8");
      expect(content).toContain("error-report");
    });

    it("error.tsx is a Next.js 'use client' component (required for ErrorBoundary)", () => {
      const content = fs.readFileSync(errorFile, "utf8");
      expect(content).toMatch(/['"]use client['"]/);
    });

    it("error.tsx exports a default component with (error, reset) props", () => {
      const content = fs.readFileSync(errorFile, "utf8");
      // Next.js error boundary signature
      expect(content).toMatch(/export default function/);
      expect(content).toMatch(/error/);
      expect(content).toMatch(/reset/);
    });
  });

  describe("4b. backend error-report controller structure", () => {
    // PR-D god class split (2026-05-15): error-report 路由从 playground.controller.ts
    // 拆到 controllers/mission-read.controller.ts，spec readSrc 跟着迁。
    const controllerFile = path.resolve(
      __dirname,
      "../../../modules/ai-app/playground/api/controller/mission-read.controller.ts",
    );

    it("controller file exists", () => {
      expect(fs.existsSync(controllerFile)).toBe(true);
    });

    it("controller has @Post('error-report') route", () => {
      const content = fs.readFileSync(controllerFile, "utf8");
      expect(content).toMatch(/@Post\(\s*['"]error-report['"]\s*\)/);
    });

    it("controller logs the missionId in the error message", () => {
      const content = fs.readFileSync(controllerFile, "utf8");
      // The log.error call must reference missionId within 500 chars of the route
      const routeIdx = content.indexOf("error-report");
      expect(routeIdx).toBeGreaterThan(-1);
      const segment = content.slice(routeIdx, routeIdx + 600);
      expect(segment).toContain("missionId");
    });

    it("controller returns { ok: true } response shape", () => {
      const content = fs.readFileSync(controllerFile, "utf8");
      const routeIdx = content.indexOf("error-report");
      const segment = content.slice(routeIdx, routeIdx + 800);
      expect(segment).toContain("ok: true");
    });

    it("controller is decorated with @Public() — no auth required for error reporting", () => {
      const content = fs.readFileSync(controllerFile, "utf8");
      // @Public() must appear just before @Post("error-report")
      const routeIdx = content.indexOf('@Post("error-report")');
      expect(routeIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, routeIdx - 100), routeIdx);
      expect(before).toContain("@Public()");
    });
  });
});
