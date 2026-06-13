/**
 * standards/16 §五·补 — ai-engine 递归子目录 MECE 看护（2026-06-04 全量审计后硬化）
 *
 * L2 ai-engine 12 聚合，递归子目录单轴 = "无 agent/mission 状态的原子能力"。
 * 六条律（详见 standards/16-ai-engine-harness-structure.md §五·补）：
 *   律1 顶层 12 聚合：顶层目录 ∈ {llm,tools,rag,knowledge,content,skills,planning,
 *                    safety,routing,reliability,evaluation,facade}。
 *   律2 禁垃圾抽屉：子树内禁 utils/helpers/common/misc 目录。
 *   律3 禁自造词目录：子树内禁 runtime/kernel/execution/process/governance/ecosystem
 *                    （tools/categories/* 工具分类法除外）。
 *   律4 R1 无 agent 状态：engine 源码禁查 agent/mission 运行时表。
 *   律5 同名概念唯一：LlmRerankerAdapter 以引擎版为权威，他处禁再声明。
 *   律6 引擎词汇纯净：engine 禁 IAgentSpec / agent-spec 命名。
 *
 * 每条用**收缩 ALLOWLIST** 跟踪存量违规：搬一个删一行，清空即硬焊。新增违规即红。
 * 过期条目（已整改但还列着）走软告警，不硬失败（避免与并发整改竞态）。
 * R2（engine 0 controller）已由 no-http-in-lower-layers.spec.ts 看护，本 spec 不重复。
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../..");
const MODULES = path.join(SRC_ROOT, "modules");
const ENGINE = path.join(MODULES, "ai-engine");

function listTs(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules" || e.name === "dist")
        continue;
      listTs(full, acc);
    } else if (
      e.isFile() &&
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".spec.ts") &&
      !e.name.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function listDirsRec(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "dist")
      continue;
    const full = path.join(dir, e.name);
    acc.push(full);
    listDirsRec(full, acc);
  }
  return acc;
}

const rel = (f: string) => path.relative(SRC_ROOT, f).replace(/\\/g, "/");

function listTopDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "__tests__")
    .map((e) => e.name)
    .sort();
}

function softStaleWarn(name: string, allowlist: string[], actual: string[]) {
  const stale = allowlist.filter((a) => !actual.includes(a));
  if (stale.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[std16:${name}] ALLOWLIST 过期条目（已整改，请删行）：\n  ${stale.join("\n  ")}`,
    );
  }
  // eslint-disable-next-line no-console
  console.info(`[std16:${name}] 剩余违规 ${actual.length} 个`);
}

// ── 律1 顶层 12 聚合 ──
const TOP_LEVEL_AGGREGATES = [
  "llm",
  "tools",
  "rag",
  "knowledge",
  "content",
  "skills",
  "planning",
  "safety",
  "routing",
  "reliability",
  "evaluation",
  "facade",
];

// ── 律2 垃圾抽屉目录名 ──
const JUNK_DRAWER = ["utils", "helpers", "common", "misc"];
const JUNK_DRAWER_ALLOWLIST = []; // W3 已落地：safety/utils 拆分到 reliability + content/figure

// ── 律3 自造词 / 含糊结构目录名（tools/categories/* 分类法除外）──
const BANNED_VOCAB = [
  "runtime",
  "kernel",
  "execution",
  "process",
  "governance",
  "ecosystem",
];
const BANNED_VOCAB_ALLOWLIST = []; // W3 已落地：runtime→integration、ecosystem→marketplace

// ── 律4 R1：agent/mission 运行时表查询 ──
const AGENT_STATE_QUERY =
  /prisma\.(agentProcess|mission)\b|\.agentProcess\.(find|update|create|delete|upsert)/;
const AGENT_STATE_ALLOWLIST = []; // W2 已落地：capability-guard 迁回 ai-harness/guardrails/capability

// ── 律5 同名概念唯一（引擎版权威）──
const RERANK_CANONICAL = "modules/ai-engine/knowledge/rerank/llm-reranker.adapter.ts";
const RERANK_DUP_ALLOWLIST = []; // W1 已落地：insight 本地副本已删，硬焊单一权威

// ── 律6 引擎词汇纯净 ──
const AGENT_SPEC_ALLOWLIST = []; // W2 已落地：engine IAgentSpec → ISkillExecSpec（去 agent 词汇 + 解与 harness IAgentSpec 撞名）

describe("standards/16 §五·补 · ai-engine 递归子目录 MECE", () => {
  it("律1：ai-engine 顶层目录 ∈ 12 聚合（多一个即红）", () => {
    const dirs = listTopDirs(ENGINE);
    const offenders = dirs.filter((d) => !TOP_LEVEL_AGGREGATES.includes(d));
    expect(offenders).toEqual([]);
  });

  it("律2：子树内禁垃圾抽屉目录（utils/helpers/common/misc）", () => {
    const offenders = listDirsRec(ENGINE)
      .filter((d) => JUNK_DRAWER.includes(path.basename(d)))
      .map(rel)
      .sort();
    softStaleWarn("junk-drawer", JUNK_DRAWER_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !JUNK_DRAWER_ALLOWLIST.includes(o))).toEqual([]);
  });

  it("律3：子树内禁自造词/含糊结构目录（tools/categories/* 除外）", () => {
    const offenders = listDirsRec(ENGINE)
      .filter((d) => BANNED_VOCAB.includes(path.basename(d)))
      .filter((d) => !rel(d).includes("/tools/categories/"))
      .map(rel)
      .sort();
    softStaleWarn("banned-vocab", BANNED_VOCAB_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !BANNED_VOCAB_ALLOWLIST.includes(o))).toEqual(
      [],
    );
  });

  it("律4：R1 engine 禁查 agent/mission 运行时表（无 agent 状态）", () => {
    const offenders = listTs(ENGINE)
      .filter((f) => AGENT_STATE_QUERY.test(fs.readFileSync(f, "utf-8")))
      .map(rel)
      .sort();
    softStaleWarn("r1-agent-state", AGENT_STATE_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !AGENT_STATE_ALLOWLIST.includes(o))).toEqual(
      [],
    );
  });

  it("律5：LlmRerankerAdapter 同名概念唯一（引擎版权威，他处禁声明）", () => {
    const declarers = listTs(MODULES)
      .filter((f) =>
        /export\s+class\s+LlmRerankerAdapter\b/.test(fs.readFileSync(f, "utf-8")),
      )
      .map(rel)
      .sort();
    // 权威实现必须存在
    expect(declarers).toContain(RERANK_CANONICAL);
    // 权威之外的声明即违规（存量走 allowlist）
    const offenders = declarers.filter((d) => d !== RERANK_CANONICAL);
    softStaleWarn("rerank-single-home", RERANK_DUP_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !RERANK_DUP_ALLOWLIST.includes(o))).toEqual([]);
  });

  it("律6：engine 禁 IAgentSpec / agent-spec 命名（agent 词汇不进 L2）", () => {
    const offenders = listTs(ENGINE)
      .filter((f) => {
        const base = path.basename(f);
        const body = fs.readFileSync(f, "utf-8");
        return base.includes("agent-spec") || /\bIAgentSpec\b/.test(body);
      })
      .map(rel)
      .sort();
    softStaleWarn("engine-vocab-agent-spec", AGENT_SPEC_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !AGENT_SPEC_ALLOWLIST.includes(o))).toEqual([]);
  });
});
