/**
 * chapter-stream.helper —— 单测（审计 #4/#34/#35/#36 强验证）。
 *
 * 覆盖：
 *   #35/#36 emitChapterStream：N 章 → N 次 started + N 次 completed，字段 chapterIndex，
 *     时间戳严格递增（非同毫秒 burst）。
 *   #4 startWritingHeartbeat：每间隔一条 iteration:progress，stop 后停发。
 *   #34 runGuardedSectionRemediation：单 call 超时触发护栏不无限等待；20min wall-time
 *     守卫提前结束；minimal 档整段跳过；单 section 失败 fail-open 不阻断。
 */
import type { CapabilityRunEvent } from "../../../../../capability/capability-runner.port";
import {
  withTimeout,
  emitChapterStream,
  startWritingHeartbeat,
  runGuardedSectionRemediation,
  type RemediableSection,
  type SelfEvalLite,
} from "../chapter-stream.helper";

// ── 收集 domain 事件 ────────────────────────────────────────────────────────────
function makeCollector(): {
  onEvent: (e: CapabilityRunEvent) => void;
  events: Array<{ event: string; data: Record<string, unknown>; ts: number }>;
} {
  const events: Array<{
    event: string;
    data: Record<string, unknown>;
    ts: number;
  }> = [];
  return {
    events,
    onEvent: (e: CapabilityRunEvent) => {
      if (e.type === "domain") {
        const p = e.payload as { event: string; data: Record<string, unknown> };
        events.push({ event: p.event, data: p.data, ts: e.timestamp });
      }
    },
  };
}

describe("emitChapterStream (#35/#36 逐章流式)", () => {
  it("N 章产出 N 次 started + N 次 completed，payload 用 chapterIndex", async () => {
    const { onEvent, events } = makeCollector();
    const sections = [
      { heading: "A", body: "x".repeat(100) },
      { heading: "B", body: "y".repeat(200) },
      { heading: "C", body: "z".repeat(50) },
    ];
    const n = await emitChapterStream({
      sections,
      dimensionNames: ["dim1", "dim2"],
      fallbackDimension: "topic-X",
      onEvent,
      minStepMs: 0, // 测试无需真等待；时间戳单调性由下一个用例驱动
    });

    expect(n).toBe(3);
    const started = events.filter((e) => e.event === "chapter:writing:started");
    const completed = events.filter(
      (e) => e.event === "chapter:writing:completed",
    );
    expect(started).toHaveLength(3);
    expect(completed).toHaveLength(3);
    // chapterIndex 字段（不是 index）
    expect(started.map((e) => e.data.chapterIndex)).toEqual([0, 1, 2]);
    expect(completed.map((e) => e.data.chapterIndex)).toEqual([0, 1, 2]);
    // 维度按索引映射；越界回退 fallback
    expect(started[0].data.dimension).toBe("dim1");
    expect(started[1].data.dimension).toBe("dim2");
    expect(started[2].data.dimension).toBe("topic-X");
    // wordCount = body.length/2
    expect(completed[0].data.wordCount).toBe(50);
    expect(completed[1].data.wordCount).toBe(100);
  });

  it("时间戳严格递增（非同毫秒 burst）", async () => {
    const { onEvent, events } = makeCollector();
    // 用真 setTimeout sleep + 真 Date.now：minStepMs=2 保证跨事件时间戳前进。
    await emitChapterStream({
      sections: [
        { heading: "A", body: "x".repeat(300) },
        { heading: "B", body: "y".repeat(300) },
        { heading: "C", body: "z".repeat(300) },
      ],
      dimensionNames: [],
      fallbackDimension: "t",
      onEvent,
      minStepMs: 2,
    });
    const ts = events.map((e) => e.ts);
    expect(ts.length).toBe(6);
    // 非递减且首尾确有前进（不是全部同一毫秒）
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
    }
    expect(ts[ts.length - 1]).toBeGreaterThan(ts[0]);
  });

  it("sections 为空 / onEvent 缺省 → 0 事件", async () => {
    const { onEvent, events } = makeCollector();
    expect(
      await emitChapterStream({
        sections: [],
        dimensionNames: [],
        fallbackDimension: "t",
        onEvent,
        minStepMs: 0,
      }),
    ).toBe(0);
    expect(events).toHaveLength(0);
    expect(
      await emitChapterStream({
        sections: [{ heading: "A" }],
        dimensionNames: [],
        fallbackDimension: "t",
        onEvent: undefined,
        minStepMs: 0,
      }),
    ).toBe(0);
  });
});

describe("startWritingHeartbeat (#4 写作期心跳)", () => {
  it("每间隔发一条 iteration:progress，stop 后停发", () => {
    jest.useFakeTimers();
    try {
      const { onEvent, events } = makeCollector();
      const stop = startWritingHeartbeat({
        onEvent,
        stage: "s8-writer",
        role: "writer",
        text: "撰写中",
        intervalMs: 60_000,
      });
      expect(events).toHaveLength(0);
      jest.advanceTimersByTime(60_000);
      expect(events).toHaveLength(1);
      jest.advanceTimersByTime(120_000);
      expect(events).toHaveLength(3);
      expect(events[0].event).toBe("iteration:progress");
      expect(events[0].data.iteration).toBe(1);
      expect(events[2].data.iteration).toBe(3);
      stop();
      jest.advanceTimersByTime(180_000);
      expect(events).toHaveLength(3); // 停发
    } finally {
      jest.useRealTimers();
    }
  });

  it("onEvent 缺省 → 返回 no-op stop，不抛错", () => {
    const stop = startWritingHeartbeat({
      onEvent: undefined,
      stage: "s",
      role: "r",
      text: "t",
    });
    expect(() => stop()).not.toThrow();
  });
});

describe("withTimeout (#34 单 call 护栏)", () => {
  it("超时 reject 不无限等待", async () => {
    const never = new Promise<string>(() => {
      /* 永不 resolve */
    });
    await expect(withTimeout(never, 20, "neverResolves")).rejects.toThrow(
      /timeout 20ms/,
    );
  });

  it("及时完成 → 透传结果并清 timer", async () => {
    const ok = Promise.resolve("done");
    await expect(withTimeout(ok, 1000, "fast")).resolves.toBe("done");
  });
});

describe("runGuardedSectionRemediation (#34 三重护栏)", () => {
  const goodEval: SelfEvalLite = {
    overallOk: false,
    weakAreas: ["analytical_depth"],
    scores: { analytical_depth: 4 },
  };
  const okEval: SelfEvalLite = {
    overallOk: true,
    weakAreas: [],
    scores: { analytical_depth: 9 },
  };

  function mkSections(count: number): RemediableSection[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `sec-${i}`,
      title: `Section ${i}`,
      content: "x".repeat(500),
    }));
  }

  it("护栏 3：minimal 档整段跳过（不调任何服务）", async () => {
    const evaluateSection = jest.fn();
    const res = await runGuardedSectionRemediation({
      sections: mkSections(3),
      topic: "t",
      language: "zh-CN",
      auditLayers: ["minimal"],
      deps: {
        evaluateSection,
        determineRemediationActions: () => [],
        remediate: jest.fn(),
      },
    });
    expect(res.skippedMinimal).toBe(true);
    expect(res.mutated).toBe(false);
    expect(evaluateSection).not.toHaveBeenCalled();
  });

  it("护栏 1：单 section selfEval 超时 → catch 跳过，不无限等待，后续 section 继续", async () => {
    let call = 0;
    const evaluateSection = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        // 第一个 section selfEval 永不返回 → 应被 withTimeout 打断
        return new Promise<SelfEvalLite>(() => {});
      }
      return okEval; // 第二个 section 正常（ok → 不补救）
    });
    const start = Date.now();
    const res = await runGuardedSectionRemediation({
      sections: mkSections(2),
      topic: "t",
      language: "zh-CN",
      auditLayers: [],
      selfEvalTimeoutMs: 30, // 缩短护栏便于测试
      remediateTimeoutMs: 30,
      deps: {
        evaluateSection,
        determineRemediationActions: () => [{ k: 1 }],
        remediate: jest.fn(),
      },
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 没有无限等待
    expect(res.processed).toBe(2); // 两个 section 都被尝试（第一个超时跳过）
    expect(res.wallTimeHit).toBe(false);
    expect(evaluateSection).toHaveBeenCalledTimes(2);
  });

  it("护栏 2：wall-time 超限 → 提前 break 跳过余下 section", async () => {
    // 调用序：now() 第 1 次算 deadline（=times[0]+wall）；之后每次循环顶部检查 now()>deadline。
    //   times[0]=0  → deadline=0+240000=240000
    //   loop iter1: now=times[1]=60000  ≤ 240000 → 处理 section1（processed=1）
    //   loop iter2: now=times[2]=300000 > 240000 → break，跳过余下。
    const times = [0, 60_000, 300_000, 360_000];
    let i = 0;
    const now = (): number => times[Math.min(i++, times.length - 1)];
    const warn = jest.fn();
    const evaluateSection = jest.fn(async () => okEval);
    const res = await runGuardedSectionRemediation({
      sections: mkSections(5),
      topic: "t",
      language: "zh-CN",
      auditLayers: [],
      wallTimeMs: 4 * 60_000, // 4min wall
      now,
      warn,
      deps: {
        evaluateSection,
        determineRemediationActions: () => [],
        remediate: jest.fn(),
      },
    });
    expect(res.wallTimeHit).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("wall-time exceeded"),
    );
    expect(res.processed).toBe(1);
  });

  it("正常补救闭环：弱维度 → remediate → 回写 content + mutated=true + recordLoop", async () => {
    const remediated = { skipped: false, content: "REMEDIATED-BODY-CONTENT" };
    const recordLoop = jest.fn();
    const sections = mkSections(1);
    const res = await runGuardedSectionRemediation({
      sections,
      topic: "t",
      language: "zh-CN",
      auditLayers: [],
      preferredModelId: "model-x",
      deps: {
        evaluateSection: jest
          .fn()
          .mockResolvedValueOnce(goodEval) // before: weak
          .mockResolvedValueOnce(okEval), // after: resolved
        determineRemediationActions: () => [{ type: "deepen" }],
        remediate: jest.fn().mockResolvedValue(remediated),
        recordLoop,
      },
    });
    expect(res.mutated).toBe(true);
    expect(sections[0].content).toBe("REMEDIATED-BODY-CONTENT");
    expect(recordLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "sec-0",
        weakAreasResolved: true,
        remediationModel: "model-x",
      }),
    );
  });

  it("fail-open：单 section remediate 抛错 → 跳过不阻断，mutated=false", async () => {
    const warn = jest.fn();
    const sections = mkSections(2);
    const res = await runGuardedSectionRemediation({
      sections,
      topic: "t",
      language: "zh-CN",
      auditLayers: [],
      warn,
      deps: {
        evaluateSection: jest.fn().mockResolvedValue(goodEval),
        determineRemediationActions: () => [{ type: "x" }],
        remediate: jest.fn().mockRejectedValue(new Error("LLM 500")),
      },
    });
    expect(res.mutated).toBe(false);
    expect(res.processed).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("remediation failed"),
    );
  });

  it("太短 section（< 200 字）跳过补救", async () => {
    const evaluateSection = jest.fn();
    const res = await runGuardedSectionRemediation({
      sections: [{ id: "s", title: "T", content: "short" }],
      topic: "t",
      language: "zh-CN",
      auditLayers: [],
      deps: {
        evaluateSection,
        determineRemediationActions: () => [],
        remediate: jest.fn(),
      },
    });
    expect(res.processed).toBe(0);
    expect(evaluateSection).not.toHaveBeenCalled();
  });
});
