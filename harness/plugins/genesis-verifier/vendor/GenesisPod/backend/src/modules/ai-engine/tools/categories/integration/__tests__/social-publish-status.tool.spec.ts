import { SocialPublishStatusTool } from "../social-publish-status.tool";
import { ToolContext } from "../../../abstractions/tool.interface";
import type {
  SocialPublishPort,
  PublishStatusSnapshot,
} from "../abstractions/social-publish.port";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "social-publish-status",
    userId: "user-real",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("SocialPublishStatusTool", () => {
  describe("validateInput", () => {
    it("rejects empty jobId", () => {
      const tool = new SocialPublishStatusTool(null);
      expect(tool.validateInput({ jobId: "" })).toBe(false);
    });

    it("accepts non-empty jobId", () => {
      const tool = new SocialPublishStatusTool(null);
      expect(tool.validateInput({ jobId: "abc" })).toBe(true);
    });
  });

  describe("doExecute - port not configured", () => {
    it("returns failure when port is null", async () => {
      const tool = new SocialPublishStatusTool(null);
      const result = await tool.execute({ jobId: "abc" }, ctx());
      expect(result.data?.success).toBe(false);
      expect(result.data?.found).toBe(false);
      expect(result.data?.error).toMatch(/Social publish port not configured/);
    });
  });

  describe("doExecute - job not found", () => {
    it("returns found=false when port returns null", async () => {
      const port: SocialPublishPort = {
        publishWechatMp: jest.fn(),
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn().mockResolvedValue(null),
      };
      const tool = new SocialPublishStatusTool(port);

      const result = await tool.execute({ jobId: "no-such-job" }, ctx());

      expect(result.data?.success).toBe(true);
      expect(result.data?.found).toBe(false);
      expect(result.data?.jobId).toBe("no-such-job");
      expect(port.getPublishStatus).toHaveBeenCalledWith(
        "no-such-job",
        expect.objectContaining({ userId: "user-real" }),
      );
    });
  });

  describe("doExecute - published snapshot", () => {
    it("maps snapshot fields to output", async () => {
      // mock 数据故意与 input 不同，证明 output 来自 port
      const finishedAt = new Date("2026-05-15T10:00:00.000Z");
      const snapshot: PublishStatusSnapshot = {
        jobId: "content-row-99",
        status: "published",
        platform: "wechat-mp",
        externalUrl: "https://mp.weixin.qq.com/s/abcdef",
        externalId: "wx-12345",
        finishedAt,
      };
      const port: SocialPublishPort = {
        publishWechatMp: jest.fn(),
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn().mockResolvedValue(snapshot),
      };
      const tool = new SocialPublishStatusTool(port);

      const result = await tool.execute({ jobId: "content-row-99" }, ctx());

      expect(result.data?.success).toBe(true);
      expect(result.data?.found).toBe(true);
      expect(result.data?.status).toBe("published");
      expect(result.data?.platform).toBe("wechat-mp");
      expect(result.data?.externalUrl).toBe(
        "https://mp.weixin.qq.com/s/abcdef",
      );
      expect(result.data?.externalId).toBe("wx-12345");
      expect(result.data?.finishedAt).toBe(finishedAt.toISOString());
    });
  });

  describe("doExecute - failed snapshot", () => {
    it("surfaces errorMessage", async () => {
      const port: SocialPublishPort = {
        publishWechatMp: jest.fn(),
        publishXhs: jest.fn(),
        getPublishStatus: jest.fn().mockResolvedValue({
          jobId: "j",
          status: "failed",
          platform: "xhs",
          errorMessage: "Cookie 失效",
        } as PublishStatusSnapshot),
      };
      const tool = new SocialPublishStatusTool(port);
      const result = await tool.execute({ jobId: "j" }, ctx());
      expect(result.data?.status).toBe("failed");
      expect(result.data?.errorMessage).toBe("Cookie 失效");
    });
  });
});
