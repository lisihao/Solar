/**
 * ManifestValidator — 启动期 manifest 校验（v5.1 §11.8 / standards/19）
 *
 * 三类校验：
 *   1. schema 校验：必填字段、类型、enum 取值
 *   2. capability ↔ hooks 一致性：声明监听某 hook 必须声明对应 capability
 *   3. coreVersionRange 兼容性（v5.1 MED-2 fail-fast）
 *
 * 不依赖 zod，避免 plugins/core 引入大依赖；用纯 TS validation。
 */
import { PLUGIN_CATEGORIES } from "../abstractions/plugin.interface";
import type { IPluginManifest } from "../abstractions/plugin.interface";
import { PluginIncompatibleCoreError } from "../abstractions/hook-context.interface";
import type { PluginCapability } from "../abstractions/plugin-capability.types";

export class ManifestValidationError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly issues: string[],
  ) {
    super(
      `[ManifestValidator] plugin ${pluginId} manifest invalid: ${issues.join("; ")}`,
    );
    this.name = "ManifestValidationError";
  }
}

const STABILITY_VALUES = new Set(["stable", "experimental", "internal"]);
const PHASE_VALUES = new Set(["bootstrap", "runtime"]);
const SIG_ALG = new Set(["ed25519", "rsa-sha256"]);

const SEMVER_RANGE_PATTERN = /^[\^~>=<\s\d.*x|\-\sa-z]+$/i;

export class ManifestValidator {
  /**
   * 全套校验：返回 issues 列表（空表示通过）
   */
  validate(manifest: IPluginManifest, currentCoreVersion: string): void {
    const issues: string[] = [];

    if (!manifest.id || typeof manifest.id !== "string") {
      issues.push("id is required (string)");
    }
    if (!manifest.version || !this.isValidSemver(manifest.version)) {
      issues.push("version must be valid semver (x.y.z)");
    }
    if (
      !manifest.coreVersionRange ||
      !SEMVER_RANGE_PATTERN.test(manifest.coreVersionRange)
    ) {
      issues.push("coreVersionRange must be a semver range");
    }
    if (!manifest.description) {
      issues.push("description required");
    }
    if (!PLUGIN_CATEGORIES.includes(manifest.category)) {
      issues.push(
        `category must be one of: ${PLUGIN_CATEGORIES.join(",")}; got "${manifest.category}"`,
      );
    }
    if (!STABILITY_VALUES.has(manifest.stability)) {
      issues.push(
        `stability must be stable|experimental|internal; got "${manifest.stability}"`,
      );
    }
    if (!PHASE_VALUES.has(manifest.phase)) {
      issues.push(`phase must be bootstrap|runtime; got "${manifest.phase}"`);
    }
    if (typeof manifest.required !== "boolean") {
      issues.push("required must be boolean");
    }
    if (!Array.isArray(manifest.hooks)) {
      issues.push("hooks must be array");
    }
    if (!Array.isArray(manifest.capabilities)) {
      issues.push("capabilities must be array");
    }
    if (manifest.signature) {
      const sig = manifest.signature;
      if (!sig.issuer || !sig.sig || !SIG_ALG.has(sig.algorithm)) {
        issues.push(
          `signature must have issuer, sig, algorithm in ${[...SIG_ALG].join("|")}`,
        );
      }
    }

    // capability ↔ hooks 一致性
    if (Array.isArray(manifest.hooks) && Array.isArray(manifest.capabilities)) {
      const capIssues = this.checkCapabilityConsistency(manifest);
      issues.push(...capIssues);
    }

    if (issues.length > 0) {
      throw new ManifestValidationError(manifest.id ?? "<unknown>", issues);
    }

    // coreVersionRange 兼容性（v5.1 MED-2: 不兼容一律 fail-fast）
    if (
      !this.satisfiesCoreVersion(manifest.coreVersionRange, currentCoreVersion)
    ) {
      throw new PluginIncompatibleCoreError(
        manifest.id,
        manifest.coreVersionRange,
        currentCoreVersion,
      );
    }
  }

  /**
   * capability ↔ hooks 一致性：plugin 监听某 hook 必须声明对应 hook capability
   *
   * 当前规则（最小可执行）：
   * - 声明 hook 监听必须有 hook:<hookId> capability（细粒度授权）
   * - 容忍：未声明 capability 也可监听 hook（生产应改为 strict）
   *
   * v5.1 文档表态：启动期校验 capability ↔ hooks 一致性。这里实现为
   * "manifest.hooks 中的每个 hook 应在 capabilities 列出 hook:<id>"，
   * 但允许覆盖 capability ⊇ hooks（声明了 hook capability 但 hooks 数组没列）。
   */
  private checkCapabilityConsistency(manifest: IPluginManifest): string[] {
    const issues: string[] = [];
    const capSet = new Set<string>(manifest.capabilities);
    for (const hookId of manifest.hooks) {
      const required: PluginCapability = `hook:${hookId}`;
      if (!capSet.has(required)) {
        issues.push(
          `hook "${hookId}" missing capability declaration "${required}"`,
        );
      }
    }
    return issues;
  }

  /** 简化版 semver range 满足性判断（覆盖 ^x.y.z / ~x.y.z / x.y.z / >=x.y.z）*/
  satisfiesCoreVersion(range: string, version: string): boolean {
    const r = range.trim();
    const v = this.parseSemver(version);
    if (!v) return false;

    // ^x.y.z: 允许同 major
    let match = /^\^(\d+)\.(\d+)\.(\d+)/.exec(r);
    if (match) {
      const [, M, m, p] = match;
      const minMaj = +M;
      return (
        v.major === minMaj &&
        (v.minor > +m || (v.minor === +m && v.patch >= +p))
      );
    }
    // ~x.y.z: 允许同 major.minor
    match = /^~(\d+)\.(\d+)\.(\d+)/.exec(r);
    if (match) {
      const [, M, m, p] = match;
      return v.major === +M && v.minor === +m && v.patch >= +p;
    }
    // >=x.y.z
    match = /^>=\s*(\d+)\.(\d+)\.(\d+)/.exec(r);
    if (match) {
      const [, M, m, p] = match;
      const minNum = +M * 1_000_000 + +m * 1_000 + +p;
      const vNum = v.major * 1_000_000 + v.minor * 1_000 + v.patch;
      return vNum >= minNum;
    }
    // 精确匹配 x.y.z
    match = /^(\d+)\.(\d+)\.(\d+)$/.exec(r);
    if (match) {
      const [, M, m, p] = match;
      return v.major === +M && v.minor === +m && v.patch === +p;
    }
    // 通配符 *
    if (r === "*") return true;

    return false;
  }

  private parseSemver(
    v: string,
  ): { major: number; minor: number; patch: number } | null {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3] };
  }

  private isValidSemver(v: string): boolean {
    return /^\d+\.\d+\.\d+/.test(v);
  }
}
