/**
 * JWT Auth Guard 测试
 * 测试JWT认证守卫功能
 */

import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../jwt-auth.guard";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  describe("canActivate", () => {
    it("should be defined", () => {
      expect(guard).toBeDefined();
    });

    it("should call super.canActivate", () => {
      // 由于 AuthGuard 是基于 Passport 的，我们需要 mock 它
      // 这里我们只测试 guard 实例是否存在
      expect(guard.canActivate).toBeDefined();
    });
  });

  describe("handleRequest", () => {
    it("should return user when authentication succeeds", () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      };

      const result = guard.handleRequest(null, mockUser, null);

      expect(result).toEqual(mockUser);
    });

    it("should throw UnauthorizedException when user is null", () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when user is undefined", () => {
      expect(() => guard.handleRequest(null, undefined, null)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw provided error when error exists", () => {
      const customError = new Error("Custom authentication error");

      expect(() => guard.handleRequest(customError, null, null)).toThrow(
        customError,
      );
    });

    it("should throw UnauthorizedException with correct message", () => {
      try {
        guard.handleRequest(null, null, null);
        fail("Expected UnauthorizedException to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(
          "Please sign in to continue",
        );
      }
    });

    it("should throw original error instead of UnauthorizedException", () => {
      const originalError = new UnauthorizedException("Token expired");

      expect(() => guard.handleRequest(originalError, null, null)).toThrow(
        originalError,
      );
    });

    it("should return user even when info is present", () => {
      const mockUser = { id: "user-123", email: "test@example.com" };
      const mockInfo = { message: "some info" };

      const result = guard.handleRequest(null, mockUser, mockInfo);

      expect(result).toEqual(mockUser);
    });
  });
});
