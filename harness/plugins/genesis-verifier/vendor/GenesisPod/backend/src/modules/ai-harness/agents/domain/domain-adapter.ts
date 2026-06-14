/**
 * IDomainAdapter — 业务概念 ↔ Prisma 行的转换协议
 *
 * 业务方实现 IDomainAdapter<T>，注册到 DomainAdapterRegistry。
 * Harness Loop 拿到 DomainEntity 时通过 adapter.fetch(id) / .save(entity) 落库。
 *
 * 这层抽象让 Harness 能"读写业务表"而不直接知道 Prisma model，
 * 同时业务方保留对 schema / 事务 / 软删除等细节的完全控制。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DomainEntity } from "./concept.types";

export interface IDomainAdapter<TData = Record<string, unknown>> {
  /** 关联的 concept id */
  readonly conceptId: string;
  /** 拉取一个实体 */
  fetch(id: string): Promise<DomainEntity<TData> | null>;
  /** 持久化一个实体（业务方处理 create vs update） */
  save(entity: DomainEntity<TData>): Promise<void>;
  /** 按 query 列出实体（业务方决定 query DSL） */
  list?(
    query: Record<string, unknown>,
  ): Promise<readonly DomainEntity<TData>[]>;
  /** 删除实体（可选；业务方可不实现） */
  delete?(id: string): Promise<void>;
}

@Injectable()
export class DomainAdapterRegistry {
  private readonly log = new Logger(DomainAdapterRegistry.name);
  private readonly byConceptId = new Map<string, IDomainAdapter<unknown>>();

  register<TData>(adapter: IDomainAdapter<TData>): void {
    if (this.byConceptId.has(adapter.conceptId)) {
      const msg = `Adapter for "${adapter.conceptId}" already registered`;
      // 建议修 #8: dev 抛错，生产 warn
      if (process.env.NODE_ENV !== "production") {
        throw new Error(`${msg}. Adapters per concept must be unique.`);
      }
      this.log.warn(`${msg} — overwriting in production for safety`);
    }
    this.byConceptId.set(adapter.conceptId, adapter as IDomainAdapter<unknown>);
  }

  get<TData>(conceptId: string): IDomainAdapter<TData> | undefined {
    return this.byConceptId.get(conceptId) as IDomainAdapter<TData> | undefined;
  }

  has(conceptId: string): boolean {
    return this.byConceptId.has(conceptId);
  }

  list(): readonly string[] {
    return [...this.byConceptId.keys()];
  }
}
