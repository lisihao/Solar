import { XhsMcpAdapter } from "../xhs-mcp.adapter";
import type { MCPClientService } from "../../../core/mcp-client.service";
import type {
  SessionData,
  PublishOptions,
} from "../../../mission/types/platform.types";
import type { SocialContent } from "../../../mission/types";
import { SocialPlatformType } from "../../../mission/types";

function createMockMCPClient() {
  return {
    callTool: jest.fn(),
    isServerAvailable: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<MCPClientService>;
}

function createMockSessionData(): SessionData {
  return {
    cookies: [
      {
        name: "a1",
        value: "test-cookie",
        domain: ".xiaohongshu.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
        httpOnly: false,
        secure: true,
      },
    ],
    localStorage: {},
  };
}

function createMockContent(): SocialContent {
  return {
    title: "Test Note Title",
    content: "Test note content here",
    images: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
    tags: ["tag1", "tag2"],
    location: "Shanghai",
  } as SocialContent;
}

describe("XhsMcpAdapter", () => {
  let adapter: XhsMcpAdapter;
  let mockMCPClient: jest.Mocked<MCPClientService>;

  beforeEach(() => {
    mockMCPClient = createMockMCPClient();
    adapter = new XhsMcpAdapter(mockMCPClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("platformType", () => {
    it("should have correct platform type", () => {
      expect(adapter.platformType).toBe(SocialPlatformType.XIAOHONGSHU);
    });

    it("should have supportsMcp set to true", () => {
      expect(adapter.supportsMcp).toBe(true);
    });
  });

  describe("initLogin", () => {
    it("should return login session with qrCodeUrl on success", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: {
          qrCodeUrl: "https://xhs.com/qr/abc123",
          sessionKey: "session-key-xyz",
        },
      });

      const result = await adapter.initLogin();

      expect(result.sessionKey).toBe("session-key-xyz");
      expect(result.qrCodeUrl).toBe("https://xhs.com/qr/abc123");
      expect(result.status).toBe("pending");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("should return expired session when MCP call fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "MCP server unavailable",
      });

      const result = await adapter.initLogin();

      expect(result.sessionKey).toBe("");
      expect(result.status).toBe("expired");
    });

    it("should handle thrown error gracefully", async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error("Connection failed"));

      const result = await adapter.initLogin();

      expect(result.sessionKey).toBe("");
      expect(result.status).toBe("expired");
    });
  });

  describe("checkLoginStatus", () => {
    it("should return logged in status with session data", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: {
          loggedIn: true,
          cookies: [
            {
              name: "a1",
              value: "cookie-value",
              domain: ".xiaohongshu.com",
              path: "/",
              expires: Date.now() / 1000 + 3600,
              httpOnly: false,
              secure: true,
            },
          ],
          userInfo: {
            userId: "user-123",
            nickname: "Test User",
            avatar: "https://example.com/avatar.jpg",
          },
        },
      });

      const result = await adapter.checkLoginStatus("test-session-key");

      expect(result.loggedIn).toBe(true);
      expect(result.accountName).toBe("Test User");
      expect(result.accountId).toBe("user-123");
      expect(result.avatarUrl).toBe("https://example.com/avatar.jpg");
      expect(result.sessionData).toBeDefined();
    });

    it("should return not logged in when data.loggedIn is false", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { loggedIn: false },
      });

      const result = await adapter.checkLoginStatus("pending-key");

      expect(result.loggedIn).toBe(false);
    });

    it("should return not logged in when MCP call fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Check failed",
      });

      const result = await adapter.checkLoginStatus("bad-key");

      expect(result.loggedIn).toBe(false);
    });

    it("should handle thrown error gracefully", async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error("Network error"));

      const result = await adapter.checkLoginStatus("key");

      expect(result.loggedIn).toBe(false);
    });

    it("should return loggedIn with no sessionData when cookies are absent", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: {
          loggedIn: true,
          userInfo: { userId: "u1", nickname: "User1", avatar: "" },
        },
      });

      const result = await adapter.checkLoginStatus("session-key");

      expect(result.loggedIn).toBe(true);
      expect(result.sessionData).toBeUndefined();
    });
  });

  describe("validateSession", () => {
    it("should return valid when getUserInfo succeeds", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { userId: "u1", nickname: "User" },
      });

      const result = await adapter.validateSession(createMockSessionData());

      expect(result.valid).toBe(true);
    });

    it("should return invalid with reason when MCP call fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Session expired",
      });

      const result = await adapter.validateSession(createMockSessionData());

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Session expired");
    });

    it("should handle thrown error", async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error("Timeout"));

      const result = await adapter.validateSession(createMockSessionData());

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Timeout");
    });
  });

  describe("refreshSession", () => {
    it("should always return null (XHS does not support session refresh)", async () => {
      const result = await adapter.refreshSession(createMockSessionData());
      expect(result).toBeNull();
    });
  });

  describe("publish", () => {
    const publishOptions: PublishOptions = { mode: "published" };

    it("should return error when session is invalid", async () => {
      // First call is validateSession -> getUserInfo returns failure with no error message
      // so the fallback "会话已过期" message is used
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: undefined,
      });

      const result = await adapter.publish(
        createMockContent(),
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("会话已过期");
    });

    it("should upload images and publish note on success", async () => {
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} }) // validateSession
        .mockResolvedValueOnce({
          success: true,
          data: { imageId: "img-1" },
        }) // upload image 1
        .mockResolvedValueOnce({
          success: true,
          data: { imageId: "img-2" },
        }) // upload image 2
        .mockResolvedValueOnce({
          success: true,
          data: { noteId: "note-abc", noteUrl: "https://xhs.com/note/abc" },
        }); // createNote

      const result = await adapter.publish(
        createMockContent(),
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(true);
      expect(result.type).toBe("published");
      expect(result.externalId).toBe("note-abc");
      expect(result.externalUrl).toBe("https://xhs.com/note/abc");
    });

    it("should warn but continue when image upload fails", async () => {
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} }) // validateSession
        .mockResolvedValueOnce({ success: false, error: "Upload failed" }) // image 1 fail
        .mockResolvedValueOnce({ success: true, data: { imageId: "img-2" } }) // image 2
        .mockResolvedValueOnce({
          success: true,
          data: { noteId: "note-xyz", noteUrl: "https://xhs.com/note/xyz" },
        }); // createNote

      const result = await adapter.publish(
        createMockContent(),
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(true);
    });

    it("should save draft when mode is 'draft'", async () => {
      // publish flow for draft mode:
      // 1. validateSession, 2. upload image 1, 3. upload image 2, 4. saveDraft
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} }) // validateSession
        .mockResolvedValueOnce({ success: true, data: { imageId: "img-1" } }) // upload image 1
        .mockResolvedValueOnce({ success: true, data: { imageId: "img-2" } }) // upload image 2
        .mockResolvedValueOnce({
          success: true,
          data: { draftId: "draft-xhs-1" },
        }); // saveDraft

      const draftOptions: PublishOptions = { mode: "draft" };
      const result = await adapter.publish(
        createMockContent(),
        createMockSessionData(),
        draftOptions,
      );

      expect(result.success).toBe(true);
      expect(result.type).toBe("draft");
      expect(result.externalId).toBe("draft-xhs-1");
    });

    it("should return error when createNote fails", async () => {
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} }) // validateSession
        .mockResolvedValueOnce({ success: true, data: { imageId: "img-1" } }) // upload
        .mockResolvedValueOnce({
          success: false,
          error: "Rate limit exceeded",
        }); // createNote fail

      const content = { ...createMockContent(), images: ["img1"] };
      const result = await adapter.publish(
        content as SocialContent,
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Rate limit exceeded");
    });

    it("should handle thrown error during publish", async () => {
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} })
        .mockRejectedValue(new Error("Connection reset"));

      const result = await adapter.publish(
        createMockContent(),
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Connection reset");
    });

    it("should handle content with no images", async () => {
      mockMCPClient.callTool
        .mockResolvedValueOnce({ success: true, data: {} }) // validateSession
        .mockResolvedValueOnce({
          success: true,
          data: {
            noteId: "note-no-img",
            noteUrl: "https://xhs.com/note/no-img",
          },
        }); // createNote

      const contentNoImages: SocialContent = {
        title: "Title Only",
        content: "Content",
        tags: [],
      } as SocialContent;

      const result = await adapter.publish(
        contentNoImages,
        createMockSessionData(),
        publishOptions,
      );

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("note-no-img");
    });
  });

  describe("saveDraft", () => {
    it("should return draft id on success", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { draftId: "draft-save-1" },
      });

      const result = await adapter.saveDraft(
        createMockContent(),
        createMockSessionData(),
      );

      expect(result.success).toBe(true);
      expect(result.draftId).toBe("draft-save-1");
    });

    it("should return error when save fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Save draft failed",
      });

      const result = await adapter.saveDraft(
        createMockContent(),
        createMockSessionData(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Save draft failed");
    });

    it("should handle thrown error in saveDraft", async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error("MCP down"));

      const result = await adapter.saveDraft(
        createMockContent(),
        createMockSessionData(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("MCP down");
    });
  });

  describe("getAnalytics", () => {
    it("should return analytics data on success", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { followers: 1000, likes: 5000, notes: 50 },
      });

      const result = await adapter.getAnalytics(createMockSessionData());

      expect(result.followers).toBe(1000);
      expect(result.likes).toBe(5000);
      expect(result.notes).toBe(50);
      expect(result.lastUpdated).toBeInstanceOf(Date);
    });

    it("should return empty object when MCP fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Analytics unavailable",
      });

      const result = await adapter.getAnalytics(createMockSessionData());

      expect(result).toEqual({});
    });

    it("should return empty object on error", async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error("Error"));

      const result = await adapter.getAnalytics(createMockSessionData());

      expect(result).toEqual({});
    });
  });

  describe("getNotes", () => {
    it("should return notes list on success", async () => {
      const mockNotes = [
        { id: "1", title: "Note 1" },
        { id: "2", title: "Note 2" },
      ];
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { notes: mockNotes },
      });

      const result = await adapter.getNotes(createMockSessionData(), {
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.notes).toHaveLength(2);
    });

    it("should return error when call fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Failed to get notes",
      });

      const result = await adapter.getNotes(createMockSessionData());

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to get notes");
    });
  });

  describe("getNoteStats", () => {
    it("should return stats on success", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: true,
        data: { views: 1000, likes: 100, comments: 50, shares: 20 },
      });

      const result = await adapter.getNoteStats(
        "note-1",
        createMockSessionData(),
      );

      expect(result.success).toBe(true);
      expect(result.stats?.views).toBe(1000);
      expect(result.stats?.likes).toBe(100);
    });

    it("should return error when stats unavailable", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Note not found",
      });

      const result = await adapter.getNoteStats(
        "bad-id",
        createMockSessionData(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Note not found");
    });
  });

  describe("deleteNote", () => {
    it("should return success on deletion", async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      const result = await adapter.deleteNote(
        "note-1",
        createMockSessionData(),
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return error when deletion fails", async () => {
      mockMCPClient.callTool.mockResolvedValue({
        success: false,
        error: "Cannot delete published note",
      });

      const result = await adapter.deleteNote(
        "note-pub",
        createMockSessionData(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot delete published note");
    });
  });

  describe("isAvailable", () => {
    it("should return true when server is available", () => {
      mockMCPClient.isServerAvailable.mockReturnValue(true);
      expect(adapter.isAvailable()).toBe(true);
    });

    it("should return false when server is not available", () => {
      mockMCPClient.isServerAvailable.mockReturnValue(false);
      expect(adapter.isAvailable()).toBe(false);
    });
  });
});
