/**
 * Evidence Budget Contract — 架构看护测试（Capability Contract · Guard）
 *
 * 2026-05-21 P2 根因治理：质量闸的来源要求与采集端供给各写各的常量，留出"采得少
 * 却要得多"的不可满足死区 → 审核结构性打回 → 重写循环 → 超时失败。根治方案是把
 * 来源充分性收成单一权威 EvidenceBudget（evidence-budget.ts），下游章节数 / 引用
 * 阈值由它派生。
 *
 * 本 spec 锁住该不变量：**谁拆掉 per-dim 的章节数封顶、或 reviewer 的来源感知引用
 * 阈值 → 这条测试就挂。** 与 evidence-budget.spec.ts（单测）belt-and-suspenders。
 */

import * as fs from "fs";
import * as path from "path";

const WORKFLOW = path.resolve(
  __dirname,
  "../../../modules/ai-app/playground/mission/pipeline/helpers",
);
const ARTIFACTS = path.resolve(
  __dirname,
  "../../../modules/ai-app/marketplace/capabilities/deep-insight/contract",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(WORKFLOW, rel), "utf-8");
}

function readArtifact(rel: string): string {
  return fs.readFileSync(path.join(ARTIFACTS, rel), "utf-8");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("Capability Contract · evidence budget guard", () => {
  it("the evidence-budget single authority exists and exports the contract", () => {
    const src = readArtifact("evidence-budget.ts");
    expect(src).toMatch(/export function computeEvidenceBudget\s*\(/);
    expect(src).toMatch(/export function deriveMaxChapters\s*\(/);
    expect(src).toMatch(/export function deriveCitationFloor\s*\(/);
  });

  it("per-dim pipeline caps chapter count by the evidence budget", () => {
    const code = stripComments(read("per-dim-pipeline.util.ts"));
    expect(code).toMatch(/computeEvidenceBudget\s*\(/);
    expect(code).toMatch(/deriveMaxChapters\s*\(/);
  });

  it("chapter pipeline feeds the reviewer the per-chapter source count", () => {
    const code = stripComments(read("chapter-pipeline.helper.ts"));
    expect(code).toMatch(/availableSourceCount\s*:/);
  });

  it("chapter-reviewer accepts availableSourceCount and derives the citation floor", () => {
    const reviewer = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../modules/ai-app/marketplace/capabilities/deep-insight/agents/writer/chapter-reviewer.agent.ts",
      ),
      "utf-8",
    );
    expect(reviewer).toMatch(/availableSourceCount/);
    expect(reviewer).toMatch(/citationFloor/);
    // ★ 引用下限走单一权威 deriveCitationFloor，不得内联复制公式
    expect(reviewer).toMatch(/deriveCitationFloor/);
  });
});
