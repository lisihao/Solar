/**
 * OutputSchemaRegistry — schema id → zod schema 注册表（v5.1 R1-A0 / §3.3.2）
 *
 * 设计理由：
 * - SKILL.md frontmatter 含 `outputSchemaRef: "{app}.leader-output"`，
 *   是字符串引用而非 zod 实例（zod 实例不可 serializable）
 * - ai-app 在 onModuleInit 注册 schema by id；SkillSpecBuilder 通过 ref 查表拿 zod
 *
 * 命名约定：`<ai-app-id>.<schema-name>`（标识唯一性，但 registry 本身业务无关）
 *
 * 全局单例：1 个 registry 服务整个进程；id collision 抛错（不允许覆盖）
 */
import { Injectable } from "@nestjs/common";
import { z, type ZodType } from "zod";

@Injectable()
export class OutputSchemaRegistry {
  private readonly schemas = new Map<string, ZodType>();

  /**
   * 注册 schema（ai-app onModuleInit 调用）
   *
   * @throws Error 当 id 已注册（避免 silent override）
   */
  register(id: string, schema: ZodType): void {
    if (this.schemas.has(id)) {
      throw new Error(
        `[OutputSchemaRegistry] schema id collision: "${id}" already registered`,
      );
    }
    this.schemas.set(id, schema);
  }

  /** 获取 schema；不存在抛错 */
  get(id: string): ZodType {
    const s = this.schemas.get(id);
    if (!s) {
      throw new Error(
        `[OutputSchemaRegistry] schema not found: "${id}". Did you call register() in your ai-app onModuleInit?`,
      );
    }
    return s;
  }

  /** 尝试获取（返回 undefined 不抛） */
  tryGet(id: string): ZodType | undefined {
    return this.schemas.get(id);
  }

  has(id: string): boolean {
    return this.schemas.has(id);
  }

  /** 列出所有已注册 id（用于 open-api /api/v1/output-schemas 端点）*/
  listIds(): string[] {
    return Array.from(this.schemas.keys()).sort();
  }

  size(): number {
    return this.schemas.size;
  }

  /** 测试用：清空 */
  clearForTest(): void {
    this.schemas.clear();
  }
}

/** 默认 fallback：当 SKILL.md 无 outputSchemaRef 时使用 */
export const FREE_TEXT_OUTPUT_SCHEMA: ZodType = z.unknown();
