/**
 * AI Engine - Tool Middleware Interface
 * 工具中间件接口定义
 */

import { ITool, ToolContext, ToolResult } from "../abstractions/tool.interface";

/**
 * 工具中间件接口
 */
export interface IToolMiddleware {
  /**
   * 中间件名称
   */
  readonly name: string;

  /**
   * 优先级（越小越先执行）
   */
  readonly priority?: number;

  /**
   * 前置处理
   * 在工具执行前调用
   * @param input 输入参数
   * @param context 执行上下文
   * @returns 修改后的输入（如果需要）
   */
  before?(
    input: unknown,
    context: ToolContext,
    tool: ITool,
  ): Promise<unknown | void>;

  /**
   * 后置处理
   * 在工具执行后调用
   * @param result 执行结果
   * @param context 执行上下文
   * @returns 修改后的结果（如果需要）
   */
  after?(
    result: ToolResult,
    context: ToolContext,
    tool: ITool,
  ): Promise<ToolResult>;

  /**
   * 错误处理
   * 在工具执行出错时调用
   * @param error 错误
   * @param context 执行上下文
   * @returns 恢复的结果或 void（继续抛出）
   */
  onError?(
    error: Error,
    input: unknown,
    context: ToolContext,
    tool: ITool,
  ): Promise<ToolResult | void>;
}

/**
 * 中间件链
 */
export interface IMiddlewareChain {
  /**
   * 添加中间件
   */
  use(middleware: IToolMiddleware): this;

  /**
   * 移除中间件
   */
  remove(name: string): boolean;

  /**
   * 获取所有中间件
   */
  getAll(): IToolMiddleware[];

  /**
   * 执行中间件链
   */
  execute<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>>;
}

/**
 * 中间件配置
 */
export interface MiddlewareConfig {
  /**
   * 是否启用
   */
  enabled?: boolean;

  /**
   * 优先级
   */
  priority?: number;

  /**
   * 应用于哪些工具（ID 列表，为空表示全部）
   */
  includeTools?: string[];

  /**
   * 排除哪些工具
   */
  excludeTools?: string[];

  /**
   * 自定义配置
   */
  options?: Record<string, unknown>;
}

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  /**
   * 当前中间件索引
   */
  index: number;

  /**
   * 中间件链
   */
  chain: IToolMiddleware[];

  /**
   * 是否已中止
   */
  aborted: boolean;

  /**
   * 中止原因
   */
  abortReason?: string;

  /**
   * 共享数据
   */
  data: Map<string, unknown>;
}

/**
 * 创建中间件的工厂函数类型
 */
export type MiddlewareFactory<TConfig = unknown> = (
  config?: TConfig,
) => IToolMiddleware;
