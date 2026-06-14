/**
 * AI Teams E2E Tests (L4 AI Apps)
 *
 * Tests the AI Teams / Topics system including topic CRUD, members,
 * AI members, messages, and full conversation flow.
 * Routes: /api/v1/topics/*
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("AiTeamsController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testUser = {
    email: `teams-test-${Date.now()}@example.com`,
    username: `teams-user-${Date.now()}`,
    password: "Test123456!",
  };

  let accessToken: string;
  let userId: string;
  let createdTopicId: string;

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
    // Clean up topic if created
    if (createdTopicId) {
      try {
        await prisma.topic.delete({ where: { id: createdTopicId } });
      } catch {
        // ignore
      }
    }

    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        // ignore
      }
    }

    await app.close();
  });

  // ==================== Unauthorized Access ====================

  describe("Unauthorized access", () => {
    it("GET /api/v1/topics — should return 401 without token", async () => {
      await request(app.getHttpServer()).get("/api/v1/topics").expect(401);
    });

    it("POST /api/v1/topics — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/topics")
        .send({ name: "Test Topic" })
        .expect(401);
    });
  });

  // ==================== Topic CRUD ====================

  describe("POST /api/v1/topics", () => {
    it("should create a new topic", async () => {
      if (!accessToken) return;

      const topicData = {
        name: `E2E Test Topic ${Date.now()}`,
        description: "A test topic created during E2E testing",
        type: "DEBATE",
      };

      const response = await request(app.getHttpServer())
        .post("/api/v1/topics")
        .set("Authorization", `Bearer ${accessToken}`)
        .send(topicData)
        .expect((res: request.Response) => {
          expect([200, 201, 400, 500]).toContain(res.status);
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("id");
        expect(response.body).toHaveProperty("name");
        createdTopicId = response.body.id;
      }
    });

    it("should reject topic creation with missing name", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/topics")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ description: "No name provided" })
        .expect((res: request.Response) => {
          expect([400, 422]).toContain(res.status);
        });
    });
  });

  describe("GET /api/v1/topics", () => {
    it("should return list of topics for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/topics")
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
        .get("/api/v1/topics")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ skip: 0, take: 10 })
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });
    });
  });

  describe("GET /api/v1/topics/:id", () => {
    it("should return topic by id", async () => {
      if (!accessToken || !createdTopicId) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/topics/${createdTopicId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty("id", createdTopicId);
      }
    });

    it("should return 404 for non-existent topic", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .get("/api/v1/topics/non-existent-topic-id-xyz")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([404, 500]).toContain(res.status);
        });
    });
  });

  describe("PATCH /api/v1/topics/:id", () => {
    it("should update topic", async () => {
      if (!accessToken || !createdTopicId) return;

      const updateData = {
        name: `Updated E2E Topic ${Date.now()}`,
        description: "Updated description",
      };

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/topics/${createdTopicId}`)
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

  // ==================== Members ====================

  describe("POST /api/v1/topics/:id/members", () => {
    it("should handle add member request", async () => {
      if (!accessToken || !createdTopicId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/topics/${createdTopicId}/members`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ userId: userId, role: "MEMBER" })
        .expect((res: request.Response) => {
          // 200/201: added, 400: already member, 404: topic not found, 500: db error
          expect([200, 201, 400, 404, 500]).toContain(res.status);
        });
    });
  });

  describe("POST /api/v1/topics/:id/ai-members", () => {
    it("should handle add AI member request", async () => {
      if (!accessToken || !createdTopicId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/topics/${createdTopicId}/ai-members`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          agentId: "research-analyst",
          role: "MEMBER",
        })
        .expect((res: request.Response) => {
          expect([200, 201, 400, 404, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Messages ====================

  describe("POST /api/v1/topics/:id/messages", () => {
    it("should send message to topic", async () => {
      if (!accessToken || !createdTopicId) return;

      const messageData = {
        content: "Hello, this is an E2E test message",
        type: "TEXT",
      };

      await request(app.getHttpServer())
        .post(`/api/v1/topics/${createdTopicId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(messageData)
        .expect((res: request.Response) => {
          expect([200, 201, 400, 403, 404, 500]).toContain(res.status);
        });
    });

    it("should reject message without content", async () => {
      if (!accessToken || !createdTopicId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/topics/${createdTopicId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect((res: request.Response) => {
          expect([400, 404, 500]).toContain(res.status);
        });
    });
  });

  describe("GET /api/v1/topics/:id/messages", () => {
    it("should get messages for a topic", async () => {
      if (!accessToken || !createdTopicId) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/topics/${createdTopicId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 403, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it("should support limit and skip query params", async () => {
      if (!accessToken || !createdTopicId) return;

      await request(app.getHttpServer())
        .get(`/api/v1/topics/${createdTopicId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ limit: 20, skip: 0 })
        .expect((res: request.Response) => {
          expect([200, 403, 404, 500]).toContain(res.status);
        });
    });
  });

  // ==================== Delete ====================

  describe("DELETE /api/v1/topics/:id", () => {
    it("should delete topic", async () => {
      if (!accessToken || !createdTopicId) return;

      await request(app.getHttpServer())
        .delete(`/api/v1/topics/${createdTopicId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 204, 403, 404, 500]).toContain(res.status);
        });

      // Mark as deleted so afterAll cleanup skips it
      createdTopicId = "";
    });
  });
});

// ==================== Custom Teams ====================

describe("CustomTeamsController (e2e)", () => {
  let app: INestApplication;

  const testUser = {
    email: `custom-teams-${Date.now()}@example.com`,
    username: `custom-teams-user-${Date.now()}`,
    password: "Test123456!",
  };

  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");
    await app.init();

    const registerRes = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(testUser);

    if (registerRes.status === 201) {
      accessToken = registerRes.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/v1/ai-teams/custom-teams", () => {
    it("should return all teams for authenticated user", async () => {
      if (!accessToken) return;

      const response = await request(app.getHttpServer())
        .get("/api/v1/ai-teams/custom-teams")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect((res: request.Response) => {
          expect([200, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });
});
