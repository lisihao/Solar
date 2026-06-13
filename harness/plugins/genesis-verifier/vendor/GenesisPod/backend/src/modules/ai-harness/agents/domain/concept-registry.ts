/**
 * DomainConceptRegistry — 业务概念中央目录
 *
 * 业务模块（业务模块（如 X/Y/Z））启动时调
 * registry.register({ id: '{app}.topic', ...spec })。
 *
 * Harness Loop 通过 conceptId 反查 spec，能：
 *   - 自动生成 prompt 中的 "## Available concepts" 段落
 *   - 校验业务方 enqueueTask 时引用的 concept 是否存在
 *   - 跨 AI App 复用：research 模块也能用 {app}.topic
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DomainConceptSpec } from "./concept.types";

@Injectable()
export class DomainConceptRegistry {
  private readonly log = new Logger(DomainConceptRegistry.name);
  private readonly concepts = new Map<string, DomainConceptSpec>();

  register(spec: DomainConceptSpec): void {
    if (this.concepts.has(spec.id)) {
      const existing = this.concepts.get(spec.id);
      const msg =
        `Concept "${spec.id}" already registered by module "${existing?.moduleId}" ` +
        `— cannot re-register from "${spec.moduleId}". Concept ids are global and must be unique.`;
      // 建议修 #8: dev 环境抛错（早暴露），生产 warn（防 init 顺序问题宕机）
      if (process.env.NODE_ENV !== "production") {
        throw new Error(msg);
      }
      this.log.warn(`${msg} (overwriting in production for safety)`);
    }
    this.concepts.set(spec.id, spec);
  }

  registerAll(specs: readonly DomainConceptSpec[]): void {
    for (const s of specs) this.register(s);
  }

  get(id: string): DomainConceptSpec | undefined {
    return this.concepts.get(id);
  }

  has(id: string): boolean {
    return this.concepts.has(id);
  }

  list(): readonly DomainConceptSpec[] {
    return [...this.concepts.values()];
  }

  listByModule(moduleId: string): readonly DomainConceptSpec[] {
    return this.list().filter((c) => c.moduleId === moduleId);
  }

  /**
   * 给 LLM 用的精简描述 —— 注入到 system prompt。
   * 例：业务方让 agent 知道当前 mission 涉及哪些 concept。
   */
  describeForLLM(conceptIds: readonly string[]): string {
    const specs = conceptIds
      .map((id) => this.concepts.get(id))
      .filter((s): s is DomainConceptSpec => s !== undefined);
    if (specs.length === 0) return "(no domain concepts)";
    return specs
      .map((s) => {
        const fields = s.fields
          .map((f) => `${f.name}:${f.type}${f.required ? "*" : ""}`)
          .join(", ");
        return `- ${s.id} (${s.displayName}): ${s.description}\n  fields: ${fields}`;
      })
      .join("\n");
  }
}
