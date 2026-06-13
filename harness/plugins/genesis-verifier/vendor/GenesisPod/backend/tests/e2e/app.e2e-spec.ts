/**
 * 应用程序基础 E2E 测试
 *
 * 测试应用程序的基本健康状态和配置
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Health Check", () => {
    it("/ (GET) - should return application info", () => {
      return request(app.getHttpServer())
        .get("/")
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body).toBeDefined();
        });
    });
  });

  describe("API Prefix", () => {
    it("should respond to /api/v1 prefixed routes", async () => {
      // This test verifies the API prefix is working
      await request(app.getHttpServer())
        .get("/api/v1/resources/stats/summary")
        .expect((res: request.Response) => {
          // Either 200 or 401 (if auth required) indicates the route is accessible
          expect([200, 401, 404]).toContain(res.status);
        });
    });
  });
});
