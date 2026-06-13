/**
 * XhsMcpAdapter 单元测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { XhsMcpAdapter } from "../xiaohongshu/xiaohongshu.adapter";
import { MCPClientService } from "../../runtime/mcp-client.service";

// ==================== Mock ====================

const mockMcpClient = {
  isServerAvailable: jest.fn(),
  callTool: jest.fn(),
};

// ==================== Helper ====================

function makeSuccessResult(data: unknown) {
  return { success: true, data };
}

function makeFailResult(error: string) {
  return { success: false, error };
}

// ==================== Tests ====================

describe("XhsMcpAdapter", () => {
  let adapter: XhsMcpAdapter;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XhsMcpAdapter,
        { provide: MCPClientService, useValue: mockMcpClient },
      ],
    }).compile();

    adapter = module.get<XhsMcpAdapter>(XhsMcpAdapter);
  });

  // ==================== isAvailable ====================

  describe("isAvailable", () => {
    it("should return true when server is available", () => {
      mockMcpClient.isServerAvailable.mockReturnValue(true);
      expect(adapter.isAvailable()).toBe(true);
      expect(mockMcpClient.isServerAvailable).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
      );
    });

    it("should return false when server is not available", () => {
      mockMcpClient.isServerAvailable.mockReturnValue(false);
      expect(adapter.isAvailable()).toBe(false);
    });
  });

  // ==================== checkLoginStatus ====================

  describe("checkLoginStatus", () => {
    it("should return logged-in status with nickname and userId", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({
          loggedIn: true,
          nickname: "测试用户",
          userId: "u123",
        }),
      );

      const result = await adapter.checkLoginStatus();
      expect(result.loggedIn).toBe(true);
      expect(result.nickname).toBe("测试用户");
      expect(result.userId).toBe("u123");
    });

    it("should handle snake_case fields (logged_in, user_id)", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({
          logged_in: true,
          nickname: "用户",
          user_id: "u456",
        }),
      );

      const result = await adapter.checkLoginStatus();
      expect(result.loggedIn).toBe(true);
      expect(result.userId).toBe("u456");
    });

    it("should return loggedIn=false on failure", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("连接失败"));

      const result = await adapter.checkLoginStatus();
      expect(result.loggedIn).toBe(false);
    });

    it("should return loggedIn=false when MCP throws", async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error("超时"));

      const result = await adapter.checkLoginStatus();
      expect(result.loggedIn).toBe(false);
    });
  });

  // ==================== publishContent ====================

  describe("publishContent", () => {
    it("should return success with noteId", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({ noteId: "note-001" }),
      );

      const result = await adapter.publishContent({
        title: "测试标题",
        content: "测试内容",
        images: ["img1.jpg"],
      });

      expect(result.success).toBe(true);
      expect(result.noteId).toBe("note-001");
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "publish_content",
        expect.objectContaining({
          title: "测试标题",
          content: "测试内容",
          images: ["img1.jpg"],
        }),
      );
    });

    it("should handle snake_case note_id", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({ note_id: "note-002" }),
      );

      const result = await adapter.publishContent({
        title: "标题",
        content: "内容",
      });

      expect(result.success).toBe(true);
      expect(result.noteId).toBe("note-002");
    });

    it("should return failure with error message", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeFailResult("发布失败：账号异常"),
      );

      const result = await adapter.publishContent({
        title: "标题",
        content: "内容",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("发布失败：账号异常");
    });

    it("should default images to empty array", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({ noteId: "n1" }),
      );

      await adapter.publishContent({ title: "t", content: "c" });

      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "publish_content",
        expect.objectContaining({ images: [] }),
      );
    });
  });

  // ==================== publishVideo ====================

  describe("publishVideo", () => {
    it("should return success with noteId", async () => {
      mockMcpClient.callTool.mockResolvedValue(
        makeSuccessResult({ noteId: "video-note-001" }),
      );

      const result = await adapter.publishVideo({
        title: "视频标题",
        content: "视频描述",
        videoPath: "/tmp/video.mp4",
      });

      expect(result.success).toBe(true);
      expect(result.noteId).toBe("video-note-001");
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "publish_with_video",
        expect.objectContaining({ video: "/tmp/video.mp4" }),
      );
    });

    it("should return failure on error", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("视频上传失败"));

      const result = await adapter.publishVideo({
        title: "标题",
        content: "内容",
        videoPath: "/tmp/video.mp4",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("视频上传失败");
    });
  });

  // ==================== listFeeds ====================

  describe("listFeeds", () => {
    it("should return feeds array", async () => {
      const feeds = [
        { id: "f1", title: "帖子1" },
        { id: "f2", title: "帖子2" },
      ];
      mockMcpClient.callTool.mockResolvedValue(makeSuccessResult({ feeds }));

      const result = await adapter.listFeeds();
      expect(result).toEqual(feeds);
    });

    it("should return empty array on failure", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("获取失败"));

      const result = await adapter.listFeeds();
      expect(result).toEqual([]);
    });

    it("should return empty array when MCP throws", async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error("连接断开"));

      const result = await adapter.listFeeds();
      expect(result).toEqual([]);
    });
  });

  // ==================== searchFeeds ====================

  describe("searchFeeds", () => {
    it("should pass keyword and return results", async () => {
      const feeds = [{ id: "f1", title: "搜索结果" }];
      mockMcpClient.callTool.mockResolvedValue(makeSuccessResult({ feeds }));

      const result = await adapter.searchFeeds("关键词");
      expect(result).toEqual(feeds);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "search_feeds",
        { keyword: "关键词" },
      );
    });

    it("should return empty array on failure", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("搜索失败"));
      const result = await adapter.searchFeeds("test");
      expect(result).toEqual([]);
    });
  });

  // ==================== getFeedDetail ====================

  describe("getFeedDetail", () => {
    it("should return feed detail on success", async () => {
      const detail = { id: "f1", title: "帖子详情", desc: "描述内容" };
      mockMcpClient.callTool.mockResolvedValue(makeSuccessResult(detail));

      const result = await adapter.getFeedDetail("f1", "token123");
      expect(result).toEqual(detail);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "get_feed_detail",
        { feed_id: "f1", xsec_token: "token123" },
      );
    });

    it("should return null on failure", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("获取失败"));
      const result = await adapter.getFeedDetail("f1", "token");
      expect(result).toBeNull();
    });
  });

  // ==================== postComment ====================

  describe("postComment", () => {
    it("should return success", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeSuccessResult({}));

      const result = await adapter.postComment("f1", "token", "这是评论内容");
      expect(result.success).toBe(true);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "post_comment_to_feed",
        { feed_id: "f1", xsec_token: "token", content: "这是评论内容" },
      );
    });

    it("should return failure with error", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("评论失败"));

      const result = await adapter.postComment("f1", "token", "评论");
      expect(result.success).toBe(false);
      expect(result.error).toBe("评论失败");
    });
  });

  // ==================== getUserProfile ====================

  describe("getUserProfile", () => {
    it("should return user profile on success", async () => {
      const profile = { userId: "u1", nickname: "用户名", fans: 1000 };
      mockMcpClient.callTool.mockResolvedValue(makeSuccessResult(profile));

      const result = await adapter.getUserProfile("u1", "token");
      expect(result).toEqual(profile);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        "xiaohongshu-mcp",
        "user_profile",
        { user_id: "u1", xsec_token: "token" },
      );
    });

    it("should return null on failure", async () => {
      mockMcpClient.callTool.mockResolvedValue(makeFailResult("未找到用户"));
      const result = await adapter.getUserProfile("u1", "token");
      expect(result).toBeNull();
    });
  });
});
