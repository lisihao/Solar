/**
 * TopicAccessGuard Tests
 *
 * Covers:
 * - RequireTopicAccess decorator
 * - TOPIC_ACCESS_KEY constant
 * - canActivate: unauthenticated user throws ForbiddenException
 * - canActivate: no required role → passes
 * - canActivate: topicId missing → throws ForbiddenException
 * - canActivate: hasAccess false → throws ForbiddenException
 * - canActivate: hasAccess true → returns true and sets request.topicId
 * - extractTopicId from various param positions
 * - getAccessDeniedMessage for each CollaboratorRole
 */

jest.mock("@prisma/client", () => ({
  AIModelType: { CHAT: "CHAT" },
  PrismaClient: class {},
}));

jest.mock("@/modules/ai-app/insight/services", () => ({
  TopicCollaboratorService: class {},
}));

jest.mock("@/common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  TopicAccessGuard,
  RequireTopicAccess,
  TOPIC_ACCESS_KEY,
} from "../topic-access.guard";
import { CollaboratorRole } from "../../dto/collaborator.dto";
import { TopicCollaboratorService } from "../../services";

// Minimal mock for ExecutionContext
function buildMockContext(
  user: Record<string, unknown> | null,
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  handlerName = "testHandler",
  classRef: object = class TestController {},
): {
  switchToHttp: () => { getRequest: () => unknown };
  getHandler: () => { name: string };
  getClass: () => object;
} {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params, body, method: "POST", url: "/test" }),
    }),
    getHandler: () => ({ name: handlerName }),
    getClass: () => classRef,
  };
}

describe("TOPIC_ACCESS_KEY", () => {
  it("should be the string 'topic_access_role'", () => {
    expect(TOPIC_ACCESS_KEY).toBe("topic_access_role");
  });
});

describe("RequireTopicAccess decorator", () => {
  it("should be a function that returns a decorator", () => {
    expect(typeof RequireTopicAccess).toBe("function");
    const decorator = RequireTopicAccess(CollaboratorRole.EDITOR);
    expect(typeof decorator).toBe("function");
  });
});

describe("TopicAccessGuard", () => {
  let guard: TopicAccessGuard;
  let reflector: jest.Mocked<Reflector>;
  let collaboratorService: jest.Mocked<TopicCollaboratorService>;

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const mockCollaboratorService = {
      hasAccess: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicAccessGuard,
        { provide: Reflector, useValue: mockReflector },
        {
          provide: TopicCollaboratorService,
          useValue: mockCollaboratorService,
        },
      ],
    }).compile();

    guard = module.get<TopicAccessGuard>(TopicAccessGuard);
    reflector = module.get(Reflector);
    collaboratorService = module.get(TopicCollaboratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("canActivate - unauthenticated", () => {
    it("should throw ForbiddenException when user is null", async () => {
      const context = buildMockContext(null);

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "Authentication required",
      );
    });

    it("should throw ForbiddenException when user has no id", async () => {
      const context = buildMockContext({});

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw ForbiddenException when user id is empty string", async () => {
      const context = buildMockContext({ id: "" });

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("canActivate - no required role", () => {
    it("should return true when no required role is set", async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = buildMockContext({ id: "user-1" });

      const result = await guard.canActivate(context as never);

      expect(result).toBe(true);
      expect(collaboratorService.hasAccess).not.toHaveBeenCalled();
    });
  });

  describe("canActivate - topicId extraction", () => {
    it("should throw ForbiddenException when topicId is missing from params and body", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.VIEWER);
      const context = buildMockContext({ id: "user-1" }, {}, {});

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "Topic ID required",
      );
    });

    it("should extract topicId from params.id", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.VIEWER);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      const result = await guard.canActivate(context as never);

      expect(result).toBe(true);
      expect(collaboratorService.hasAccess).toHaveBeenCalledWith(
        "topic-123",
        "user-1",
        CollaboratorRole.VIEWER,
      );
    });

    it("should extract topicId from params.topicId", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.EDITOR);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-1" },
        { topicId: "topic-456" },
        {},
      );

      const result = await guard.canActivate(context as never);

      expect(result).toBe(true);
      expect(collaboratorService.hasAccess).toHaveBeenCalledWith(
        "topic-456",
        "user-1",
        CollaboratorRole.EDITOR,
      );
    });

    it("should extract topicId from body.topicId when params are absent", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.VIEWER);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-1" },
        {},
        { topicId: "topic-789" },
      );

      const result = await guard.canActivate(context as never);

      expect(result).toBe(true);
      expect(collaboratorService.hasAccess).toHaveBeenCalledWith(
        "topic-789",
        "user-1",
        CollaboratorRole.VIEWER,
      );
    });

    it("should prefer params.topicId over body.topicId", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.VIEWER);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-1" },
        { topicId: "topic-param" },
        { topicId: "topic-body" },
      );

      await guard.canActivate(context as never);

      expect(collaboratorService.hasAccess).toHaveBeenCalledWith(
        "topic-param",
        "user-1",
        CollaboratorRole.VIEWER,
      );
    });
  });

  describe("canActivate - access control", () => {
    it("should return true when user has required access", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.EDITOR);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      const result = await guard.canActivate(context as never);

      expect(result).toBe(true);
    });

    it("should set request.topicId when access is granted", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.EDITOR);
      collaboratorService.hasAccess.mockResolvedValue(true);

      const mockRequest = {
        user: { id: "user-1" },
        params: { id: "topic-123" },
        body: {},
        method: "POST",
        url: "/test",
        topicId: undefined as string | undefined,
      };

      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
        getHandler: () => ({ name: "testHandler" }),
        getClass: () => class TestController {},
      };

      await guard.canActivate(context as never);

      expect(mockRequest.topicId).toBe("topic-123");
    });

    it("should throw ForbiddenException with VIEWER message when user lacks VIEWER access", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.VIEWER);
      collaboratorService.hasAccess.mockResolvedValue(false);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "需要查看权限",
      );
    });

    it("should throw ForbiddenException with EDITOR message when user lacks EDITOR access", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.EDITOR);
      collaboratorService.hasAccess.mockResolvedValue(false);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "需要编辑权限",
      );
    });

    it("should throw ForbiddenException with ADMIN message when user lacks ADMIN access", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.ADMIN);
      collaboratorService.hasAccess.mockResolvedValue(false);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "需要管理员权限",
      );
    });

    it("should throw ForbiddenException with generic message for unknown role", async () => {
      reflector.getAllAndOverride.mockReturnValue(
        "UNKNOWN_ROLE" as CollaboratorRole,
      );
      collaboratorService.hasAccess.mockResolvedValue(false);
      const context = buildMockContext(
        { id: "user-1" },
        { id: "topic-123" },
        {},
      );

      await expect(guard.canActivate(context as never)).rejects.toThrow(
        "无权访问该专题",
      );
    });
  });

  describe("canActivate - security logging", () => {
    it("should call collaboratorService.hasAccess with correct arguments", async () => {
      reflector.getAllAndOverride.mockReturnValue(CollaboratorRole.ADMIN);
      collaboratorService.hasAccess.mockResolvedValue(true);
      const context = buildMockContext(
        { id: "user-admin" },
        { id: "topic-abc" },
        {},
      );

      await guard.canActivate(context as never);

      expect(collaboratorService.hasAccess).toHaveBeenCalledTimes(1);
      expect(collaboratorService.hasAccess).toHaveBeenCalledWith(
        "topic-abc",
        "user-admin",
        CollaboratorRole.ADMIN,
      );
    });
  });
});
