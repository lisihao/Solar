/**
 * 资源管理模块 E2E 测试
 *
 * 测试资源的 CRUD 操作、搜索、统计等功能
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("ResourcesController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let createdResourceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    // 清理测试资源
    if (createdResourceId) {
      try {
        await prisma.resource.delete({ where: { id: createdResourceId } });
      } catch {
        // 忽略删除失败
      }
    }
    await app.close();
  });

  describe("GET /api/v1/resources", () => {
    it("should return paginated resource list", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources")
        .query({ skip: 0, take: 10 })
        .expect(200);

      expect(response.body).toHaveProperty("resources");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.resources)).toBe(true);
    });

    it("should filter by type", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources")
        .query({ type: "PAPER", skip: 0, take: 10 })
        .expect(200);

      expect(response.body).toHaveProperty("resources");
      // All returned resources should be of type PAPER
      response.body.resources.forEach((resource: any) => {
        expect(resource.type).toBe("PAPER");
      });
    });

    it("should support search query", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources")
        .query({ search: "machine learning", skip: 0, take: 10 })
        .expect(200);

      expect(response.body).toHaveProperty("resources");
    });

    it("should support sorting", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources")
        .query({ sortBy: "publishedAt", sortOrder: "desc", skip: 0, take: 10 })
        .expect(200);

      expect(response.body).toHaveProperty("resources");
    });
  });

  describe("GET /api/v1/resources/stats/summary", () => {
    it("should return resource statistics", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources/stats/summary")
        .expect(200);

      expect(response.body).toBeDefined();
      // Stats structure may include total, by type, etc.
    });
  });

  describe("GET /api/v1/resources/search/suggestions", () => {
    it("should return search suggestions", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources/search/suggestions")
        .query({ q: "machine", limit: 5 })
        .expect(200);

      expect(response.body).toHaveProperty("suggestions");
      expect(Array.isArray(response.body.suggestions)).toBe(true);
    });

    it("should return empty for short query", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources/search/suggestions")
        .query({ q: "a", limit: 5 })
        .expect(200);

      expect(response.body.suggestions).toEqual([]);
    });
  });

  describe("POST /api/v1/resources", () => {
    it("should create a new resource", async () => {
      const resourceData = {
        title: `E2E Test Resource ${Date.now()}`,
        type: "BLOG",
        sourceUrl: `https://example.com/test-${Date.now()}`,
        abstract: "This is a test resource created during E2E testing",
      };

      const response = await request(app.getHttpServer())
        .post("/api/v1/resources")
        .send(resourceData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.title).toBe(resourceData.title);
      expect(response.body.type).toBe(resourceData.type);

      createdResourceId = response.body.id;
    });
  });

  describe("GET /api/v1/resources/:id", () => {
    it("should return resource by id", async () => {
      // Skip if no resource was created
      if (!createdResourceId) {
        return;
      }

      const response = await request(app.getHttpServer())
        .get(`/api/v1/resources/${createdResourceId}`)
        .expect(200);

      expect(response.body).toHaveProperty("id", createdResourceId);
      expect(response.body).toHaveProperty("title");
      expect(response.body).toHaveProperty("type");
    });

    it("should return 404 for non-existent resource", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/resources/non-existent-id-12345")
        .expect(404);
    });
  });

  describe("PATCH /api/v1/resources/:id", () => {
    it("should update resource", async () => {
      if (!createdResourceId) {
        return;
      }

      const updateData = {
        title: `Updated E2E Test Resource ${Date.now()}`,
        abstract: "Updated abstract content",
      };

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/resources/${createdResourceId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.title).toBe(updateData.title);
      expect(response.body.abstract).toBe(updateData.abstract);
    });
  });

  describe("POST /api/v1/resources/import-url", () => {
    it("should reject import without URL", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/resources/import-url")
        .send({ type: "BLOG" })
        .expect(400);
    });

    it("should reject import without type", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/resources/import-url")
        .send({ url: "https://example.com" })
        .expect(400);
    });

    it("should reject invalid resource type", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/resources/import-url")
        .send({ url: "https://example.com", type: "INVALID_TYPE" })
        .expect(400);
    });
  });

  describe("GET /api/v1/resources/ai/health", () => {
    it("should return AI service health status", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/resources/ai/health")
        .expect(200);

      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("aiServiceAvailable");
    });
  });

  describe("DELETE /api/v1/resources/:id", () => {
    it("should delete resource", async () => {
      if (!createdResourceId) {
        return;
      }

      await request(app.getHttpServer())
        .delete(`/api/v1/resources/${createdResourceId}`)
        .expect(200);

      // Verify deletion
      await request(app.getHttpServer())
        .get(`/api/v1/resources/${createdResourceId}`)
        .expect(404);

      // Clear the ID since it's deleted
      createdResourceId = "";
    });
  });
});
