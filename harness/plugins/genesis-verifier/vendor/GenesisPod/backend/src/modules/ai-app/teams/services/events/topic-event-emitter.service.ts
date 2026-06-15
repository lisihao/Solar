/**
 * TopicEventEmitter Service
 *
 * Breaks circular dependency between AiTeamsGateway and AiResponseService.
 * Gateway registers its emit function here, services use this to emit events.
 * Also emits events through NestJS EventEmitter2 for Webhook integration.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

export type TopicEmitHandler = (
  topicId: string,
  event: string,
  data: unknown,
) => Promise<void>;

@Injectable()
export class TopicEventEmitterService {
  private readonly logger = new Logger(TopicEventEmitterService.name);
  private emitHandler?: TopicEmitHandler;

  constructor(@Optional() private eventEmitter?: EventEmitter2) {}

  /**
   * Register the emit handler (called by AiTeamsGateway)
   */
  registerEmitHandler(handler: TopicEmitHandler): void {
    this.emitHandler = handler;
    this.logger.log("Topic emit handler registered");
  }

  /**
   * Emit an event to a topic (called by services)
   */
  async emitToTopic(
    topicId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    // Emit via WebSocket handler
    if (this.emitHandler) {
      try {
        await this.emitHandler(topicId, event, data);
      } catch (error) {
        this.logger.error(`Failed to emit WebSocket event ${event}:`, error);
      }
    }

    // Also emit via NestJS EventEmitter2 for Webhook integration
    if (this.eventEmitter) {
      try {
        this.eventEmitter.emit(event, {
          topicId,
          ...this.normalizeEventData(data),
        });
      } catch (error) {
        this.logger.error(`Failed to emit EventEmitter event ${event}:`, error);
      }
    }
  }

  /**
   * Emit topic-level events (for Webhook integration)
   * These events match the WebhookEventType enum
   */
  emitTopicEvent(eventType: string, payload: Record<string, unknown>): void {
    if (this.eventEmitter) {
      this.eventEmitter.emit(eventType, payload);
    }
  }

  /**
   * Normalize event data to plain object
   */
  private normalizeEventData(data: unknown): Record<string, unknown> {
    if (data === null || data === undefined) {
      return {};
    }
    if (typeof data === "object") {
      return data as Record<string, unknown>;
    }
    return { value: data };
  }
}
