import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { NotionPageService } from "../notion-page.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { NotionAuthService } from "../notion-auth.service";
import { ListPagesDto } from "../../dto/notion.dto";

const mockNotionClient = {
  blocks: {
    children: {
      list: jest.fn(),
      append: jest.fn(),
    },
    delete: jest.fn(),
  },
};

jest.mock("@notionhq/client", () => ({
  Client: jest.fn().mockImplementation(() => mockNotionClient),
}));

describe("NotionPageService", () => {
  let service: NotionPageService;
  let prisma: jest.Mocked<PrismaService>;
  let authService: jest.Mocked<NotionAuthService>;

  const mockPage = {
    id: "page-1",
    notionPageId: "notion-page-1",
    connectionId: "conn-1",
    title: "Test Page",
    icon: null,
    coverUrl: null,
    url: "https://notion.so/test",
    parentType: "workspace",
    parentId: null,
    blocks: [
      { type: "paragraph", content: [{ type: "text", text: "Hello World" }] },
    ],
    plainTextContent: "Hello World",
    syncStatus: "SUCCESS",
    notionCreatedAt: new Date("2024-01-01"),
    notionUpdatedAt: new Date("2024-01-02"),
    lastSyncedAt: new Date(),
    isLocallyModified: false,
    localModifiedAt: null,
    linkedResourceId: null,
    connection: { id: "conn-1", workspaceName: "Test WS", workspaceIcon: null },
    versions: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const prismaMock = {
      notionConnection: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      notionPage: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      notionDatabase: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      notionBlockVersion: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      resource: {
        findUnique: jest.fn(),
      },
    };

    const authServiceMock = {
      getNotionClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionPageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotionAuthService, useValue: authServiceMock },
      ],
    }).compile();

    service = module.get<NotionPageService>(NotionPageService);
    prisma = module.get(PrismaService);
    authService = module.get(NotionAuthService);
  });

  // ============ listPages ============

  describe("listPages", () => {
    it("should return paginated pages for all user connections", async () => {
      const dto: ListPagesDto = { page: 1, limit: 20 };
      prisma.notionConnection.findMany.mockResolvedValue([
        { id: "conn-1" },
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([mockPage] as any);
      prisma.notionPage.count.mockResolvedValue(1);

      const result = await service.listPages("user-1", dto);

      expect(prisma.notionConnection.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { id: true },
      });
      expect(result.pages).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("should filter by connectionId when provided", async () => {
      const dto: ListPagesDto = { connectionId: "conn-1" };
      prisma.notionPage.findMany.mockResolvedValue([mockPage] as any);
      prisma.notionPage.count.mockResolvedValue(1);

      await service.listPages("user-1", dto);

      // Should not call findMany for connections because connectionId is given directly
      expect(prisma.notionConnection.findMany).not.toHaveBeenCalled();
      expect(prisma.notionPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connectionId: { in: ["conn-1"] },
          }),
        }),
      );
    });

    it("should apply search filter when search term provided", async () => {
      const dto: ListPagesDto = { search: "hello" };
      prisma.notionConnection.findMany.mockResolvedValue([
        { id: "conn-1" },
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([mockPage] as any);
      prisma.notionPage.count.mockResolvedValue(1);

      await service.listPages("user-1", dto);

      expect(prisma.notionPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: expect.objectContaining({ contains: "hello" }),
              }),
            ]),
          }),
        }),
      );
    });

    it("should use default pagination values when not specified", async () => {
      const dto: ListPagesDto = {};
      prisma.notionConnection.findMany.mockResolvedValue([
        { id: "conn-1" },
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([]);
      prisma.notionPage.count.mockResolvedValue(0);

      const result = await service.listPages("user-1", dto);

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it("should calculate correct totalPages for pagination", async () => {
      const dto: ListPagesDto = { page: 1, limit: 10 };
      prisma.notionConnection.findMany.mockResolvedValue([
        { id: "conn-1" },
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([]);
      prisma.notionPage.count.mockResolvedValue(25);

      const result = await service.listPages("user-1", dto);

      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ============ getPage ============

  describe("getPage", () => {
    it("should return page details when page exists and belongs to user", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);

      const result = await service.getPage("user-1", "page-1");

      expect(prisma.notionPage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "page-1", connection: { userId: "user-1" } },
        }),
      );
      expect(result).toEqual(mockPage);
    });

    it("should throw NotFoundException when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(service.getPage("user-1", "page-999")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when page belongs to another user", async () => {
      // Prisma query with connection.userId filter already handles authorization
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(service.getPage("user-2", "page-1")).rejects.toThrow(
        "Page not found",
      );
    });
  });

  // ============ updatePageLocally ============

  describe("updatePageLocally", () => {
    it("should save block version and update page with new blocks", async () => {
      const currentPage = { ...mockPage, isLocallyModified: false };
      prisma.notionPage.findFirst.mockResolvedValue(currentPage as any);
      prisma.notionBlockVersion.findFirst.mockResolvedValue(null);
      prisma.notionBlockVersion.create.mockResolvedValue({} as any);
      prisma.notionPage.update.mockResolvedValue({
        ...currentPage,
        isLocallyModified: true,
      } as any);

      const newBlocks = [
        { type: "paragraph", content: [{ type: "text", text: "Updated" }] },
      ];
      const result = await service.updatePageLocally(
        "user-1",
        "page-1",
        newBlocks,
      );

      expect(prisma.notionBlockVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pageId: "page-1",
            version: 1,
            source: "local_edit",
          }),
        }),
      );
      expect(prisma.notionPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLocallyModified: true }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePageLocally("user-1", "page-999", []),
      ).rejects.toThrow(NotFoundException);
    });

    it("should increment version number based on existing versions", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      prisma.notionBlockVersion.findFirst.mockResolvedValue({
        version: 3,
      } as any);
      prisma.notionBlockVersion.create.mockResolvedValue({} as any);
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.updatePageLocally("user-1", "page-1", []);

      expect(prisma.notionBlockVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 4 }),
        }),
      );
    });

    it("should extract plain text content from new blocks", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      prisma.notionBlockVersion.findFirst.mockResolvedValue(null);
      prisma.notionBlockVersion.create.mockResolvedValue({} as any);
      prisma.notionPage.update.mockResolvedValue({} as any);

      const blocks = [
        { type: "paragraph", content: [{ type: "text", text: "Line one" }] },
        { type: "paragraph", content: [{ type: "text", text: "Line two" }] },
      ];
      await service.updatePageLocally("user-1", "page-1", blocks);

      expect(prisma.notionPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            plainTextContent: "Line one\nLine two",
          }),
        }),
      );
    });
  });

  // ============ pushToNotion ============

  describe("pushToNotion", () => {
    it("should push local changes to Notion and clear modification flag", async () => {
      const locallyModifiedPage = {
        ...mockPage,
        isLocallyModified: true,
        connection: { id: "conn-1" },
      };
      prisma.notionPage.findFirst.mockResolvedValue(locallyModifiedPage as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.blocks.children.list.mockResolvedValue({ results: [] });
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.pushToNotion("user-1", "page-1");

      expect(authService.getNotionClient).toHaveBeenCalledWith("conn-1");
      expect(prisma.notionPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isLocallyModified: false,
            localModifiedAt: null,
          }),
        }),
      );
    });

    it("should throw NotFoundException when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(service.pushToNotion("user-1", "page-999")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when page has no local modifications", async () => {
      const unmodifiedPage = { ...mockPage, isLocallyModified: false };
      prisma.notionPage.findFirst.mockResolvedValue(unmodifiedPage as any);

      await expect(service.pushToNotion("user-1", "page-1")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.pushToNotion("user-1", "page-1")).rejects.toThrow(
        "No local modifications to push",
      );
    });

    it("should delete existing blocks before appending new ones", async () => {
      const locallyModifiedPage = {
        ...mockPage,
        isLocallyModified: true,
        connection: { id: "conn-1" },
      };
      prisma.notionPage.findFirst.mockResolvedValue(locallyModifiedPage as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.blocks.children.list.mockResolvedValue({
        results: [{ id: "existing-block-1" }, { id: "existing-block-2" }],
      });
      mockNotionClient.blocks.delete.mockResolvedValue({});
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.pushToNotion("user-1", "page-1");

      expect(mockNotionClient.blocks.delete).toHaveBeenCalledTimes(2);
    });

    it("should wrap Notion API errors in BadRequestException", async () => {
      const locallyModifiedPage = {
        ...mockPage,
        isLocallyModified: true,
        connection: { id: "conn-1" },
      };
      prisma.notionPage.findFirst.mockResolvedValue(locallyModifiedPage as any);
      authService.getNotionClient.mockRejectedValue(
        new Error("Notion API error"),
      );

      await expect(service.pushToNotion("user-1", "page-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============ linkToResource / unlinkFromResource ============

  describe("linkToResource", () => {
    it("should link a page to a resource", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      prisma.resource.findUnique.mockResolvedValue({ id: "resource-1" } as any);
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.linkToResource("user-1", "page-1", "resource-1");

      expect(prisma.notionPage.update).toHaveBeenCalledWith({
        where: { id: "page-1" },
        data: { linkedResourceId: "resource-1" },
      });
    });

    it("should throw NotFoundException when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(
        service.linkToResource("user-1", "page-999", "resource-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when resource not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      prisma.resource.findUnique.mockResolvedValue(null);

      await expect(
        service.linkToResource("user-1", "page-1", "resource-999"),
      ).rejects.toThrow("Resource not found");
    });
  });

  describe("unlinkFromResource", () => {
    it("should unlink page from its resource", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.unlinkFromResource("user-1", "page-1");

      expect(prisma.notionPage.update).toHaveBeenCalledWith({
        where: { id: "page-1" },
        data: { linkedResourceId: null },
      });
    });

    it("should throw NotFoundException when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(
        service.unlinkFromResource("user-1", "page-999"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============ listDatabases ============

  describe("listDatabases", () => {
    it("should return databases for all user connections", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        { id: "conn-1" },
      ] as any);
      prisma.notionDatabase.findMany.mockResolvedValue([
        { id: "db-1", title: "My DB", notionDbId: "notion-db-1" },
      ] as any);

      const result = await service.listDatabases("user-1");

      expect(prisma.notionDatabase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId: { in: ["conn-1"] } },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it("should filter by connectionId when provided", async () => {
      prisma.notionDatabase.findMany.mockResolvedValue([]);

      await service.listDatabases("user-1", "conn-1");

      // Should not call findMany for connections
      expect(prisma.notionConnection.findMany).not.toHaveBeenCalled();
      expect(prisma.notionDatabase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId: { in: ["conn-1"] } },
        }),
      );
    });
  });

  // ============ getDatabase ============

  describe("getDatabase", () => {
    it("should return database when it exists and belongs to user", async () => {
      const mockDb = {
        id: "db-1",
        title: "Test DB",
        connection: { id: "conn-1" },
      };
      prisma.notionDatabase.findFirst.mockResolvedValue(mockDb as any);

      const result = await service.getDatabase("user-1", "db-1");

      expect(prisma.notionDatabase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "db-1", connection: { userId: "user-1" } },
        }),
      );
      expect(result).toEqual(mockDb);
    });

    it("should throw NotFoundException when database not found", async () => {
      prisma.notionDatabase.findFirst.mockResolvedValue(null);

      await expect(service.getDatabase("user-1", "db-999")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============ Block conversion ============

  describe("block conversion (via pushToNotion)", () => {
    const setupPushTest = (blocks: unknown[]) => {
      const pageWithBlocks = {
        ...mockPage,
        isLocallyModified: true,
        blocks,
        connection: { id: "conn-1" },
      };
      prisma.notionPage.findFirst.mockResolvedValue(pageWithBlocks as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.blocks.children.list.mockResolvedValue({ results: [] });
      mockNotionClient.blocks.children.append.mockResolvedValue({});
      prisma.notionPage.update.mockResolvedValue({} as any);
    };

    it("should convert paragraph blocks to Notion format", async () => {
      setupPushTest([
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ]);

      await service.pushToNotion("user-1", "page-1");

      expect(mockNotionClient.blocks.children.append).toHaveBeenCalledWith(
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({ type: "paragraph" }),
          ]),
        }),
      );
    });

    it("should convert heading blocks with level props", async () => {
      setupPushTest([
        {
          type: "heading",
          props: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
      ]);

      await service.pushToNotion("user-1", "page-1");

      expect(mockNotionClient.blocks.children.append).toHaveBeenCalledWith(
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({ type: "heading_2" }),
          ]),
        }),
      );
    });

    it("should convert checkListItem blocks with checked state", async () => {
      setupPushTest([
        {
          type: "checkListItem",
          props: { checked: true },
          content: [{ type: "text", text: "Done" }],
        },
      ]);

      await service.pushToNotion("user-1", "page-1");

      expect(mockNotionClient.blocks.children.append).toHaveBeenCalledWith(
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({ type: "to_do" }),
          ]),
        }),
      );
    });

    it("should not append when blocks are empty", async () => {
      setupPushTest([]);

      await service.pushToNotion("user-1", "page-1");

      expect(mockNotionClient.blocks.children.append).not.toHaveBeenCalled();
    });
  });
});
