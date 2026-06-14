import { WechatMpPublishTool } from "../wechat-mp-publish.tool";
import { ToolContext } from "../../../abstractions/tool.interface";
import type {
  SocialPublishPort,
  PublishJobReceipt,
} from "../abstractions/social-publish.port";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "wechat-mp-publish",
    userId: "user-real",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("WechatMpPublishTool", () => {
  describe("validateInput", () => {
    it("rejects when title is empty", () => {
      const tool = new WechatMpPublishTool(null);
      expect(tool.validateInput({ title: "", content: "body" })).toBe(false);
    });

    it("rejects when content is empty", () => {
      const tool = new WechatMpPublishTool(null);
      expect(tool.validateInput({ title: "ok", content: "" })).toBe(false);
    });

    it("rejects when title exceeds 64 chars", () => {
      const tool = new WechatMpPublishTool(null);
      expect(
        tool.validateInput({ title: "x".repeat(65), content: "body" }),
      ).toBe(false);
    });

    it("accepts a fully populated input", () => {
      const tool = new WechatMpPublishTool(null);
      expect(
        tool.validateInput({
          title: "GenesisPod 周报 #12",
          content: "<p>正文</p>",
          digest: "本周回顾",
          coverImageUrl: "https://example.com/cover.jpg",
          author: "Editor Bot",
        }),
      ).toBe(true);
    });
  });

  describe("doExecute - port not configured", () => {
    it("returns structured failure when SOCIAL_PUBLISH_PORT is not bound", async () => {
      const tool = new WechatMpPublishTool(null);
      const result = await tool.execute({ title: "T", content: "body" }, ctx());
      expect(result.success).toBe(true); // execute() wraps to ToolResult.success=true even though output.success=false
      expect(result.data?.success).toBe(false);
      expect(result.data?.platform).toBe("wechat-mp");
      expect(result.data?.error).toMatch(/Social publish port not configured/);
    });
  });

  describe("doExecute - userId missing", () => {
    it("returns failure if context.userId is absent", async () => {
      const port: SocialPublishPort = {
        publishWechatMp: jest.fn(),
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn(),
      };
      const tool = new WechatMpPublishTool(port);
      const result = await tool.execute(
        { title: "T", content: "body" },
        ctx({ userId: undefined }),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toMatch(/userId is required/);
      expect(port.publishWechatMp).not.toHaveBeenCalled();
    });
  });

  describe("doExecute - delegates to port", () => {
    it("forwards input + context.userId and returns the receipt", async () => {
      // mock 返回的 jobId 故意不是 "exec-1"，证明 data 真的来自 port 而非 ctx 回灌
      const fakeReceipt: PublishJobReceipt = {
        jobId: "content-row-uuid-abc",
        status: "queued",
        platform: "wechat-mp",
      };
      const publishWechatMp = jest.fn().mockResolvedValue(fakeReceipt);
      const port: SocialPublishPort = {
        publishWechatMp,
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn(),
      };
      const tool = new WechatMpPublishTool(port);

      const result = await tool.execute(
        {
          title: "周报",
          content: "<p>正文</p>",
          digest: "摘要",
          author: "署名",
        },
        ctx({ userId: "user-real", callerId: "leader-agent" }),
      );

      expect(publishWechatMp).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "周报",
          content: "<p>正文</p>",
          digest: "摘要",
          author: "署名",
        }),
        expect.objectContaining({
          userId: "user-real",
          callerId: "leader-agent",
        }),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.jobId).toBe("content-row-uuid-abc");
      expect(result.data?.status).toBe("queued");
      expect(result.data?.platform).toBe("wechat-mp");
    });

    it("passes accountId when explicitly provided", async () => {
      const publishWechatMp = jest.fn().mockResolvedValue({
        jobId: "job-2",
        status: "queued",
        platform: "wechat-mp",
      } as PublishJobReceipt);
      const port: SocialPublishPort = {
        publishWechatMp,
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn(),
      };
      const tool = new WechatMpPublishTool(port);

      await tool.execute(
        {
          title: "T",
          content: "body",
          accountId: "conn-id-77",
        },
        ctx(),
      );

      expect(publishWechatMp).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: "conn-id-77" }),
        expect.anything(),
      );
    });
  });
});
