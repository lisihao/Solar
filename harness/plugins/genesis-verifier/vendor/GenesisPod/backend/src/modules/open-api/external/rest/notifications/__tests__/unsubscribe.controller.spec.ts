import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { UnsubscribeController } from "../unsubscribe.controller";
import { UnsubscribeTokenService } from "@/modules/platform/notifications/dispatcher/preferences/unsubscribe-token.service";

describe("UnsubscribeController (PR-DR1b)", () => {
  let controller: UnsubscribeController;
  let tokens: jest.Mocked<UnsubscribeTokenService>;

  beforeEach(async () => {
    tokens = {
      verifyAndApply: jest.fn(),
    } as unknown as jest.Mocked<UnsubscribeTokenService>;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UnsubscribeController],
      providers: [{ provide: UnsubscribeTokenService, useValue: tokens }],
    }).compile();
    controller = module.get(UnsubscribeController);
  });

  it("缺 token → BadRequest", async () => {
    await expect(controller.unsubscribe(undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each([
    ["global", "已退订全部通知。可在账户设置重新启用"],
    ["radar_all", "已退订所有 AI 雷达通知"],
    ["weekly", "已退订 AI 雷达周报"],
    ["topic", "已退订该雷达主题的通知"],
  ] as const)("scope=%s → message=%s", async (scope, message) => {
    tokens.verifyAndApply.mockResolvedValue({
      userId: "u1",
      scope: scope as never,
    });
    const result = await controller.unsubscribe("fake-token");
    expect(result).toEqual({ success: true, scope, message });
  });
});
