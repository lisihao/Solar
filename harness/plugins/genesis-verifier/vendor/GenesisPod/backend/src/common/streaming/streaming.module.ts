/**
 * Streaming Module
 *
 * 统一的流式响应处理模块，提供：
 * 1. SSE (Server-Sent Events) 响应处理
 * 2. 流式数据转换
 * 3. 错误处理
 * 4. 心跳机制
 *
 * 设计原则：
 * - 所有需要 SSE 的模块都应该使用此模块
 * - 统一的事件格式和错误处理
 * - 支持取消和超时
 */

import { Module, Global } from "@nestjs/common";
import { StreamingService } from "./streaming.service";

@Global()
@Module({
  providers: [StreamingService],
  exports: [StreamingService],
})
export class StreamingModule {}
