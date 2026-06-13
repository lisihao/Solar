// PrismaClient ctor requires DATABASE_URL even when only testing in-memory hydrate methods.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import { PrismaService } from "../prisma.service";

interface PrismaInternals {
  hydrateWikiDiffRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void>;
  downloadText(key: string): Promise<string | null>;
  warnedMissingUri: Set<string>;
}

function asInternals(svc: PrismaService): PrismaInternals {
  return svc as unknown as PrismaInternals;
}

describe("PrismaService — wikiDiff hydration", () => {
  let service: PrismaService;
  let downloadSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PrismaService();
    asInternals(service).warnedMissingUri.clear();
  });

  afterEach(async () => {
    downloadSpy?.mockRestore();
    await service.$disconnect();
  });

  it("populates items from R2 when DB is JSON null + itemsUri present", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue(
        JSON.stringify({ creates: [{ slug: "x", title: "X" }] }),
      );
    const row = {
      id: "diff-1",
      items: null, // JSON null after off-load
      itemsUri: "wiki-diffs/diff-1/items.json",
    };
    await asInternals(service).hydrateWikiDiffRow(row);
    expect(downloadSpy).toHaveBeenCalledWith("wiki-diffs/diff-1/items.json");
    expect(row.items).toEqual({ creates: [{ slug: "x", title: "X" }] });
  });

  it("skips hydrate when items already populated (PENDING / recent)", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("{}");
    const row = {
      items: { creates: [], updates: [], deletes: [] },
      itemsUri: "wiki-diffs/x/items.json",
    };
    await asInternals(service).hydrateWikiDiffRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(row.items).toEqual({ creates: [], updates: [], deletes: [] });
  });

  it("skips when itemsUri null (PENDING + recent terminal alike)", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("{}");
    const row = { items: null, itemsUri: null };
    await asInternals(service).hydrateWikiDiffRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("warns once when caller selects items without itemsUri", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("{}");
    const warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        "warn",
      )
      .mockImplementation();
    const row = { items: null };
    await asInternals(service).hydrateWikiDiffRow(row);
    await asInternals(service).hydrateWikiDiffRow(row);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /select contains JSON 'items' but not 'itemsUri'/,
    );
    expect(downloadSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("noop on null/undefined row", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("{}");
    await asInternals(service).hydrateWikiDiffRow(null);
    await asInternals(service).hydrateWikiDiffRow(undefined);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("logs JSON parse failure but does not overwrite items", async () => {
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("not-valid-json");
    const warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        "warn",
      )
      .mockImplementation();
    const row = {
      items: null,
      itemsUri: "wiki-diffs/bad/items.json",
    };
    await asInternals(service).hydrateWikiDiffRow(row);
    expect(warnSpy.mock.calls[0][0]).toMatch(/parse failed/);
    expect(row.items).toBeNull();
    warnSpy.mockRestore();
  });
});
