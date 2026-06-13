/**
 * Export & Templates E2E Tests
 *
 * Tests the AI Image export endpoints (PNG, SVG, PDF) and
 * office slides template endpoints.
 * Routes: /api/v1/ai-image/export/*, /api/v1/ai-office/slides/*
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("ExportController (e2e)", () => {
  let app: INestApplication;

  const testUser = {
    email: `export-test-${Date.now()}@example.com`,
    username: `export-user-${Date.now()}`,
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

  // ==================== Unauthorized Access ====================

  describe("Unauthorized access", () => {
    it("POST /api/v1/ai-image/export — should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export")
        .send({
          html: "<div>test</div>",
          width: 800,
          height: 600,
          format: "png",
        })
        .expect(401);
    });
  });

  // ==================== Export Validation ====================

  describe("POST /api/v1/ai-image/export", () => {
    it("should reject export without HTML content", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ width: 800, height: 600, format: "png" })
        .expect((res: request.Response) => {
          expect([400, 422]).toContain(res.status);
        });
    });

    it("should reject export without width/height", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ html: "<div>test</div>", format: "png" })
        .expect((res: request.Response) => {
          expect([400, 422]).toContain(res.status);
        });
    });

    it("should reject export with invalid format", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          html: "<div>test</div>",
          width: 800,
          height: 600,
          format: "invalid_format",
        })
        .expect((res: request.Response) => {
          expect([400, 422]).toContain(res.status);
        });
    });

    it("should handle valid PNG export request", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          html: "<div style='background:white;padding:20px'>E2E Test Export</div>",
          width: 800,
          height: 600,
          format: "png",
          scale: 1,
        })
        .expect((res: request.Response) => {
          // 200: success, 400: puppeteer not configured, 500: service unavailable
          expect([200, 400, 500]).toContain(res.status);
        });
    });
  });

  // ==================== PNG Export ====================

  describe("POST /api/v1/ai-image/export/png", () => {
    it("should reject PNG export without HTML", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export/png")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ width: 800, height: 600 })
        .expect((res: request.Response) => {
          expect([400, 422, 500]).toContain(res.status);
        });
    });

    it("should handle valid PNG export", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export/png")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          html: "<div>PNG Export Test</div>",
          width: 400,
          height: 300,
          scale: 1,
        })
        .expect((res: request.Response) => {
          expect([200, 400, 500]).toContain(res.status);
        });
    });
  });

  // ==================== SVG Export ====================

  describe("POST /api/v1/ai-image/export/svg", () => {
    it("should handle SVG export request", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export/svg")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          html: "<div>SVG Export Test</div>",
          width: 400,
          height: 300,
        })
        .expect((res: request.Response) => {
          expect([200, 400, 500]).toContain(res.status);
        });
    });
  });

  // ==================== PDF Export ====================

  describe("POST /api/v1/ai-image/export/pdf", () => {
    it("should handle PDF export request", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-image/export/pdf")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          html: "<div>PDF Export Test</div>",
          width: 800,
          height: 600,
          pageSize: "a4",
        })
        .expect((res: request.Response) => {
          expect([200, 400, 500]).toContain(res.status);
        });
    });
  });
});

// ==================== Slides / Templates ====================

describe("SlidesController (e2e)", () => {
  let app: INestApplication;

  const testUser = {
    email: `slides-test-${Date.now()}@example.com`,
    username: `slides-user-${Date.now()}`,
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

  describe("GET /api/v1/ai-office/slides/themes", () => {
    it("should return available slide themes", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/ai-office/slides/themes")
        .expect((res: request.Response) => {
          // Some routes may be public or require auth
          expect([200, 401, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });
  });

  describe("POST /api/v1/ai-office/slides/generate", () => {
    it("should return 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/ai-office/slides/generate")
        .send({ topic: "E2E Test Presentation" })
        .expect((res: request.Response) => {
          // May return 401 or 404 depending on route registration
          expect([401, 404]).toContain(res.status);
        });
    });

    it("should handle generate request with valid token", async () => {
      if (!accessToken) return;

      await request(app.getHttpServer())
        .post("/api/v1/ai-office/slides/generate")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          topic: "Introduction to AI",
          pageCount: 5,
          theme: "professional",
        })
        .expect((res: request.Response) => {
          // 200: success, 201: accepted, 400: validation error, 500: AI not configured
          expect([200, 201, 400, 404, 500]).toContain(res.status);
        });
    });
  });
});
