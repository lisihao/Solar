/**
 * AI Teams 长内容集成服务测试
 * Teams Long Content Service Tests
 *
 * 验证：
 * 1. Mission 初始化和配置
 * 2. 粒度约束 Prompt 生成
 * 3. 任务完成处理和续写检测
 * 4. 质量监控集成
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamsLongContentService } from "../teams-long-content.service";
import { AiChatService } from "@/modules/ai-harness/facade";
import { LongContentEngineService } from "../../../../writing/content-engine/services/long-content-engine.service";
import { ContinuationProtocolService } from "../../../../writing/content-engine/services/continuation-protocol.service";
import { TaskGranularityService } from "../../../../writing/content-engine/services/task-granularity.service";
import { SlidingWindowContextService } from "../../../../writing/content-engine/services/sliding-window-context.service";
import { QualityMonitorService } from "../../../../writing/content-engine/services/quality-monitor.service";

describe("TeamsLongContentService", () => {
  let service: TeamsLongContentService;

  // Mock AiChatService
  const mockAiChatService = {
    chat: jest.fn().mockResolvedValue({ content: "Mock AI response" }),
  };

  beforeEach(async () => {
    // Build real engine services for integration-style testing
    const engineModule: TestingModule = await Test.createTestingModule({
      providers: [
        LongContentEngineService,
        ContinuationProtocolService,
        TaskGranularityService,
        SlidingWindowContextService,
        QualityMonitorService,
        { provide: AiChatService, useValue: mockAiChatService },
      ],
    }).compile();

    const longContentEngine = engineModule.get(LongContentEngineService);
    const continuationProtocol = engineModule.get(ContinuationProtocolService);

    // Inject services directly (no longer through AIFacade)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsLongContentService,
        { provide: LongContentEngineService, useValue: longContentEngine },
        {
          provide: ContinuationProtocolService,
          useValue: continuationProtocol,
        },
      ],
    }).compile();

    service = module.get<TeamsLongContentService>(TeamsLongContentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============ Mission 初始化测试 ============

  describe("initMission", () => {
    it("应该成功初始化任务", async () => {
      const config = {
        missionId: "mission-1",
        missionTitle: "写一部 10 章的小说",
        missionDescription: "创作一部科幻小说，共 10 章",
        objectives: ["第1章：引入主角", "第2章：冒险开始"],
        constraints: ["每章 3000 字"],
        expectedTaskCount: 10,
        granularityLevel: "chapter" as const,
      };

      await expect(service.initMission(config)).resolves.not.toThrow();
    });

    it("应该正确存储任务配置", async () => {
      const config = {
        missionId: "mission-2",
        missionTitle: "测试任务",
        missionDescription: "测试描述",
        objectives: [],
        constraints: [],
      };

      await service.initMission(config);

      // 通过调用 buildGranularityConstraintPrompt 验证配置已存储
      const prompt = service.buildGranularityConstraintPrompt("mission-2");
      expect(prompt).toBeDefined();
    });
  });

  // ============ 粒度约束 Prompt 测试 ============

  describe("buildGranularityConstraintPrompt", () => {
    beforeEach(async () => {
      await service.initMission({
        missionId: "mission-granularity",
        missionTitle: "10 章小说",
        missionDescription: "写一部科幻小说",
        objectives: ["写 10 章"],
        constraints: [],
        expectedTaskCount: 10,
        granularityLevel: "chapter",
      });
    });

    it("应该返回非空的粒度约束 Prompt", () => {
      const prompt = service.buildGranularityConstraintPrompt(
        "mission-granularity",
      );

      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("未初始化的任务应该返回空字符串", () => {
      const prompt = service.buildGranularityConstraintPrompt("non-existent");

      expect(prompt).toBe("");
    });
  });

  // ============ 续写检测测试 ============

  describe("detectContinuationNeeded", () => {
    it('应该检测到 "未完待续" 需要续写', () => {
      const content = `
        第一章的内容...

        未完待续
      `;

      const needsContinuation = service.detectContinuationNeeded(content, 1500);

      expect(needsContinuation).toBe(true);
    });

    it("字数不足应该需要续写", () => {
      const content = "很短的内容";

      const needsContinuation = service.detectContinuationNeeded(content, 3000);

      expect(needsContinuation).toBe(true);
    });

    it("完整内容不应该需要续写", () => {
      const content = "这是一段很长的内容".repeat(200) + "（完）";

      const needsContinuation = service.detectContinuationNeeded(content, 100);

      expect(needsContinuation).toBe(false);
    });
  });

  // ============ 任务完成处理测试 ============

  describe("processTaskCompletion", () => {
    beforeEach(async () => {
      await service.initMission({
        missionId: "mission-completion",
        missionTitle: "测试任务",
        missionDescription: "测试",
        objectives: [],
        constraints: [],
        expectedWordsPerTask: 1500,
      });
    });

    it("完整内容不需要续写", async () => {
      const longContent = "这是一段很长的内容。".repeat(200) + "（完）";

      const result = await service.processTaskCompletion(
        "mission-completion",
        "task-1",
        "第一章",
        longContent,
      );

      expect(result.needsContinuation).toBe(false);
      expect(result.finalContent).toBeDefined();
    });

    it('含有 "未完待续" 标记需要续写', async () => {
      const incompleteContent = `
        第一章的开头...

        未完待续
      `;

      const result = await service.processTaskCompletion(
        "mission-completion",
        "task-2",
        "第一章",
        incompleteContent,
      );

      expect(result.needsContinuation).toBe(true);
      expect(result.continuationState).toBeDefined();
    });
  });

  // ============ 续写 Prompt 构建测试 ============

  describe("buildContinuationPrompt", () => {
    beforeEach(async () => {
      await service.initMission({
        missionId: "mission-cont-prompt",
        missionTitle: "测试",
        missionDescription: "测试",
        objectives: [],
        constraints: [],
      });

      // 先处理一个需要续写的任务
      await service.processTaskCompletion(
        "mission-cont-prompt",
        "task-cont",
        "第一章",
        "内容开始...未完待续",
      );
    });

    it("应该能构建续写 Prompt", () => {
      const prompt = service.buildContinuationPrompt(
        "task-cont",
        "第一章",
        "写第一章的内容",
      );

      expect(prompt).toBeTruthy();
      expect(prompt).toContain("续写");
    });
  });

  // ============ 质量监控测试 ============

  describe("checkQualityIntervention", () => {
    beforeEach(async () => {
      await service.initMission({
        missionId: "mission-quality",
        missionTitle: "测试",
        missionDescription: "测试",
        objectives: [],
        constraints: [],
      });
    });

    it("质量检查应该返回结果对象", () => {
      const check = service.checkQualityIntervention("mission-quality");

      // 返回结果应该是一个对象，包含 needed 字段
      expect(check).toHaveProperty("needed");
      expect(typeof check.needed).toBe("boolean");
    });
  });

  // ============ 清理测试 ============

  describe("clearMission", () => {
    it("应该清理任务状态", async () => {
      await service.initMission({
        missionId: "mission-clear",
        missionTitle: "测试",
        missionDescription: "测试",
        objectives: [],
        constraints: [],
      });

      // 验证初始化成功
      expect(
        service.buildGranularityConstraintPrompt("mission-clear"),
      ).not.toBe("");

      // 清理
      service.clearMission("mission-clear");

      // 验证已清理
      expect(service.buildGranularityConstraintPrompt("mission-clear")).toBe(
        "",
      );
    });
  });

  // ============ 边界情况测试 ============

  describe("Edge Cases", () => {
    it("空内容应该需要续写", () => {
      const needsContinuation = service.detectContinuationNeeded("", 1500);
      expect(needsContinuation).toBe(true);
    });

    it("多种续写标记应该都能检测", () => {
      const markers = [
        "内容...未完待续",
        "内容...待续",
        "内容...[CONTINUATION_NEEDED]",
        "Content...TBC",
        "Content...To Be Continued",
      ];

      for (const content of markers) {
        const needsContinuation = service.detectContinuationNeeded(content, 10);
        expect(needsContinuation).toBe(true);
      }
    });

    it("多种完成标记应该都能检测", () => {
      const longPrefix = "这是很长的内容。".repeat(100);
      const markers = [
        longPrefix + "[COMPLETED]",
        longPrefix + "（完）",
        longPrefix + "[DONE]",
        longPrefix + "【完成】",
      ];

      for (const content of markers) {
        const needsContinuation = service.detectContinuationNeeded(content, 10);
        expect(needsContinuation).toBe(false);
      }
    });
  });
});
