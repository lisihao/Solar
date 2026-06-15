/**
 * IBroadcastAdapter — 业务事件落地协议
 *
 * Harness 内置 LoggerBroadcastAdapter（默认）；业务方实现：
 *   - SocketIoBroadcastAdapter ({app} gateway)
 *   - SseBroadcastAdapter
 *   - WebhookBroadcastAdapter
 *   - KafkaBroadcastAdapter
 *
 * Adapter 接收 DomainEvent 流，自行决定如何分发（房间过滤、ack、persist 等）。
 *
 * 事件去重 / 节流由 EventBus 在 emit 前完成；adapter 只负责传输。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "./domain-event.types";

export interface IBroadcastAdapter {
  readonly id: string;
  /** 是否处理此事件（按 type 前缀 / scope 决定） */
  accepts(event: DomainEvent): boolean;
  /** 实际广播 —— 失败抛错，由 Bus 统一吞掉（不影响主流程） */
  broadcast(event: DomainEvent): Promise<void>;
}

@Injectable()
export class LoggerBroadcastAdapter implements IBroadcastAdapter {
  readonly id = "logger";
  private readonly log = new Logger("DomainEvent");

  accepts(): boolean {
    return true;
  }

  async broadcast(event: DomainEvent): Promise<void> {
    this.log.debug(
      `[${event.type}] scope=${JSON.stringify(event.scope)} agent=${event.agentId ?? "-"}`,
    );
  }
}
