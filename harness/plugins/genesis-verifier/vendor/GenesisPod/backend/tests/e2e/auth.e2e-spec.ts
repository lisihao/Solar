/**
 * 认证模块 E2E 测试
 *
 * 测试用户注册、登录、Token 刷新等流程
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("AuthController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // 测试用户数据
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    username: `testuser-${Date.now()}`,
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

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    // 清理测试用户
    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        // 忽略删除失败
      }
    }
    await app.close();
  });

  describe("POST /api/v1/auth/register", () => {
    it("should register a new user successfully", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: testUser.email,
          username: testUser.username,
          password: testUser.password,
        })
        .expect(201);

      expect(response.body).toHaveProperty("user");
      expect(response.body).toHaveProperty("accessToken");
      expect(response.body).toHaveProperty("refreshToken");
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user).not.toHaveProperty("passwordHash");

      userId = response.body.user.id;
      accessToken = response.body.accessToken;
    });

    it("should reject duplicate email registration", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: testUser.email,
          username: "another-username",
          password: "AnotherPass123!",
        })
        .expect(400);

      expect(response.body.message).toContain("already exists");
    });

    it("should reject invalid email format", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: "invalid-email",
          username: "testuser",
          password: "Test123456!",
        })
        .expect(400);

      expect(response.body).toBeDefined();
    });

    it("should reject weak password", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: "weak@example.com",
          username: "weakuser",
          password: "123", // Too short
        })
        .expect(400);

      expect(response.body).toBeDefined();
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("should login with correct credentials", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(201);

      expect(response.body).toHaveProperty("user");
      expect(response.body).toHaveProperty("accessToken");
      expect(response.body).toHaveProperty("refreshToken");
      expect(response.body.user.email).toBe(testUser.email);

      // Update token for subsequent tests
      accessToken = response.body.accessToken;
    });

    it("should reject incorrect password", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          email: testUser.email,
          password: "wrongpassword",
        })
        .expect(401);
    });

    it("should reject non-existent user", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          email: "nonexistent@example.com",
          password: "anypassword",
        })
        .expect(401);
    });
  });

  describe("GET /api/v1/auth/me", () => {
    it("should return user profile with valid token", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("id");
      expect(response.body).toHaveProperty("email", testUser.email);
      expect(response.body).not.toHaveProperty("passwordHash");
    });

    it("should reject request without token", async () => {
      await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
    });

    it("should reject request with invalid token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer invalid-token")
        .expect(401);
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("should refresh token with valid access token", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(201);

      expect(response.body).toHaveProperty("accessToken");
      expect(response.body).toHaveProperty("refreshToken");

      // Update token
      accessToken = response.body.accessToken;
    });
  });

  describe("PATCH /api/v1/auth/profile", () => {
    it("should update user profile", async () => {
      const newUsername = `updated-${Date.now()}`;

      const response = await request(app.getHttpServer())
        .patch("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          username: newUsername,
        })
        .expect(200);

      expect(response.body).toHaveProperty("username", newUsername);
    });
  });

  describe("GET /api/v1/auth/stats", () => {
    it("should return user statistics", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/stats")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
      // Stats structure depends on implementation
    });
  });
});
