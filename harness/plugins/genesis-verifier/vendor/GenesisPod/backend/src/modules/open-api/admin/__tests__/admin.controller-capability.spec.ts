/**
 * admin.controller-capability.spec.ts — v3.1 §B.3 admin override endpoint
 *
 * 覆盖：
 *   - PATCH /admin/ai-models/:id/capability-overrides → writer.applyOverrideTransactional 调用参数
 *   - DELETE /admin/ai-models/:id/capability-overrides → 空 patch + 调用
 *   - reason < 30 字符 / patch typo → writer throws BadRequestException (透传)
 *   - 透传 ip / user-agent 给 writer
 *
 * Guard 测试（admin 403）由 e2e / module-level 守护，本 unit spec 只测 controller 委派逻辑。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";

import { AdminController } from "../admin.controller";
import { AdminService } from "../admin.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { CapabilityOverridesWriterService } from "../../../ai-engine/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { StorageInventoryService } from "../../../platform/storage/governance/storage-inventory.service";
import { StorageOffloadService } from "../../../platform/storage/governance/storage-offload.service";
import { SystemModelInventoryService } from "../../../ai-engine/llm/models/catalog/system-model-inventory.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// @prisma/client transitive proxy mock (与 supplemental spec 同套路)
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});
jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

const mockGuard = { canActivate: () => true };

describe("AdminController — capability_overrides endpoints (v3.1 §B.3)", () => {
  let controller: AdminController;
  let writer: {
    applyOverrideTransactional: jest.Mock;
    clearOverrideTransactional: jest.Mock;
  };

  beforeEach(async () => {
    writer = {
      applyOverrideTransactional: jest.fn().mockResolvedValue({
        before: null,
        after: { structuredOutput: { nativeMode: "none" } },
      }),
      // v3.1 B+.4: DELETE 改调 clearOverrideTransactional 真清整列
      clearOverrideTransactional: jest
        .fn()
        .mockResolvedValue({ before: null, after: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: {} },
        { provide: ChatFacade, useValue: {} },
        { provide: SecretsService, useValue: {} },
        { provide: StorageInventoryService, useValue: {} },
        { provide: StorageOffloadService, useValue: {} },
        { provide: SystemModelInventoryService, useValue: {} },
        {
          provide: CapabilityOverridesWriterService,
          useValue: writer,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(AdminGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(AdminController);
  });

  // ─────────── PATCH happy ───────────

  it("PATCH passes scope=ADMIN + actor.role=admin + IP/UA to writer", async () => {
    const req = {
      user: { id: "admin-7" },
      ip: "10.0.0.1",
      headers: { "user-agent": "curl/7.83" },
    } as never;
    const dto = {
      patch: { structuredOutput: { nativeMode: "none" } },
      reason:
        "Admin disables structured output for deepseek-v4-pro after 2026-05-24 incident",
    } as never;

    const result = await controller.applyAIModelCapabilityOverrides(
      "model-x",
      dto,
      req,
    );

    expect(writer.applyOverrideTransactional).toHaveBeenCalledTimes(1);
    const call = writer.applyOverrideTransactional.mock.calls[0][0];
    expect(call).toMatchObject({
      target: { kind: "ai_model", id: "model-x" },
      scope: "ADMIN",
      actor: { id: "admin-7", role: "admin" },
      source: "admin-override",
      ipAddress: "10.0.0.1",
      userAgent: "curl/7.83",
    });
    expect(call.patch).toEqual({ structuredOutput: { nativeMode: "none" } });
    expect(call.reason.length).toBeGreaterThanOrEqual(30);
    expect(result.after).toEqual({ structuredOutput: { nativeMode: "none" } });
  });

  // ─────────── DELETE happy ───────────

  it("DELETE calls clearOverrideTransactional with scope=ADMIN + actor + reason (v3.1 B+.4)", async () => {
    const req = {
      user: { id: "admin-1" },
      ip: "10.0.0.1",
      headers: {},
    } as never;
    const dto = {
      reason:
        "Reset capability_overrides after upstream API restored json_schema support",
    } as never;

    await controller.clearAIModelCapabilityOverrides("model-x", dto, req);

    // B+.4: DELETE 真清整列(SET NULL)而非旧 patch={}
    expect(writer.clearOverrideTransactional).toHaveBeenCalledTimes(1);
    expect(writer.applyOverrideTransactional).not.toHaveBeenCalled();
    const call = writer.clearOverrideTransactional.mock.calls[0][0];
    expect(call.scope).toBe("ADMIN");
    expect(call.target).toEqual({ kind: "ai_model", id: "model-x" });
    expect(call.actor).toMatchObject({ id: "admin-1", role: "admin" });
    expect(call.reason.length).toBeGreaterThanOrEqual(30);
  });

  // ─────────── unknown-admin fallback ───────────

  it("uses 'unknown-admin' actor id when req.user missing (defense-in-depth)", async () => {
    const req = { ip: "127.0.0.1", headers: {} } as never;
    const dto = {
      patch: {},
      reason:
        "Test fallback actor id when JWT did not populate req.user as expected",
    } as never;

    await controller.applyAIModelCapabilityOverrides("model-x", dto, req);

    expect(writer.applyOverrideTransactional.mock.calls[0][0].actor.id).toBe(
      "unknown-admin",
    );
  });

  // ─────────── writer error propagation ───────────

  it("propagates writer BadRequestException (reason too short / patch typo)", async () => {
    writer.applyOverrideTransactional.mockRejectedValue(
      new BadRequestException("reason too short"),
    );
    const req = { user: { id: "admin-1" }, ip: "::1", headers: {} } as never;
    const dto = {
      patch: { structuredOutput: { nativeMode: "none" } },
      reason:
        "Admin disables structured output for deepseek-v4-pro after 2026-05-24 incident",
    } as never;
    await expect(
      controller.applyAIModelCapabilityOverrides("model-x", dto, req),
    ).rejects.toThrow(BadRequestException);
  });
});
