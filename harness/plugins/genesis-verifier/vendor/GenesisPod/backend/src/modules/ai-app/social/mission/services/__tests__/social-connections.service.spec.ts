/**
 * SocialConnectionsService 烟雾测试（god class 拆分 phase 2.A.1 配套）
 *
 * 仅 instantiation + 基本方法存在性验证；详细 connection lifecycle 的旧测试
 * 历史挂在 ai-social.service.spec.ts，后续 follow-up PR 按方法搬运过来。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { SocialConnectionsService } from "../social-connections.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { CacheService } from "../../../../../../common/cache/cache.service";
import { SocialBrowserService } from "../social-browser.service";
import { XhsMcpAdapter } from "../../../integrations/xiaohongshu/xiaohongshu.adapter";

process.env.SESSION_ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

describe("SocialConnectionsService (smoke)", () => {
  let service: SocialConnectionsService;

  beforeEach(async () => {
    const mockPrisma: any = {
      socialPlatformConnection: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
      },
    };
    const mockCache: any = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      buildKey: jest
        .fn()
        .mockImplementation(
          (prefix: string, ...parts: string[]) =>
            `${prefix}:${parts.join(":")}`,
        ),
    };
    const mockPlaywright: any = {
      startLoginSession: jest.fn(),
      checkLoginStatus: jest.fn(),
      endLoginSession: jest.fn(),
      restoreSession: jest.fn(),
      createPage: jest.fn(),
      closeContext: jest.fn(),
    };
    const mockXhsMcpAdapter: any = {
      isAvailable: jest.fn().mockReturnValue(false),
      checkLoginStatus: jest.fn().mockResolvedValue({ loggedIn: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialConnectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
        { provide: SocialBrowserService, useValue: mockPlaywright },
        { provide: XhsMcpAdapter, useValue: mockXhsMcpAdapter },
      ],
    }).compile();

    service = module.get<SocialConnectionsService>(SocialConnectionsService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("instantiates", () => {
    expect(service).toBeDefined();
  });

  it("exposes 6 public methods", () => {
    expect(typeof service.getConnections).toBe("function");
    expect(typeof service.initConnection).toBe("function");
    expect(typeof service.verifyConnection).toBe("function");
    expect(typeof service.deleteConnection).toBe("function");
    expect(typeof service.testConnection).toBe("function");
    expect(typeof service.refreshConnection).toBe("function");
  });

  it("getConnections returns array from prisma", async () => {
    await expect(service.getConnections("u-1")).resolves.toEqual([]);
  });
});
