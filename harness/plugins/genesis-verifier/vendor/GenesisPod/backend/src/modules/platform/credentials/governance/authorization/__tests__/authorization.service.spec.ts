import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthRequestStatus, AuthRequestType } from "@prisma/client";
import { AuthorizationService } from "../authorization.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("AuthorizationService", () => {
  let service: AuthorizationService;
  let prisma: {
    authorizationRequest: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    authorizationGrant: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      authorizationRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "req-1" }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      authorizationGrant: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AuthorizationService);
  });

  it("重复 PENDING 申请被拒", async () => {
    prisma.authorizationRequest.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      service.createRequest("u1", {
        type: AuthRequestType.TOOL_GRANT,
        targetId: "tavily",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("approve 待审批申请 → 标记 APPROVED + 建 Grant", async () => {
    prisma.authorizationRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "u1",
      type: AuthRequestType.TOOL_GRANT,
      targetId: "tavily",
      status: AuthRequestStatus.PENDING,
    });
    prisma.authorizationRequest.update.mockResolvedValue({});
    prisma.authorizationGrant.create.mockResolvedValue({ id: "grant-1" });

    const grant = await service.approve("admin-1", "req-1", {});

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.authorizationGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          type: AuthRequestType.TOOL_GRANT,
          targetId: "tavily",
          grantedBy: "admin-1",
        }),
      }),
    );
    expect(grant).toEqual({ id: "grant-1" });
  });

  it("approve 已处理申请 → BadRequest", async () => {
    prisma.authorizationRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: AuthRequestStatus.APPROVED,
    });
    await expect(
      service.approve("admin-1", "req-1", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("cancel 非 owner 申请 → NotFound", async () => {
    prisma.authorizationRequest.findFirst.mockResolvedValue(null);
    await expect(service.cancelRequest("u1", "req-x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
