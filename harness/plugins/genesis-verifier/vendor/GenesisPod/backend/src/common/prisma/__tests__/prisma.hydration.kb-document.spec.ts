// PrismaClient ctor requires DATABASE_URL even when only testing in-memory hydrate methods.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import { PrismaService } from "../prisma.service";

interface PrismaInternals {
  hydrateKnowledgeBaseDocumentRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void>;
  downloadText(key: string): Promise<string | null>;
  warnedMissingUri: Set<string>;
}

function asInternals(svc: PrismaService): PrismaInternals {
  return svc as unknown as PrismaInternals;
}

describe("PrismaService — knowledgeBaseDocument hydration", () => {
  let service: PrismaService;
  let downloadSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PrismaService();
    asInternals(service).warnedMissingUri.clear();
    downloadSpy = jest
      .spyOn(asInternals(service), "downloadText")
      .mockResolvedValue("payload-from-r2");
  });

  afterEach(async () => {
    downloadSpy.mockRestore();
    await service.$disconnect();
  });

  it("populates rawContent from R2 when DB column is empty + rawContentUri present", async () => {
    const row = {
      id: "doc-1",
      rawContent: "",
      rawContentUri: "kb-documents/doc-1/raw.txt",
    };
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(downloadSpy).toHaveBeenCalledWith("kb-documents/doc-1/raw.txt");
    expect(row.rawContent).toBe("payload-from-r2");
  });

  it("skips hydrate when rawContent already has data (dual-write window)", async () => {
    const row = {
      rawContent: "still-in-db",
      rawContentUri: "kb-documents/x/raw.txt",
    };
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(row.rawContent).toBe("still-in-db");
  });

  it("skips hydrate when rawContentUri is null (existing rows pre-migration)", async () => {
    const row = { rawContent: "", rawContentUri: null };
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(row.rawContent).toBe("");
  });

  it("warns once when caller selects rawContent without rawContentUri", async () => {
    const warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        "warn",
      )
      .mockImplementation();
    const row = { rawContent: "" };
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /select contains 'rawContent' but not 'rawContentUri'/,
    );
    expect(downloadSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("noop on null/undefined row", async () => {
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(null);
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(undefined);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("noop when both fields absent (caller didn't request rawContent)", async () => {
    const row = { id: "doc-1" } as Record<string, unknown>;
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("does not overwrite when downloadText returns null (R2 miss)", async () => {
    downloadSpy.mockResolvedValueOnce(null);
    const row = {
      rawContent: "",
      rawContentUri: "kb-documents/missing/raw.txt",
    };
    await asInternals(service).hydrateKnowledgeBaseDocumentRow(row);
    expect(row.rawContent).toBe("");
  });
});
