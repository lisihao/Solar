/**
 * Duty Loader —— Agent 灵魂 (soul) + 职责说明书 (duty) 模板渲染器
 *
 * 2026-05-15 PR-E 单源化：数据源**仅** SKILL.md（buildPromptFromDuty 内部
 * 委托 loadSkill）。legacy 路径（soul.md + duties/*.md 散落文件）已物理删除。
 *
 * 设计原则：
 *   • Agent class 持有 schema + loop 等工程契约
 *   • SKILL.md 持有"该 agent 是谁（soul）+ 在某个 phase/mode 下做什么（duty）"
 *   • buildPromptFromDuty(agentDir, dutyName, vars) 自动从 SKILL.md 拼 soul+duty
 *
 * 文件位置规约：
 *   agents/<agent-dir>/SKILL.md  ← 唯一真源
 *
 * 模板语法（最小子集，不依赖 handlebars / mustache）：
 *   {{var}}                    简单变量替换
 *   {{a.b.c}}                  嵌套字段（点访问）
 *   {{#if condition}}...{{/if}} 条件块（值非空 / 非 false / 非 0 / 非空数组）
 *   {{#each array}}...{{/each}} 循环（{{this}} 当前项，{{@index}} 索引；
 *                                若 array 是对象数组用 {{field}} 直接引）
 */

import { loadSkill, clearSkillCache } from "./skill-md-loader";

/** 测试用：清 SKILL.md 缓存 */
export function clearDutyCache(): void {
  clearSkillCache();
}

// ───────────────────────────────────────────────────────────────────
// 模板渲染
// ───────────────────────────────────────────────────────────────────

/**
 * 渲染 duty markdown 模板，替换变量 + 处理 if / each。
 *
 * 顺序：
 *   1. {{#each}}...{{/each}} 先处理（避免 each 内部的 var 被外层先消费）
 *   2. {{#if}}...{{/if}}     再处理
 *   3. {{var}}              最后简单替换
 */
export function renderDuty(
  template: string,
  vars: Record<string, unknown>,
): string {
  let out = expandEach(template, vars);
  out = expandIf(out, vars);
  out = expandVars(out, vars);
  return out;
}

// ── 简单变量 / 点访问 ──
function getNested(vars: Record<string, unknown>, key: string): unknown {
  return key
    .trim()
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc != null && typeof acc === "object"
          ? (acc as Record<string, unknown>)[k]
          : undefined,
      vars,
    );
}

function expandVars(input: string, vars: Record<string, unknown>): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => {
    if (key === "this" || key === "@index") return m; // 留给 each 上下文
    const v = getNested(vars, key);
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  });
}

// ── {{#if}}...{{/if}} ──
function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function expandIf(input: string, vars: Record<string, unknown>): string {
  const re = /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;
  let prev = "";
  let cur = input;
  let i = 0;
  for (; i < 8 && prev !== cur; i++) {
    prev = cur;
    cur = cur.replace(re, (_m, key: string, body: string) => {
      const v = getNested(vars, key);
      return isTruthy(v) ? body : "";
    });
  }
  if (i >= 8 && prev !== cur) {
    // eslint-disable-next-line no-console
    console.warn(
      `[duty-loader] expandIf hit 8-pass cap, may have unresolved nesting`,
    );
  }
  return cur;
}

// ── {{#each array}}...{{/each}} ──
function expandEach(input: string, vars: Record<string, unknown>): string {
  const re = /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let prev = "";
  let cur = input;
  let _i = 0;
  for (; _i < 8 && prev !== cur; _i++) {
    prev = cur;
    cur = cur.replace(re, (_m, key: string, body: string) => {
      const arr = getNested(vars, key);
      if (!Array.isArray(arr) || arr.length === 0) return "";
      return arr
        .map((item, idx) => {
          const itemVars: Record<string, unknown> =
            item != null && typeof item === "object"
              ? { ...vars, ...(item as Record<string, unknown>) }
              : { ...vars };
          itemVars["this"] = item;
          itemVars["@index"] = idx;
          let rendered = expandEach(body, itemVars);
          rendered = expandIf(rendered, itemVars);
          rendered = expandVars(rendered, itemVars);
          return rendered;
        })
        .join("");
    });
  }
  if (_i >= 8 && prev !== cur) {
    // eslint-disable-next-line no-console
    console.warn(
      `[duty-loader] expandEach hit 8-pass cap, may have unresolved nesting`,
    );
  }
  return cur;
}

// ───────────────────────────────────────────────────────────────────
// 便捷封装：load + render 一步到位
// ───────────────────────────────────────────────────────────────────

/**
 * 加载 agent 的 soul + duty，拼接后渲染成最终 systemPrompt。
 *
 * 数据源单源（2026-05-15 PR-E 后）：agents/<agentDir>/SKILL.md
 *   - soul 段在 <!-- soul:start --> / <!-- soul:end --> 之间
 *   - 每个 duty 段在 <!-- duty:<name>:start --> / <!-- duty:<name>:end --> 之间
 *
 * 拼接顺序：
 *   [soul content]
 *   ---
 *   [duty content]
 *
 * soul 部分给 LLM 角色身份（"你是 Leader / Researcher / ..."），
 * duty 部分给当前 phase 任务（"现在做 plan / assess-research / ..."）。
 *
 * 抛错：
 *   - SKILL.md 不存在
 *   - SKILL.md frontmatter duties 未声明该 dutyName
 *   - body 缺对应 <!-- duty:<name>:start --> anchor
 */
export function buildPromptFromDuty(
  agentDir: string,
  dutyName: string,
  vars: Record<string, unknown>,
  agentsRootDir: string,
): string {
  const skill = loadSkill(agentDir, agentsRootDir);
  const dutyBody = skill.duties[dutyName];
  if (dutyBody == null) {
    throw new Error(
      `[duty-loader] SKILL.md for "${agentDir}" does not declare duty "${dutyName}". ` +
        `Add duty to frontmatter duties[] + body <!-- duty:${dutyName}:start --> anchor.`,
    );
  }
  const combined = skill.soul
    ? `${skill.soul.trim()}\n\n---\n\n${dutyBody}`
    : dutyBody;
  return renderDuty(combined, vars);
}
