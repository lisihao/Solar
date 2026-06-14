/**
 * RuntimePromptRouter — 中央 prompt 表 + A/B 路由 + 版本管理
 *
 * 职责：
 *   - register(template) 注册一个版本
 *   - resolve(id, ctx) 按 ctx.userId hash 选 variant，返回 PromptTemplate
 *   - history(id) 列出某 id 的所有版本
 *   - rollback(id, version) 回滚到指定版本（删除所有更新版本）
 *
 * A/B 路由：同一 id 多 variant；按 weight 分流；userId hash 一致性保证同用户固定 variant。
 */

import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { PromptTemplate } from "./prompt-template";

interface RegistryEntry {
  template: PromptTemplate;
  registeredAt: number;
}

@Injectable()
export class RuntimePromptRouter {
  private readonly log = new Logger(RuntimePromptRouter.name);
  /** key = `${id}@${version}@${variant ?? 'default'}` */
  private readonly entries = new Map<string, RegistryEntry>();
  /** index: id → list of variants/versions */
  private readonly byId = new Map<string, string[]>();
  /** active version per id (newest registered) */
  private readonly activeVersion = new Map<string, string>();

  register(template: PromptTemplate): void {
    const key = this.makeKey(template.id, template.version, template.variant);
    if (this.entries.has(key)) {
      this.log.warn(
        `Prompt ${key} already registered (checksum=${template.checksum}) — overwriting`,
      );
    }
    this.entries.set(key, { template, registeredAt: Date.now() });
    const list = this.byId.get(template.id) ?? [];
    if (!list.includes(key)) list.push(key);
    this.byId.set(template.id, list);
    this.activeVersion.set(template.id, template.version);
  }

  /** 取一个具体版本 */
  getExact(
    id: string,
    version: string,
    variant?: string,
  ): PromptTemplate | undefined {
    const key = this.makeKey(id, version, variant);
    return this.entries.get(key)?.template;
  }

  /**
   * 解析 —— 返回 (id, ctx) 应用的最佳 template。
   * 多 variant 时按 ctx.userId hash 分流（一致性 hashing）。
   */
  resolve(
    id: string,
    ctx?: { userId?: string; forceVersion?: string; forceVariant?: string },
  ): PromptTemplate | undefined {
    const version = ctx?.forceVersion ?? this.activeVersion.get(id);
    if (!version) return undefined;
    const all = (this.byId.get(id) ?? [])
      .map((k) => this.entries.get(k)!.template)
      .filter((t) => t.version === version);
    if (all.length === 0) return undefined;
    if (all.length === 1) return all[0];
    if (ctx?.forceVariant) {
      return all.find((t) => t.variant === ctx.forceVariant) ?? all[0];
    }
    // A/B 路由 —— hash userId，按 weight 分流
    if (!ctx?.userId) return all[0];
    const totalWeight = all.reduce((a, b) => a + b.weight, 0);
    if (totalWeight === 0) return all[0];
    const h = parseInt(
      createHash("md5").update(`${id}|${ctx.userId}`).digest("hex").slice(0, 8),
      16,
    );
    const bucket = h % totalWeight;
    let acc = 0;
    for (const t of all) {
      acc += t.weight;
      if (bucket < acc) return t;
    }
    return all[all.length - 1];
  }

  history(id: string): readonly PromptTemplate[] {
    // 建议修 #4: history 排序也走 semver
    return (this.byId.get(id) ?? [])
      .map((k) => this.entries.get(k)!.template)
      .sort((a, b) => compareSemver(a.version, b.version));
  }

  rollback(id: string, version: string): void {
    const all = this.byId.get(id);
    if (!all) return;
    const remaining = all.filter((k) => {
      const t = this.entries.get(k)!.template;
      // 建议修 #4: semver 数值比较替换字符串字典序
      if (compareSemver(t.version, version) > 0) {
        this.entries.delete(k);
        return false;
      }
      return true;
    });
    this.byId.set(id, remaining);
    this.activeVersion.set(id, version);
  }

  private makeKey(id: string, version: string, variant?: string): string {
    return `${id}@${version}@${variant ?? "default"}`;
  }
}

/**
 * 简易 semver 比较 —— 仅支持 major.minor.patch 数值；不支持 pre-release / build。
 * GenesisPod 内部用，不引第三方 semver 库省 bundle。
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
