/**
 * HandlebarsRendererService —— FU2 邮件 .hbs 模板渲染
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §8.6 邮件模板需求 + B14 helpers
 *
 * 职责：
 *   - 启动时 import handlebars + 注册 radar 邮件模板需要的 helpers
 *     （eq/gt/length/join/lookup 是 Handlebars 内置；urlEncode/truncate/tierBadge/
 *      detailUrl/evidenceSources/add 来自 B14 设计）
 *   - 提供 render(filename, locale, ctx) → HTML 字符串
 *   - 模板路径：`backend/src/modules/platform/email/templates/<name>.<locale>.hbs`
 *     dev 模式 = 源码；prod 模式 = dist 复制（webpack/tsc 需 include .hbs）
 *
 * 暂时与 ai-engine/tools/template-render.tool.ts 的 helpers 重复实现（B14）：
 *   - tool 是 LLM-facing 工具（runtime 输入任意模板）
 *   - 本 service 是邮件专用（启动加载固定文件）
 *   - 重复合并到下一个 PR（lift helpers 到 ai-engine/abstractions），现在保持局部
 */
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerRadarEmailHelpers } from "@/common/handlebars/radar-email-helpers";

interface HbsCompiled {
  (ctx: Record<string, unknown>): string;
}
interface Hbs {
  compile(src: string, opts?: { noEscape?: boolean }): HbsCompiled;
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
  create(): Hbs;
}

@Injectable()
export class HandlebarsRendererService implements OnModuleInit {
  private readonly log = new Logger(HandlebarsRendererService.name);
  private hbs!: Hbs;
  private readonly cache = new Map<string, HbsCompiled>();
  private readonly templatesDir = join(__dirname, "..", "templates");

  async onModuleInit(): Promise<void> {
    const mod = await import("handlebars");
    // 用 isolated 实例避免污染全局 handlebars helpers
    this.hbs = (mod as unknown as { default: Hbs }).default.create();
    this.registerHelpers();
    this.log.log(
      `HandlebarsRendererService ready, templatesDir=${this.templatesDir}`,
    );
  }

  /**
   * 渲染模板
   * @param name 文件名 stem（如 "radar-daily-briefing"）
   * @param locale 'zh-CN' | 'en-US'（取前缀 zh/en 拼接文件名）
   * @param ctx 上下文变量
   */
  async render(
    name: string,
    locale: "zh-CN" | "en-US",
    ctx: Record<string, unknown>,
  ): Promise<string> {
    const lang = locale === "en-US" ? "en" : "zh";
    const key = `${name}.${lang}`;
    let compiled = this.cache.get(key);
    if (!compiled) {
      const filePath = join(this.templatesDir, `${key}.hbs`);
      if (!existsSync(filePath)) {
        // 回退：缺中文用英文，缺英文报错
        const fallbackLang = lang === "zh" ? "en" : null;
        if (fallbackLang) {
          const fallback = join(
            this.templatesDir,
            `${name}.${fallbackLang}.hbs`,
          );
          if (existsSync(fallback)) {
            const src = await readFile(fallback, "utf8");
            compiled = this.hbs.compile(src, { noEscape: false });
            this.cache.set(key, compiled);
            this.log.warn(
              `template ${key} missing, fallback to ${name}.${fallbackLang}`,
            );
          }
        }
        if (!compiled) {
          throw new Error(`email template not found: ${filePath}`);
        }
      } else {
        const src = await readFile(filePath, "utf8");
        compiled = this.hbs.compile(src, { noEscape: false });
        this.cache.set(key, compiled);
      }
    }
    return compiled(ctx);
  }

  private registerHelpers(): void {
    const hbs = this.hbs;

    // length: 数组 / 字符串长度
    hbs.registerHelper("length", (v: unknown) =>
      Array.isArray(v) || typeof v === "string" ? v.length : 0,
    );

    // eq / gt: 比较
    hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);
    hbs.registerHelper("gt", (a: unknown, b: unknown) =>
      typeof a === "number" && typeof b === "number" ? a > b : false,
    );

    // join: 数组 → 分隔字符串
    hbs.registerHelper("join", (arr: unknown, sep: unknown) => {
      if (!Array.isArray(arr)) return "";
      return arr.join(typeof sep === "string" ? sep : ", ");
    });

    // add: 整型加（模板算术用）
    hbs.registerHelper("add", (a: unknown, b: unknown) => {
      const na = typeof a === "number" ? a : Number(a) || 0;
      const nb = typeof b === "number" ? b : Number(b) || 0;
      return na + nb;
    });

    // B14: urlEncode / truncate / tierBadge / evidenceSources —
    // F4 FU3 整改：从 common/handlebars/radar-email-helpers 统一注册，避免与
    // ai-engine/tools/.../template-render.tool 实现漂移
    registerRadarEmailHelpers(
      hbs as {
        registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
      },
    );

    // B14: detailUrl — 邮件端签名是 (signalId, topicId, baseUrl)（与模板
    // `{{detailUrl this.id ../topic.id this.baseUrl}}` 对齐），LLM 工具端是
    // 单参 + 全局 config。两端 by design 不一致，保留邮件端本地实现
    hbs.registerHelper(
      "detailUrl",
      (signalId: unknown, topicId: unknown, baseUrl: unknown) => {
        if (typeof signalId !== "string" || typeof topicId !== "string")
          return "";
        const base =
          typeof baseUrl === "string" ? baseUrl : "https://app.example.com";
        return `${base}/ai-radar/topic/${topicId}/signal/${signalId}`;
      },
    );
  }
}
