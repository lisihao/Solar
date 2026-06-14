import { Test, TestingModule } from "@nestjs/testing";
import { KeyResolverService } from "../key-resolver.service";
import { KeyAssignmentsService } from "../../../governance/key-assignments/key-assignments.service";
import { UserApiKeysService } from "../../../user-owned/user-api-keys/user-api-keys.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { KeyHealthStore } from "@/modules/platform/credentials/governance/key-health";

describe("KeyResolverService.resolveKeyChain", () => {
  let service: KeyResolverService;
  let userApiKeys: jest.Mocked<Partial<UserApiKeysService>>;
  let assignments: jest.Mocked<Partial<KeyAssignmentsService>>;
  let healthStore: jest.Mocked<Partial<KeyHealthStore>>;
  let prismaUpdate: jest.Mock;
  let prismaAssignmentUpdate: jest.Mock;

  beforeEach(async () => {
    userApiKeys = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      listPersonalKeys: jest.fn().mockResolvedValue([]),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
    };
    assignments = {
      resolveActive: jest.fn().mockResolvedValue(null),
      listActive: jest.fn().mockResolvedValue([]),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
    };
    healthStore = {
      filterUsable: jest.fn(async (ids: string[]) => ids),
      getLastGood: jest.fn().mockResolvedValue(null),
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markFailure: jest.fn().mockResolvedValue(undefined),
    };
    prismaUpdate = jest.fn().mockResolvedValue({});
    prismaAssignmentUpdate = jest.fn().mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyResolverService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn() },
            userApiKey: { update: prismaUpdate },
            keyAssignment: { update: prismaAssignmentUpdate },
          },
        },
        { provide: UserApiKeysService, useValue: userApiKeys },
        { provide: KeyAssignmentsService, useValue: assignments },
        { provide: KeyHealthStore, useValue: healthStore },
      ],
    }).compile();
    service = module.get(KeyResolverService);
  });

  it("returns empty chain when user has no keys", async () => {
    const chain = await service.resolveKeyChain("u1", "openai");
    expect(chain.size).toBe(0);
    expect(await chain.next()).toBeNull();
  });

  it("returns single PERSONAL chain", async () => {
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "row1",
        label: "default",
        apiKey: "sk-1",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);
    const chain = await service.resolveKeyChain("u1", "openai");
    expect(chain.size).toBe(1);
    const k = await chain.next();
    expect(k?.source).toBe("PERSONAL");
    expect(k?.label).toBe("default");
    expect(k?.healthKeyId).toBe("personal:u1:openai:default");
  });

  it("PERSONAL keys ordered by label asc, ASSIGNED appended", async () => {
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "r1",
        label: "default",
        apiKey: "sk-d",
        apiEndpoint: null,
        preferredModelId: null,
      },
      {
        keyRowId: "r2",
        label: "backup",
        apiKey: "sk-b",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);
    (assignments.listActive as jest.Mock).mockResolvedValue([
      {
        assignmentId: "asg-1",
        keyId: "kid-1",
        apiKey: "sk-a",
        apiEndpoint: null,
        userQuotaCents: null,
        userSpendCents: 0,
      },
    ]);
    const chain = await service.resolveKeyChain("u1", "openai");
    expect(chain.size).toBe(3);
    const k1 = await chain.next();
    const k2 = await chain.next();
    const k3 = await chain.next();
    expect(k1?.label).toBe("default");
    expect(k2?.label).toBe("backup");
    expect(k3?.source).toBe("ASSIGNED");
    expect(k3?.assignmentId).toBe("asg-1");
  });

  it("LastGood is moved to head of chain", async () => {
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "r1",
        label: "default",
        apiKey: "sk-d",
        apiEndpoint: null,
        preferredModelId: null,
      },
      {
        keyRowId: "r2",
        label: "backup",
        apiKey: "sk-b",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);
    // backup 是 LastGood
    (healthStore.getLastGood as jest.Mock).mockResolvedValue(
      "personal:u1:openai:backup",
    );

    const chain = await service.resolveKeyChain("u1", "openai");
    const k1 = await chain.next();
    const k2 = await chain.next();
    expect(k1?.label).toBe("backup"); // LastGood 顶置
    expect(k2?.label).toBe("default");
  });

  it("filterUsable removes DEAD keys from chain", async () => {
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "r1",
        label: "a",
        apiKey: "sk-a",
        apiEndpoint: null,
        preferredModelId: null,
      },
      {
        keyRowId: "r2",
        label: "b",
        apiKey: "sk-b",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);
    // health 过滤掉 a
    (healthStore.filterUsable as jest.Mock).mockResolvedValue([
      "personal:u1:openai:b",
    ]);

    const chain = await service.resolveKeyChain("u1", "openai");
    expect(chain.size).toBe(1);
    const k = await chain.next();
    expect(k?.label).toBe("b");
  });

  it("LastGood is ignored if filtered out by health", async () => {
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "r1",
        label: "default",
        apiKey: "sk-d",
        apiEndpoint: null,
        preferredModelId: null,
      },
      {
        keyRowId: "r2",
        label: "backup",
        apiKey: "sk-b",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);
    // backup 已 DEAD（被 filterUsable 过滤）
    (healthStore.filterUsable as jest.Mock).mockResolvedValue([
      "personal:u1:openai:default",
    ]);
    (healthStore.getLastGood as jest.Mock).mockResolvedValue(
      "personal:u1:openai:backup",
    );

    const chain = await service.resolveKeyChain("u1", "openai");
    expect(chain.size).toBe(1);
    const k = await chain.next();
    expect(k?.label).toBe("default"); // 不是 LastGood，因为 LastGood 已死
  });

  it("reportFailure / reportSuccess fanout to KeyHealthStore", async () => {
    const markFailure = jest.fn().mockResolvedValue(undefined);
    const markSuccess = jest.fn().mockResolvedValue(undefined);
    (healthStore as any).markFailure = markFailure;
    (healthStore as any).markSuccess = markSuccess;
    (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
      {
        keyRowId: "r1",
        label: "default",
        apiKey: "sk-d",
        apiEndpoint: null,
        preferredModelId: null,
      },
    ]);

    const chain = await service.resolveKeyChain("u1", "openai");
    const k = await chain.next();
    if (!k) throw new Error("expected key");

    await chain.reportSuccess(k);
    expect(markSuccess).toHaveBeenCalledWith(
      "personal:u1:openai:default",
      "openai",
      "u1",
    );

    await chain.reportFailure(k, {
      action: "NEXT_KEY",
      reason: "AUTH_FAILED",
      cooldownMs: Number.POSITIVE_INFINITY,
      markDead: true,
      shouldStopChain: false,
      originalMessage: "401",
      httpStatus: 401,
    });
    expect(markFailure).toHaveBeenCalledWith(
      "personal:u1:openai:default",
      expect.objectContaining({ reason: "AUTH_FAILED" }),
      "openai",
    );
  });

  // ★ 2026-05-06: 业务流量也要写 DB（让 admin/BYOK UI "上次活动状态/时间"反映真实使用）
  describe("reportSuccess / reportFailure persistence to user_api_keys (personal)", () => {
    beforeEach(() => {
      (userApiKeys.listPersonalKeys as jest.Mock).mockResolvedValue([
        {
          keyRowId: "r1",
          label: "default",
          apiKey: "sk-d",
          apiEndpoint: null,
          preferredModelId: null,
        },
      ]);
    });

    it("reportSuccess writes testStatus='success' + lastUsedAt + clears errorCode + accessCount++", async () => {
      const chain = await service.resolveKeyChain("u1", "openai");
      const k = await chain.next();
      if (!k) throw new Error("expected key");
      await chain.reportSuccess(k);
      expect(prismaUpdate).toHaveBeenCalledTimes(1);
      const call = prismaUpdate.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_provider_label: {
          userId: "u1",
          provider: "openai",
          label: "default",
        },
      });
      expect(call.data.testStatus).toBe("success");
      expect(call.data.lastErrorCode).toBeNull();
      expect(call.data.lastErrorMessage).toBeNull();
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(call.data.usageCount).toEqual({ increment: 1 });
    });

    it("reportFailure writes testStatus='failed' + lastErrorCode from classified.reason", async () => {
      const chain = await service.resolveKeyChain("u1", "openai");
      const k = await chain.next();
      if (!k) throw new Error("expected key");
      await chain.reportFailure(k, {
        action: "NEXT_KEY",
        reason: "RATE_LIMIT_KEY",
        cooldownMs: 60_000,
        markDead: false,
        shouldStopChain: false,
        originalMessage: "rate limited by upstream",
        httpStatus: 429,
      });
      expect(prismaUpdate).toHaveBeenCalledTimes(1);
      const call = prismaUpdate.mock.calls[0][0];
      expect(call.data.testStatus).toBe("failed");
      expect(call.data.lastErrorCode).toBe("RATE_LIMIT_KEY");
      expect(call.data.lastErrorMessage).toBe("rate limited by upstream");
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      // failure path 不增 usageCount
      expect(call.data.usageCount).toBeUndefined();
    });

    it("DB write failure 不抛错（健康熔断仍生效）", async () => {
      prismaUpdate.mockRejectedValueOnce(new Error("DB connection lost"));
      const chain = await service.resolveKeyChain("u1", "openai");
      const k = await chain.next();
      if (!k) throw new Error("expected key");
      await expect(chain.reportSuccess(k)).resolves.not.toThrow();
    });
  });

  // ★ 2026-05-12 (C方案): persistOutcome for ASSIGNED healthKeyId 写入 KeyAssignment.
  // 之前 assigned 路径在 persistDbHealthOutcome 注释 "跳过", 现在已实装.
  describe("persistOutcome — assigned path writes KeyAssignment", () => {
    beforeEach(() => {
      prismaAssignmentUpdate.mockClear();
    });

    it("success: increments accessCount + sets lastUsedAt", async () => {
      const before = Date.now();
      await service.persistOutcome("assigned:assn-123", { ok: true });
      const after = Date.now();
      expect(prismaAssignmentUpdate).toHaveBeenCalledTimes(1);
      const call = prismaAssignmentUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: "assn-123" });
      expect(call.data.accessCount).toEqual({ increment: 1 });
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      const ts = (call.data.lastUsedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("failure: writes lastUsedAt only (no accessCount++)", async () => {
      await service.persistOutcome("assigned:assn-123", {
        ok: false,
        classified: {
          reason: "AUTH_FAILED",
          cooldownMs: 0,
          markDead: false,
          shouldStopChain: false,
          originalMessage: "401 unauthorized",
          httpStatus: 401,
        },
      });
      expect(prismaAssignmentUpdate).toHaveBeenCalledTimes(1);
      const call = prismaAssignmentUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: "assn-123" });
      expect(call.data.accessCount).toBeUndefined();
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
    });
  });
});
