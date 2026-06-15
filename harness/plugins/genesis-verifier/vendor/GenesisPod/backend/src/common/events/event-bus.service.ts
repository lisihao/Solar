/**
 * EventBus Service
 *
 * Unified event bus for cross-module communication.
 * Helps break circular dependencies by decoupling services.
 *
 * Usage:
 * - Publisher: eventBus.publish('mission:completed', { missionId, result })
 * - Subscriber: eventBus.subscribe('mission:completed', (data) => { ... })
 *
 * Event Naming Convention:
 * - Format: {domain}:{action} (e.g., 'mission:completed', 'task:started')
 * - Domains: mission, task, topic, agent, research, writing, coding
 * - Actions: created, started, completed, failed, updated, deleted
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * Event payload base interface
 */
export interface EventPayload {
  timestamp?: number;
  source?: string;
  [key: string]: unknown;
}

/**
 * Event handler type
 */
export type EventHandler<T = EventPayload> = (
  payload: T,
) => void | Promise<void>;

/**
 * Subscription handle for cleanup
 */
export interface Subscription {
  unsubscribe: () => void;
}

@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly subscriptions = new Map<string, Set<EventHandler>>();

  constructor(private readonly eventEmitter: EventEmitter2) {
    this.logger.log("[EventBus] Service initialized");
  }

  onModuleDestroy() {
    this.logger.log("[EventBus] Cleaning up subscriptions");
    this.subscriptions.clear();
  }

  /**
   * Publish an event to all subscribers
   */
  publish<T extends EventPayload>(event: string, payload: T): void {
    const enrichedPayload = {
      ...payload,
      timestamp: payload.timestamp ?? Date.now(),
    };

    this.logger.debug(`[EventBus] Publishing ${event}`);

    // Emit via EventEmitter2 for system-wide integration
    this.eventEmitter.emit(event, enrichedPayload);

    // Also notify local subscribers
    const handlers = this.subscriptions.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          const result = handler(enrichedPayload);
          if (result instanceof Promise) {
            result.catch((error) => {
              this.logger.error(
                `[EventBus] Handler error for ${event}:`,
                error,
              );
            });
          }
        } catch (error) {
          this.logger.error(`[EventBus] Handler error for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to an event
   * Returns a subscription handle for cleanup
   */
  subscribe<T extends EventPayload>(
    event: string,
    handler: EventHandler<T>,
  ): Subscription {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }

    const handlers = this.subscriptions.get(event)!;
    handlers.add(handler as EventHandler);

    this.logger.debug(
      `[EventBus] Subscribed to ${event}, total handlers: ${handlers.size}`,
    );

    // Also register with EventEmitter2
    this.eventEmitter.on(event, handler);

    return {
      unsubscribe: () => {
        handlers.delete(handler as EventHandler);
        this.eventEmitter.off(event, handler);
        this.logger.debug(`[EventBus] Unsubscribed from ${event}`);
      },
    };
  }

  /**
   * Subscribe to an event once
   */
  once<T extends EventPayload>(
    event: string,
    handler: EventHandler<T>,
  ): Subscription {
    const wrappedHandler: EventHandler<T> = (payload) => {
      subscription.unsubscribe();
      return handler(payload);
    };

    const subscription = this.subscribe(event, wrappedHandler);
    return subscription;
  }

  /**
   * Get the count of handlers for an event
   */
  getHandlerCount(event: string): number {
    return this.subscriptions.get(event)?.size ?? 0;
  }

  /**
   * Check if an event has any subscribers
   */
  hasSubscribers(event: string): boolean {
    return this.getHandlerCount(event) > 0;
  }
}
