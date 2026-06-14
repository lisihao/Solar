/**
 * 续写协议服务测试
 * Continuation Protocol Service Tests
 *
 * 验证：
 * 1. 续写标记检测（"未完待续"等）
 * 2. 续写状态机管理
 * 3. 结果合并逻辑
 */

import { ContinuationProtocolService } from "../continuation-protocol.service";

describe("ContinuationProtocolService", () => {
  let service: ContinuationProtocolService;

  beforeEach(() => {
    service = new ContinuationProtocolService();
  });

  afterEach(() => {
    // 清理所有状态
    service["stateStore"].clear();
  });

  // ============ 续写标记检测测试 ============

  describe("detectContinuation", () => {
    describe("显式续写标记检测", () => {
      it('应该检测到 "未完待续" 标记', () => {
        const content = `
          第一章：开始

          主角走进了森林，四周一片寂静...

          未完待续
        `;

        const result = service.detectContinuation(content, {
          minWords: 100,
          hasStructuredEnd: true,
        });

        expect(result.needsContinuation).toBe(true);
        expect(result.reason).toBe("explicit_marker");
        expect(result.detectedMarker).toContain("未完待续");
      });

      it('应该检测到 "待续" 标记', () => {
        const content = `故事开始了...\n\n（待续）`;

        const result = service.detectContinuation(content, {
          minWords: 50,
        });

        expect(result.needsContinuation).toBe(true);
        expect(result.reason).toBe("explicit_marker");
      });

      it('应该检测到 "[CONTINUATION_NEEDED]" 标记', () => {
        const content = `This is the first part of the story...\n\n[CONTINUATION_NEEDED]`;

        const result = service.detectContinuation(content, {
          minWords: 50,
        });

        expect(result.needsContinuation).toBe(true);
        expect(result.reason).toBe("explicit_marker");
      });

      it('应该检测到 "TBC" 标记', () => {
        const content = `The adventure continues...\n\nTBC`;

        const result = service.detectContinuation(content, {
          minWords: 50,
        });

        expect(result.needsContinuation).toBe(true);
        expect(result.reason).toBe("explicit_marker");
      });
    });

    describe("完成标记检测", () => {
      it('应该检测到 "[COMPLETED]" 标记，不需要续写', () => {
        const content = `故事结束了。\n\n[COMPLETED]`;

        const result = service.detectContinuation(content, {
          minWords: 10,
        });

        expect(result.needsContinuation).toBe(false);
        // 完成时 completedPortion 应该是 1
        expect(result.completedPortion).toBe(1);
      });

      it('应该检测到 "（完）" 标记，不需要续写', () => {
        const content = `从此他们过上了幸福的生活。（完）`;

        const result = service.detectContinuation(content, {
          minWords: 10,
        });

        expect(result.needsContinuation).toBe(false);
        expect(result.completedPortion).toBe(1);
      });
    });

    describe("字数不足检测", () => {
      it("字数不足时应该需要续写", () => {
        const content = "这是一个很短的内容。"; // 约 10 字

        const result = service.detectContinuation(content, {
          minWords: 1000, // 期望 1000 字
        });

        expect(result.needsContinuation).toBe(true);
        expect(result.reason).toBe("short_content");
        expect(result.completedPortion).toBeLessThan(1);
      });

      it("字数足够时不需要续写", () => {
        const content = "这是一段".repeat(500) + "。[COMPLETED]"; // 足够长

        const result = service.detectContinuation(content, {
          minWords: 100,
        });

        expect(result.needsContinuation).toBe(false);
      });
    });

    describe("不完整句子检测", () => {
      it("以省略号结尾应该检测为可能需要续写", () => {
        const content = "主角向前走去...";

        const result = service.detectContinuation(content, {
          minWords: 5,
        });

        // 省略号结尾会触发 incomplete_sentence
        expect(result.reason).toBe("incomplete_sentence");
        expect(result.needsContinuation).toBe(true);
      });
    });
  });

  // ============ 状态机管理测试 ============

  describe("State Management", () => {
    it("initState 应该正确初始化续写状态", () => {
      const taskId = "task-1";
      const initialContent = "第一部分内容...";

      const state = service.initState(taskId, initialContent, {
        totalWords: 3000,
        maxContinuations: 5,
      });

      expect(state.taskId).toBe(taskId);
      // initState 初始化后 continuationCount 是 1（表示初始内容算作第一次）
      expect(state.continuationCount).toBe(1);
      expect(state.maxContinuations).toBe(5);
      expect(state.accumulatedResult).toBe(initialContent);
      expect(state.expectedTotalWords).toBe(3000);
    });

    it("updateState 应该正确累积内容", () => {
      const taskId = "task-2";
      service.initState(taskId, "第一部分", { totalWords: 100 });

      const detectionResult = {
        needsContinuation: true,
        reason: "short_content" as const,
        completedPortion: 0.5,
        lastCheckpoint: "第一部分",
        confidence: 0.8,
      };

      const newContent = "第二部分内容";
      const updatedState = service.updateState(
        taskId,
        newContent,
        detectionResult,
      );

      // initState 设为 1，updateState 再 +1
      expect(updatedState.continuationCount).toBe(2);
      expect(updatedState.accumulatedResult).toContain("第一部分");
      expect(updatedState.accumulatedResult).toContain("第二部分内容");
    });

    it("getState 应该返回正确的状态", () => {
      const taskId = "task-3";
      service.initState(taskId, "内容", { totalWords: 100 });

      const state = service.getState(taskId);
      expect(state).toBeDefined();
      expect(state?.taskId).toBe(taskId);
    });

    it("clearState 应该清除状态", () => {
      const taskId = "task-4";
      service.initState(taskId, "内容", { totalWords: 100 });

      service.clearState(taskId);

      expect(service.getState(taskId)).toBeUndefined();
    });
  });

  // ============ 停止条件测试 ============

  describe("shouldStopContinuation", () => {
    it("达到最大续写次数应该停止", () => {
      const taskId = "task-stop-1";
      service.initState(taskId, "初始", {
        totalWords: 10000,
        maxContinuations: 3,
      });

      // 模拟 2 次更新（加上初始化的 1 次，共 3 次）
      for (let i = 0; i < 2; i++) {
        service.updateState(taskId, `续写${i}`, {
          needsContinuation: true,
          reason: "short_content",
          completedPortion: 0.01,
          lastCheckpoint: `续写${i}`,
          confidence: 0.8,
        });
      }

      const updatedState = service.getState(taskId)!;
      const stopCondition = service.shouldStopContinuation(updatedState);

      expect(stopCondition.shouldStop).toBe(true);
      expect(stopCondition.reason).toBe("max_continuations");
    });

    it("完成比例达标应该停止", () => {
      const state = service.initState("task-stop-2", "x".repeat(1000), {
        totalWords: 1000,
        maxContinuations: 5,
      });

      // 字数已经足够，needsContinuation 设为 false
      state.needsContinuation = false;

      const stopCondition = service.shouldStopContinuation(state);

      expect(stopCondition.shouldStop).toBe(true);
    });
  });

  // ============ 结果合并测试 ============

  describe("mergeResults", () => {
    it("应该正确合并两段内容", () => {
      const previous = "第一章的内容。";
      const next = "第二章的内容。";

      const merged = service.mergeResults(previous, next);

      expect(merged).toContain("第一章的内容");
      expect(merged).toContain("第二章的内容");
    });

    it("应该移除重叠内容", () => {
      // 创建足够长的前缀以触发重叠检测（需要超过 overlapWindowSize=100）
      const prefix = "这是一段很长的前缀内容。".repeat(20);
      const overlap = "主角走进了森林，森林里很安静。";
      const previous = prefix + overlap;
      const next = overlap + "他开始探索这片神秘的地方。";

      const merged = service.mergeResults(previous, next, {
        removeOverlap: true,
      });

      // 合并后不应该有完整重复
      expect(merged).toContain("他开始探索这片神秘的地方");
    });

    it("应该处理空内容", () => {
      expect(service.mergeResults("内容", "")).toBe("内容");
      expect(service.mergeResults("", "内容")).toBe("内容");
      expect(service.mergeResults("", "")).toBe("");
    });
  });

  // ============ getFinalResult 测试 ============

  describe("getFinalResult", () => {
    it("应该返回累积的完整结果", () => {
      const taskId = "task-final";
      service.initState(taskId, "第一部分", { totalWords: 100 });

      service.updateState(taskId, "第二部分", {
        needsContinuation: true,
        reason: "short_content",
        completedPortion: 0.5,
        lastCheckpoint: "第二部分",
        confidence: 0.8,
      });

      service.updateState(taskId, "第三部分[COMPLETED]", {
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "第三部分",
        confidence: 0.95,
      });

      const finalResult = service.getFinalResult(taskId);

      expect(finalResult).toContain("第一部分");
      expect(finalResult).toContain("第二部分");
      expect(finalResult).toContain("第三部分");
      // 应该清理掉 [COMPLETED] 标记
      expect(finalResult).not.toContain("[COMPLETED]");
    });

    it("不存在的任务应该返回 null", () => {
      expect(service.getFinalResult("non-existent")).toBeNull();
    });
  });
});
