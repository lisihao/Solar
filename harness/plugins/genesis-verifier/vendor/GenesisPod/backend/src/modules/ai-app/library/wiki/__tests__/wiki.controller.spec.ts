/**
 * WikiController spec — v1.5.3 §6 + §8 P1 + §11
 *
 * Scope: routing + DTO bind correctness + auth-guard wiring.
 * Service-level IDOR / wikiEnabled gating is covered in each service's own
 * spec; here we only verify that NotFoundException raised by services flows
 * through the controller unchanged (404, not 403, per §6 unified semantics).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, NotImplementedException } from "@nestjs/common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { WikiController } from "../wiki.controller";
import { WikiPageService } from "../wiki-page.service";
import { WikiDiffService } from "../wiki-diff.service";
import { WikiIngestService } from "../wiki-ingest.service";
import { WikiLintService } from "../wiki-lint.service";
import { WikiQueryService } from "../wiki-query.service";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  CreateWikiPageDto,
  UpdateWikiPageDto,
  ListWikiPagesQueryDto,
} from "../dto/wiki-page.dto";
import {
  IngestWikiDto,
  PatchWikiDiffDto,
  PatchWikiLintFindingDto,
} from "../dto/wiki-diff.dto";
import {
  WikiQueryRequestDto,
  WikiLintFindingsQueryDto,
} from "../dto/wiki-query.dto";

import type { RequestWithUser } from "../../../../../common/types/express-request.types";

// ── Helpers ────────────────────────────────────────────────────────────────

const USER_ID = "user-001";
const KB_ID = "kb-001";
const SLUG = "test-page";
const DIFF_ID = "diff-001";
const FINDING_ID = "finding-001";

function makeReq(userId: string = USER_ID): RequestWithUser {
  return { user: { id: userId, email: "u@example.com" } } as RequestWithUser;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("WikiController", () => {
  let controller: WikiController;
  let pageService: jest.Mocked<WikiPageService>;
  let diffService: jest.Mocked<WikiDiffService>;
  let ingestService: jest.Mocked<WikiIngestService>;
  let lintService: jest.Mocked<WikiLintService>;
  let queryService: jest.Mocked<WikiQueryService>;

  beforeEach(async () => {
    const pageMock = {
      listPages: jest.fn(),
      getPage: jest.fn(),
      createPage: jest.fn(),
      updatePage: jest.fn(),
      deletePage: jest.fn(),
    };
    const diffMock = {
      getDiff: jest.fn(),
      applyDiff: jest.fn(),
      dismissDiff: jest.fn(),
    };
    const ingestMock = {
      ingest: jest.fn(),
    };
    const lintMock = {
      runFullLint: jest.fn(),
      listFindings: jest.fn(),
      patchFinding: jest.fn(),
    };
    const queryMock = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WikiController],
      providers: [
        { provide: WikiPageService, useValue: pageMock },
        { provide: WikiDiffService, useValue: diffMock },
        { provide: WikiIngestService, useValue: ingestMock },
        { provide: WikiLintService, useValue: lintMock },
        { provide: WikiQueryService, useValue: queryMock },
      ],
    }).compile();

    controller = module.get(WikiController);
    pageService = module.get(WikiPageService);
    diffService = module.get(WikiDiffService);
    ingestService = module.get(WikiIngestService);
    lintService = module.get(WikiLintService);
    queryService = module.get(WikiQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── A. Routing + DTO bind correctness ────────────────────────────────────

  describe("GET /:kbId/pages — listPages", () => {
    it("calls pageService.listPages with userId, kbId, and parsed { category, limit, locale }", async () => {
      pageService.listPages.mockResolvedValue([{ slug: SLUG }] as never);
      const query: ListWikiPagesQueryDto = {
        category: "CONCEPT" as never,
        limit: 25,
      };

      const result = await controller.listPages(makeReq(), KB_ID, query);

      // gap #2 (2026-05-12): controller now forwards `locale` (undefined
      // when omitted — service-side reads "all locales").
      expect(pageService.listPages).toHaveBeenCalledWith(USER_ID, KB_ID, {
        category: "CONCEPT",
        limit: 25,
        locale: undefined,
      });
      expect(result).toEqual({ items: [{ slug: SLUG }] });
    });

    it("forwards explicit locale='en' for bilingual KB", async () => {
      pageService.listPages.mockResolvedValue([] as never);
      const query: ListWikiPagesQueryDto = {
        limit: 50,
        locale: "en",
      };

      await controller.listPages(makeReq(), KB_ID, query);

      expect(pageService.listPages).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        expect.objectContaining({ locale: "en", limit: 50 }),
      );
    });
  });

  describe("GET /:kbId/pages/:slug — getPage", () => {
    it("calls pageService.getPage(userId, kbId, slug, locale)", async () => {
      const page = { slug: SLUG, body: "x" };
      pageService.getPage.mockResolvedValue(page as never);

      const result = await controller.getPage(makeReq(), KB_ID, SLUG, {});

      // gap #2 (2026-05-12): controller now forwards `query.locale` (may
      // be undefined for legacy single-locale clients; service defaults
      // to 'zh' downstream).
      expect(pageService.getPage).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        SLUG,
        undefined,
      );
      expect(result).toEqual(page);
    });

    it("propagates NotFoundException from service unchanged (cross-KB IDOR → 404)", async () => {
      pageService.getPage.mockRejectedValue(
        new NotFoundException("Page not found"),
      );
      await expect(
        controller.getPage(makeReq(), KB_ID, SLUG, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it("forwards explicit locale='en' query param to service", async () => {
      const page = { slug: SLUG, body: "x" };
      pageService.getPage.mockResolvedValue(page as never);

      await controller.getPage(makeReq(), KB_ID, SLUG, { locale: "en" });

      expect(pageService.getPage).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        SLUG,
        "en",
      );
    });
  });

  describe("POST /:kbId/pages — createPage", () => {
    it("returns body wrapped in { page } (HTTP 201 set via @HttpCode)", async () => {
      const created = { id: "p1", slug: SLUG };
      pageService.createPage.mockResolvedValue(created as never);
      const dto = {
        slug: SLUG,
        title: "T",
        category: "CONCEPT",
        body: "b",
        oneLiner: "o",
      } as CreateWikiPageDto;

      const result = await controller.createPage(makeReq(), KB_ID, dto);

      expect(pageService.createPage).toHaveBeenCalledWith(USER_ID, KB_ID, dto);
      expect(result).toEqual({ page: created });
    });

    it("declares HTTP 201 via @HttpCode metadata", () => {
      const httpCode = Reflect.getMetadata(
        "__httpCode__",
        WikiController.prototype.createPage,
      );
      expect(httpCode).toBe(201);
    });
  });

  describe("PATCH /:kbId/pages/:slug — updatePage", () => {
    it("passes the full UpdateWikiPageDto through to the service", async () => {
      const dto: UpdateWikiPageDto = { body: "new", oneLiner: "ol" };
      const updated = { id: "p1", slug: SLUG, body: "new" };
      pageService.updatePage.mockResolvedValue(updated as never);

      const result = await controller.updatePage(makeReq(), KB_ID, SLUG, dto);

      expect(pageService.updatePage).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        SLUG,
        dto,
      );
      expect(result).toEqual({ page: updated });
    });

    it("forwards revert action with toRevisionId", async () => {
      const dto: UpdateWikiPageDto = {
        action: "revert",
        toRevisionId: "rev-1",
      };
      pageService.updatePage.mockResolvedValue({ id: "p1" } as never);

      await controller.updatePage(makeReq(), KB_ID, SLUG, dto);

      expect(pageService.updatePage).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        SLUG,
        dto,
      );
    });
  });

  describe("DELETE /:kbId/pages/:slug — deletePage", () => {
    it("calls pageService.deletePage and returns nothing (HTTP 204 via @HttpCode)", async () => {
      pageService.deletePage.mockResolvedValue(undefined as never);

      const result = await controller.deletePage(makeReq(), KB_ID, SLUG);

      expect(pageService.deletePage).toHaveBeenCalledWith(USER_ID, KB_ID, SLUG);
      expect(result).toBeUndefined();
    });

    it("declares HTTP 204 via @HttpCode metadata", () => {
      const httpCode = Reflect.getMetadata(
        "__httpCode__",
        WikiController.prototype.deletePage,
      );
      expect(httpCode).toBe(204);
    });
  });

  describe("POST /:kbId/ingest — ingest (fire-and-forget)", () => {
    it("returns async stub immediately + fires ingestService.ingest in background", async () => {
      // 2026-05-19 fire-and-forget：controller no longer awaits the MULTI
      // pipeline (5-12 min on big sources blew Cloudflare / Railway edge
      // timeouts). Response is a stub { diff: {id:'processing', ...}, async:true }
      // sent immediately; the real WikiDiff PENDING row is written by the
      // background promise. failure surfaces in [wiki ingest async] log.
      const dto: IngestWikiDto = { documentIds: ["doc-1", "doc-2"] };
      ingestService.ingest.mockResolvedValue({
        id: DIFF_ID,
        status: "PENDING",
        affectedKeys: ["a:zh", "b:en"],
        knowledgeBaseId: KB_ID,
        items: [],
      } as never);

      const result = await controller.ingest(makeReq(), KB_ID, dto);

      // ingestService.ingest is invoked but not awaited synchronously; assert
      // it was called with the right args (background promise fires regardless).
      expect(ingestService.ingest).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        dto.documentIds,
      );
      expect(result).toEqual({
        diff: {
          id: "processing",
          status: "PENDING",
          affectedKeys: [],
        },
        async: true,
      });
    });
  });

  describe("GET /:kbId/diffs/:diffId — getDiff", () => {
    it("passes (userId, kbId, diffId) through and returns service result", async () => {
      const diff = { id: DIFF_ID, status: "PENDING" };
      diffService.getDiff.mockResolvedValue(diff as never);

      const result = await controller.getDiff(makeReq(), KB_ID, DIFF_ID);

      expect(diffService.getDiff).toHaveBeenCalledWith(USER_ID, KB_ID, DIFF_ID);
      expect(result).toBe(diff);
    });

    it("propagates NotFoundException unchanged (cross-KB IDOR → 404)", async () => {
      diffService.getDiff.mockRejectedValue(
        new NotFoundException("Diff not found"),
      );
      await expect(
        controller.getDiff(makeReq(), KB_ID, DIFF_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("PATCH /:kbId/diffs/:diffId — patchDiff", () => {
    it("action=apply → calls diffService.applyDiff with selectedItemIds", async () => {
      const dto: PatchWikiDiffDto = {
        action: "apply",
        selectedItemIds: ["item-1", "item-2"],
      };
      diffService.applyDiff.mockResolvedValue({ id: DIFF_ID } as never);

      await controller.patchDiff(makeReq(), KB_ID, DIFF_ID, dto);

      expect(diffService.applyDiff).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        DIFF_ID,
        ["item-1", "item-2"],
        { supersedeConflictingDiffs: false },
      );
      expect(diffService.dismissDiff).not.toHaveBeenCalled();
    });

    it("action=apply with no selectedItemIds → forwards undefined (apply all)", async () => {
      const dto: PatchWikiDiffDto = { action: "apply" };
      diffService.applyDiff.mockResolvedValue({ id: DIFF_ID } as never);

      await controller.patchDiff(makeReq(), KB_ID, DIFF_ID, dto);

      expect(diffService.applyDiff).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        DIFF_ID,
        undefined,
        { supersedeConflictingDiffs: false },
      );
    });

    it("action=dismiss → calls diffService.dismissDiff (selectedItemIds ignored)", async () => {
      const dto: PatchWikiDiffDto = {
        action: "dismiss",
        selectedItemIds: ["item-x"],
      };
      diffService.dismissDiff.mockResolvedValue({ id: DIFF_ID } as never);

      await controller.patchDiff(makeReq(), KB_ID, DIFF_ID, dto);

      expect(diffService.dismissDiff).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        DIFF_ID,
      );
      expect(diffService.applyDiff).not.toHaveBeenCalled();
    });
  });

  describe("POST /:kbId/query — query", () => {
    it("passes WikiQueryRequestDto through to queryService.query", async () => {
      const dto: WikiQueryRequestDto = { question: "What is X?", mode: "auto" };
      const result = { answer: "X is..." };
      queryService.query.mockResolvedValue(result as never);

      const out = await controller.query(makeReq(), KB_ID, dto);

      expect(queryService.query).toHaveBeenCalledWith(USER_ID, KB_ID, dto);
      expect(out).toBe(result);
    });
  });

  describe("POST /:kbId/lint — runLint", () => {
    it("calls lintService.runFullLint(userId, kbId)", async () => {
      const result = {
        counts: {
          ORPHAN: 0,
          MISSING_XREF: 0,
          STALE: 0,
          CONTRADICTION: 0,
          DATA_GAP: 0,
        },
        budgetExceeded: false,
      };
      lintService.runFullLint.mockResolvedValue(result as never);

      const out = await controller.runLint(makeReq(), KB_ID);

      expect(lintService.runFullLint).toHaveBeenCalledWith(USER_ID, KB_ID);
      expect(out).toBe(result);
    });
  });

  describe("GET /:kbId/lint-findings — listLintFindings", () => {
    it("parses query.resolved 'true' → boolean true", async () => {
      lintService.listFindings.mockResolvedValue([] as never);
      const query: WikiLintFindingsQueryDto = {
        type: "ORPHAN" as never,
        resolved: "true",
      };

      await controller.listLintFindings(makeReq(), KB_ID, query);

      expect(lintService.listFindings).toHaveBeenCalledWith(USER_ID, KB_ID, {
        type: "ORPHAN",
        resolved: true,
      });
    });

    it("parses query.resolved 'false' → boolean false", async () => {
      lintService.listFindings.mockResolvedValue([] as never);
      const query: WikiLintFindingsQueryDto = { resolved: "false" };

      await controller.listLintFindings(makeReq(), KB_ID, query);

      expect(lintService.listFindings).toHaveBeenCalledWith(USER_ID, KB_ID, {
        type: undefined,
        resolved: false,
      });
    });

    it("parses query.resolved undefined → undefined (no filter)", async () => {
      lintService.listFindings.mockResolvedValue([{ id: FINDING_ID }] as never);
      const query: WikiLintFindingsQueryDto = {};

      const result = await controller.listLintFindings(makeReq(), KB_ID, query);

      expect(lintService.listFindings).toHaveBeenCalledWith(USER_ID, KB_ID, {
        type: undefined,
        resolved: undefined,
      });
      expect(result).toEqual({ items: [{ id: FINDING_ID }] });
    });

    it("treats arbitrary string for resolved as undefined (only 'true'/'false' are recognized)", async () => {
      lintService.listFindings.mockResolvedValue([] as never);
      const query: WikiLintFindingsQueryDto = { resolved: "yes" };

      await controller.listLintFindings(makeReq(), KB_ID, query);

      expect(lintService.listFindings).toHaveBeenCalledWith(USER_ID, KB_ID, {
        type: undefined,
        resolved: undefined,
      });
    });
  });

  describe("PATCH /:kbId/lint-findings/:id — patchLintFinding", () => {
    it("forwards action through to lintService.patchFinding", async () => {
      const dto: PatchWikiLintFindingDto = { action: "resolve" };
      lintService.patchFinding.mockResolvedValue({ id: FINDING_ID } as never);

      await controller.patchLintFinding(makeReq(), KB_ID, FINDING_ID, dto);

      expect(lintService.patchFinding).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        FINDING_ID,
        "resolve",
      );
    });

    it("forwards action=dismiss", async () => {
      const dto: PatchWikiLintFindingDto = { action: "dismiss" };
      lintService.patchFinding.mockResolvedValue({ id: FINDING_ID } as never);

      await controller.patchLintFinding(makeReq(), KB_ID, FINDING_ID, dto);

      expect(lintService.patchFinding).toHaveBeenCalledWith(
        USER_ID,
        KB_ID,
        FINDING_ID,
        "dismiss",
      );
    });
  });

  describe("POST /:kbId/export — export (P3a stub)", () => {
    it("still throws NotImplementedException", async () => {
      await expect(controller.export(makeReq(), KB_ID)).rejects.toThrow(
        NotImplementedException,
      );
    });
  });

  // ── B. JwtAuthGuard wired on every endpoint ──────────────────────────────

  describe("JwtAuthGuard — declared on every endpoint via @UseGuards", () => {
    const endpoints: Array<keyof WikiController> = [
      "listPages",
      "getPage",
      "createPage",
      "updatePage",
      "deletePage",
      "ingest",
      "getDiff",
      "patchDiff",
      "query",
      "runLint",
      "listLintFindings",
      "patchLintFinding",
      "export",
    ];

    it.each(endpoints)("%s declares JwtAuthGuard", (method) => {
      const handler = WikiController.prototype[method] as (
        ...args: unknown[]
      ) => unknown;
      const guards = Reflect.getMetadata("__guards__", handler) as
        | Array<new (...args: unknown[]) => unknown>
        | undefined;
      expect(guards).toBeDefined();
      const names = (guards ?? []).map((g) => g.name);
      expect(names).toContain(JwtAuthGuard.name);
    });
  });

  // ── C. DTO validation (class-validator) ──────────────────────────────────

  describe("DTO validation", () => {
    describe("CreateWikiPageDto", () => {
      const validBody = {
        slug: "valid-slug",
        title: "Title",
        category: "CONCEPT",
        body: "body",
        oneLiner: "one liner",
      };

      it("accepts a valid DTO", async () => {
        const dto = plainToInstance(CreateWikiPageDto, validBody);
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it("rejects an invalid slug (uppercase)", async () => {
        const dto = plainToInstance(CreateWikiPageDto, {
          ...validBody,
          slug: "Invalid-Slug",
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe("slug");
        expect(errors[0].constraints).toMatchObject({
          matches: expect.stringContaining("kebab-case"),
        });
      });

      it("rejects a slug with leading hyphen", async () => {
        const dto = plainToInstance(CreateWikiPageDto, {
          ...validBody,
          slug: "-leading-hyphen",
        });
        const errors = await validate(dto);
        expect(errors.find((e) => e.property === "slug")).toBeDefined();
      });

      it("rejects a single-character slug (regex requires >= 2 chars)", async () => {
        const dto = plainToInstance(CreateWikiPageDto, {
          ...validBody,
          slug: "a",
        });
        const errors = await validate(dto);
        expect(errors.find((e) => e.property === "slug")).toBeDefined();
      });

      it("rejects an unknown category enum value", async () => {
        const dto = plainToInstance(CreateWikiPageDto, {
          ...validBody,
          category: "UNKNOWN",
        });
        const errors = await validate(dto);
        expect(errors.find((e) => e.property === "category")).toBeDefined();
      });
    });

    describe("WikiQueryRequestDto", () => {
      it("accepts a typical question", async () => {
        const dto = plainToInstance(WikiQueryRequestDto, {
          question: "What is the capital of France?",
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it("rejects question > 2000 chars (MaxLength)", async () => {
        const dto = plainToInstance(WikiQueryRequestDto, {
          question: "x".repeat(2001),
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe("question");
        expect(errors[0].constraints).toMatchObject({
          maxLength: expect.any(String),
        });
      });

      it("accepts exactly 2000 chars (boundary)", async () => {
        const dto = plainToInstance(WikiQueryRequestDto, {
          question: "x".repeat(2000),
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it("rejects empty question (MinLength 1)", async () => {
        const dto = plainToInstance(WikiQueryRequestDto, { question: "" });
        const errors = await validate(dto);
        expect(errors.find((e) => e.property === "question")).toBeDefined();
      });

      it("rejects unknown mode value", async () => {
        const dto = plainToInstance(WikiQueryRequestDto, {
          question: "q",
          mode: "bogus",
        });
        const errors = await validate(dto);
        expect(errors.find((e) => e.property === "mode")).toBeDefined();
      });
    });
  });
});
