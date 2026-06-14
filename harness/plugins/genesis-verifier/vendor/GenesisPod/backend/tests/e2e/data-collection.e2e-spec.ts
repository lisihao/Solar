/**
 * 数据采集模块 E2E 测试
 *
 * 测试数据采集任务的创建、执行、监控等功能
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("DataCollectionController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let createdTaskId: string;

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
    // 清理测试任务
    if (createdTaskId) {
      try {
        await prisma.collectionTask.delete({ where: { id: createdTaskId } });
      } catch {
        // 忽略删除失败
      }
    }
    await app.close();
  });

  describe("Collection Tasks", () => {
    describe("GET /api/v1/collection-tasks", () => {
      it("should return task list", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/collection-tasks")
          .expect(200);

        expect(
          Array.isArray(response.body) || response.body.tasks,
        ).toBeTruthy();
      });
    });

    describe("POST /api/v1/collection-tasks", () => {
      it("should create a new collection task", async () => {
        const taskData = {
          name: `E2E Test Task ${Date.now()}`,
          source: "hackernews",
          config: {
            maxItems: 5,
            category: "top",
          },
        };

        const response = await request(app.getHttpServer())
          .post("/api/v1/collection-tasks")
          .send(taskData)
          .expect(201);

        expect(response.body).toHaveProperty("id");
        expect(response.body.name).toBe(taskData.name);
        expect(response.body.source).toBe(taskData.source);

        createdTaskId = response.body.id;
      });

      it("should reject task without name", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/collection-tasks")
          .send({
            source: "hackernews",
            config: {},
          })
          .expect(400);
      });

      it("should reject task without source", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/collection-tasks")
          .send({
            name: "Test Task",
            config: {},
          })
          .expect(400);
      });
    });

    describe("GET /api/v1/collection-tasks/:id", () => {
      it("should return task by id", async () => {
        if (!createdTaskId) return;

        const response = await request(app.getHttpServer())
          .get(`/api/v1/collection-tasks/${createdTaskId}`)
          .expect(200);

        expect(response.body).toHaveProperty("id", createdTaskId);
      });

      it("should return 404 for non-existent task", async () => {
        await request(app.getHttpServer())
          .get("/api/v1/collection-tasks/non-existent-id")
          .expect(404);
      });
    });
  });

  describe("Dashboard", () => {
    describe("GET /api/v1/data-collection/dashboard/stats", () => {
      it("should return dashboard statistics", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/data-collection/dashboard/stats")
          .expect(200);

        expect(response.body).toBeDefined();
      });
    });
  });

  describe("Data Sources", () => {
    describe("GET /api/v1/data-sources", () => {
      it("should return available data sources", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/data-sources")
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
      });
    });
  });

  describe("Quality Control", () => {
    describe("GET /api/v1/data-collection/quality/summary", () => {
      it("should return quality summary", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/data-collection/quality/summary")
          .expect(200);

        expect(response.body).toBeDefined();
      });
    });
  });

  describe("History", () => {
    describe("GET /api/v1/data-collection/history", () => {
      it("should return collection history", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/data-collection/history")
          .expect(200);

        expect(response.body).toBeDefined();
      });
    });
  });
});
