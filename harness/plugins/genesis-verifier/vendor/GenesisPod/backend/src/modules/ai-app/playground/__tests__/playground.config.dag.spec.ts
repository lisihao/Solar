/**
 * PLAYGROUND_PIPELINE DAG 自洽 spec —— PR-R1
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.1 §5
 *
 * 反向证据：
 *   - 14 step 的 dag 字段填齐（除 s12 postlude 不在 steps）
 *   - validateStageDag 通过（successors 引用合法 + 无环 + rerunableReason）
 *   - computeCascadeChain 关键 mission 路径正确（c195035f 的 S11 单跑 + S2 全跑等）
 *
 * IMPORTANT — DAG honesty note (R2-#44):
 *   The `dag.successors` field is a RERUN CASCADE declaration, not a parallel-execution
 *   dependency graph. MissionPipelineOrchestrator runs stages in strict sequential order
 *   (for-loop over steps array). Stages are inherently sequential because each stage
 *   consumes the previous stage's output (S3 needs S2's plan, S5 needs S3's results,
 *   etc.). The only real parallelism is the per-dimension researcher fan-out INSIDE S3
 *   (via runDagConcurrency), which is already genuine parallel and is not changed here.
 */

import { PLAYGROUND_PIPELINE } from "../runtime/playground.config";
import {
  validateStageDag,
  computeCascadeChain,
} from "@/modules/ai-harness/runner/dag";

describe("PLAYGROUND_PIPELINE DAG 自洽", () => {
  it("13 step 全部声明 dag 字段（s1-s11，s12 postlude 不在 steps）", () => {
    expect(PLAYGROUND_PIPELINE.steps.length).toBe(13);
    const stepsWithDag = PLAYGROUND_PIPELINE.steps.filter((s) => s.dag);
    expect(stepsWithDag.length).toBe(13);
  });

  it("validateStageDag 通过：无任何 issue", () => {
    const issues = validateStageDag([...PLAYGROUND_PIPELINE.steps]);
    expect(issues).toEqual([]);
  });

  it("s1-budget 是唯一 rerunable=false 的 stage（含 reason）", () => {
    const s1 = PLAYGROUND_PIPELINE.steps.find((s) => s.id === "s1-budget");
    expect(s1?.dag?.rerunable).toBe(false);
    expect(s1?.dag?.rerunableReason).toBeTruthy();
    const otherUnrerunable = PLAYGROUND_PIPELINE.steps
      .filter((s) => s.id !== "s1-budget")
      .filter((s) => s.dag && !s.dag.rerunable);
    expect(otherUnrerunable).toEqual([]);
  });

  it("s11-persist 是 cascade 终点（successors 为空）", () => {
    const s11 = PLAYGROUND_PIPELINE.steps.find((s) => s.id === "s11-persist");
    expect(s11?.dag?.successors).toEqual([]);
  });

  it("c195035f 主用例：computeCascadeChain('s11-persist') === ['s11-persist']", () => {
    const chain = computeCascadeChain(
      [...PLAYGROUND_PIPELINE.steps],
      "s11-persist",
    );
    expect(chain).toEqual(["s11-persist"]);
  });

  it("S8 重跑 cascade 链 = [S8, S8B, S9, S9B, S10, S11]（6 step）", () => {
    const chain = computeCascadeChain(
      [...PLAYGROUND_PIPELINE.steps],
      "s8-writer",
    );
    expect(chain).toEqual([
      "s8-writer",
      "s8b-quality-enhancement",
      "s9-critic",
      "s9b-objective-eval",
      "s10-leader-foreword-signoff",
      "s11-persist",
    ]);
  });

  it("S2 重跑 cascade 链覆盖所有下游 stage（12 step：s2 + s3-s11 共 11 successors）", () => {
    const chain = computeCascadeChain(
      [...PLAYGROUND_PIPELINE.steps],
      "s2-leader-plan",
    );
    // s2 自己 + 11 successors (s3, s4, s5, s6, s7, s8, s8b, s9, s9b, s10, s11) = 12
    expect(chain.length).toBe(12);
    expect(chain[0]).toBe("s2-leader-plan");
    expect(chain[chain.length - 1]).toBe("s11-persist");
  });

  it("所有 successors 都是合法 step id（不引用 s12 这种 postlude）", () => {
    const validIds = new Set(PLAYGROUND_PIPELINE.steps.map((s) => s.id));
    for (const step of PLAYGROUND_PIPELINE.steps) {
      for (const succ of step.dag?.successors ?? []) {
        expect(validIds.has(succ)).toBe(true);
      }
    }
  });

  it("S6 写 analyst_output 列（PR-R0 新加列）", () => {
    const s6 = PLAYGROUND_PIPELINE.steps.find((s) => s.id === "s6-analyst");
    expect(s6?.dag?.dbWrites).toContain("analyst_output");
  });

  it("S7 写 outline_plan 列（PR-R0 新加列）", () => {
    const s7 = PLAYGROUND_PIPELINE.steps.find(
      (s) => s.id === "s7-writer-outline",
    );
    expect(s7?.dag?.dbWrites).toContain("outline_plan");
  });

  it("S11 dbWrites 含完整终态字段（status / completed_at / final_score / report_full）", () => {
    const s11 = PLAYGROUND_PIPELINE.steps.find((s) => s.id === "s11-persist");
    const dbW = new Set(s11?.dag?.dbWrites ?? []);
    expect(dbW.has("status")).toBe(true);
    expect(dbW.has("completed_at")).toBe(true);
    expect(dbW.has("final_score")).toBe(true);
    expect(dbW.has("report_full")).toBe(true);
  });

  /**
   * R2-#44 DAG honesty: assert the pipeline is strictly sequential.
   * dag.successors is a rerun-cascade declaration — it names which downstream stages
   * to reset/re-run when a given stage is re-run. It is NOT a parallel-execution
   * dependency graph. Steps execute in the order they appear in PLAYGROUND_PIPELINE.steps.
   *
   * This test verifies that every successor of step[i] appears strictly AFTER step[i]
   * in the steps array (no back-edges, which would imply loops; no same-index, which
   * would imply self-referential). This property is also checked by validateStageDag,
   * but we make the sequential-execution contract explicit here.
   */
  it("R2-#44: DAG successors all point strictly forward — pipeline executes sequentially", () => {
    const ids = PLAYGROUND_PIPELINE.steps.map((s) => s.id);
    const idxOf = new Map(ids.map((id, i) => [id, i]));
    for (const step of PLAYGROUND_PIPELINE.steps) {
      const myIdx = idxOf.get(step.id)!;
      for (const succ of step.dag?.successors ?? []) {
        const succIdx = idxOf.get(succ);
        expect(succIdx).toBeDefined();
        // Successor must appear strictly after the current step in the pipeline array.
        // This is the structural guarantee that the pipeline is sequential and acyclic.
        expect(succIdx).toBeGreaterThan(myIdx);
      }
    }
  });

  it("所有 stage 的 resetFields 都在合法 MissionColumnKey union 内（编译期校验已守，本 spec 兜底防漂移）", () => {
    // 列出所有出现过的 resetFields，断言合法（编译期 TS 已守，运行期再确认）
    const allResetFields = new Set<string>();
    for (const step of PLAYGROUND_PIPELINE.steps) {
      step.dag?.resetFields?.forEach((f) => allResetFields.add(f));
    }
    // 以下是 MissionColumnKey union 中"被使用"的子集
    const usedColumns = [
      "report_full",
      "report_artifact_version",
      "completed_at",
      "final_score",
      "error_message",
      "dimensions",
      "theme_summary",
      "reconciliation_report",
      "verdicts",
      "leader_signed",
      "leader_overall_score",
      "leader_verdict",
      "outline_plan",
      "analyst_output",
    ];
    for (const f of allResetFields) {
      expect(usedColumns).toContain(f);
    }
  });
});
