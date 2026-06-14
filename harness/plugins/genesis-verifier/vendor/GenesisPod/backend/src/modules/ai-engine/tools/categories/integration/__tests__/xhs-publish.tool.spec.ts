import { XhsPublishTool } from "../xhs-publish.tool";
import { ToolContext } from "../../../abstractions/tool.interface";
import type {
  SocialPublishPort,
  PublishJobReceipt,
} from "../abstractions/social-publish.port";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "xhs-publish",
    userId: "user-real",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("XhsPublishTool", () => {
  describe("validateInput", () => {
    it("rejects when title > 20 chars", () => {
      const tool = new XhsPublishTool(null);
      expect(
        tool.validateInput({
          title: "x".repeat(21),
          content: "body",
          images: ["https://x.com/1.jpg"],
        }),
      ).toBe(false);
    });

    it("rejects when content > 1000 chars", () => {
      const tool = new XhsPublishTool(null);
      expect(
        tool.validateInput({
          title: "T",
          content: "x".repeat(1001),
          images: ["https://x.com/1.jpg"],
        }),
      ).toBe(false);
    });

    it("rejects when images is empty", () => {
      const tool = new XhsPublishTool(null);
      expect(
        tool.validateInput({
          title: "T",
          content: "body",
          images: [],
        }),
      ).toBe(false);
    });

    it("rejects when images > 9", () => {
      const tool = new XhsPublishTool(null);
      expect(
        tool.validateInput({
          title: "T",
          content: "body",
          images: Array(10).fill("https://x.com/1.jpg"),
        }),
      ).toBe(false);
    });

    it("accepts valid input", () => {
      const tool = new XhsPublishTool(null);
      expect(
        tool.validateInput({
          title: "AI 周记",
          content: "今天聊聊 …",
          images: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
          tags: ["AI", "GenesisPod"],
        }),
      ).toBe(true);
    });
  });

  describe("doExecute - port not configured", () => {
    it("returns structured failure when port is null", async () => {
      const tool = new XhsPublishTool(null);
      const result = await tool.execute(
        { title: "T", content: "body", images: ["https://x.com/1.jpg"] },
        ctx(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.platform).toBe("xhs");
      expect(result.data?.error).toMatch(/Social publish port not configured/);
    });
  });

  describe("doExecute - delegates to port", () => {
    it("forwards full payload including tags / location / atUsers", async () => {
      const fakeReceipt: PublishJobReceipt = {
        jobId: "xhs-content-uuid-99",
        status: "queued",
        platform: "xhs",
      };
      const publishXhs = jest.fn().mockResolvedValue(fakeReceipt);
      const port: SocialPublishPort = {
        publishWechatMp: jest.fn(),
        publishXhs,
        getPublishStatus: jest.fn(),
      };
      const tool = new XhsPublishTool(port);

      const result = await tool.execute(
        {
          title: "AI 周记",
          content: "今天聊聊 …",
          images: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
          tags: ["AI", "GenesisPod"],
          location: "杭州",
          atUsers: ["xiaoming"],
        },
        ctx({ userId: "user-real", callerId: "writer-agent" }),
      );

      expect(publishXhs).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "AI 周记",
          images: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
          tags: ["AI", "GenesisPod"],
          location: "杭州",
          atUsers: ["xiaoming"],
        }),
        expect.objectContaining({
          userId: "user-real",
          callerId: "writer-agent",
        }),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.jobId).toBe("xhs-content-uuid-99");
      expect(result.data?.platform).toBe("xhs");
    });
  });
});
