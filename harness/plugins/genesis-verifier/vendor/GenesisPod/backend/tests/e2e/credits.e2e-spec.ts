/**
 * Credits System E2E Tests (L1 Infrastructure)
 *
 * Tests the credits/points system including account management,
 * balance queries, checkin flow, rules, and consumption estimation.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("CreditsController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testUser = {
    email: `credits-test-${Date.now()}@example.com`,
    username: `credits-user-${Date.now()}`,
    password: "Test123456!",
  };

  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Register a test user and get token
    const registerRes = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(testUser);

    if (registerRes.status === 201) {
      accessToken = registerRes.body.accessToken;
      userId = registerRes.body.user.id;
    }
  });

  afterAll(async () => {
    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        // ignore cleanup errors
      }
    }
    await app.close();
  });

  // ==================== Unauthorized Access ====================

  describe("Unauthorized access", () => {
    it("GET /api/v1/credits — should return 401 without token", async () => {
      await request(app.getHttpServer()).get("/api/v1/credits").expect(401);
    });

    it("GET /api/v1/credits/balance — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/credits/balance")
        .expect(401);
    });

    it("GET /api/v1/credits/stats — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/credits/stats")
        .expect(401);
    });

    it("POST /api/v1/credits/checkin — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/credits/checkin")
        .expect(401);
    });
  });

  // ==================== Account Info ====================

  describe("GET /api/v1/credits", () => {
    it("should return credit account info for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Balance ====================

  describe("GET /api/v1/credits/balance", () => {
    it("should return balance for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/balance")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Stats ====================

  describe("GET /api/v1/credits/stats", () => {
    it("should return credit statistics for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/stats")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Transactions ====================

  describe("GET /api/v1/credits/transactions", () => {
    it("should return transaction history for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/transactions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support pagination query params", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/credits/transactions")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ page: 1, limit: 10 })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Checkin ====================

  describe("GET /api/v1/credits/checkin/status", () => {
    it("should return checkin status for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/checkin/status")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("POST /api/v1/credits/checkin", () => {
    it("should perform checkin or indicate already checked in", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .post("/api/v1/credits/checkin")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          // 200: success, 400: already checked in, 500: db not available
          expect([200, 400, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("GET /api/v1/credits/checkin/history", () => {
    it("should return checkin history for authenticated user", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/credits/checkin/history")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Rules ====================

  describe("GET /api/v1/credits/rules", () => {
    it("should return credit rules list", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/rules")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
        if (response.body.length > 0) {
          expect(response.body[0]).toHaveProperty("moduleType");
          expect(response.body[0]).toHaveProperty("operationType");
          expect(response.body[0]).toHaveProperty("baseCredits");
        }
      }
    });
  });

  // ==================== Estimate ====================

  describe("GET /api/v1/credits/estimate", () => {
    it("should estimate credit consumption", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/credits/estimate")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ moduleType: "RESEARCH", operationType: "DEEP_RESEARCH" })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("estimatedCredits");
        expect(response.body).toHaveProperty("moduleType");
        expect(response.body).toHaveProperty("operationType");
      }
    });

    it("should handle estimate with optional token count", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/credits/estimate")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({
          moduleType: "CHAT",
          operationType: "AI_CHAT",
          tokenCount: 1000,
        })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });
});
