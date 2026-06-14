/**
 * A2A v0.3 JSON-RPC Controller
 *
 * 2026-05-01 (PR-X-P): 对齐 Google A2A v0.3 / Anthropic A2A SDK 标准。
 *
 * 端点:
 *   POST /a2a/v1                — JSON-RPC 2.0 入口（message/send / tasks/get / tasks/cancel）
 *   POST /a2a/v1/stream         — SSE 流式（message/stream）
 *   GET  /.well-known/agent.json — Agent discovery（保留旧实现）
 *
 * 旧端点（A2AController）保留：POST /a2a/tasks / GET /a2a/tasks/:id —— backwards-compat shim。
 * 新代码 / 新 client 请走 /a2a/v1 JSON-RPC 入口。
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "@/common/decorators/public.decorator";
import { Observable, from } from "rxjs";
import { A2AApiKeyGuard } from "../../../ai-harness/protocols/a2a/guards/a2a-api-key.guard";
import { A2ARpcService } from "../../../ai-harness/protocols/a2a/a2a-rpc.service";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../../ai-harness/protocols/a2a/a2a-spec.types";

@ApiTags("A2A Protocol v0.3")
@Controller("a2a/v1")
export class A2ARpcController {
  private readonly logger = new Logger(A2ARpcController.name);

  constructor(private readonly rpcService: A2ARpcService) {}

  /**
   * JSON-RPC 2.0 入口 — message/send / tasks/get / tasks/cancel 等
   */
  @Public()
  @Post()
  @UseGuards(A2AApiKeyGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "A2A v0.3 JSON-RPC 2.0 endpoint",
    description:
      "Single endpoint for all A2A v0.3 RPC methods. Supported: message/send, tasks/get, tasks/cancel.",
  })
  @ApiResponse({
    status: 200,
    description: "JSON-RPC response (success or error envelope)",
  })
  async rpc(@Body() request: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.logger.log(
      `A2A RPC method=${request.method} id=${String(request.id)}`,
    );
    return this.rpcService.handle(request);
  }

  /**
   * SSE 流式响应 — message/stream method
   *
   * Client 通过此端点订阅 task 状态变化 / artifact 增量，每条 event 是
   * StreamEvent（Message / Task / TaskStatusUpdateEvent / TaskArtifactUpdateEvent）。
   *
   * 当前实现：调用 message/send 创建 task 后返回单个 final 事件；后续可扩展为真正
   * 多事件流（与 MissionEventBuffer 对接，把 stage:* / status-update 转发出去）。
   */
  @Public()
  @Post("stream")
  @UseGuards(A2AApiKeyGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Sse()
  @ApiOperation({
    summary: "A2A v0.3 SSE streaming endpoint (message/stream)",
    description:
      "Server-Sent Events stream. Each event is a JSON-encoded A2A StreamEvent (Message / Task / TaskStatusUpdateEvent / TaskArtifactUpdateEvent).",
  })
  stream(
    @Body() request: JsonRpcRequest,
  ): Observable<{ data: JsonRpcResponse }> {
    this.logger.log(`A2A SSE stream method=${request.method}`);
    // 当前简化实现：调 RPC 一次，把结果作为 single SSE event 返回
    // TODO: 接 MissionEventBuffer 转发 stage:started/completed → TaskStatusUpdateEvent
    return from(
      this.rpcService.handle(request).then((response) => ({ data: response })),
    );
  }
}
