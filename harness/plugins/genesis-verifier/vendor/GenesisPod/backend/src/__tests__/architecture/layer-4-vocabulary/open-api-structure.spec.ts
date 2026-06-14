/**
 * standards/24 Open API 目录结构看护（2026-06-03 信任边界 MECE 重组后）
 *
 * 单轴 = 调用方信任边界。顶层 4 区：
 *   external/ 非第一方（API-key/协议/签名）· a2a / mcp / rest / webhooks
 *   admin/    第一方运营（AdminGuard）· 仅【跨域/平台级】治理（单域治理须 sink-to-domain）
 *   system/   平台基建/握手 · 零业务 · auth / metrics
 *   user/     第一方登录用户（JWT）· 跨域通用能力 · credits / notifications / agents / skills / ai
 *
 * 看护铁律：
 *   律1 admin 唯一：所有 `@Controller('admin/...')` 必须在 open-api/admin/ 下。
 *   律2 顶层 4 区：open-api 顶层目录 ∈ {external, admin, system, user}（+ 收缩 allowlist 跟踪 T3 残留）。
 *   律2-sub 区内子目录受控：external/system/user 各自子目录 ∈ 白名单。
 *   律2b admin 文件名禁冗余 `-admin` 后缀（目录已表达 admin 身份）。
 *   律3 admin 仅跨域/平台级：禁含任一产品域目录（research/knowledge/teams/... 单域治理须下沉 ai-app）。
 *   律4 薄网关：open-api controller 不得直接注入 PrismaService。
 *
 * 每条用**收缩 ALLOWLIST** 跟踪存量违规：搬一个删一行，清空即硬焊。新增违规即红。
 * 过期条目（已整改但还列着）走软告警，不硬失败（避免与并发整改竞态）。
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../..");
const OA = path.join(SRC_ROOT, "modules/open-api");

function listTs(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === "__tests__" ||
        e.name === "node_modules" ||
        e.name === "dist"
      )
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
const rel = (f: string) => path.relative(SRC_ROOT, f).replace(/\\/g, "/");

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "__tests__")
    .map((e) => e.name)
    .sort();
}

// ── 律2 顶层 4 区（信任边界）──
const TOP_LEVEL_ZONES = ["external", "admin", "system", "user"];
// 收缩 allowlist：T3 跨层下沉未落地的残留顶层目录（搬一个删一行，清空即硬焊）
const TOP_LEVEL_ALLOWLIST = []; // T3 已落地：teams/ 已下沉 ai-app/teams（顶层 4 区硬焊）

// ── 律2-sub 区内子目录白名单 ──
const EXTERNAL_CHILDREN = ["a2a", "mcp", "rest", "webhooks"];
const SYSTEM_CHILDREN = ["auth", "metrics"];
const USER_CHILDREN = [
  "agents",
  "skills",
  "ai",
  "credits",
  "notifications",
  "byok",
  "workspace",
];

// ── 律3 admin 禁含产品域（单域治理须 sink-to-domain）──
const PRODUCT_DOMAINS = [
  "research",
  "writing",
  "ask",
  "image",
  "social",
  "simulation",
  "office",
  "explore",
  "insight",
  "custom-agents",
  "library",
  "feedback",
  "planning",
  "radar",
  "playground",
  "knowledge",
  "teams",
];
// 收缩 allowlist：T3 未下沉的 admin 单域治理目录
const ADMIN_DOMAIN_ALLOWLIST = []; // T3 已落地：research/knowledge/teams 已下沉 ai-app（admin 仅跨域硬焊）

// ── 律1 admin 散落 ──
// T3 下沉：单域 admin 控制器随域落 ai-app，保留 admin/* 路由 URL（非破坏）。
// 「单域治理归域」与「admin 路由收口」的权衡——路由 URL 不变，物理归域。
const ADMIN_SCATTER_ALLOWLIST = [
  "modules/ai-app/research/research-template.controller.ts", // route admin/research/templates
  "modules/ai-app/library/knowledge-graph/knowledge-admin.controller.ts", // route admin/knowledge
  "modules/ai-app/teams/controllers/ai-teams-admin.controller.ts", // route admin/ai-teams
  "modules/open-api/user/byok/authorization.controller.ts", // route admin/authorization (co-located w/ user/authorization in byok)
];

// ── 律4 薄网关（Prisma in controller）──
const THIN_GATEWAY_ALLOWLIST = []; // 清零：byok 2 个厚 controller 已下沉 UserByokService / UserProvidersService

function softStaleWarn(name: string, allowlist: string[], actual: string[]) {
  const stale = allowlist.filter((a) => !actual.includes(a));
  if (stale.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[std24:${name}] ALLOWLIST 过期条目（已整改，请删行）：\n  ${stale.join("\n  ")}`,
    );
  }
  // eslint-disable-next-line no-console
  console.info(`[std24:${name}] 剩余违规 ${actual.length} 个`);
}

describe("standards/24 · Open API 目录结构（信任边界 MECE）", () => {
  it("律1：所有 admin/* 路由唯一在 open-api/admin/（散落即红）", () => {
    const offenders = listTs(OA)
      .filter((f) =>
        /@Controller\(\s*['"]admin\//.test(fs.readFileSync(f, "utf-8")),
      )
      .map(rel)
      .filter((r) => !r.startsWith("modules/open-api/admin/"))
      .sort();
    softStaleWarn("admin-cohesion", ADMIN_SCATTER_ALLOWLIST, offenders);
    expect(
      offenders.filter((o) => !ADMIN_SCATTER_ALLOWLIST.includes(o)),
    ).toEqual([]);
  });

  it("律2：open-api 顶层目录 ∈ {external, admin, system, user}（信任边界 4 区）", () => {
    const dirs = listDirs(OA);
    const offenders = dirs.filter((d) => !TOP_LEVEL_ZONES.includes(d));
    softStaleWarn("top-level-zones", TOP_LEVEL_ALLOWLIST, offenders);
    expect(offenders.filter((o) => !TOP_LEVEL_ALLOWLIST.includes(o))).toEqual(
      [],
    );
  });

  it("律2-sub：external 子目录 ∈ {a2a, mcp, rest, webhooks}", () => {
    expect(
      listDirs(path.join(OA, "external")).filter(
        (d) => !EXTERNAL_CHILDREN.includes(d),
      ),
    ).toEqual([]);
  });

  it("律2-sub：system 零业务（子目录 ∈ {auth, metrics}）", () => {
    expect(
      listDirs(path.join(OA, "system")).filter(
        (d) => !SYSTEM_CHILDREN.includes(d),
      ),
    ).toEqual([]);
  });

  it("律2-sub：user 跨域通用能力（子目录 ∈ {agents, skills, ai, credits, notifications}）", () => {
    expect(
      listDirs(path.join(OA, "user")).filter((d) => !USER_CHILDREN.includes(d)),
    ).toEqual([]);
  });

  it("律3：admin 仅跨域/平台级 —— 禁含产品域目录（单域治理须 sink-to-domain）", () => {
    const present = listDirs(path.join(OA, "admin")).filter((d) =>
      PRODUCT_DOMAINS.includes(d),
    );
    softStaleWarn("admin-no-domain", ADMIN_DOMAIN_ALLOWLIST, present);
    expect(present.filter((d) => !ADMIN_DOMAIN_ALLOWLIST.includes(d))).toEqual(
      [],
    );
  });

  it("律2b：open-api/admin 下控制器文件名禁带冗余 -admin 后缀（目录已表达 admin 身份）", () => {
    const offenders = listTs(path.join(OA, "admin"))
      .filter((file) => /-admin.controller.ts$/.test(file))
      .map(rel)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("律4：open-api controller 不得直接注入 PrismaService（薄网关）", () => {
    const offenders = listTs(OA)
      .filter((f) => f.endsWith(".controller.ts"))
      .filter((f) => /\bPrismaService\b/.test(fs.readFileSync(f, "utf-8")))
      .map(rel)
      .sort();
    softStaleWarn("thin-gateway", THIN_GATEWAY_ALLOWLIST, offenders);
    expect(
      offenders.filter((o) => !THIN_GATEWAY_ALLOWLIST.includes(o)),
    ).toEqual([]);
  });
});
