/**
 * SectionRemediationService Tests
 *
 * 覆盖分支：
 * 1. 空 actions → 跳过
 * 2. 补救成功 → 返回新内容
 * 3. 补救后内容过短（<50% 原长） → 保留原内容
 * 4. API 错误（isError=true）→ 跳过
 * 5. LLM 调用异常 → 跳过，保留原内容
 * 6. 模型升级：STANDARD → selectModel 获取 STRONG
 * 7. 模型升级：STRONG → 用原模型
 * 8. selectModel 返回 null → 空字符串
 * 9. selectModel 返回非 STRONG → 空字符串 fallback
 * 10. 英文 prompt
 * 11. resolvedRemediationModelId 预解析跳过 selectModel
 */

import { SectionRemediationService } from "../section-remediation.service";
import type { RemediationAction } from "../../../types/quality.types";

const mockChat = jest.fn();
const mockSelectModel = jest.fn();

const mockChatFacade = { chat: mockChat } as any;
const mockEngineFacade = { selectModel: mockSelectModel } as any;

describe("SectionRemediationService", () => {
  let service: SectionRemediationService;

  beforeEach(() => {
    service = new SectionRemediationService(mockChatFacade, mockEngineFacade);
    mockChat.mockReset();
    mockSelectModel.mockReset();
  });

  const sampleActions: RemediationAction[] = [
    {
      type: "deepen_analysis",
      dimension: "analytical_depth",
      score: 5,
      guidance: "补充因果推理链条",
    },
    {
      type: "add_recommendations",
      dimension: "actionability",
      score: 4,
      guidance: "补充具体建议",
    },
  ];

  const originalContent =
    "这是原始章节内容，包含多个论点 [1] 和引用 [2]。市场格局方面...（约200字内容）";

  // ==================== remediate ====================

  describe("remediate", () => {
    it("skips when actions is empty", async () => {
      const result = await service.remediate({
        content: originalContent,
        sectionTitle: "测试章节",
        actions: [],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("no_actions_needed");
      expect(result.content).toBe(originalContent);
      expect(mockChat).not.toHaveBeenCalled();
    });

    it("returns remediated content on success", async () => {
      const improvedContent =
        originalContent + "\n\n深度分析补充：因果推理...建议：具体方案...";
      mockChat.mockResolvedValue({
        content: improvedContent,
        model: "gpt-4o",
        isError: false,
      });

      const result = await service.remediate({
        content: originalContent,
        sectionTitle: "市场格局",
        actions: sampleActions,
        originalModelId: "gpt-4o",
        language: "zh",
      });

      expect(result.skipped).toBe(false);
      expect(result.content).toBe(improvedContent);
      expect(result.actionsApplied).toEqual(sampleActions);
    });

    it("keeps original when remediated content too short", async () => {
      mockChat.mockResolvedValue({
        content: "太短了",
        isError: false,
      });

      const result = await service.remediate({
        content: originalContent,
        sectionTitle: "市场格局",
        actions: sampleActions,
        originalModelId: "gpt-4o",
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("remediated_content_too_short");
      expect(result.content).toBe(originalContent);
    });

    it("keeps original on API error (isError=true)", async () => {
      mockChat.mockResolvedValue({
        content: "Error: rate limit exceeded",
        isError: true,
      });

      const result = await service.remediate({
        content: originalContent,
        sectionTitle: "市场格局",
        actions: sampleActions,
        originalModelId: "gpt-4o",
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("api_error");
      expect(result.content).toBe(originalContent);
    });

    it("keeps original on LLM call exception", async () => {
      mockChat.mockRejectedValue(new Error("Network timeout"));

      const result = await service.remediate({
        content: originalContent,
        sectionTitle: "市场格局",
        actions: sampleActions,
        originalModelId: "gpt-4o",
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Network timeout");
      expect(result.content).toBe(originalContent);
    });

    it("uses English prompt for en language", async () => {
      const improved = originalContent + " Additional analysis...";
      mockChat.mockResolvedValue({
        content: improved,
        isError: false,
      });

      await service.remediate({
        content: originalContent,
        sectionTitle: "Market Analysis",
        actions: sampleActions,
        originalModelId: "gpt-4o",
        language: "en",
      });

      const prompt = mockChat.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("You are a senior report editor");
      expect(prompt).not.toContain("你是一位资深报告编辑");
    });

    it("uses resolvedRemediationModelId when provided", async () => {
      const improved = originalContent + "\n补充内容...";
      mockChat.mockResolvedValue({
        content: improved,
        isError: false,
      });

      await service.remediate({
        content: originalContent,
        sectionTitle: "测试",
        actions: sampleActions,
        originalModelId: "gpt-4o-mini",
        resolvedRemediationModelId: "claude-sonnet-4",
      });

      // Should NOT call selectModel since resolvedRemediationModelId is provided
      expect(mockSelectModel).not.toHaveBeenCalled();
      // Should use the resolved model
      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-sonnet-4",
        }),
      );
    });

    it("passes model=undefined when remediation model is empty string", async () => {
      const improved = originalContent + "\n补充...";
      mockChat.mockResolvedValue({
        content: improved,
        isError: false,
      });
      mockSelectModel.mockResolvedValue(null);

      await service.remediate({
        content: originalContent,
        sectionTitle: "测试",
        actions: sampleActions,
        originalModelId: "unknown-model",
      });

      // model: "" || undefined → undefined
      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: undefined,
        }),
      );
    });
  });

  // ==================== getRemediationModelId ====================

  describe("getRemediationModelId", () => {
    it("returns original model when it is STRONG tier", async () => {
      const result = await service.getRemediationModelId("gpt-4o");
      expect(result).toBe("gpt-4o");
      expect(mockSelectModel).not.toHaveBeenCalled();
    });

    it("returns original model for claude-sonnet-4", async () => {
      const result = await service.getRemediationModelId("claude-sonnet-4");
      expect(result).toBe("claude-sonnet-4");
    });

    it("upgrades STANDARD model via selectModel", async () => {
      mockSelectModel.mockResolvedValue({
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
      });

      const result = await service.getRemediationModelId("gpt-4o-mini");

      expect(mockSelectModel).toHaveBeenCalled();
      expect(result).toBe("gpt-4o");
    });

    it("upgrades BASIC model via selectModel", async () => {
      mockSelectModel.mockResolvedValue({
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        provider: "anthropic",
      });

      const result = await service.getRemediationModelId("unknown-model");

      expect(result).toBe("claude-sonnet-4");
    });

    it("returns empty string when selectModel returns null", async () => {
      mockSelectModel.mockResolvedValue(null);

      const result = await service.getRemediationModelId("gpt-4o-mini");

      expect(result).toBe("");
    });

    it("returns empty string when selectModel returns non-STRONG model", async () => {
      mockSelectModel.mockResolvedValue({
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openai",
      });

      const result = await service.getRemediationModelId("some-basic-model");

      // selectModel returned a STANDARD model, not STRONG → empty string fallback
      expect(result).toBe("");
    });

    it("returns empty string when selectModel throws", async () => {
      mockSelectModel.mockRejectedValue(new Error("DB error"));

      const result = await service.getRemediationModelId("gpt-4o-mini");

      expect(result).toBe("");
    });
  });
});
