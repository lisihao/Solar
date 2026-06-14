import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "../..");
const modulesRoot = path.join(repoRoot, "src", "modules");
const targets = ["ai-infra", "ai-engine", "ai-harness"] as const;

const allowedNames = new Set([
  "index.ts",
  "README.md",
  "SKILL.md",
  "integration.md",
  "python-sandbox.py",
  "types.ts",
]);
const allowedRoleTokens = [
  "module",
  "service",
  "controller",
  "dto",
  "pipe",
  "types",
  "interface",
  "adapter",
  "strategy",
  "exception",
  "provider",
  "registry",
  "guard",
  "policy",
  "catalog",
  "checker",
  "validator",
  "tool",
  "utils",
  "factory",
  "manager",
  "coordinator",
  "orchestrator",
  "tracker",
  "parser",
  "sanitizer",
  "wrapper",
  "balancer",
  "filter",
  "calculator",
  "replayer",
  "middleware",
  "tokens",
  "token",
  "mapping",
  "context",
  "config",
  "constants",
  "error",
  "errors",
  "listener",
  "scheduler",
  "store",
  "exports",
  "facade",
  "base",
  "protocol",
  "profile",
  "loop",
  "executor",
  "reviewer",
  "selector",
  "planner",
  "router",
  "identity",
  "envelope",
  "classifier",
  "client",
  "detector",
  "logger",
  "loader",
  "activator",
  "learner",
  "scanner",
  "judge",
  "consensus",
  "handle",
  "classes",
  "abstractions",
  "monitor",
  "runner",
  "check",
  "chunker",
  "pipeline",
  "agent",
  "skill",
  "member",
  "role",
  "team",
  "workflow",
  "template",
  "prompt",
  "engine",
  "limiter",
  "indexer",
  "bus",
  "accountant",
  "pool",
  "environment",
  "isolation",
  "spawner",
  "compactor",
  "pruner",
  "estimator",
  "invoker",
  "breaker",
  "fusion",
  "tracer",
  "exporter",
  "conventions",
];
const allowedRoleSuffixPattern = new RegExp(
  String.raw`(?:[.-])(?:${allowedRoleTokens.join("|")})\.ts$`,
);

const bannedNamePatterns = [
  /\.util\.ts$/,
  /\.interfaces\.ts$/,
  /(?:^|[-_.])supplemental(?:[-_.]|$)/i,
  /(?:^|[-_.])legacy(?:[-_.]|$)/i,
  /(?:^|[-_.])additional(?:[-_.]|$)/i,
  /(?:^|[-_.])compat(?:[-_.]|$)/i,
  /(?:^|[-_.])temp(?:[-_.]|$)/i,
  /(?:^|[-_.])custom(?:[-_.]|$)/i,
  /(?:^|[-_.])bridge(?:[-_.]|$)/i,
  /adapter\.adapter\.ts$/,
];

const suspiciousDomainTerms = [
  "topic-insights",
  "deep-research",
  "ai-office",
  "slides",
  "social",
  "feedback",
  "mission completion",
  "writing",
  "research project",
  "office documents",
];

const contentIgnoreNeedles = [
  "sediment from",
  "来源:",
  "历史路径",
  "shim",
  "compat",
  "provenance",
];

type Finding = {
  layer: string;
  relPath: string;
  filenameStatus: "ok" | "flagged";
  contentStatus: "ok" | "suspicious";
  reasons: string[];
};

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "__tests__" ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      listFiles(full, acc);
      continue;
    }
    acc.push(full);
  }
  return acc;
}

function isProductionFile(filePath: string): boolean {
  return !filePath.includes(`${path.sep}__tests__${path.sep}`);
}

function hasAllowedFilename(name: string): boolean {
  if (allowedNames.has(name)) return true;
  return allowedRoleSuffixPattern.test(name);
}

function auditFile(layer: string, filePath: string): Finding {
  const relPath = path.relative(modulesRoot, filePath).replace(/\\/g, "/");
  const name = path.basename(filePath);
  const reasons: string[] = [];

  if (!hasAllowedFilename(name)) {
    reasons.push("filename-not-in-allowed-families");
  }

  for (const pattern of bannedNamePatterns) {
    if (pattern.test(name)) {
      reasons.push(`banned-name-pattern:${pattern}`);
    }
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lowered = raw.toLowerCase();
  const shouldIgnoreContentTerms = contentIgnoreNeedles.some((needle) =>
    lowered.includes(needle),
  );
  for (const term of suspiciousDomainTerms) {
    if (!shouldIgnoreContentTerms && lowered.includes(term)) {
      reasons.push(`suspicious-domain-term:${term}`);
      break;
    }
  }

  const upwardImportPattern =
    /\b(?:from|import)\s*["'][^"']*(?:\.\.\/)+ai-app[^"']*["']/;
  const aliasedUpwardImportPattern = /["']@\/modules\/ai-app(?:\/[^"']*)?["']/;
  if (
    upwardImportPattern.test(raw) ||
    aliasedUpwardImportPattern.test(raw)
  ) {
    reasons.push("upward-ai-app-reference");
  }

  const filenameStatus = reasons.some((r) =>
    r.startsWith("filename") || r.startsWith("banned-name-pattern"),
  )
    ? "flagged"
    : "ok";

  const contentStatus = reasons.some(
    (r) => r.startsWith("suspicious-domain-term") || r === "upward-ai-app-reference",
  )
    ? "suspicious"
    : "ok";

  return { layer, relPath, filenameStatus, contentStatus, reasons };
}

function main() {
  const findings: Finding[] = [];

  for (const layer of targets) {
    const root = path.join(modulesRoot, layer);
    for (const filePath of listFiles(root)) {
      if (!isProductionFile(filePath)) continue;
      if (!/\.(ts|md|py)$/.test(filePath)) continue;
      findings.push(auditFile(layer, filePath));
    }
  }

  const flagged = findings.filter(
    (f) => f.filenameStatus === "flagged" || f.contentStatus === "suspicious",
  );

  const summary = {
    totalProductionFiles: findings.length,
    flaggedFiles: flagged.length,
    byLayer: Object.fromEntries(
      targets.map((layer) => [
        layer,
        {
          total: findings.filter((f) => f.layer === layer).length,
          flagged: flagged.filter((f) => f.layer === layer).length,
        },
      ]),
    ),
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  for (const finding of flagged) {
    console.log(
      `${finding.relPath} | filename=${finding.filenameStatus} | content=${finding.contentStatus} | ${finding.reasons.join(", ")}`,
    );
  }
}

main();
