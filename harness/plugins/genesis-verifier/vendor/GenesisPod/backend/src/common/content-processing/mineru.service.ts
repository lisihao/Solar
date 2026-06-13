/**
 * MinerU Document Parsing Service
 *
 * 深度文档解析服务 - 集成 MinerU 进行高质量 PDF/文档解析
 *
 * MinerU 功能：
 * 1. 复杂 PDF 解析（保留结构）
 * 2. 表格提取（转 HTML）
 * 3. 公式识别（转 LaTeX）
 * 4. 图片提取
 * 5. 多语言 OCR（84 种语言）
 *
 * 支持模式：
 * - API 模式：调用远程 MinerU API 服务（推荐）
 * - CLI 模式：调用本地安装的 MinerU（需要 Python 环境）
 *
 * @see https://github.com/opendatalab/MinerU
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============================================
// 类型定义
// ============================================

export interface MinerUParseResult {
  success: boolean;
  content: string; // Markdown 格式的解析结果
  metadata: {
    pageCount: number;
    wordCount: number;
    hasImages: boolean;
    hasTables: boolean;
    hasFormulas: boolean;
    parseTime: number; // 毫秒
    method: "api" | "cli" | "fallback";
  };
  images?: ExtractedImage[];
  tables?: ExtractedTable[];
  error?: string;
}

export interface ExtractedImage {
  index: number;
  url?: string; // 上传后的 URL
  base64?: string; // 或 base64 数据
  caption?: string;
  page: number;
}

export interface ExtractedTable {
  index: number;
  html: string;
  caption?: string;
  page: number;
}

export interface MinerUConfig {
  mode: "api" | "cli" | "auto";
  apiEndpoint?: string;
  apiKey?: string;
  cliPath?: string;
  timeout?: number; // 超时（毫秒）
  maxPages?: number; // 最大解析页数
}

// ============================================
// MinerU 服务
// ============================================

@Injectable()
export class MinerUService {
  private readonly logger = new Logger(MinerUService.name);
  private config: MinerUConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.config = {
      mode:
        (this.configService.get<string>("MINERU_MODE") as "api" | "cli") ||
        "auto",
      apiEndpoint:
        this.configService.get<string>("MINERU_API_ENDPOINT") ||
        "http://localhost:8765",
      apiKey: this.configService.get<string>("MINERU_API_KEY"),
      cliPath: this.configService.get<string>("MINERU_CLI_PATH") || "mineru",
      timeout: parseInt(
        this.configService.get<string>("MINERU_TIMEOUT") || "120000",
        10,
      ),
      maxPages: parseInt(
        this.configService.get<string>("MINERU_MAX_PAGES") || "50",
        10,
      ),
    };

    this.logger.log(
      `[MinerUService] Initialized with mode: ${this.config.mode}`,
    );
  }

  /**
   * 解析 PDF 文件
   */
  async parsePdf(
    input: Buffer | string,
    options?: Partial<MinerUConfig>,
  ): Promise<MinerUParseResult> {
    const startTime = Date.now();
    const config = { ...this.config, ...options };

    this.logger.log(`[parsePdf] Starting PDF parse (mode: ${config.mode})`);

    try {
      let result: MinerUParseResult;

      // 根据模式选择解析方式
      if (config.mode === "api" || config.mode === "auto") {
        result = await this.parseViaApi(input, config);
        if (result.success) {
          result.metadata.parseTime = Date.now() - startTime;
          return result;
        }

        // API 失败，如果是 auto 模式则尝试 CLI
        if (config.mode === "auto") {
          this.logger.warn("[parsePdf] API mode failed, trying CLI mode");
          result = await this.parseViaCli(input, config);
          if (result.success) {
            result.metadata.parseTime = Date.now() - startTime;
            return result;
          }
        }
      } else if (config.mode === "cli") {
        result = await this.parseViaCli(input, config);
        if (result.success) {
          result.metadata.parseTime = Date.now() - startTime;
          return result;
        }
      }

      // 所有方法都失败，返回错误
      this.logger.error("[parsePdf] All parsing methods failed");
      return {
        success: false,
        content: "",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
          parseTime: Date.now() - startTime,
          method: "fallback",
        },
        error: "All MinerU parsing methods failed",
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[parsePdf] Error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
          parseTime: Date.now() - startTime,
          method: "fallback",
        },
        error: errorMessage,
      };
    }
  }

  /**
   * 通过 API 解析
   */
  private async parseViaApi(
    input: Buffer | string,
    config: MinerUConfig,
  ): Promise<MinerUParseResult> {
    try {
      const endpoint = config.apiEndpoint || "http://localhost:8765";

      // 准备请求数据
      let fileData: string;
      if (Buffer.isBuffer(input)) {
        fileData = input.toString("base64");
      } else if (typeof input === "string" && fs.existsSync(input)) {
        fileData = fs.readFileSync(input).toString("base64");
      } else {
        throw new Error("Invalid input: must be Buffer or file path");
      }

      this.logger.log(`[parseViaApi] Sending request to ${endpoint}/parse`);

      const response = await firstValueFrom(
        this.httpService.post(
          `${endpoint}/parse`,
          {
            file: fileData,
            format: "markdown",
            extract_images: true,
            extract_tables: true,
            max_pages: config.maxPages,
          },
          {
            headers: {
              "Content-Type": "application/json",
              ...(config.apiKey && {
                Authorization: `Bearer ${config.apiKey}`,
              }),
            },
            timeout: config.timeout,
          },
        ),
      );

      if (response.data?.success && response.data?.content) {
        const content = response.data.content;

        return {
          success: true,
          content,
          metadata: {
            pageCount: response.data.metadata?.page_count || 0,
            wordCount: this.countWords(content),
            hasImages:
              response.data.images?.length > 0 || content.includes("!["),
            hasTables:
              response.data.tables?.length > 0 ||
              content.includes("<table") ||
              content.includes("|"),
            hasFormulas: content.includes("$$") || content.includes("\\("),
            parseTime: 0,
            method: "api",
          },
          images: response.data.images,
          tables: response.data.tables,
        };
      }

      throw new Error(response.data?.error || "API returned empty result");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`[parseViaApi] Failed: ${errorMessage}`);
      return {
        success: false,
        content: "",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
          parseTime: 0,
          method: "api",
        },
        error: errorMessage,
      };
    }
  }

  /**
   * 通过 CLI 解析
   */
  private async parseViaCli(
    input: Buffer | string,
    config: MinerUConfig,
  ): Promise<MinerUParseResult> {
    let tempInputPath: string | null = null;
    let tempOutputDir: string | null = null;

    try {
      // 创建临时文件/目录
      const tempDir = os.tmpdir();
      const timestamp = Date.now();

      // 如果是 Buffer，保存到临时文件
      if (Buffer.isBuffer(input)) {
        tempInputPath = path.join(tempDir, `mineru_input_${timestamp}.pdf`);
        fs.writeFileSync(tempInputPath, input);
      } else if (typeof input === "string" && fs.existsSync(input)) {
        tempInputPath = input;
      } else {
        throw new Error("Invalid input: must be Buffer or file path");
      }

      tempOutputDir = path.join(tempDir, `mineru_output_${timestamp}`);
      fs.mkdirSync(tempOutputDir, { recursive: true });

      // 构建命令
      const cliPath = config.cliPath || "mineru";
      const cmd = `${cliPath} -p "${tempInputPath}" -o "${tempOutputDir}" --format markdown`;

      this.logger.log(`[parseViaCli] Executing: ${cmd}`);

      // 执行命令
      const { stderr } = await execAsync(cmd, {
        timeout: config.timeout,
      });

      if (stderr && !stderr.includes("INFO")) {
        this.logger.warn(`[parseViaCli] stderr: ${stderr}`);
      }

      // 读取输出
      const outputFiles = fs.readdirSync(tempOutputDir);
      const mdFile = outputFiles.find((f) => f.endsWith(".md"));

      if (!mdFile) {
        throw new Error("No markdown output file found");
      }

      const content = fs.readFileSync(
        path.join(tempOutputDir, mdFile),
        "utf-8",
      );

      // 提取图片
      const images: ExtractedImage[] = [];
      const imagesDir = path.join(tempOutputDir, "images");
      if (fs.existsSync(imagesDir)) {
        const imageFiles = fs.readdirSync(imagesDir);
        imageFiles.forEach((file, index) => {
          const imagePath = path.join(imagesDir, file);
          const imageData = fs.readFileSync(imagePath);
          images.push({
            index,
            base64: imageData.toString("base64"),
            page: 0, // CLI 输出不包含页码信息
          });
        });
      }

      return {
        success: true,
        content,
        metadata: {
          pageCount: this.estimatePageCount(content),
          wordCount: this.countWords(content),
          hasImages: images.length > 0 || content.includes("!["),
          hasTables: content.includes("<table") || content.includes("|"),
          hasFormulas: content.includes("$$") || content.includes("\\("),
          parseTime: 0,
          method: "cli",
        },
        images,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`[parseViaCli] Failed: ${errorMessage}`);
      return {
        success: false,
        content: "",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
          parseTime: 0,
          method: "cli",
        },
        error: errorMessage,
      };
    } finally {
      // 清理临时文件
      try {
        if (
          tempInputPath &&
          Buffer.isBuffer(input) &&
          fs.existsSync(tempInputPath)
        ) {
          fs.unlinkSync(tempInputPath);
        }
        if (tempOutputDir && fs.existsSync(tempOutputDir)) {
          fs.rmSync(tempOutputDir, { recursive: true, force: true });
        }
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 检查 MinerU 是否可用
   */
  async checkAvailability(): Promise<{
    available: boolean;
    mode: "api" | "cli" | "none";
    message: string;
  }> {
    // 检查 API
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.config.apiEndpoint}/health`, {
          timeout: 5000,
        }),
      );
      if (response.status === 200) {
        return {
          available: true,
          mode: "api",
          message: `MinerU API available at ${this.config.apiEndpoint}`,
        };
      }
    } catch {
      this.logger.debug("[checkAvailability] API not available");
    }

    // 检查 CLI
    try {
      const { stdout } = await execAsync(`${this.config.cliPath} --version`, {
        timeout: 5000,
      });
      if (stdout.includes("mineru") || stdout.includes("MinerU")) {
        return {
          available: true,
          mode: "cli",
          message: `MinerU CLI available: ${stdout.trim()}`,
        };
      }
    } catch {
      this.logger.debug("[checkAvailability] CLI not available");
    }

    return {
      available: false,
      mode: "none",
      message: "MinerU not available (neither API nor CLI)",
    };
  }

  /**
   * 计算字数
   */
  private countWords(text: string): number {
    if (!text) return 0;

    // 中文字符
    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    const chineseCount = chineseMatch ? chineseMatch.length : 0;

    // 英文单词
    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const englishCount = englishWords.length;

    return chineseCount + englishCount;
  }

  /**
   * 估算页数
   */
  private estimatePageCount(content: string): number {
    // 简单估算：每页约 3000 字符
    return Math.max(1, Math.ceil(content.length / 3000));
  }
}
