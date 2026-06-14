import { DAGExecutor, type DAGAdapter, type DAGTask } from "../dag-executor";

interface TestTask extends DAGTask {
  id: string;
  deps?: string[];
  duration?: number;
}

class FakeAdapter implements DAGAdapter<TestTask> {
  completed = new Set<string>();
  failed = new Set<string>();
  executionLog: string[] = [];
  cancelled = false;
  private peakConcurrent = 0;
  private active = 0;

  constructor(private readonly tasks: TestTask[]) {}

  get peakConcurrency(): number {
    return this.peakConcurrent;
  }

  async fetchExecutable(): Promise<TestTask[]> {
    return this.tasks.filter(
      (t) =>
        !this.completed.has(t.id) &&
        !this.failed.has(t.id) &&
        (!t.deps || t.deps.every((d) => this.completed.has(d))),
    );
  }

  executor = async (task: TestTask): Promise<void> => {
    this.active++;
    this.peakConcurrent = Math.max(this.peakConcurrent, this.active);
    this.executionLog.push(task.id);
    await new Promise((r) => setTimeout(r, task.duration ?? 5));
    this.active--;
    if (task.id.startsWith("FAIL_")) {
      this.failed.add(task.id);
      throw new Error(`task ${task.id} failed`);
    }
    this.completed.add(task.id);
  };

  async countPending(): Promise<number> {
    return this.tasks.filter(
      (t) => !this.completed.has(t.id) && !this.failed.has(t.id),
    ).length;
  }

  async isCancelled(): Promise<boolean> {
    return this.cancelled;
  }
}

describe("DAGExecutor.run", () => {
  it("executes independent tasks in parallel up to maxConcurrent", async () => {
    const tasks: TestTask[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      duration: 10,
    }));
    const adapter = new FakeAdapter(tasks);
    const exec = new DAGExecutor();
    const r = await exec.run(adapter, { maxConcurrent: 3 });
    expect(r.completed).toBe(6);
    expect(r.cancelled).toBe(false);
    expect(adapter.peakConcurrency).toBeLessThanOrEqual(3);
  });

  it("respects task dependencies", async () => {
    const tasks: TestTask[] = [
      { id: "A" },
      { id: "B", deps: ["A"] },
      { id: "C", deps: ["A"] },
      { id: "D", deps: ["B", "C"] },
    ];
    const adapter = new FakeAdapter(tasks);
    const exec = new DAGExecutor();
    await exec.run(adapter, { maxConcurrent: 4 });
    // A 必须在 B/C 前；B/C 必须在 D 前
    const log = adapter.executionLog;
    expect(log.indexOf("A")).toBeLessThan(log.indexOf("B"));
    expect(log.indexOf("A")).toBeLessThan(log.indexOf("C"));
    expect(log.indexOf("B")).toBeLessThan(log.indexOf("D"));
    expect(log.indexOf("C")).toBeLessThan(log.indexOf("D"));
  });

  it("respects cancellation between rounds", async () => {
    const tasks: TestTask[] = [
      { id: "t1", duration: 5 },
      { id: "t2", duration: 5 },
      { id: "t3", duration: 5 },
    ];
    const adapter = new FakeAdapter(tasks);
    // 让第二轮就取消
    let calls = 0;
    const origIsCancelled = adapter.isCancelled.bind(adapter);
    adapter.isCancelled = async () => {
      calls++;
      return calls > 1;
    };
    const exec = new DAGExecutor();
    const r = await exec.run(adapter, {
      maxConcurrent: 1,
      postTaskDelayMs: 0,
    });
    expect(r.cancelled).toBe(true);
    void origIsCancelled;
  });

  it("isolates failed tasks (does not corrupt completion set)", async () => {
    const tasks: TestTask[] = [{ id: "ok1" }, { id: "FAIL_x" }, { id: "ok2" }];
    const adapter = new FakeAdapter(tasks);
    const exec = new DAGExecutor();
    const r = await exec.run(adapter, {
      maxConcurrent: 2,
      postTaskDelayMs: 0,
    });
    expect(r.completed).toBe(2); // ok1 + ok2
    expect(r.deadlocked).toBe(false);
  });

  it("detects deadlock when pending but no executable", async () => {
    const tasks: TestTask[] = [{ id: "X", deps: ["NEVER_COMPLETES"] }];
    const adapter = new FakeAdapter(tasks);
    const exec = new DAGExecutor();
    const r = await exec.run(adapter, {
      maxConcurrent: 1,
      pollIntervalMs: 1, // 加速测试
      postTaskDelayMs: 0,
      maxConsecutiveWaits: 3,
    });
    expect(r.deadlocked).toBe(true);
    expect(r.completed).toBe(0);
  });

  it("dynamic — picks up next executable as soon as one completes", async () => {
    const tasks: TestTask[] = [
      { id: "fast", duration: 5 },
      { id: "slow", duration: 100 },
      { id: "after-fast", deps: ["fast"], duration: 5 },
    ];
    const adapter = new FakeAdapter(tasks);
    const exec = new DAGExecutor();
    const t0 = Date.now();
    await exec.run(adapter, { maxConcurrent: 2, postTaskDelayMs: 0 });
    const elapsed = Date.now() - t0;
    // slow=100ms, fast+after-fast=10ms 串行；并行总时长应≈100ms 而非 110ms
    expect(elapsed).toBeLessThan(150);
  });
});
