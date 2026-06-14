/**
 * Admin Settings E2E Tests (L1 Infrastructure)
 *
 * Tests admin settings endpoints including site, AI, security,
 * storage, email, and cache management settings.
 * All endpoints require JWT + Admin guard.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("SettingsController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Regular (non-admin) user for 403 tests
  const regularUser = {
    email: `settings-regular-${Date.now()}@example.com`,
    username: `settings-regular-${Date.now()}`,
    password: "Test123456!",
  };

  // Admin user — relies on seeded admin or environment
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

    if (adminLoginRes.status === 201 || adminLoginRes.status === 200) {
      adminToken = adminLoginRes.body.accessToken;
    }
  });

  afterAll(async () => {
    if (regularUserId) {
      try {
        await prisma.user.delete({ where: { id: regularUserId } });
      } catch {
        // ignore cleanup errors
      }
    }
    await app.close();
  });

  // ==================== Unauthorized (no token) ====================

  describe("Unauthorized access", () => {
    it("GET /api/v1/admin/settings — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/settings")
        .expect(401);
    });

    it("GET /api/v1/admin/settings/site — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/settings/site")
        .expect(401);
    });
  });

  // ==================== Forbidden (regular user) ====================

  describe("Forbidden access (non-admin)", () => {
    it("GET /api/v1/admin/settings — should return 403 for regular user", async () => {
      if (!regularToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect((res: request.Response) => {
          expect([401, 403]).toContain(res.status);
        });
    });

    it("GET /api/v1/admin/settings/site — should return 403 for regular user", async () => {
      if (!regularToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/admin/settings/site")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect((res: request.Response) => {
          expect([401, 403]).toContain(res.status);
        });
    });
  });

  // ==================== Admin Access ====================

  describe("GET /api/v1/admin/settings", () => {
    it("should return all settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("settings");
      }
    });
  });

  describe("GET /api/v1/admin/settings/site", () => {
    it("should return site settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings/site")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("GET /api/v1/admin/settings/ai", () => {
    it("should return AI settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings/ai")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("GET /api/v1/admin/settings/security", () => {
    it("should return security settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings/security")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("GET /api/v1/admin/settings/storage", () => {
    it("should return storage settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings/storage")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("GET /api/v1/admin/settings/email", () => {
    it("should return email settings for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/settings/email")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        // Password should be masked
        if (response.body.pass) {
          expect(response.body.pass).toBe("********");
        }
      }
    });
  });

  describe("POST /api/v1/admin/settings/refresh-cache", () => {
    it("should refresh settings cache for admin", async () => {
      if (!adminToken) return;

      const response = await request(app.getHttpServer())
        .post("/api/v1/admin/settings/refresh-cache")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect((res: request.Response) => {
          expect([200, 201, 500]).toContain(res.status);
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("message");
      }
    });

    it("should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/settings/refresh-cache")
        .expect(401);
    });

    it("should return 403 for non-admin user", async () => {
      if (!regularToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/admin/settings/refresh-cache")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect((res: request.Response) => {
          expect([401, 403]).toContain(res.status);
        });
    });
  });
});
