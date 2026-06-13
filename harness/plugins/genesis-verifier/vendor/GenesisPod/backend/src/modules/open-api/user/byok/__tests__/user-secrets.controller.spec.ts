import { Test, TestingModule } from "@nestjs/testing";
import { UserSecretsController } from "../user-secrets.controller";
import { UserSecretsService } from "../../../../platform/credentials/user-owned/user-secrets/user-secrets.service";
import { SecretsService } from "../../../../platform/credentials/storage/secrets/secrets.service";
import { SecretKeysService } from "../../../../platform/credentials/storage/secrets/secret-keys.service";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserSecretsController — testKey endpoint (C8)", () => {
  let controller: UserSecretsController;
  let service: { testKey: jest.Mock };
  let secrets: { getByIdForUser: jest.Mock };
  let secretKeys: {
    listKeys: jest.Mock;
    addKey: jest.Mock;
    deleteKey: jest.Mock;
  };

  const req = { user: { id: "user-1", email: "u@x.com" } } as never;

  beforeEach(async () => {
    service = { testKey: jest.fn() };
    secrets = { getByIdForUser: jest.fn() };
    secretKeys = {
      listKeys: jest.fn(),
      addKey: jest.fn(),
      deleteKey: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSecretsController],
      providers: [
        { provide: UserSecretsService, useValue: service },
        { provide: SecretsService, useValue: secrets },
        { provide: SecretKeysService, useValue: secretKeys },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserSecretsController);
  });

  it("delegates to service.testKey with owner userId", async () => {
    service.testKey.mockResolvedValue({
      success: true,
      message: "Key 存在，格式校验通过",
      testedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await controller.testKey(req, "llm", "uak-1");

    expect(service.testKey).toHaveBeenCalledWith("user-1", "llm", "uak-1");
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("key");
    expect(result).not.toHaveProperty("plaintext");
  });

  it("propagates failure result from service", async () => {
    service.testKey.mockResolvedValue({
      success: false,
      message: "Key 未找到或无权限",
      testedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await controller.testKey(req, "secret", "sec-other");

    expect(result.success).toBe(false);
    expect(result.message).toContain("未找到");
  });

  // ── 同名多 Key 子资源（2026-05-29，owner 隔离）──
  describe("multi-key sub-resource (owner-scoped)", () => {
    it("listKeys 校验归属后按 userId 作用域列 key", async () => {
      secrets.getByIdForUser.mockResolvedValue({ id: "sec-1" });
      secretKeys.listKeys.mockResolvedValue([{ id: "k1", label: "primary" }]);

      const res = await controller.listKeys(req, "sec-1");

      expect(secrets.getByIdForUser).toHaveBeenCalledWith("sec-1", "user-1");
      expect(secretKeys.listKeys).toHaveBeenCalledWith("sec-1", "user-1");
      expect(res).toHaveLength(1);
    });

    it("非本人 secret → listKeys 抛 NotFound（防 IDOR）", async () => {
      secrets.getByIdForUser.mockResolvedValue(null);

      await expect(controller.listKeys(req, "sec-other")).rejects.toThrow();
      expect(secretKeys.listKeys).not.toHaveBeenCalled();
    });

    it("addKey 先校验 :id 归属再透传 ownerUserId", async () => {
      secrets.getByIdForUser.mockResolvedValue({ id: "sec-1" });
      secretKeys.addKey.mockResolvedValue({ id: "k2", label: "backup-1" });

      await controller.addKey(req, "sec-1", {
        label: "backup-1",
        value: "sk-xxx",
      } as never);

      expect(secrets.getByIdForUser).toHaveBeenCalledWith("sec-1", "user-1");
      expect(secretKeys.addKey).toHaveBeenCalledWith(
        "sec-1",
        expect.objectContaining({ label: "backup-1" }),
        expect.objectContaining({ userId: "user-1" }),
        "user-1",
      );
    });

    it("非本人 secret → addKey 抛 NotFound（纵深防御）", async () => {
      secrets.getByIdForUser.mockResolvedValue(null);
      await expect(
        controller.addKey(req, "sec-other", {
          label: "x",
          value: "v",
        } as never),
      ).rejects.toThrow();
      expect(secretKeys.addKey).not.toHaveBeenCalled();
    });

    it("deleteKey 校验 :id 归属后透传 ownerUserId", async () => {
      secrets.getByIdForUser.mockResolvedValue({ id: "sec-1" });
      secretKeys.deleteKey.mockResolvedValue(undefined);

      const res = await controller.deleteKey(req, "sec-1", "k2");

      expect(secrets.getByIdForUser).toHaveBeenCalledWith("sec-1", "user-1");
      expect(secretKeys.deleteKey).toHaveBeenCalledWith(
        "k2",
        expect.objectContaining({ userId: "user-1" }),
        "user-1",
      );
      expect(res.ok).toBe(true);
    });
  });
});
