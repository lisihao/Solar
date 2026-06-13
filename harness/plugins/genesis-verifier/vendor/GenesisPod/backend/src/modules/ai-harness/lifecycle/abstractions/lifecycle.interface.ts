/**
 * AI Engine - Lifecycle Interface
 * 生命周期接口定义
 */

/**
 * 初始化接口
 */
export interface IOnInit {
  /**
   * 初始化
   * 在组件启动时调用
   */
  onInit(): Promise<void> | void;
}

/**
 * 销毁接口
 */
export interface IOnDestroy {
  /**
   * 销毁
   * 在组件关闭时调用
   */
  onDestroy(): Promise<void> | void;
}

/**
 * 启动接口
 */
export interface IOnStart {
  /**
   * 启动
   * 在初始化完成后调用
   */
  onStart(): Promise<void> | void;
}

/**
 * 停止接口
 */
export interface IOnStop {
  /**
   * 停止
   * 在销毁前调用
   */
  onStop(): Promise<void> | void;
}

/**
 * 完整生命周期接口
 */
export interface ILifecycle extends IOnInit, IOnDestroy {
  /**
   * 获取生命周期状态
   */
  getLifecycleState(): LifecycleState;
}

/**
 * 生命周期状态
 */
export enum LifecycleState {
  /**
   * 未初始化
   */
  UNINITIALIZED = "uninitialized",

  /**
   * 初始化中
   */
  INITIALIZING = "initializing",

  /**
   * 已初始化
   */
  INITIALIZED = "initialized",

  /**
   * 启动中
   */
  STARTING = "starting",

  /**
   * 运行中
   */
  RUNNING = "running",

  /**
   * 停止中
   */
  STOPPING = "stopping",

  /**
   * 已停止
   */
  STOPPED = "stopped",

  /**
   * 销毁中
   */
  DESTROYING = "destroying",

  /**
   * 已销毁
   */
  DESTROYED = "destroyed",

  /**
   * 错误状态
   */
  ERROR = "error",
}

/**
 * 生命周期管理器接口
 */
export interface ILifecycleManager {
  /**
   * 注册组件
   * @param component 组件
   * @param priority 优先级（越小越先执行）
   */
  register(component: ILifecycle, priority?: number): void;

  /**
   * 初始化所有组件
   */
  initAll(): Promise<void>;

  /**
   * 销毁所有组件
   */
  destroyAll(): Promise<void>;

  /**
   * 获取所有组件状态
   */
  getStates(): Map<string, LifecycleState>;
}

/**
 * 可重启接口
 */
export interface IRestartable {
  /**
   * 重启
   */
  restart(): Promise<void>;
}

/**
 * 可热重载接口
 */
export interface IHotReloadable {
  /**
   * 热重载
   * @param config 新配置
   */
  hotReload(config?: unknown): Promise<void>;

  /**
   * 是否支持热重载
   */
  canHotReload(): boolean;
}

/**
 * 优雅关闭接口
 */
export interface IGracefulShutdown {
  /**
   * 优雅关闭
   * @param timeout 超时时间（毫秒）
   */
  gracefulShutdown(timeout?: number): Promise<void>;
}

/**
 * 健康探针接口
 */
export interface IProbe {
  /**
   * 存活探针
   */
  livenessProbe(): Promise<ProbeResult>;

  /**
   * 就绪探针
   */
  readinessProbe(): Promise<ProbeResult>;

  /**
   * 启动探针
   */
  startupProbe?(): Promise<ProbeResult>;
}

/**
 * 探针结果
 */
export interface ProbeResult {
  /**
   * 是否通过
   */
  success: boolean;

  /**
   * 消息
   */
  message?: string;

  /**
   * 检查时间
   */
  checkedAt: Date;

  /**
   * 详情
   */
  details?: Record<string, unknown>;
}

/**
 * 依赖检查接口
 */
export interface IDependencyCheck {
  /**
   * 检查依赖
   */
  checkDependencies(): Promise<DependencyCheckResult>;
}

/**
 * 依赖检查结果
 */
export interface DependencyCheckResult {
  /**
   * 是否所有依赖都满足
   */
  allSatisfied: boolean;

  /**
   * 依赖状态
   */
  dependencies: DependencyStatus[];
}

/**
 * 依赖状态
 */
export interface DependencyStatus {
  /**
   * 依赖名称
   */
  name: string;

  /**
   * 是否满足
   */
  satisfied: boolean;

  /**
   * 版本（如果适用）
   */
  version?: string;

  /**
   * 消息
   */
  message?: string;
}

/**
 * 检查组件是否实现了初始化接口
 */
export function hasOnInit(obj: unknown): obj is IOnInit {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "onInit" in obj &&
    typeof (obj as IOnInit).onInit === "function"
  );
}

/**
 * 检查组件是否实现了销毁接口
 */
export function hasOnDestroy(obj: unknown): obj is IOnDestroy {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "onDestroy" in obj &&
    typeof (obj as IOnDestroy).onDestroy === "function"
  );
}

/**
 * 检查组件是否实现了生命周期接口
 */
export function hasLifecycle(obj: unknown): obj is ILifecycle {
  return hasOnInit(obj) && hasOnDestroy(obj);
}
