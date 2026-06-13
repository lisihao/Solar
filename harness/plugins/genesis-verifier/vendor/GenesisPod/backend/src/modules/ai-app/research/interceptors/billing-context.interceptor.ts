/**
 * BillingContext Interceptor for Research
 *
 * Automatically wraps all Research controller methods with BillingContext.run(),
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

    // Already has BillingContext — skip (e.g., methods that already wrap manually)
    if (BillingContext.get()) {
      return next.handle();
    }

    const projectId = request.params?.projectId || request.params?.id;

    return new Observable((subscriber) => {
      BillingContext.run(
        {
          userId,
          moduleType: "research",
          operationType: "deep-research",
          referenceId: projectId,
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
