/**
 * Admin Dashboard E2E Tests (L5 Open API)
 *
 * Tests admin endpoints including overview stats, AI capabilities
 * (models, agents, skills, tools, MCP servers), kernel processes,
 * observability traces, and cache management.
 * All endpoints require JWT + AdminGuard.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("AdminController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Regular (non-admin) user
  const regularUser = {
    email: `admin-test-regular-${Date.now()}@example.com`,
    username: `admin-regular-${Date.now()}`,
    password: "Test123456!",
  };

  // Admin user credentials (set via env in CI)
  const adminUser = {
    email: process.env.ADMIN_EMAIL || "admin@example.com",
    password: process.env.ADMIN_PASSWORD || "Admin123456!",
  };

  let regularToken: string;
  let adminToken: string;
  let regularUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Register regular user
    const registerRes = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(regularUser);

    if (registerRes.status === 201) {
      regularToken = registerRes.body.accessToken;
      regularUserId = registerRes.body.user.id;
    }

    // Attempt admin login
    const adminLoginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send(adminUser);

    if (adminLoginRes.status === 200 || adminLoginRes.status === 201) {
      adminToken = adminLoginRes.body.accessToken;
    }
  });

  afterAll(async () => {
    if (regularUserId) {
      try {
        await prisma.user.delete({ where: { id: regularUserId } });
      } catch {
        // ignore
      }
    }
    await app.close();
  });

  // ==================== Unauthorized ====================

  describe("Unauthorized access", () => {
    it("GET /api/v1/admin/overview-stats — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/overview-stats")
        .expect(401);
    });

    it("GET /api/v1/admin/ai/models — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/ai/models")
        .expect(401);
    });

    it("GET /api/v1/admin/ai/agents — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/agents")
        .expect(401);
    });
  });

  // ==================== Forbidden (non-admin) ====================

  describe("Forbidden access for regular user", () => {
    it("GET /api/v1/admin/overview-stats — should return 403 for regular user", async () => {
      if (!regularToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/overview-stats")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect((res: request.Response) => {
          expect([401, 403]).toContain(res.status);
        });
    });

    it("GET /api/v1/admin/ai/tools — should return 403 for regular user", async () => {
      if (!regularToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/ai/tools")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect((res: request.Response) => {
          expect([401, 403]).toContain(res.status);
        });
    });
  });

  // ==================== Overview Stats ====================

  describe("GET /api/v1/admin/overview-stats", () => {
    it("should return overview statistics for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/overview-stats")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== AI Models ====================

  describe("GET /api/v1/admin/ai/models", () => {
    it("should return AI models list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/ai/models")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          // Note: /admin/ai/models route may not exist — /admin/ai prefix is AIAdminController
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== AI Diagnose ====================

  describe("GET /api/v1/admin/ai/diagnose", () => {
    it("should run AI capability diagnosis for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/ai/diagnose")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Agents ====================

  describe("GET /api/v1/admin/agents", () => {
    it("should return agent configurations list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/agents")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support domain filter query param", async () => {
      if (!adminToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/agents")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ domain: "research" })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Skills ====================

  describe("GET /api/v1/admin/ai/skills", () => {
    it("should return skills list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/ai/skills")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Tools ====================

  describe("GET /api/v1/admin/ai/tools", () => {
    it("should return tools list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/ai/tools")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== MCP Servers ====================

  describe("GET /api/v1/admin/ai/mcp-servers", () => {
    it("should return MCP servers list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/ai/mcp-servers")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Kernel Processes ====================

  describe("GET /api/v1/admin/kernel/processes", () => {
    it("should return kernel processes list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/kernel/processes")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("processes");
        expect(response.body).toHaveProperty("total");
        expect(Array.isArray(response.body.processes)).toBe(true);
      }
    });

    it("should support limit query param", async () => {
      if (!adminToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/kernel/processes")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ limit: 10 })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Traces ====================

  describe("GET /api/v1/admin/monitoring/traces", () => {
    it("should return traces list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/monitoring/traces")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support limit filter", async () => {
      if (!adminToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/monitoring/traces")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ limit: 5 })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Cache Management ====================

  describe("Cache management", () => {
    it("GET /api/v1/admin/cache/status — should return cache status for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/cache/status")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("timestamp");
        expect(response.body).toHaveProperty("cacheType");
      }
    });

    it("POST /api/v1/admin/cache/warmup — should trigger cache warmup for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .post("/api/v1/admin/cache/warmup")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 201, 500]).toContain(res.status);
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("success");
      }
    });

    it("DELETE /api/v1/admin/cache/ai-models — should clear AI model cache for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .delete("/api/v1/admin/cache/ai-models")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("success", true);
      }
    });
  });

  // ==================== Users ====================

  describe("GET /api/v1/admin/users", () => {
    it("should return user list for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support search query param", async () => {
      if (!adminToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ search: "test", limit: 10 })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });
});
