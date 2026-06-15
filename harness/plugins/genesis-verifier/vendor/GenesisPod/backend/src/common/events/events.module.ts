/**
 * Events Module
 *
 * Provides centralized event bus functionality for cross-module communication.
 * This module should be imported by any module that needs to publish or subscribe to events.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [EventsModule],
 *   providers: [MyService],
 * })
 * export class MyModule {}
 * ```
 */

import { Global, Module } from "@nestjs/common";
import { EventBusService } from "./event-bus.service";

@Global()
@Module({
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
