// PrismaClient ctor requires DATABASE_URL even when only testing in-memory hydrate methods.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import { PrismaService } from "../prisma.service";

interface PrismaInternals {
  hydrateWikiPageRevisionRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void>;
  downloadText(key: string): Promise<string | null>;
  warnedMissingUri: Set<string>;
}

function asInternals(svc: PrismaService): PrismaInternals {
  return svc as unknown as PrismaInternals;
}

describe("PrismaService — wikiPageRevision hydration", () => {
  let service: PrismaService;
  let downloadSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PrismaService();
    asInternals(service).warnedMissingUri.clear();
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("revision-body-from-r2");
  });

  afterEach(async () => {
    downloadSpy.mockRestore();
    await service.$disconnect();
  });

  it("populates body from R2 when DB column is empty + bodyUri present", async () => {
    const row = {
      id: "rev-1",
      body: "",
      bodyUri: "wiki-revisions/rev-1/body.md",
    };
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    expect(downloadSpy).toHaveBeenCalledWith("wiki-revisions/rev-1/body.md");
    expect(row.body).toBe("revision-body-from-r2");
  });

  it("skips hydrate when body already has data (pre-migration row)", async () => {
    const row = { body: "still-in-db", bodyUri: "wiki-revisions/x/body.md" };
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(row.body).toBe("still-in-db");
  });

  it("skips when bodyUri null (existing rows pre-migration)", async () => {
    const row = { body: "", bodyUri: null };
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("warns once when caller selects body without bodyUri", async () => {
    const warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        "warn",
      )
      .mockImplementation();
    const row = { body: "" };
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /select contains 'body' but not 'bodyUri'/,
    );
    expect(downloadSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("noop on null/undefined row", async () => {
    await asInternals(service).hydrateWikiPageRevisionRow(null);
    await asInternals(service).hydrateWikiPageRevisionRow(undefined);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("does not overwrite when downloadText returns null (R2 miss)", async () => {
    downloadSpy.mockResolvedValueOnce(null);
    const row = { body: "", bodyUri: "wiki-revisions/missing/body.md" };
    await asInternals(service).hydrateWikiPageRevisionRow(row);
    expect(row.body).toBe("");
  });
});
