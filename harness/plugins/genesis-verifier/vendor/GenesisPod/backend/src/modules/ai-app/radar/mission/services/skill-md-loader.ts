/**
 * AI Radar SKILL.md loader —— 与 playground/utils/skill-md-loader 完全同形
 *
 * 解析 agents/<agentDir>/SKILL.md 的 frontmatter + soul / duty 段：
 *   - frontmatter（YAML between ---）含 id / name / allowedTools / duties[] 等
 *   - body 用 HTML 注释边界标识 soul / 每个 duty 的内容：
 *       <!-- soul:start --> ... <!-- soul:end -->
 *
 * 实现照抄 playground 标准，保证整个项目 SKILL.md 加载行为一致；不依赖
 * 第三方 YAML 库，避免新增 runtime 依赖。
 */
import * as fs from "fs";
import * as path from "path";

export interface SkillFrontmatter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly allowedModels: ReadonlyArray<string>;
  readonly duties: ReadonlyArray<string>;
  readonly domain?: string;
  readonly version?: string;
}

export interface ParsedSkill {
  readonly frontmatter: SkillFrontmatter;
  readonly soul: string | null;
  readonly duties: Readonly<Record<string, string>>;
}

const cache = new Map<string, ParsedSkill>();

/**
 * 加载 + 解析某 agent 的 SKILL.md。文件不存在抛错。
 */
export function loadSkill(agentDir: string): ParsedSkill {
  const cached = cache.get(agentDir);
  if (cached) return cached;
  const filePath = path.resolve(
    __dirname,
    "..",
    "agents",
    agentDir,
    "SKILL.md",
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`SKILL.md not found: ${filePath} (agent=${agentDir})`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseSkill(raw);
  cache.set(agentDir, parsed);
  return parsed;
}

export function clearSkillCache(): void {
  cache.clear();
}

export function parseSkill(raw: string): ParsedSkill {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error("SKILL.md missing YAML frontmatter (--- ... --- block)");
  }
  const frontmatter = parseFrontmatter(fmMatch[1]);
  const body = fmMatch[2];
  return {
    frontmatter,
    soul: extractSection(body, "soul"),
    duties: extractDuties(body, frontmatter.duties),
  };
}

function extractSection(body: string, name: string): string | null {
  const re = new RegExp(
    `<!--\\s*${name}:start\\s*-->\\r?\\n([\\s\\S]*?)\\r?\\n<!--\\s*${name}:end\\s*-->`,
  );
  const m = body.match(re);
  return m ? m[1] : null;
}

function extractDuties(
  body: string,
  dutyNames: ReadonlyArray<string>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of dutyNames) {
    const re = new RegExp(
      `<!--\\s*duty:${escapeRegex(name)}:start\\s*-->\\r?\\n([\\s\\S]*?)\\r?\\n<!--\\s*duty:${escapeRegex(name)}:end\\s*-->`,
    );
    const m = body.match(re);
    if (!m) {
      throw new Error(
        `[radar/skill-md] duty "${name}" listed in frontmatter but body has no <!-- duty:${name}:start --> block`,
      );
    }
    out[name] = m[1];
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFrontmatter(yaml: string): SkillFrontmatter {
  const lines = yaml.split(/\r?\n/);
  const fields: Record<string, unknown> = {};
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    const value = valueRaw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      fields[key] =
        inner.length === 0
          ? []
          : inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    } else if (value === "true") {
      fields[key] = true;
    } else if (value === "false") {
      fields[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      fields[key] = Number(value);
    } else {
      fields[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  if (!fields.id || typeof fields.id !== "string") {
    throw new Error("[radar/skill-md] frontmatter missing required field: id");
  }
  return {
    id: fields.id,
    name: (fields.name as string | undefined) ?? "",
    description: fields.description as string | undefined,
    allowedTools: (fields.allowedTools as string[] | undefined) ?? [],
    allowedModels: (fields.allowedModels as string[] | undefined) ?? [],
    duties: (fields.duties as string[] | undefined) ?? [],
    domain: fields.domain as string | undefined,
    version: fields.version as string | undefined,
  };
}
