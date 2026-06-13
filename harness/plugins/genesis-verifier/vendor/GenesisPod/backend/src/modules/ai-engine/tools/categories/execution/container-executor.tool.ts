/**
 * Container Executor Tool
 * 容器代码执行工具 - 在 Docker 容器中安全执行代码
 *
 * 支持多种编程语言运行时，提供资源隔离和限制
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

/**
 * 支持的编程语言
 */
export enum SupportedLanguage {
  PYTHON = "python",
  JAVASCRIPT = "javascript",
  TYPESCRIPT = "typescript",
  JAVA = "java",
  GO = "go",
  RUST = "rust",
  CPP = "cpp",
  C = "c",
  RUBY = "ruby",
  PHP = "php",
  SHELL = "shell",
}

/**
 * 语言运行时配置
 */
export interface LanguageRuntime {
  /**
   * Docker 镜像
   */
  image: string;

  /**
   * 默认入口命令
   */
  command: string[];

  /**
   * 文件扩展名
   */
  extension: string;
}

/**
 * 资源使用统计
 */
export interface ResourceUsage {
  /**
   * CPU 使用率（百分比）
   */
  cpuPercent: number;

  /**
   * 内存使用（字节）
   */
  memoryBytes: number;

  /**
   * 内存使用（MB）
   */
  memoryMB: number;

  /**
   * 网络 IO（字节）
   */
  networkIO?: {
    rx: number; // 接收
    tx: number; // 发送
  };

  /**
   * 磁盘 IO（字节）
   */
  diskIO?: {
    read: number;
    write: number;
  };
}

export interface ContainerExecutorInput {
  /**
   * 要执行的代码
   */
  code: string;

  /**
   * 编程语言
   */
  language: SupportedLanguage | string;

  /**
   * 自定义 Docker 镜像（可选，覆盖默认镜像）
   */
  image?: string;

  /**
   * 执行选项
   */
  options?: {
    /**
     * 超时时间（毫秒），默认 30000
     */
    timeout?: number;

    /**
     * 内存限制（MB），默认 256
     */
    memoryLimit?: number;

    /**
     * CPU 限制（核心数），默认 1.0
     */
    cpuLimit?: number;

    /**
     * 是否允许网络访问，默认 false
     */
    networkEnabled?: boolean;

    /**
     * 环境变量
     */
    env?: Record<string, string>;

    /**
     * 传递给代码的输入（stdin）
     */
    stdin?: string;

    /**
     * 工作目录（容器内）
     */
    workDir?: string;
  };
}

export interface ContainerExecutorOutput {
  /**
   * 是否执行成功
   */
  success: boolean;

  /**
   * 标准输出
   */
  stdout: string;

  /**
   * 标准错误输出
   */
  stderr: string;

  /**
   * 退出码
   */
  exitCode: number;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;

  /**
   * 资源使用统计
   */
  resourceUsage: ResourceUsage;

  /**
   * 执行的语言
   */
  language: string;

  /**
   * 使用的镜像
   */
  image: string;

  /**
   * 是否因超时而终止
   */
  timeout: boolean;

  /**
   * 是否因内存超限而终止
   */
  oomKilled: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * 默认语言运行时配置
 */
export const DEFAULT_RUNTIMES: Record<SupportedLanguage, LanguageRuntime> = {
  [SupportedLanguage.PYTHON]: {
    image: "python:3.11-slim",
    command: ["python", "-u"],
    extension: ".py",
  },
  [SupportedLanguage.JAVASCRIPT]: {
    image: "node:20-slim",
    command: ["node"],
    extension: ".js",
  },
  [SupportedLanguage.TYPESCRIPT]: {
    image: "node:20-slim",
    command: ["tsx"], // 需要安装 tsx
    extension: ".ts",
  },
  [SupportedLanguage.JAVA]: {
    image: "openjdk:17-slim",
    command: ["java"],
    extension: ".java",
  },
  [SupportedLanguage.GO]: {
    image: "golang:1.21-alpine",
    command: ["go", "run"],
    extension: ".go",
  },
  [SupportedLanguage.RUST]: {
    image: "rust:1.75-slim",
    command: ["rustc", "--edition=2021"],
    extension: ".rs",
  },
  [SupportedLanguage.CPP]: {
    image: "gcc:13-slim",
    command: ["g++", "-std=c++20"],
    extension: ".cpp",
  },
  [SupportedLanguage.C]: {
    image: "gcc:13-slim",
    command: ["gcc"],
    extension: ".c",
  },
  [SupportedLanguage.RUBY]: {
    image: "ruby:3.2-slim",
    command: ["ruby"],
    extension: ".rb",
  },
  [SupportedLanguage.PHP]: {
    image: "php:8.2-cli",
    command: ["php"],
    extension: ".php",
  },
  [SupportedLanguage.SHELL]: {
    image: "bash:5.2",
    command: ["bash"],
    extension: ".sh",
  },
};

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class ContainerExecutorTool extends BaseTool<
  ContainerExecutorInput,
  ContainerExecutorOutput
> {
  private readonly logger = new Logger(ContainerExecutorTool.name);

  readonly id = "container-executor";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "execution";
  readonly tags = ["execution", "container", "docker", "code", "sandbox"];
  readonly name = "容器代码执行";
  readonly description =
    "在隔离的 Docker 容器中安全执行代码。支持 Python、JavaScript、Java、Go、Rust 等多种语言。自动限制资源使用（CPU、内存、网络）。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "要执行的代码",
      },
      language: {
        type: "string",
        description: `编程语言 (${Object.values(SupportedLanguage).join(", ")})`,
        enum: Object.values(SupportedLanguage),
      },
      image: {
        type: "string",
        description: "自定义 Docker 镜像（可选）",
      },
      options: {
        type: "object",
        description: "执行选项",
        properties: {
          timeout: {
            type: "number",
            description: "超时时间（毫秒），默认 30000",
            default: 30000,
          },
          memoryLimit: {
            type: "number",
            description: "内存限制（MB），默认 256",
            default: 256,
          },
          cpuLimit: {
            type: "number",
            description: "CPU 限制（核心数），默认 1.0",
            default: 1.0,
          },
          networkEnabled: {
            type: "boolean",
            description: "是否允许网络访问，默认 false",
            default: false,
          },
          env: {
            type: "object",
            description: "环境变量（键值对）",
          },
          stdin: {
            type: "string",
            description: "传递给代码的输入（stdin）",
          },
          workDir: {
            type: "string",
            description: "工作目录（容器内），默认 /workspace",
            default: "/workspace",
          },
        },
      },
    },
    required: ["code", "language"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "是否执行成功",
      },
      stdout: {
        type: "string",
        description: "标准输出",
      },
      stderr: {
        type: "string",
        description: "标准错误输出",
      },
      exitCode: {
        type: "number",
        description: "退出码",
      },
      executionTime: {
        type: "number",
        description: "执行时间（毫秒）",
      },
      resourceUsage: {
        type: "object",
        description: "资源使用统计",
        properties: {
          cpuPercent: { type: "number", description: "CPU 使用率（%）" },
          memoryBytes: { type: "number", description: "内存使用（字节）" },
          memoryMB: { type: "number", description: "内存使用（MB）" },
        },
      },
      language: {
        type: "string",
        description: "执行的语言",
      },
      image: {
        type: "string",
        description: "使用的 Docker 镜像",
      },
      timeout: {
        type: "boolean",
        description: "是否因超时而终止",
      },
      oomKilled: {
        type: "boolean",
        description: "是否因内存超限而终止",
      },
    },
  };

  constructor() {
    super();
  }

  validateInput(input: ContainerExecutorInput) {
    if (!input.code || typeof input.code !== "string") {
      this.logger.warn("Invalid code: must be a non-empty string");
      return false;
    }

    if (!input.language || typeof input.language !== "string") {
      this.logger.warn("Invalid language: must be a non-empty string");
      return false;
    }

    // 检查是否支持该语言
    const supportedLanguages = Object.values(SupportedLanguage);
    if (!supportedLanguages.includes(input.language as SupportedLanguage)) {
      this.logger.warn(
        `Unsupported language: ${input.language}. Supported: ${supportedLanguages.join(", ")}`,
      );
      return false;
    }

    // 验证资源限制
    if (input.options?.memoryLimit && input.options.memoryLimit <= 0) {
      this.logger.warn("Invalid memoryLimit: must be positive");
      return false;
    }

    if (input.options?.cpuLimit && input.options.cpuLimit <= 0) {
      this.logger.warn("Invalid cpuLimit: must be positive");
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: ContainerExecutorInput,
    _context: ToolContext,
  ): Promise<ContainerExecutorOutput> {
    const { code, language, image, options } = input;
    const timeout = options?.timeout || 30000;
    const memoryLimit = options?.memoryLimit || 256;
    const cpuLimit = options?.cpuLimit || 1.0;

    // 获取运行时配置
    const runtime =
      DEFAULT_RUNTIMES[language as SupportedLanguage] ||
      DEFAULT_RUNTIMES.python;
    const dockerImage = image || runtime.image;

    this.logger.log(
      `Executing ${language} code in container (image: ${dockerImage}, timeout: ${timeout}ms, memory: ${memoryLimit}MB, cpu: ${cpuLimit})`,
    );

    try {
      // 执行容器化代码
      const result = await this.executeInContainer(
        code,
        language,
        dockerImage,
        runtime,
        {
          timeout,
          memoryLimit,
          cpuLimit,
          networkEnabled: options?.networkEnabled || false,
          env: options?.env,
          stdin: options?.stdin,
          workDir: options?.workDir || "/workspace",
        },
      );

      this.logger.log(
        `Container execution completed: exitCode=${result.exitCode}, time=${result.executionTime}ms, memory=${result.resourceUsage.memoryMB}MB`,
      );

      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Container execution failed: ${errorMessage}`);

      return {
        success: false,
        stdout: "",
        stderr: errorMessage,
        exitCode: -1,
        executionTime: 0,
        resourceUsage: {
          cpuPercent: 0,
          memoryBytes: 0,
          memoryMB: 0,
        },
        language,
        image: dockerImage,
        timeout: false,
        oomKilled: false,
      };
    }
  }

  /**
   * 在容器中执行代码
   *
   * ⚠️ NOT IMPLEMENTED
   * 真实实现需要：
   * 1. 使用 Docker API 或 Kubernetes 创建容器
   * 2. 挂载代码文件到容器
   * 3. 设置资源限制（--memory, --cpus, --network）
   * 4. 监控资源使用
   * 5. 清理容器
   */
  private async executeInContainer(
    _code: string,
    _language: string,
    _image: string,
    _runtime: LanguageRuntime,
    _options: {
      timeout: number;
      memoryLimit: number;
      cpuLimit: number;
      networkEnabled: boolean;
      env?: Record<string, string>;
      stdin?: string;
      workDir: string;
    },
  ): Promise<ContainerExecutorOutput> {
    throw new Error(
      "ContainerExecutor is not yet implemented. " +
        "Real implementation requires dockerode integration. " +
        "See the pseudocode comment below for implementation reference.",
    );
  }

  /**
   * 真实实现的伪代码示例
   *
   * ```typescript
   * import Docker from 'dockerode';
   *
   * const docker = new Docker();
   *
   * // 1. 创建临时文件
   * const codeFile = `/tmp/code-${uuid()}${runtime.extension}`;
   * fs.writeFileSync(codeFile, code);
   *
   * // 2. 创建容器
   * const container = await docker.createContainer({
   *   Image: image,
   *   Cmd: [...runtime.command, codeFile],
   *   HostConfig: {
   *     Memory: options.memoryLimit * 1024 * 1024,
   *     NanoCpus: options.cpuLimit * 1e9,
   *     NetworkMode: options.networkEnabled ? 'bridge' : 'none',
   *     ReadonlyRootfs: true,
   *     Binds: [`${codeFile}:${options.workDir}/code${runtime.extension}:ro`],
   *   },
   *   Env: Object.entries(options.env || {}).map(([k, v]) => `${k}=${v}`),
   *   WorkingDir: options.workDir,
   * });
   *
   * // 3. 启动容器
   * await container.start();
   *
   * // 4. 获取输出
   * const stream = await container.logs({ stdout: true, stderr: true, follow: true });
   *
   * // 5. 等待完成或超时
   * const result = await Promise.race([
   *   container.wait(),
   *   new Promise((_, reject) =>
   *     setTimeout(() => reject(new Error('Timeout')), options.timeout)
   *   ),
   * ]);
   *
   * // 6. 获取资源统计
   * const stats = await container.stats({ stream: false });
   *
   * // 7. 清理
   * await container.remove({ force: true });
   * fs.unlinkSync(codeFile);
   *
   * return { ... };
   * ```
   */
}
