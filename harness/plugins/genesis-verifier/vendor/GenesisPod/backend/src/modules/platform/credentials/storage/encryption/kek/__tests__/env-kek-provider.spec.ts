import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { EnvKekProvider } from "../env-kek-provider";

const buildConfig = (env: Record<string, string | undefined>): ConfigService =>
  ({
    get: (key: string) => env[key],
  }) as unknown as ConfigService;

const hex32 = (seed: string) =>
  crypto.createHash("sha256").update(seed).digest("hex");

describe("EnvKekProvider", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  it("derives a dev KEK from master key when no SETTINGS_KEK_V* is set", async () => {
    const kek = new EnvKekProvider(
      buildConfig({ NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: "master" }),
    );
    expect(kek.currentVersion).toBe(1);
    const dek = crypto.randomBytes(32);
    const { wrapped, kekVersion } = await kek.wrap(dek);
    expect(kekVersion).toBe(1);
    expect(await kek.unwrap(wrapped, 1)).toEqual(dek);
  });

  it("throws in production when no KEK and no master key", () => {
    expect(
      () => new EnvKekProvider(buildConfig({ NODE_ENV: "production" })),
    ).toThrow(/no KEK configured/i);
  });

  it("wrap/unwrap roundtrips with an explicit hex KEK", async () => {
    const kek = new EnvKekProvider(
      buildConfig({ NODE_ENV: "test", SETTINGS_KEK_V1: hex32("kek-1") }),
    );
    const dek = crypto.randomBytes(32);
    const { wrapped } = await kek.wrap(dek);
    expect(await kek.unwrap(wrapped, 1)).toEqual(dek);
  });

  it("uses the highest version by default and supports unwrapping older versions", async () => {
    const kek = new EnvKekProvider(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_KEK_V1: hex32("kek-1"),
        SETTINGS_KEK_V2: hex32("kek-2"),
      }),
    );
    expect(kek.currentVersion).toBe(2);

    // simulate a row wrapped under v1 by a prior provider instance
    const v1Only = new EnvKekProvider(
      buildConfig({ NODE_ENV: "test", SETTINGS_KEK_V1: hex32("kek-1") }),
    );
    const dek = crypto.randomBytes(32);
    const { wrapped } = await v1Only.wrap(dek);
    expect(await kek.unwrap(wrapped, 1)).toEqual(dek);
  });

  it("honors SETTINGS_KEK_VERSION override", () => {
    const kek = new EnvKekProvider(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_KEK_V1: hex32("kek-1"),
        SETTINGS_KEK_V2: hex32("kek-2"),
        SETTINGS_KEK_VERSION: "1",
      }),
    );
    expect(kek.currentVersion).toBe(1);
  });

  it("rejects unwrap with an unavailable KEK version", async () => {
    const kek = new EnvKekProvider(
      buildConfig({ NODE_ENV: "test", SETTINGS_KEK_V1: hex32("kek-1") }),
    );
    const { wrapped } = await kek.wrap(crypto.randomBytes(32));
    await expect(kek.unwrap(wrapped, 9)).rejects.toThrow(/version 9/i);
  });

  it("fails to unwrap a tampered wrapped DEK (GCM integrity)", async () => {
    const kek = new EnvKekProvider(
      buildConfig({ NODE_ENV: "test", SETTINGS_KEK_V1: hex32("kek-1") }),
    );
    const { wrapped } = await kek.wrap(crypto.randomBytes(32));
    const [iv, tag, ct] = wrapped.split(":");
    const badTag = (tag[0] === "0" ? "1" : "0") + tag.slice(1);
    await expect(kek.unwrap(`${iv}:${badTag}:${ct}`, 1)).rejects.toThrow();
  });
});
