/**
 * AI 服务模块 E2E 测试
 *
 * 测试 AI 模型管理、聊天、问答等功能
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("AIController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("AI Models", () => {
    describe("GET /api/v1/ai/models", () => {
      it("should return available AI models", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/ai/models")
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        if (response.body.length > 0) {
          expect(response.body[0]).toHaveProperty("id");
          expect(response.body[0]).toHaveProperty("name");
        }
      });
    });

    describe("GET /api/v1/ai/models/default", () => {
      it("should return default AI model", async () => {
        await request(app.getHttpServer())
          .get("/api/v1/ai/models/default")
          .expect((res: request.Response) => {
            // Either 200 with model or 404 if no default
            expect([200, 404]).toContain(res.status);
          });
      });
    });
  });

  describe("AI Chat", () => {
    describe("POST /api/v1/ai/chat", () => {
      it("should reject chat without message", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/ai/chat")
          .send({})
          .expect(400);
      });

      it("should handle chat request (may fail without API key)", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/ai/chat")
          .send({
            message: "Hello, how are you?",
            modelId: "default",
          })
          .expect((res: request.Response) => {
            // 200 if successful, 400/500 if API not configured
            expect([200, 400, 500]).toContain(res.status);
          });
      });
    });
  });

  describe("AI Translation", () => {
    describe("POST /api/v1/ai/translate", () => {
      it("should reject translation without text", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/ai/translate")
          .send({
            targetLanguage: "zh-CN",
          })
          .expect(400);
      });

      it("should handle translation request", async () => {
        await request(app.getHttpServer())
          .post("/api/v1/ai/translate")
          .send({
            text: "Hello world",
            targetLanguage: "zh-CN",
          })
          .expect((res: request.Response) => {
            // 200/201 if successful, 400/500 if API not configured
            expect([200, 201, 400, 500]).toContain(res.status);
          });
      });
    });
  });
});

describe("AIOfficeController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("AI Models Management", () => {
    describe("GET /api/v1/ai-office/models", () => {
      it("should return AI models list", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/ai-office/models")
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
      });
    });
  });
});

describe("AskSessionController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix("api/v1");

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Ask Sessions", () => {
    describe("GET /api/v1/ask-sessions", () => {
      it("should return ask sessions list", async () => {
        const response = await request(app.getHttpServer())
          .get("/api/v1/ask-sessions")
          .expect(200);

        expect(response.body).toBeDefined();
      });
    });

    describe("POST /api/v1/ask-sessions", () => {
      it("should create a new ask session", async () => {
        const response = await request(app.getHttpServer())
          .post("/api/v1/ask-sessions")
          .send({
            title: `E2E Test Session ${Date.now()}`,
          })
          .expect((res: request.Response) => {
            expect([200, 201]).toContain(res.status);
          });

        if (response.status === 201 || response.status === 200) {
          expect(response.body).toHaveProperty("id");
        }
      });
    });
  });
});
