/**
 * BillingContext Interceptor for Topic Insights
 *
 * Automatically wraps all TI controller methods with BillingContext.run(),
 * using the authenticated user's ID from the request.
 *
 * This eliminates the need to manually add BillingContext.run() in every
 * controller method that triggers LLM calls.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import type { Request } from "express";
import { BillingContext } from "@/modules/platform/facade";

@Injectable()
export class BillingContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: { id?: string }; params?: Record<string, string> }
      >();
    const userId = request.user?.id;

    if (!userId) {
      return next.handle();
    }

    // Already has BillingContext — skip (e.g., leaderChat already wraps manually)
    if (BillingContext.get()) {
      return next.handle();
    }

    const topicId = request.params?.id || request.params?.topicId;

    return new Observable((subscriber) => {
      BillingContext.run(
        {
          userId,
          moduleType: "topic-insights",
          operationType: "research",
          referenceId: topicId,
        },
        () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}
