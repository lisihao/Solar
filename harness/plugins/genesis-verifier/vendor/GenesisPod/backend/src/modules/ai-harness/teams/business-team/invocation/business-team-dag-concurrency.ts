/**
 * BusinessAgentTeam — In-Memory DAG Concurrency Scheduler
 *
 * 内存数组 DAG 并发调度（runDagConcurrency 上提到 harness）。纯内存 + dependsOn
 * 字段 + 编译期拓扑求解；与 harness DAGExecutor（DB-backed 任务池调度）边界清晰：
 *   - 本 helper：纯内存数组 + `dependsOn` 字段，编译期拓扑求解，returns TOut[]
 *   - harness DAGExecutor：DB-backed 任务池调度（fetchExecutable / countPending /
 *     isCancelled adapter），用于 TI/research 的持久化任务队列。
 *   两者抽象层次不同，不是双源；本 helper 服务于"stage 内 dim 内存并行"场景。
 *
 * 2026-05-24 (P4) 抽取自 ai-app 业务侧 agent-execution-support.runDagConcurrency:
 *   - ai-app/playground/services/roles/agent-execution-support.ts.runDagConcurrency  @migrated-from
 *
 * 行为契约：
 *   1. 检测 cycle / missing deps → fallback 到 flat ConcurrencyLimiter 调度（仍并发）
 *   2. 遵守 `concurrency` 上限（任意时刻 activeCount ≤ concurrency）
 *   3. firstError 后续不再 dispatch 新任务，但 in-flight 任务跑完才 reject
 *   4. results 按 input items 顺序填充（不按完成顺序）
 */

import { Logger } from "@nestjs/common";
// ★ 不走 facade barrel：facade/index.ts 会 re-export 本 helper（构成循环加载）。
import { ConcurrencyLimiter } from "@/modules/ai-harness/runner/concurrency";

const log = new Logger("BusinessTeamDagConcurrency");

/**
 * 内存数组 DAG 并发调度。
 *
 * @param items - 必须有 `id`，可选 `dependsOn`（dependsOn 中找不到的 id 自动剔除）
 * @param concurrency - 任意时刻最大并发数（≥1）
 * @param fn - 单 item 处理函数（idx 与 items 同序）
 * @returns 与 items 同序的输出数组
 */
export async function runDagConcurrency<
  TIn extends { id: string; dependsOn?: string[] },
  TOut,
>(
  items: readonly TIn[],
  concurrency: number,
  fn: (item: TIn, idx: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const ids = new Set(items.map((i) => i.id));
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const idToIdx = new Map<string, number>();
  items.forEach((it, i) => idToIdx.set(it.id, i));
  for (const it of items) {
    const deps = (it.dependsOn ?? []).filter((d) => ids.has(d));
    inDeg.set(it.id, deps.length);
    for (const d of deps) {
      const arr = adj.get(d) ?? [];
      arr.push(it.id);
      adj.set(d, arr);
    }
  }

  // Reachability check (cycle / orphan detection) via temp topo sort
  const tmpInDeg = new Map(inDeg);
  const reachable = new Set<string>();
  const tmpQ: string[] = [];
  for (const [id, n] of tmpInDeg) {
    if (n === 0) {
      reachable.add(id);
      tmpQ.push(id);
    }
  }
  while (tmpQ.length > 0) {
    const id = tmpQ.shift()!;
    for (const child of adj.get(id) ?? []) {
      tmpInDeg.set(child, (tmpInDeg.get(child) ?? 0) - 1);
      if (tmpInDeg.get(child) === 0) {
        reachable.add(child);
        tmpQ.push(child);
      }
    }
  }
  if (reachable.size < items.length) {
    log.warn(
      `runDagConcurrency: cycle or missing deps detected - fallback to flat`,
    );
    const limiter = new ConcurrencyLimiter(Math.max(1, concurrency));
    return Promise.all(
      items.map((item, idx) => limiter.run(() => fn(item, idx))),
    );
  }

  const results: TOut[] = new Array(items.length);
  const ready: string[] = [];
  for (const [id, n] of inDeg) {
    if (n === 0) ready.push(id);
  }
  let activeCount = 0;
  let completed = 0;
  let firstError: unknown = null;

  return new Promise<TOut[]>((resolve, reject) => {
    const tryDispatch = () => {
      if (firstError) {
        if (activeCount === 0) reject(firstError);
        return;
      }
      while (activeCount < concurrency && ready.length > 0) {
        const id = ready.shift()!;
        const idx = idToIdx.get(id)!;
        const item = items[idx];
        activeCount++;
        Promise.resolve()
          .then(() => fn(item, idx))
          .then(
            (out) => {
              results[idx] = out;
              activeCount--;
              completed++;
              for (const child of adj.get(id) ?? []) {
                const next = (inDeg.get(child) ?? 0) - 1;
                inDeg.set(child, next);
                if (next === 0) ready.push(child);
              }
              if (completed === items.length) resolve(results);
              else tryDispatch();
            },
            (err) => {
              activeCount--;
              if (!firstError) firstError = err;
              tryDispatch();
            },
          );
      }
      if (
        activeCount === 0 &&
        ready.length === 0 &&
        completed < items.length &&
        !firstError
      ) {
        reject(new Error("runDagConcurrency: scheduler stalled (unreachable)"));
      }
    };
    tryDispatch();
  });
}
