/**
 * MissionFailedPreset unit tests (e2e P0-#5)
 *
 * 覆盖：
 *   - notify dispatch type=MISSION_FAILED + title/message/link/metadata 正确
 *   - user 不存在 → 跳过 dispatch（warn，不抛）
 *   - reason 截断 500 + failureCode 进 metadata
 *   - HTML 转义（防 stored XSS）
 */

import { MissionFailedPreset } from "../mission-failed.preset";

function makeMockDispatcher() {
  return { dispatch: jest.fn().mockResolvedValue({ userId: "u1" }) };
}
function makeMockPrisma(user: { id: string; email: string } | null) {
  return { user: { findUnique: jest.fn().mockResolvedValue(user) } };
}
function makeMockConfig() {
  return { get: jest.fn().mockReturnValue("https://app.example.com") };
}

describe("MissionFailedPreset", () => {
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let prisma: ReturnType<typeof makeMockPrisma>;
  let config: ReturnType<typeof makeMockConfig>;
  let preset: MissionFailedPreset;

  beforeEach(() => {
    dispatcher = makeMockDispatcher();
    prisma = makeMockPrisma({ id: "u1", email: "u@x.com" });
    config = makeMockConfig();
    preset = new MissionFailedPreset(
      dispatcher as never,
      prisma as never,
      config as never,
    );
  });

  it("dispatches MISSION_FAILED with correct payload", async () => {
    await preset.notify({
      userId: "u1",
      missionId: "m-1",
      missionTitle: "AI 趋势研究",
      missionUrl: "/agent-playground/team/m-1",
      reason: "预算已耗尽",
      failureCode: "BUDGET_EXHAUSTED",
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const [uid, payload] = dispatcher.dispatch.mock.calls[0];
    expect(uid).toBe("u1");
    expect(payload.type).toBe("MISSION_FAILED");
    expect(payload.title).toContain("Mission Failed");
    expect(payload.title).toContain("AI 趋势研究");
    expect(payload.message).toContain("预算已耗尽");
    expect(payload.link).toBe("/agent-playground/team/m-1");
    expect(payload.metadata.missionId).toBe("m-1");
    expect(payload.metadata.failureCode).toBe("BUDGET_EXHAUSTED");
    expect(payload.emailContext.html).toContain("Mission Failed");
    expect(payload.emailContext.html).toContain("BUDGET_EXHAUSTED");
  });

  it("skips dispatch when user not found (no throw)", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      preset.notify({
        userId: "ghost",
        missionId: "m-1",
        missionTitle: "X",
        missionUrl: "/x",
        reason: "boom",
      }),
    ).resolves.toBeUndefined();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("defaults failureCode to UNKNOWN in metadata when absent", async () => {
    await preset.notify({
      userId: "u1",
      missionId: "m-2",
      missionTitle: "T",
      missionUrl: "/t",
      reason: "generic failure",
    });
    const [, payload] = dispatcher.dispatch.mock.calls[0];
    expect(payload.metadata.failureCode).toBe("UNKNOWN");
  });

  it("escapes HTML in mission title + reason (XSS guard)", async () => {
    await preset.notify({
      userId: "u1",
      missionId: "m-3",
      missionTitle: "<script>alert(1)</script>",
      missionUrl: "/t",
      reason: "<img src=x onerror=alert(2)>",
      failureCode: "PROVIDER_API_ERROR",
    });
    const [, payload] = dispatcher.dispatch.mock.calls[0];
    const html: string = payload.emailContext.html;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x onerror");
  });
});
