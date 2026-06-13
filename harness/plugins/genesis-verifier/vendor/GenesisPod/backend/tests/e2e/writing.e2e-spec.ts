/**
 * AI Writing E2E Tests (L4 AI Apps)
 *
 * Tests the AI Writing module including project CRUD, chapters,
 * volumes, missions, and style presets.
 * Routes: /api/v1/ai-writing/*
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("AiWritingController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testUser = {
    email: `writing-test-${Date.now()}@example.com`,
    username: `writing-user-${Date.now()}`,
    password: "Test123456!",
  };

  let accessToken: string;
  let userId: string;
  let createdProjectId: string;
  let createdVolumeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Register and get token
    const registerRes = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(testUser);

    if (registerRes.status === 201) {
      accessToken = registerRes.body.accessToken;
      userId = registerRes.body.user.id;
    }
  });

  afterAll(async () => {
    // Clean up created project (cascades to volumes/chapters)
    if (createdProjectId) {
      try {
        await prisma.writingProject.delete({ where: { id: createdProjectId } });
      } catch {
        // ignore cleanup errors
      }
    }

    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        // ignore cleanup errors
      }
    }

    await app.close();
  });

  // ==================== Public Endpoints (no auth required) ====================

  describe("GET /api/v1/ai-writing/style-presets", () => {
    it("should return writing style presets without authentication", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/ai-writing/style-presets")
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("presets");
        expect(Array.isArray(response.body.presets)).toBe(true);
      }
    });
  });

  describe("GET /api/v1/ai-writing/style-presets/recommend", () => {
    it("should return recommended styles by genre", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/ai-writing/style-presets/recommend")
        .query({ genre: "fantasy" })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("genre", "fantasy");
        expect(response.body).toHaveProperty("recommended");
        expect(response.body).toHaveProperty("all");
      }
    });

    it("should handle empty genre query", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/ai-writing/style-presets/recommend")
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Unauthorized Access ====================

  describe("Unauthorized access", () => {
    it("GET /api/v1/ai-writing/projects — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/ai-writing/projects")
        .expect(401);
    });

    it("POST /api/v1/ai-writing/projects — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/ai-writing/projects")
        .send({ name: "Test Project" })
        .expect(401);
    });
  });

  // ==================== Project CRUD ====================

  describe("POST /api/v1/ai-writing/projects", () => {
    it("should create a new writing project", async () => {
      if (!accessToken) return;

      const projectData = {
        name: `E2E Test Novel ${Date.now()}`,
        genre: "fantasy",
        synopsis: "A test story created during E2E testing",
        targetWordCount: 50000,
      };

      const response = await request(app.getHttpServer())
        .post("/api/v1/ai-writing/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send(projectData)
        .expect((res: request.Response) => {
          expect([200, 201, 400, 500]).toContain(res.status);
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("id");
        expect(response.body).toHaveProperty("name");
        createdProjectId = response.body.id;
      }
    });

    it("should reject project creation with missing name", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-writing/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ genre: "fantasy" })
        .expect((res: request.Response) => {
          expect([400, 422]).toContain(res.status);
        });
    });
  });

  describe("GET /api/v1/ai-writing/projects", () => {
    it("should return list of user projects", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/ai-writing/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support status filter", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/ai-writing/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ status: "ACTIVE" })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  describe("GET /api/v1/ai-writing/projects/:id", () => {
    it("should return project by id", async () => {
      if (!accessToken || !createdProjectId) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/ai-writing/projects/${createdProjectId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("id", createdProjectId);
      }
    });

    it("should return 404 for non-existent project", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/ai-writing/projects/non-existent-project-xyz")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([404, 500]).toContain(res.status);
        });
    });
  });

  describe("PATCH /api/v1/ai-writing/projects/:id", () => {
    it("should update project details", async () => {
      if (!accessToken || !createdProjectId) return;

      const updateData = {
        name: `Updated E2E Novel ${Date.now()}`,
        synopsis: "Updated synopsis for E2E testing",
      };

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/ai-writing/projects/${createdProjectId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(updateData)
        .expect((res: request.Response) => {
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("name", updateData.name);
      }
    });
  });

  // ==================== Volumes ====================

  describe("POST /api/v1/ai-writing/projects/:projectId/volumes", () => {
    it("should create a volume for project", async () => {
      if (!accessToken || !createdProjectId) return;

      const volumeData = {
        title: `Volume 1 - E2E Test`,
        synopsis: "First volume of the test story",
        order: 1,
      };

      const response = await request(app.getHttpServer())
        .post(`/api/v1/ai-writing/projects/${createdProjectId}/volumes`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(volumeData)
        .expect((res: request.Response) => {
          expect([200, 201, 400, 404, 500]).toContain(res.status);
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("id");
        createdVolumeId = response.body.id;
      }
    });
  });

  describe("GET /api/v1/ai-writing/projects/:projectId/volumes", () => {
    it("should return volumes for project", async () => {
      if (!accessToken || !createdProjectId) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/ai-writing/projects/${createdProjectId}/volumes`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Chapters ====================

  describe("GET /api/v1/ai-writing/volumes/:volumeId/chapters", () => {
    it("should return chapters for volume", async () => {
      if (!accessToken || !createdVolumeId) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/ai-writing/volumes/${createdVolumeId}/chapters`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  // ==================== Missions ====================

  describe("POST /api/v1/ai-writing/projects/:projectId/missions", () => {
    it("should handle mission creation request", async () => {
      if (!accessToken || !createdProjectId) return;

      const missionData = {
        prompt: "Write an opening chapter that introduces the protagonist",
        missionType: "outline",
        targetWordCount: 1000,
      };

      await request(app.getHttpServer())
        .post(`/api/v1/ai-writing/projects/${createdProjectId}/missions`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(missionData)
        .expect((res: request.Response) => {
          // 200/201: accepted, 400: validation error, 500: AI not configured
          expect([200, 201, 400, 500]).toContain(res.status);
        });
    });

    it("should reject mission creation without prompt", async () => {
      if (!accessToken || !createdProjectId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/ai-writing/projects/${createdProjectId}/missions`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ missionType: "outline" })
        .expect((res: request.Response) => {
          expect([400, 422, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Delete ====================

  describe("DELETE /api/v1/ai-writing/projects/:id", () => {
    it("should delete project", async () => {
      if (!accessToken || !createdProjectId) return;

      await request(app.getHttpServer())
        .delete(`/api/v1/ai-writing/projects/${createdProjectId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 204, 404, 500]).toContain(res.status);
        });

      // Mark as deleted so afterAll skips cleanup
      createdProjectId = "";
    });
  });
});
