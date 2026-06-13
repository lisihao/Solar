/**
 * Duty Loader for ai-app/social.
 *
 * Copy of playground/utils/duty-loader.ts —— mirror unchanged。若第 3 个
 * ai-app 也需要，抽到 ai-engine/skills；目前 YAGNI 保留两份。
 *
 * Loads soul + duty from agents/<agentDir>/SKILL.md and renders the template
 * with given vars (supports {{var}} / {{#if}} / {{#each}} primitives).
 */
import { loadSkill, clearSkillCache } from "./skill-md-loader";

export function clearDutyCache(): void {
  clearSkillCache();
}

export function renderDuty(
  template: string,
  vars: Record<string, unknown>,
): string {
  let out = expandEach(template, vars);
  out = expandIf(out, vars);
  out = expandVars(out, vars);
  return out;
}

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
    if (key === "this" || key === "@index") return m;
    const v = getNested(vars, key);
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  });
}

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
  return cur;
}

function expandEach(input: string, vars: Record<string, unknown>): string {
  const re = /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let prev = "";
  let cur = input;
  let i = 0;
  for (; i < 8 && prev !== cur; i++) {
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
  return cur;
}

export function buildPromptFromDuty(
  agentDir: string,
  dutyName: string,
  vars: Record<string, unknown>,
): string {
  const skill = loadSkill(agentDir);
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
