/**
 * OptionalJwtAuthGuard unit tests
 *
 * The guard extends AuthGuard("jwt") and overrides handleRequest to return null
 * on error or missing user, rather than throwing an exception.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { OptionalJwtAuthGuard } from "../optional-jwt-auth.guard";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OptionalJwtAuthGuard", () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(async () => {
    // OptionalJwtAuthGuard extends AuthGuard("jwt") which depends on Passport.
    // For unit tests we skip the Passport strategy and test only the
    // handleRequest override — the method that controls the guard's behaviour.
    const module: TestingModule = await Test.createTestingModule({
      providers: [OptionalJwtAuthGuard],
    }).compile();

    guard = module.get<OptionalJwtAuthGuard>(OptionalJwtAuthGuard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // handleRequest — valid user
  // -------------------------------------------------------------------------

  describe("handleRequest — valid user", () => {
    it("returns the user object when no error and user is present", () => {
      const user = { id: "user-1", email: "user@example.com" };

      const result = guard.handleRequest(null, user);

      expect(result).toEqual(user);
    });

    it("returns the user object regardless of what info contains", () => {
      const user = { id: "user-2", email: "other@example.com" };
      const info = { message: "some jwt info" };

      // handleRequest has signature (err, user, info?) but our override only
      // uses err and user, so info is irrelevant.
      const result = guard.handleRequest(null, user, info);

      expect(result).toEqual(user);
    });

    it("returns any truthy user object (non-standard shape)", () => {
      const user = { sub: "sub-123", roles: ["admin"] };

      const result = guard.handleRequest(null, user);

      expect(result).toEqual(user);
    });
  });

  // -------------------------------------------------------------------------
  // handleRequest — missing or falsy user
  // -------------------------------------------------------------------------

  describe("handleRequest — missing user", () => {
    it("returns null when user is null", () => {
      const result = guard.handleRequest(null, null);

      expect(result).toBeNull();
    });

    it("returns null when user is undefined", () => {
      const result = guard.handleRequest(null, undefined);

      expect(result).toBeNull();
    });

    it("returns null when user is false", () => {
      const result = guard.handleRequest(null, false);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // handleRequest — error present
  // -------------------------------------------------------------------------

  describe("handleRequest — error cases", () => {
    it("returns null when an Error is passed (does NOT re-throw)", () => {
      const err = new Error("JWT expired");

      // Unlike JwtAuthGuard which throws, this guard should NOT throw
      expect(() => guard.handleRequest(err, null)).not.toThrow();
      expect(guard.handleRequest(err, null)).toBeNull();
    });

    it("returns null when an error is present even if a user is also passed", () => {
      const err = new Error("Something went wrong");
      const user = { id: "should-be-ignored" };

      const result = guard.handleRequest(err, user);

      expect(result).toBeNull();
    });

    it("returns null when error is a string", () => {
      const result = guard.handleRequest("string error", null);

      expect(result).toBeNull();
    });

    it("returns null for an UnauthorizedException-like error without throwing", () => {
      const err = { message: "Unauthorized", status: 401 };

      expect(() => guard.handleRequest(err, null)).not.toThrow();
      expect(guard.handleRequest(err, null)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Structural checks
  // -------------------------------------------------------------------------

  describe("structural checks", () => {
    it("is defined", () => {
      expect(guard).toBeDefined();
    });

    it("exposes canActivate method (inherited from AuthGuard)", () => {
      expect(typeof guard.canActivate).toBe("function");
    });

    it("exposes handleRequest method", () => {
      expect(typeof guard.handleRequest).toBe("function");
    });
  });
});
