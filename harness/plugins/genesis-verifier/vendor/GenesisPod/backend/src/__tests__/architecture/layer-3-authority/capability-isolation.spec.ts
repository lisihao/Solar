/**
 * 能力即产品（Capability-as-Product）隔离看护
 *
 * 据 docs/architecture/capability-execution-architecture.md 的铁律 R1/R3 + telemetry 契约：
 *
 *   R1（能力层零 app import）：marketplace/capabilities/** 非测试源码不得 import 任何
 *     app 业务目录（playground/company/insight/teams/writing），也不得直连 app DB
 *     （prisma.service / @prisma/client runtime）。能力内核执行期只依赖 harness/engine
 *     facade + 共享 agent + 三端口（中间态走 CrossStageState，落库经 MissionPersistencePort）。
 *
 *   R3（消费方只经端口）：company 不得 import 具体能力 runner 实现类
 *     （DeepInsightDefaultRunner 等），只能经 ICapabilityRunner / CapabilityRegistry。
 *
 *   telemetry 契约：CapabilityRunEvent 必须含 telemetry.systemStageId（14-chip 点亮锚点），
 *     防止字段被改名后前端静默失联。
 *
 * 与 ESLint belt-and-suspenders：本 spec 不依赖 lint config，覆盖动态 import / 注释逃逸，
 * 跑在 verify:arch + pre-push + CI。ESLint IDE 规则后续非破坏性接入（避免 clobber 既有
 * ai-app→facade override）。
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../..");
const CAPABILITIES_DIR = path.join(
  SRC_ROOT,
  "modules/ai-app/marketplace/capabilities",
);
const COMPANY_DIR = path.join(SRC_ROOT, "modules/ai-app/company");
const PORT_FILE = path.join(
  SRC_ROOT,
  "modules/ai-app/marketplace/capability/capability-runner.port.ts",
);

/** 递归列 .ts 源文件（排除测试 / 声明文件）。 */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ["__tests__", "node_modules", "dist", "coverage"].includes(entry.name)
      )
        continue;
      listTsFiles(full, acc);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** 抽出文件里所有 import/require/dynamic-import 的模块路径字符串。 */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:import\s[^;]*?from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

/** 禁止的 app 业务目录（能力层不得 import）。 */
const BANNED_APP_PATTERNS = [
  /ai-app\/playground\//,
  /ai-app\/company\//,
  /ai-app\/insight\//,
  /ai-app\/teams\//,
  /ai-app\/writing\//,
];
/** 禁止的 app DB 直连（能力内核执行期零 app DB）。 */
const BANNED_DB_PATTERNS = [/prisma\.service/, /@prisma\/client\/runtime/];

describe("capability isolation (能力即产品 R1/R3 + telemetry 契约)", () => {
  it("R1: capabilities/** 非测试源码零 app 业务 import", () => {
    const files = listTsFiles(CAPABILITIES_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (BANNED_APP_PATTERNS.some((p) => p.test(spec))) {
          violations.push(
            `${path.relative(SRC_ROOT, file)} → import "${spec}"`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("R1: capabilities/** 非测试源码零 app DB 直连", () => {
    const files = listTsFiles(CAPABILITIES_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (BANNED_DB_PATTERNS.some((p) => p.test(spec))) {
          violations.push(
            `${path.relative(SRC_ROOT, file)} → import "${spec}"`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("R3: company 不直接 import 具体能力 runner 实现（只经 ICapabilityRunner/Registry）", () => {
    const files = listTsFiles(COMPANY_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        // 具体 runner 实现文件（…/capabilities/<cap>/*.runner）禁止被消费方直 import。
        if (/capabilities\/[^"']*\.runner/.test(spec)) {
          violations.push(
            `${path.relative(SRC_ROOT, file)} → import "${spec}"`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("telemetry 契约：CapabilityRunEvent 含 telemetry.systemStageId（14-chip 锚点防漂移）", () => {
    const src = fs.readFileSync(PORT_FILE, "utf8");
    expect(src).toMatch(/telemetry\?:/);
    expect(src).toMatch(/systemStageId\?:/);
    // MissionPersistencePort 在通用 capability 层（非具体能力私有）
    expect(src).toMatch(/interface MissionPersistencePort/);
  });
});
