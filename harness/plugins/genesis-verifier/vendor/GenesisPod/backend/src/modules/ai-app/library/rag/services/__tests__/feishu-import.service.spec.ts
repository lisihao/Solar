/**
 * FeishuImportService 单元测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FeishuImportService } from "../feishu-import.service";
import { KnowledgeBaseService } from "../knowledge-base.service";
import { UrlFetchService } from "../url-fetch.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ==================== Mocks ====================

const mockPrisma = {
  knowledgeBaseDocument: {
    findFirst: jest.fn(),
  },
  knowledgeBase: {
    findFirst: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
};

const mockKnowledgeBaseService = {
  findById: jest.fn(),
  addDocument: jest.fn(),
  create: jest.fn(),
};

const mockUrlFetchService = {
  fetchUrl: jest.fn(),
};

// ==================== Test Data ====================

const defaultKb = { id: "kb-001", name: "飞书同步" };
const defaultDocument = {
  id: "doc-001",
  title: "测试文档",
  knowledgeBaseId: "kb-001",
};

// ==================== Tests ====================

describe("FeishuImportService", () => {
  let service: FeishuImportService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // 默认无重复文档
    mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValue(null);
    // 默认 KB
    mockKnowledgeBaseService.findById.mockResolvedValue(defaultKb);
    mockKnowledgeBaseService.addDocument.mockResolvedValue(defaultDocument);
    // 默认 URL 抓取
    mockUrlFetchService.fetchUrl.mockResolvedValue({
      title: "抓取到的标题",
      metadata: { description: "描述", author: "作者" },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeishuImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KnowledgeBaseService, useValue: mockKnowledgeBaseService },
        { provide: UrlFetchService, useValue: mockUrlFetchService },
      ],
    }).compile();

    service = module.get<FeishuImportService>(FeishuImportService);
  });

  // ==================== identifyLinkType ====================

  describe("identifyLinkType", () => {
    it("should identify wiki_node from /wiki/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/wiki/abc123")).toBe(
        "wiki_node",
      );
    });

    it("should identify doc from /docs/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/docs/abc")).toBe(
        "doc",
      );
    });

    it("should identify doc from /docx/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/docx/abc")).toBe(
        "doc",
      );
    });

    it("should identify sheet from /sheets/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/sheets/abc")).toBe(
        "sheet",
      );
    });

    it("should identify sheet from /sheet/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/sheet/abc")).toBe(
        "sheet",
      );
    });

    it("should identify bitable from /base/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/base/abc")).toBe(
        "bitable",
      );
    });

    it("should identify bitable from /bitable/ path", () => {
      expect(service.identifyLinkType("https://feishu.cn/bitable/abc")).toBe(
        "bitable",
      );
    });

    it("should return external for unrecognized path", () => {
      expect(service.identifyLinkType("https://feishu.cn/other/abc")).toBe(
        "external",
      );
    });

    it("should return external for invalid URL", () => {
      expect(service.identifyLinkType("not-a-url")).toBe("external");
    });
  });

  // ==================== isFeishuUrl ====================

  describe("isFeishuUrl", () => {
    it("should return true for feishu.cn domain", () => {
      expect(service.isFeishuUrl("https://feishu.cn/wiki/abc")).toBe(true);
    });

    it("should return true for larksuite.com domain", () => {
      expect(service.isFeishuUrl("https://app.larksuite.com/wiki/abc")).toBe(
        true,
      );
    });

    it("should return true for feishu.net domain", () => {
      expect(service.isFeishuUrl("https://feishu.net/wiki/abc")).toBe(true);
    });

    it("should return false for non-feishu domain", () => {
      expect(service.isFeishuUrl("https://google.com/page")).toBe(false);
    });

    it("should return false for invalid URL", () => {
      expect(service.isFeishuUrl("not-a-url")).toBe(false);
    });
  });

  // ==================== getUserByFeishuOpenId ====================

  describe("getUserByFeishuOpenId", () => {
    it("should return userId when user found", async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: "user-001" });

      const result = await service.getUserByFeishuOpenId("open-id-001");
      expect(result).toBe("user-001");
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            preferences: expect.objectContaining({
              path: ["feishuOpenId"],
              equals: "open-id-001",
            }),
          }),
        }),
      );
    });

    it("should return null when user not found", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.getUserByFeishuOpenId("unknown-open-id");
      expect(result).toBeNull();
    });
  });

  // ==================== importFeishuUrl ====================

  describe("importFeishuUrl", () => {
    const baseParams = {
      url: "https://feishu.cn/wiki/abc123",
      userId: "user-001",
    };

    it("should import a wiki document successfully using provided knowledgeBaseId", async () => {
      const result = await service.importFeishuUrl({
        ...baseParams,
        knowledgeBaseId: "kb-001",
      });

      expect(result.documentId).toBe("doc-001");
      expect(result.linkType).toBe("wiki_node");
      expect(result.knowledgeBaseId).toBe("kb-001");
      expect(result.detailUrl).toContain("kb-001");
      expect(mockKnowledgeBaseService.findById).toHaveBeenCalledWith("kb-001");
      expect(mockKnowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-001",
        expect.objectContaining({
          sourceType: "FEISHU_WIKI",
          sourceUrl: baseParams.url,
        }),
      );
    });

    it("should use title from URL fetch when no title provided", async () => {
      await service.importFeishuUrl({
        ...baseParams,
        knowledgeBaseId: "kb-001",
      });

      expect(mockKnowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-001",
        expect.objectContaining({ title: "抓取到的标题" }),
      );
    });

    it("should prefer provided title over fetched title", async () => {
      await service.importFeishuUrl({
        ...baseParams,
        knowledgeBaseId: "kb-001",
        title: "手动指定的标题",
      });

      expect(mockKnowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-001",
        expect.objectContaining({ title: "手动指定的标题" }),
      );
    });

    it("should fallback to default title when fetch fails", async () => {
      mockUrlFetchService.fetchUrl.mockRejectedValue(new Error("网络错误"));

      await service.importFeishuUrl({
        ...baseParams,
        knowledgeBaseId: "kb-001",
      });

      expect(mockKnowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-001",
        expect.objectContaining({ title: "无标题" }),
      );
    });

    it("should throw when document already exists", async () => {
      mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValue({
        id: "existing-doc",
        knowledgeBase: { name: "已有知识库" },
      });

      await expect(
        service.importFeishuUrl({ ...baseParams, knowledgeBaseId: "kb-001" }),
      ).rejects.toThrow('已存在于知识库"已有知识库"');
    });

    it("should get or create default KB when no knowledgeBaseId provided", async () => {
      // 存在飞书同步 KB
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue(defaultKb);

      await service.importFeishuUrl(baseParams);

      expect(mockPrisma.knowledgeBase.findFirst).toHaveBeenCalled();
      expect(mockKnowledgeBaseService.findById).not.toHaveBeenCalled();
    });

    it("should create default KB when none exists", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue(null);
      mockKnowledgeBaseService.create.mockResolvedValue({
        id: "new-kb-001",
        name: "飞书同步",
      });
      mockKnowledgeBaseService.addDocument.mockResolvedValue({
        ...defaultDocument,
        knowledgeBaseId: "new-kb-001",
      });

      const result = await service.importFeishuUrl(baseParams);
      expect(mockKnowledgeBaseService.create).toHaveBeenCalledWith(
        "user-001",
        expect.objectContaining({ name: "飞书同步" }),
      );
      expect(result.documentId).toBeDefined();
    });

    it("should use correct sourceType for different link types", async () => {
      const testCases = [
        { url: "https://feishu.cn/docs/abc", sourceType: "FEISHU_DOC" },
        { url: "https://feishu.cn/sheets/abc", sourceType: "FEISHU_SHEET" },
        { url: "https://feishu.cn/base/abc", sourceType: "FEISHU_BITABLE" },
        { url: "https://feishu.cn/other/abc", sourceType: "URL" },
      ];

      for (const tc of testCases) {
        jest.clearAllMocks();
        mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValue(null);
        mockKnowledgeBaseService.findById.mockResolvedValue(defaultKb);
        mockKnowledgeBaseService.addDocument.mockResolvedValue(defaultDocument);
        mockUrlFetchService.fetchUrl.mockResolvedValue({
          title: "标题",
          metadata: {},
        });

        await service.importFeishuUrl({
          url: tc.url,
          userId: "u1",
          knowledgeBaseId: "kb-001",
        });
        expect(mockKnowledgeBaseService.addDocument).toHaveBeenCalledWith(
          "kb-001",
          expect.objectContaining({ sourceType: tc.sourceType }),
        );
      }
    });
  });
});
