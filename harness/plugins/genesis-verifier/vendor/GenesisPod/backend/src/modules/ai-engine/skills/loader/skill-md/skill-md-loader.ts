/**
 * SKILL.md loader（v5.1 R2-A0 / Anthropic skill 标准格式）
 *
 * 解析 agents/<agentDir>/SKILL.md 的 frontmatter + soul / duty 段：
 *   - frontmatter（YAML between ---）含 id / name / allowedTools / duties[] 等
 *   - body 用 HTML 注释边界标识 soul / 每个 duty 的内容：
 *       <!-- soul:start --> ... <!-- soul:end -->
 *       <!-- duty:<name>:start --> ... <!-- duty:<name>:end -->
 *
 * 2026-05-15 PR-E 单源化后是首个 ai-app(@migrated-from playground)的 prompt 数据源。
 * duty-loader.ts 委托本模块 loadSkill。legacy soul.md / duties/*.md 已物理删除。
 * P9c (2026-05-24) 上提到 ai-engine,通用化:caller 传 agentsRootDir。
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
 * 加载 + 解析某 agent 的 SKILL.md。
 *
 * P9c (2026-05-24):loader 上提到 ai-engine/skills/loader 后通用化:
 * caller 必须传 `agentsRootDir`(各 app 自己的 mission/agents 绝对路径或 module
 * 相对 __dirname),不再在 loader 内拼路径。
 *
 * @param agentDir 子目录名(如 "leader" / "researcher")
 * @param agentsRootDir agents 根目录绝对路径(caller 用 path.resolve(__dirname, ...) 算)
 */
export function loadSkill(
  agentDir: string,
  agentsRootDir: string,
): ParsedSkill {
  const cacheKey = `${agentsRootDir}::${agentDir}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const filePath = path.resolve(agentsRootDir, agentDir, "SKILL.md");
  if (!fs.existsSync(filePath)) {
    throw new Error(`SKILL.md not found: ${filePath} (agent=${agentDir})`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseSkill(raw);
  cache.set(cacheKey, parsed);
  return parsed;
}

/** 测试用 */
export function clearSkillCache(): void {
  cache.clear();
}

/**
 * 解析 SKILL.md 文本（exposed 给 spec 直接验证 byte-equal）。
 */
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

/**
 * 抽取 soul 段：<!-- soul:start --> ... <!-- soul:end --> 之间的内容；
 * 不包含包裹注释；首尾 trim 一行。
 */
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
        `[skill-md] duty "${name}" listed in frontmatter but body has no <!-- duty:${name}:start --> block`,
      );
    }
    out[name] = m[1];
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 极简 YAML frontmatter 解析（仅支持本 skill 用到的字段类型：
 *   string / inline array / boolean / number）。
 *
 * 不依赖 js-yaml，避免新增 runtime 依赖。完整 YAML 写复杂结构请改 duties block。
 */
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
      // inline array：[a, b, "c"]
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
    throw new Error("[skill-md] frontmatter missing required field: id");
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
