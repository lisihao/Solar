/**
 * research primitive 滑动窗并发 spec（审计 #23/#34）
 *
 * 守护三条语义：
 *  1. 滑动窗无 chunk barrier：槽位空出立即补位（首个 item 完成后第 N+1 个立刻起跑，
 *     不等同批其余 item）。
 *  2. 并发解析优先级：用户档位（ctx.input.invocation.concurrency）>
 *     params.concurrency > min(items, 6)（基线 fc22d9a Phase A 语义）。
 *  3. 失败仍按 item 计入 failureCount + onPatchFailure，结果保持 item 原序。
 */
import { RESEARCH_PRIMITIVE, CrossStageState } from "../index";

interface Deferred {
  promise: Promise<number>;
  resolve: (v: number) => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (v: number) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> =>
  new Promise<void>((r) => {
    setImmediate(r);
  });

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    ctx: { missionId: "m1", input: {}, statefulRoleStates: {} },
    role: {
      id: "researcher",
      stateful: false,
      skillSpec: {
        id: "researcher",
        systemPrompt: "research",
        allowedToolIds: [],
        allowedModels: [],
        outputSchema: { safeParse: () => ({ success: true }) },
        meta: {},
      },
    },
    config: { id: "research" },
    hooks: {},
    crossStageState: new CrossStageState(),
    previousOutputs: {},
    ...overrides,
  } as Parameters<typeof RESEARCH_PRIMITIVE.run>[0];
}

/** 8 item + deferred 控制完成时机的 harness：返回跟踪器与 run promise。 */
function startTrackedRun(args: {
  itemCount: number;
  input?: unknown;
  params?: Record<string, unknown>;
  rejectIdx?: number;
}) {
  const items = Array.from({ length: args.itemCount }, (_, i) => i);
  const deferreds = items.map(() => deferred());
  const started: number[] = [];
  const failures: unknown[] = [];
  let inFlight = 0;
  let peak = 0;

  const runPromise = RESEARCH_PRIMITIVE.run(
    makeArgs({
      ctx: {
        missionId: "m1",
        input: args.input ?? {},
        statefulRoleStates: {},
      },
      config: {
        id: "research",
        ...(args.params ? { params: args.params } : {}),
      },
      hooks: {
        fanOut: () => items,
        perItemPipeline: async ({ item }: { item: number }) => {
          started.push(item);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            return await deferreds[item].promise;
          } finally {
            inFlight -= 1;
          }
        },
        onPatchFailure: ({ item }: { item: unknown }) => {
          failures.push(item);
        },
      },
    }),
  );
  return {
    deferreds,
    started,
    failures,
    runPromise,
    getInFlight: () => inFlight,
    getPeak: () => peak,
  };
}

describe("research primitive 滑动窗并发", () => {
  it("8 维 + 用户档位 6：同时 in_flight 峰值 6，首个完成后第 7 个立即补位（无 chunk barrier）", async () => {
    const t = startTrackedRun({
      itemCount: 8,
      input: { invocation: { concurrency: 6 } },
    });

    await flush();
    // 窗口填满：前 6 个 item 同时 in_flight，第 7/8 个排队
    expect(t.started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.getInFlight()).toBe(6);

    // 只完成 item 0 —— chunk-barrier 实现会等 1-5 全部完成才放行下一批；
    // 滑动窗必须立即起跑 item 6
    t.deferreds[0].resolve(0);
    await flush();
    expect(t.started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(t.getInFlight()).toBe(6);

    t.deferreds[1].resolve(1);
    await flush();
    expect(t.started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (let i = 2; i < 8; i++) t.deferreds[i].resolve(i);
    const out = await t.runPromise;
    expect(t.getPeak()).toBe(6);
    // 结果保持 item 原序（与完成顺序无关）
    expect(out.results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out.failureCount).toBe(0);
  });

  it("用户未配且无 params：默认 min(items, 6)（基线 Phase A 语义）", async () => {
    const t = startTrackedRun({ itemCount: 8 });
    await flush();
    expect(t.started).toHaveLength(6);

    for (let i = 0; i < 8; i++) t.deferreds[i].resolve(i);
    await t.runPromise;
    expect(t.getPeak()).toBe(6);
  });

  it("items 少于 6 时默认并发 = items 数", async () => {
    const t = startTrackedRun({ itemCount: 3 });
    await flush();
    expect(t.started).toHaveLength(3);
    for (let i = 0; i < 3; i++) t.deferreds[i].resolve(i);
    await t.runPromise;
    expect(t.getPeak()).toBe(3);
  });

  it("params.concurrency 在用户未配时生效", async () => {
    const t = startTrackedRun({ itemCount: 8, params: { concurrency: 2 } });
    await flush();
    expect(t.started).toHaveLength(2);
    for (let i = 0; i < 8; i++) t.deferreds[i].resolve(i);
    await t.runPromise;
    expect(t.getPeak()).toBe(2);
  });

  it("用户档位优先于 params.concurrency", async () => {
    const t = startTrackedRun({
      itemCount: 8,
      input: { invocation: { concurrency: 4 } },
      params: { concurrency: 2 },
    });
    await flush();
    expect(t.started).toHaveLength(4);
    for (let i = 0; i < 8; i++) t.deferreds[i].resolve(i);
    await t.runPromise;
    expect(t.getPeak()).toBe(4);
  });

  it("非法用户档位（0 / NaN）回退到下一优先级", async () => {
    const t = startTrackedRun({
      itemCount: 8,
      input: { invocation: { concurrency: 0 } },
      params: { concurrency: "abc" },
    });
    await flush();
    // 两级均非法 → min(items, 6)
    expect(t.started).toHaveLength(6);
    for (let i = 0; i < 8; i++) t.deferreds[i].resolve(i);
    await t.runPromise;
  });

  it("失败 item 计入 failureCount + onPatchFailure，成功结果保持原序", async () => {
    const t = startTrackedRun({
      itemCount: 8,
      input: { invocation: { concurrency: 6 } },
    });
    await flush();
    t.deferreds[3].reject(new Error("dim-3 fail"));
    for (let i = 0; i < 8; i++) {
      if (i !== 3) t.deferreds[i].resolve(i);
    }
    const out = await t.runPromise;
    expect(out.failureCount).toBe(1);
    expect(t.failures).toEqual([3]);
    expect(out.results).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });
});
