/**
 * SocialImportSourcesService 烟雾测试（god class 拆分 phase 2.A.5 配套）
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SocialImportSourcesService } from "../social-import-sources.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("SocialImportSourcesService (smoke)", () => {
  let service: SocialImportSourcesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      resource: { findMany: jest.fn().mockResolvedValue([]) },
      researchTopic: { findMany: jest.fn().mockResolvedValue([]) },
      officeDocument: { findMany: jest.fn().mockResolvedValue([]) },
      writingProject: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialImportSourcesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<SocialImportSourcesService>(
      SocialImportSourcesService,
    );
  });

  it("instantiates", () => {
    expect(service).toBeDefined();
  });

  it("getExploreSources passes filter / pagination", async () => {
    await service.getExploreSources("u1", {
      type: "video",
      page: 2,
      limit: 50,
      since: "2026-01-01",
    });
    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "VIDEO",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
        skip: 50,
        take: 50,
      }),
    );
  });

  it("getResearchSources / getOfficeSources / getWritingSources / getTopicInsightsSources delegate to prisma", async () => {
    await service.getResearchSources("u1");
    await service.getOfficeSources("u1");
    await service.getWritingSources("u1");
    await service.getTopicInsightsSources("u1");
    expect(prisma.researchTopic.findMany).toHaveBeenCalled();
    expect(prisma.officeDocument.findMany).toHaveBeenCalled();
    expect(prisma.writingProject.findMany).toHaveBeenCalled();
  });
});
