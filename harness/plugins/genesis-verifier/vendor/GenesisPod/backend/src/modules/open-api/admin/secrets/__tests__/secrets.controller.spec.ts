/**
 * SecretsController Unit Tests
 *
 * Covers all 14 endpoints:
 * - GET    /admin/secrets
 * - GET    /admin/secrets/names
 * - POST   /admin/secrets
 * - GET    /admin/secrets/:name
 * - GET    /admin/secrets/:name/value
 * - PATCH  /admin/secrets/:name
 * - DELETE /admin/secrets/:name
 * - GET    /admin/secrets/:name/logs
 * - GET    /admin/secrets/:name/references
 * - POST   /admin/secrets/migrate
 * - GET    /admin/secrets/:name/versions
 * - GET    /admin/secrets/:name/versions/:version/value
 * - POST   /admin/secrets/:name/rollback/:version
 * - POST   /admin/secrets/init-versions
 */

// Module-level mocks to prevent transitive import failures
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }));
jest.mock("cache-manager", () => ({}));
jest.mock("ioredis", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { SecretsController } from "../secrets.controller";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { CreateSecretDto } from "../dto/create-secret.dto";
import { UpdateSecretDto } from "../dto/update-secret.dto";
import { SecretCategory } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockSecretsService = {
  findAll: jest.fn(),
  getSecretNames: jest.fn(),
  create: jest.fn(),
  findByName: jest.fn(),
  getValue: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getAccessLogs: jest.fn(),
  getReferences: jest.fn(),
  migrateExistingKeys: jest.fn(),
  getVersions: jest.fn(),
  getVersionValue: jest.fn(),
  rollback: jest.fn(),
  initializeAllVersions: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER = { userId: "user-admin-1", email: "admin@example.com" };

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    user: ADMIN_USER,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "user-agent": "jest-test-agent" },
    ...overrides,
  };
}

function makeAuditContext(
  overrides: Partial<{
    userId: string;
    userEmail: string;
    ipAddress: string;
    userAgent: string;
  }> = {},
) {
  return {
    userId: ADMIN_USER.userId,
    userEmail: ADMIN_USER.email,
    ipAddress: "127.0.0.1",
    userAgent: "jest-test-agent",
    ...overrides,
  };
}

const SAMPLE_SECRET_LIST_ITEM = {
  id: "secret-1",
  name: "openai-api-key",
  displayName: "OpenAI API Key",
  category: "AI_MODEL" as SecretCategory,
  description: "OpenAI production key",
  provider: "openai",
  isActive: true,
  maskedValue: "****key****",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  lastAccessedAt: null,
  accessCount: 0,
  expiresAt: null,
  lastRotatedAt: null,
};

const SAMPLE_VERSION = {
  id: "ver-1",
  version: 1,
  checksum: "abc123",
  createdBy: null,
  createdAt: new Date("2025-01-01"),
  changeNote: null,
  isCurrent: true,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SecretsController", () => {
  let controller: SecretsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
      controllers: [SecretsController],
      providers: [{ provide: SecretsService, useValue: mockSecretsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SecretsController>(SecretsController);
  });

  // -------------------------------------------------------------------------
  // Sanity
  // -------------------------------------------------------------------------

  describe("controller definition", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // findAll() — GET /admin/secrets
  // -------------------------------------------------------------------------

  describe("findAll()", () => {
    it("should return all secrets when no category filter is given", async () => {
      mockSecretsService.findAll.mockResolvedValue([SAMPLE_SECRET_LIST_ITEM]);

      const result = await controller.findAll(undefined);

      expect(mockSecretsService.findAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([SAMPLE_SECRET_LIST_ITEM]);
    });

    it("should pass category filter to service when provided", async () => {
      const filtered = [
        { ...SAMPLE_SECRET_LIST_ITEM, category: "AI_MODEL" as SecretCategory },
      ];
      mockSecretsService.findAll.mockResolvedValue(filtered);

      const result = await controller.findAll("AI_MODEL" as SecretCategory);

      expect(mockSecretsService.findAll).toHaveBeenCalledWith("AI_MODEL");
      expect(result).toEqual(filtered);
    });

    it("should propagate service errors", async () => {
      mockSecretsService.findAll.mockRejectedValue(new Error("DB error"));

      await expect(controller.findAll(undefined)).rejects.toThrow("DB error");
    });
  });

  // -------------------------------------------------------------------------
  // getSecretNames() — GET /admin/secrets/names
  // -------------------------------------------------------------------------

  describe("getSecretNames()", () => {
    it("should return all secret names without category filter", async () => {
      const names = ["openai-api-key", "anthropic-api-key"];
      mockSecretsService.getSecretNames.mockResolvedValue(names);

      const result = await controller.getSecretNames(undefined);

      expect(mockSecretsService.getSecretNames).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(names);
    });

    it("should pass category to service when provided", async () => {
      const names = ["openai-api-key"];
      mockSecretsService.getSecretNames.mockResolvedValue(names);

      const result = await controller.getSecretNames(
        "AI_MODEL" as SecretCategory,
      );

      expect(mockSecretsService.getSecretNames).toHaveBeenCalledWith(
        "AI_MODEL",
      );
      expect(result).toEqual(names);
    });

    it("should return empty array when no secrets exist", async () => {
      mockSecretsService.getSecretNames.mockResolvedValue([]);

      const result = await controller.getSecretNames(undefined);

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // create() — POST /admin/secrets
  // -------------------------------------------------------------------------

  describe("create()", () => {
    const dto: CreateSecretDto = {
      name: "openai-api-key",
      displayName: "OpenAI API Key",
      value: "sk-test-value",
      category: "AI_MODEL" as SecretCategory,
    };

    it("should call service.create with dto and audit context extracted from request", async () => {
      mockSecretsService.create.mockResolvedValue(SAMPLE_SECRET_LIST_ITEM);
      const req = makeRequest();

      const result = await controller.create(dto, req as never);

      expect(mockSecretsService.create).toHaveBeenCalledWith(
        dto,
        makeAuditContext(),
      );
      expect(result).toEqual(SAMPLE_SECRET_LIST_ITEM);
    });

    it("should extract audit context with ip from socket when req.ip is absent", async () => {
      mockSecretsService.create.mockResolvedValue(SAMPLE_SECRET_LIST_ITEM);
      const req = makeRequest({
        ip: undefined,
        socket: { remoteAddress: "192.168.1.1" },
      });

      await controller.create(dto, req as never);

      expect(mockSecretsService.create).toHaveBeenCalledWith(
        dto,
        expect.objectContaining({ ipAddress: "192.168.1.1" }),
      );
    });

    it("should propagate service errors on creation failure", async () => {
      mockSecretsService.create.mockRejectedValue(new Error("Duplicate name"));
      const req = makeRequest();

      await expect(controller.create(dto, req as never)).rejects.toThrow(
        "Duplicate name",
      );
    });
  });

  // -------------------------------------------------------------------------
  // findByName() — GET /admin/secrets/:name
  // -------------------------------------------------------------------------

  describe("findByName()", () => {
    it("should return the secret for a valid name", async () => {
      mockSecretsService.findByName.mockResolvedValue(SAMPLE_SECRET_LIST_ITEM);

      const result = await controller.findByName("openai-api-key");

      expect(mockSecretsService.findByName).toHaveBeenCalledWith(
        "openai-api-key",
      );
      expect(result).toEqual(SAMPLE_SECRET_LIST_ITEM);
    });

    it("should propagate NotFoundException from service when secret does not exist", async () => {
      mockSecretsService.findByName.mockRejectedValue(
        new NotFoundException("Secret not found"),
      );

      await expect(controller.findByName("nonexistent-key")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should propagate other service errors", async () => {
      mockSecretsService.findByName.mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(controller.findByName("some-key")).rejects.toThrow(
        "DB connection lost",
      );
    });
  });

  // -------------------------------------------------------------------------
  // getValue() — GET /admin/secrets/:name/value
  // -------------------------------------------------------------------------

  describe("getValue()", () => {
    it("should return wrapped decrypted value from service", async () => {
      mockSecretsService.getValue.mockResolvedValue("sk-actual-secret-value");
      const req = makeRequest();

      const result = await controller.getValue("openai-api-key", req as never);

      expect(mockSecretsService.getValue).toHaveBeenCalledWith(
        "openai-api-key",
        makeAuditContext(),
      );
      expect(result).toEqual({ value: "sk-actual-secret-value" });
    });

    it("should wrap the value in a { value } object", async () => {
      mockSecretsService.getValue.mockResolvedValue("raw-secret");
      const req = makeRequest();

      const result = await controller.getValue("some-key", req as never);

      expect(result).toHaveProperty("value", "raw-secret");
    });

    it("should propagate NotFoundException when secret is not found", async () => {
      mockSecretsService.getValue.mockRejectedValue(
        new NotFoundException("Not found"),
      );
      const req = makeRequest();

      await expect(
        controller.getValue("ghost-key", req as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // update() — PATCH /admin/secrets/:name
  // -------------------------------------------------------------------------

  describe("update()", () => {
    const dto: UpdateSecretDto = {
      displayName: "Updated OpenAI Key",
      value: "sk-updated-value",
      changeNote: "Rotated monthly",
    };

    it("should call service.update with name, dto and audit context", async () => {
      const updated = {
        ...SAMPLE_SECRET_LIST_ITEM,
        displayName: "Updated OpenAI Key",
      };
      mockSecretsService.update.mockResolvedValue(updated);
      const req = makeRequest();

      const result = await controller.update(
        "openai-api-key",
        dto,
        req as never,
      );

      expect(mockSecretsService.update).toHaveBeenCalledWith(
        "openai-api-key",
        dto,
        makeAuditContext(),
      );
      expect(result).toEqual(updated);
    });

    it("should handle partial updates (only isActive flag)", async () => {
      const partialDto: UpdateSecretDto = { isActive: false };
      const deactivated = { ...SAMPLE_SECRET_LIST_ITEM, isActive: false };
      mockSecretsService.update.mockResolvedValue(deactivated);
      const req = makeRequest();

      const result = await controller.update(
        "openai-api-key",
        partialDto,
        req as never,
      );

      expect(mockSecretsService.update).toHaveBeenCalledWith(
        "openai-api-key",
        partialDto,
        makeAuditContext(),
      );
      expect(result).toEqual(deactivated);
    });

    it("should propagate NotFoundException when secret does not exist", async () => {
      mockSecretsService.update.mockRejectedValue(
        new NotFoundException("Secret not found"),
      );
      const req = makeRequest();

      await expect(
        controller.update("ghost-key", dto, req as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // delete() — DELETE /admin/secrets/:name
  // -------------------------------------------------------------------------

  describe("delete()", () => {
    it("should call service.delete and return confirmation message", async () => {
      mockSecretsService.delete.mockResolvedValue(undefined);
      const req = makeRequest();

      const result = await controller.delete("openai-api-key", req as never);

      expect(mockSecretsService.delete).toHaveBeenCalledWith(
        "openai-api-key",
        makeAuditContext(),
      );
      expect(result).toEqual({ message: "Secret 'openai-api-key' deleted" });
    });

    it("should include the secret name in the confirmation message", async () => {
      mockSecretsService.delete.mockResolvedValue(undefined);
      const req = makeRequest();

      const result = await controller.delete("my-custom-key", req as never);

      expect(result).toEqual({ message: "Secret 'my-custom-key' deleted" });
    });

    it("should propagate NotFoundException when secret does not exist", async () => {
      mockSecretsService.delete.mockRejectedValue(
        new NotFoundException("Secret not found"),
      );
      const req = makeRequest();

      await expect(
        controller.delete("ghost-key", req as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // getAccessLogs() — GET /admin/secrets/:name/logs
  // -------------------------------------------------------------------------

  describe("getAccessLogs()", () => {
    const sampleLogs = [
      { id: "log-1", action: "READ", userId: "user-1", createdAt: new Date() },
    ];

    it("should call service with default limit 50 when no limit query param given", async () => {
      mockSecretsService.getAccessLogs.mockResolvedValue(sampleLogs);

      const result = await controller.getAccessLogs(
        "openai-api-key",
        undefined,
      );

      expect(mockSecretsService.getAccessLogs).toHaveBeenCalledWith(
        "openai-api-key",
        50,
      );
      expect(result).toEqual(sampleLogs);
    });

    it("should parse and pass the limit query param as integer", async () => {
      mockSecretsService.getAccessLogs.mockResolvedValue(sampleLogs);

      await controller.getAccessLogs("openai-api-key", "10");

      expect(mockSecretsService.getAccessLogs).toHaveBeenCalledWith(
        "openai-api-key",
        10,
      );
    });

    it("should propagate errors from service", async () => {
      mockSecretsService.getAccessLogs.mockRejectedValue(
        new Error("Query failed"),
      );

      await expect(
        controller.getAccessLogs("openai-api-key", undefined),
      ).rejects.toThrow("Query failed");
    });
  });

  // -------------------------------------------------------------------------
  // getReferences() — GET /admin/secrets/:name/references
  // -------------------------------------------------------------------------

  describe("getReferences()", () => {
    it("should return references for the given secret name", async () => {
      const refs = [{ type: "ai_model", id: "model-1", name: "GPT-4" }];
      mockSecretsService.getReferences.mockResolvedValue(refs);

      const result = await controller.getReferences("openai-api-key");

      expect(mockSecretsService.getReferences).toHaveBeenCalledWith(
        "openai-api-key",
      );
      expect(result).toEqual(refs);
    });

    it("should return empty array when no references exist", async () => {
      mockSecretsService.getReferences.mockResolvedValue([]);

      const result = await controller.getReferences("unused-key");

      expect(result).toEqual([]);
    });

    it("should propagate NotFoundException from service", async () => {
      mockSecretsService.getReferences.mockRejectedValue(
        new NotFoundException("Not found"),
      );

      await expect(controller.getReferences("ghost-key")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // migrateExistingKeys() — POST /admin/secrets/migrate
  // -------------------------------------------------------------------------

  describe("migrateExistingKeys()", () => {
    it("should call service.migrateExistingKeys with audit context and return result", async () => {
      const migrationResult = { migrated: 5, skipped: 2, errors: [] };
      mockSecretsService.migrateExistingKeys.mockResolvedValue(migrationResult);
      const req = makeRequest();

      const result = await controller.migrateExistingKeys(req as never);

      expect(mockSecretsService.migrateExistingKeys).toHaveBeenCalledWith(
        makeAuditContext(),
      );
      expect(result).toEqual(migrationResult);
    });

    it("should propagate service errors during migration", async () => {
      mockSecretsService.migrateExistingKeys.mockRejectedValue(
        new Error("Migration failed"),
      );
      const req = makeRequest();

      await expect(
        controller.migrateExistingKeys(req as never),
      ).rejects.toThrow("Migration failed");
    });
  });

  // -------------------------------------------------------------------------
  // getVersions() — GET /admin/secrets/:name/versions
  // -------------------------------------------------------------------------

  describe("getVersions()", () => {
    it("should return all versions for the secret", async () => {
      const versions = [
        SAMPLE_VERSION,
        { ...SAMPLE_VERSION, id: "ver-2", version: 2, isCurrent: false },
      ];
      mockSecretsService.getVersions.mockResolvedValue(versions);

      const result = await controller.getVersions("openai-api-key");

      expect(mockSecretsService.getVersions).toHaveBeenCalledWith(
        "openai-api-key",
      );
      expect(result).toEqual(versions);
    });

    it("should return empty array when no versions exist", async () => {
      mockSecretsService.getVersions.mockResolvedValue([]);

      const result = await controller.getVersions("fresh-key");

      expect(result).toEqual([]);
    });

    it("should propagate NotFoundException from service", async () => {
      mockSecretsService.getVersions.mockRejectedValue(
        new NotFoundException("Secret not found"),
      );

      await expect(controller.getVersions("ghost-key")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getVersionValue() — GET /admin/secrets/:name/versions/:version/value
  // -------------------------------------------------------------------------

  describe("getVersionValue()", () => {
    it("should return wrapped value for the specified version", async () => {
      mockSecretsService.getVersionValue.mockResolvedValue(
        "sk-version-1-value",
      );
      const req = makeRequest();

      const result = await controller.getVersionValue(
        "openai-api-key",
        "1",
        req as never,
      );

      expect(mockSecretsService.getVersionValue).toHaveBeenCalledWith(
        "openai-api-key",
        1,
        makeAuditContext(),
      );
      expect(result).toEqual({ value: "sk-version-1-value" });
    });

    it("should parse version string to integer before passing to service", async () => {
      mockSecretsService.getVersionValue.mockResolvedValue("value-v3");
      const req = makeRequest();

      await controller.getVersionValue("openai-api-key", "3", req as never);

      expect(mockSecretsService.getVersionValue).toHaveBeenCalledWith(
        "openai-api-key",
        3,
        expect.any(Object),
      );
    });

    it("should propagate NotFoundException when version does not exist", async () => {
      mockSecretsService.getVersionValue.mockRejectedValue(
        new NotFoundException("Version not found"),
      );
      const req = makeRequest();

      await expect(
        controller.getVersionValue("openai-api-key", "99", req as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // rollback() — POST /admin/secrets/:name/rollback/:version
  // -------------------------------------------------------------------------

  describe("rollback()", () => {
    it("should call service.rollback with name, parsed version int and audit context", async () => {
      const rolledBack = { ...SAMPLE_SECRET_LIST_ITEM };
      mockSecretsService.rollback.mockResolvedValue(rolledBack);
      const req = makeRequest();

      const result = await controller.rollback(
        "openai-api-key",
        "2",
        req as never,
      );

      expect(mockSecretsService.rollback).toHaveBeenCalledWith(
        "openai-api-key",
        2,
        makeAuditContext(),
      );
      expect(result).toEqual(rolledBack);
    });

    it("should propagate NotFoundException when target version is missing", async () => {
      mockSecretsService.rollback.mockRejectedValue(
        new NotFoundException("Version not found"),
      );
      const req = makeRequest();

      await expect(
        controller.rollback("openai-api-key", "99", req as never),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate errors on rollback failure", async () => {
      mockSecretsService.rollback.mockRejectedValue(
        new Error("Rollback conflict"),
      );
      const req = makeRequest();

      await expect(
        controller.rollback("openai-api-key", "1", req as never),
      ).rejects.toThrow("Rollback conflict");
    });
  });

  // -------------------------------------------------------------------------
  // initializeVersions() — POST /admin/secrets/init-versions
  // -------------------------------------------------------------------------

  describe("initializeVersions()", () => {
    it("should call service.initializeAllVersions and return result", async () => {
      const initResult = { initialized: 10, alreadyVersioned: 3 };
      mockSecretsService.initializeAllVersions.mockResolvedValue(initResult);

      const result = await controller.initializeVersions();

      expect(mockSecretsService.initializeAllVersions).toHaveBeenCalledTimes(1);
      expect(result).toEqual(initResult);
    });

    it("should propagate errors if initialization fails", async () => {
      mockSecretsService.initializeAllVersions.mockRejectedValue(
        new Error("Init failed"),
      );

      await expect(controller.initializeVersions()).rejects.toThrow(
        "Init failed",
      );
    });
  });
});
