/**
 * XhsMcpFacadeService 烟雾测试（god class 拆分 phase 2.A.2 配套）
 */

import { Test, TestingModule } from "@nestjs/testing";
import { XhsMcpFacadeService } from "../xhs-mcp-facade.service";
import { XhsMcpAdapter } from "../../../integrations/xiaohongshu/xiaohongshu.adapter";

describe("XhsMcpFacadeService (smoke)", () => {
  let service: XhsMcpFacadeService;
  let adapter: any;

  beforeEach(async () => {
    adapter = {
      checkLoginStatus: jest.fn().mockResolvedValue({ loggedIn: true }),
      listFeeds: jest.fn().mockResolvedValue([]),
      searchFeeds: jest.fn().mockResolvedValue([]),
      getFeedDetail: jest.fn().mockResolvedValue(null),
      postComment: jest.fn().mockResolvedValue({ success: true }),
      getUserProfile: jest.fn().mockResolvedValue(null),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XhsMcpFacadeService,
        { provide: XhsMcpAdapter, useValue: adapter },
      ],
    }).compile();
    service = module.get<XhsMcpFacadeService>(XhsMcpFacadeService);
  });

  it("instantiates", () => {
    expect(service).toBeDefined();
  });

  it("getLoginStatus delegates to adapter", async () => {
    const r = await service.getLoginStatus();
    expect(adapter.checkLoginStatus).toHaveBeenCalled();
    expect(r.loggedIn).toBe(true);
  });

  it("listFeeds / searchFeeds / getFeedDetail / postComment / getUserProfile delegate", async () => {
    await service.listFeeds();
    await service.searchFeeds("kw");
    await service.getFeedDetail("f1", "tok");
    await service.postComment("f1", "tok", "ok");
    await service.getUserProfile("u1", "tok");
    expect(adapter.listFeeds).toHaveBeenCalled();
    expect(adapter.searchFeeds).toHaveBeenCalledWith("kw");
    expect(adapter.getFeedDetail).toHaveBeenCalledWith("f1", "tok");
    expect(adapter.postComment).toHaveBeenCalledWith("f1", "tok", "ok");
    expect(adapter.getUserProfile).toHaveBeenCalledWith("u1", "tok");
  });
});
