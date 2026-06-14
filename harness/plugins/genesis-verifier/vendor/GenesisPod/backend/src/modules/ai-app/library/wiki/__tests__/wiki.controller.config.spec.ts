/**
 * WikiController.updateConfig whitelist spec.
 *
 * Regression guard for the 2026-05-25 incident: the PATCH /config endpoint is a
 * hand-maintained type pass-through ("ignores unknown keys"). `autoIngestEnabled`
 * was missing from that whitelist, so the only switch that stops the wiki
 * auto-ingest cron could never be persisted from the UI — the cron kept burning
 * LLM quota with no off switch. These tests lock the boolean through the
 * controller → service patch boundary so the field can't silently fall out again.
 */

import { WikiController } from "../wiki.controller";

type PatchArg = Record<string, unknown>;

function makeController(updateConfig: jest.Mock) {
  const pageService = { updateConfig } as any;
  const noop = {} as any;
  return new WikiController(pageService, noop, noop, noop, noop);
}

const req = { user: { id: "user-1" } } as any;

describe("WikiController.updateConfig — config whitelist", () => {
  it("forwards autoIngestEnabled=false to the service patch", async () => {
    // Arrange
    const updateConfig = jest.fn().mockResolvedValue({ ok: true });
    const controller = makeController(updateConfig);

    // Act
    await controller.updateConfig(req, "kb-1", { autoIngestEnabled: false });

    // Assert
    expect(updateConfig).toHaveBeenCalledWith(
      "user-1",
      "kb-1",
      expect.objectContaining({ autoIngestEnabled: false }),
    );
  });

  it("forwards autoIngestEnabled=true to the service patch", async () => {
    // Arrange
    const updateConfig = jest.fn().mockResolvedValue({ ok: true });
    const controller = makeController(updateConfig);

    // Act
    await controller.updateConfig(req, "kb-1", { autoIngestEnabled: true });

    // Assert
    expect(updateConfig).toHaveBeenCalledWith(
      "user-1",
      "kb-1",
      expect.objectContaining({ autoIngestEnabled: true }),
    );
  });

  it("drops a non-boolean autoIngestEnabled (undefined in patch)", async () => {
    // Arrange
    const updateConfig = jest.fn().mockResolvedValue({ ok: true });
    const controller = makeController(updateConfig);

    // Act — a stringy "false" must not be treated as a real value
    await controller.updateConfig(req, "kb-1", { autoIngestEnabled: "false" });

    // Assert
    const patch = updateConfig.mock.calls[0][2] as PatchArg;
    expect(patch.autoIngestEnabled).toBeUndefined();
  });

  it("keeps autoIngestEnabled alongside other whitelisted fields", async () => {
    // Arrange
    const updateConfig = jest.fn().mockResolvedValue({ ok: true });
    const controller = makeController(updateConfig);

    // Act
    await controller.updateConfig(req, "kb-1", {
      autoIngestEnabled: false,
      cronLintEnabled: true,
      ingestMaxTokens: 12000,
    });

    // Assert
    expect(updateConfig).toHaveBeenCalledWith(
      "user-1",
      "kb-1",
      expect.objectContaining({
        autoIngestEnabled: false,
        cronLintEnabled: true,
        ingestMaxTokens: 12000,
      }),
    );
  });
});
