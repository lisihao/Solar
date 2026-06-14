/**
 * Streaming Service
 *
 * 统一的流式响应服务，提供：
 * 1. SSE 事件创建和格式化
 * 2. Observable 到 SSE 的转换
 * 3. 心跳机制
 * 4. 错误处理
 */

import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject, interval, merge, takeUntil } from "rxjs";
import { map, takeWhile } from "rxjs/operators";
import {
  SSEEvent,
  ProgressEvent,
  CompleteEvent,
  ErrorEvent,
  HeartbeatEvent,
  StreamConfig,
  NestSSEMessageEvent,
  StreamingOptions,
} from "./types";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  /**
   * 创建 SSE 事件（NestJS @Sse 格式）
   *
   * @param type 事件类型
   * @param data 事件数据
   */
  createEvent<T>(type: string, data: T): NestSSEMessageEvent {
    const event: SSEEvent<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    return {
      type, // NestJS 会将此设置为 SSE 的 event: 字段
      data: JSON.stringify(event),
    };
  }

  /**
   * 创建进度事件
   */
  createProgressEvent(
    phase: string,
    progress: number,
    message: string,
    current?: number,
    total?: number,
  ): NestSSEMessageEvent {
    const data: ProgressEvent = {
      type: "progress",
      phase,
      progress,
      message,
      current,
      total,
    };
    return this.createEvent("progress", data);
  }

  /**
   * 创建完成事件
   */
  createCompleteEvent<T>(result: T, totalTime?: number): NestSSEMessageEvent {
    const data: CompleteEvent<T> = {
      type: "complete",
      result,
      totalTime,
    };
    return this.createEvent("complete", data);
  }

  /**
   * 创建错误事件
   */
  createErrorEvent(
    error: string,
    code?: string,
    recoverable?: boolean,
  ): NestSSEMessageEvent {
    const data: ErrorEvent = {
      type: "error",
      error,
      code,
      recoverable,
    };
    return this.createEvent("error", data);
  }

  /**
   * 创建心跳事件
   */
  createHeartbeatEvent(): NestSSEMessageEvent {
    const data: HeartbeatEvent = {
      type: "heartbeat",
      timestamp: new Date().toISOString(),
    };
    return this.createEvent("heartbeat", data);
  }

  /**
   * 将 Subject 转换为带心跳的 SSE Observable
   *
   * @param source 源 Subject
   * @param config 配置
   */
  toSSEStream<T>(
    source: Subject<SSEEvent<T>>,
    config?: StreamConfig,
  ): Observable<NestSSEMessageEvent> {
    const {
      heartbeatInterval = 30000,
      timeout = 600000, // 10 分钟默认超时
      enableHeartbeat = true,
      onClientDisconnect,
    } = config || {};

    const stopSignal = new Subject<void>();

    // 创建心跳流
    const heartbeat$ = enableHeartbeat
      ? interval(heartbeatInterval).pipe(
          map(() => this.createHeartbeatEvent()),
          takeUntil(stopSignal),
        )
      : new Observable<NestSSEMessageEvent>();

    // 创建主事件流
    const events$ = source.pipe(
      map((event) => ({
        type: event.type,
        data: JSON.stringify(event),
      })),
      takeUntil(stopSignal),
    );

    // 设置超时
    if (timeout > 0) {
      setTimeout(() => {
        this.logger.warn(`[toSSEStream] Timeout after ${timeout}ms`);
        stopSignal.next();
        stopSignal.complete();
        onClientDisconnect?.();
      }, timeout);
    }

    // 合并事件流和心跳流
    return merge(events$, heartbeat$).pipe(
      // 当收到完成或错误事件时停止
      takeWhile((event) => {
        if (event.type === "complete" || event.type === "error") {
          // 发送最后一个事件后停止
          setTimeout(() => {
            stopSignal.next();
            stopSignal.complete();
          }, 100);
        }
        return true;
      }),
    );
  }

  /**
   * 创建一个新的 SSE Subject
   */
  createSSESubject<T>(): Subject<SSEEvent<T>> {
    return new Subject<SSEEvent<T>>();
  }

  /**
   * 发送进度事件到 Subject
   */
  emitProgress<T>(
    subject: Subject<SSEEvent<T>>,
    phase: string,
    progress: number,
    message: string,
    current?: number,
    total?: number,
  ): void {
    subject.next({
      type: "progress",
      data: {
        type: "progress",
        phase,
        progress,
        message,
        current,
        total,
      } as unknown as T,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 发送完成事件到 Subject
   */
  emitComplete<T>(subject: Subject<SSEEvent<T>>, result: T): void {
    subject.next({
      type: "complete",
      data: result,
      timestamp: new Date().toISOString(),
    });
    subject.complete();
  }

  /**
   * 发送错误事件到 Subject
   */
  emitError<T>(
    subject: Subject<SSEEvent<T>>,
    error: string,
    code?: string,
  ): void {
    subject.next({
      type: "error",
      data: { error, code } as unknown as T,
      timestamp: new Date().toISOString(),
    });
    subject.complete();
  }

  /**
   * 包装异步生成器为 SSE Observable
   *
   * 用于将异步生成器（如 AI 流式响应）转换为 SSE 格式，支持背压控制
   */
  fromAsyncGenerator<T>(
    generator: AsyncGenerator<T>,
    options?: StreamingOptions,
  ): Observable<NestSSEMessageEvent> {
    const subject = new Subject<NestSSEMessageEvent>();
    const buffer: T[] = [];
    const maxBuffer = options?.bufferSize || 10;
    const backpressureStrategy = options?.backpressureStrategy || "pause";

    const processGenerator = async () => {
      try {
        for await (const item of generator) {
          // 1. 检查客户端是否断连
          if (subject.observers.length === 0) {
            this.logger.warn(
              "[fromAsyncGenerator] Client disconnected, cleaning up",
            );
            await generator.return?.(undefined);
            options?.onClientDisconnect?.();
            break;
          }

          // 2. 背压控制
          if (buffer.length >= maxBuffer) {
            switch (backpressureStrategy) {
              case "drop":
                this.logger.warn(
                  `[fromAsyncGenerator] Buffer full (${buffer.length}/${maxBuffer}), dropping item`,
                );
                continue; // 丢弃当前项
              case "error":
                throw new Error(
                  `Buffer overflow: ${buffer.length}/${maxBuffer} items`,
                );
              case "pause":
              default:
                this.logger.debug(
                  `[fromAsyncGenerator] Buffer full (${buffer.length}/${maxBuffer}), pausing`,
                );
                await this.waitForBufferDrain(
                  buffer,
                  Math.floor(maxBuffer / 2),
                );
            }
          }

          // 3. 将数据加入缓冲区
          buffer.push(item);

          // 4. 发送数据
          const event = options?.mapToEvent
            ? options.mapToEvent(item)
            : {
                type: "chunk",
                data: item,
                timestamp: new Date().toISOString(),
              };

          subject.next({
            type: event.type,
            data: JSON.stringify(event),
          });

          // 5. 发送后从缓冲区移除
          buffer.shift();
        }

        // 发送完成事件
        const completeEvent = options?.onComplete?.() || {
          type: "complete",
          data: { success: true },
          timestamp: new Date().toISOString(),
        };

        subject.next({
          type: completeEvent.type,
          data: JSON.stringify(completeEvent),
        });

        subject.complete();
      } catch (error) {
        this.logger.error(
          "[fromAsyncGenerator] Error processing generator",
          error,
        );

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        const errorEvent = options?.onError?.(error as Error) || {
          type: "error",
          data: { error: errorMessage },
          timestamp: new Date().toISOString(),
        };

        subject.next({
          type: errorEvent.type,
          data: JSON.stringify(errorEvent),
        });

        subject.complete();
      }
    };

    void processGenerator();

    return subject.asObservable();
  }

  /**
   * 等待缓冲区排空到目标大小
   *
   * @param buffer 缓冲区数组
   * @param target 目标大小
   */
  private async waitForBufferDrain(
    buffer: unknown[],
    target: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (buffer.length <= target) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }
}
