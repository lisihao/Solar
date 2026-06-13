/**
 * User Preferences Tool
 * 用户偏好工具 - 存储和检索用户偏好设置
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

export type PreferenceOperation =
  | "GET"
  | "SET"
  | "DELETE"
  | "LIST"
  | "MERGE"
  | "RESET";

export interface UserPreferencesInput {
  /**
   * 操作类型
   */
  operation: PreferenceOperation;

  /**
   * 用户 ID
   */
  userId: string;

  /**
   * 命名空间（用于分组偏好）
   */
  namespace?: string;

  /**
   * 偏好键（支持点号分隔的路径，如 "theme.mode"）
   */
  key?: string;

  /**
   * 偏好值（SET 操作）
   */
  value?: unknown;

  /**
   * 要合并的偏好对象（MERGE 操作）
   */
  preferences?: Record<string, unknown>;

  /**
   * 默认值（GET 操作时，如果键不存在返回的值）
   */
  defaultValue?: unknown;
}

export interface UserPreferencesOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: PreferenceOperation;

  /**
   * 获取的值
   */
  value?: unknown;

  /**
   * 所有偏好（LIST 操作）
   */
  preferences?: Record<string, unknown>;

  /**
   * 受影响的键
   */
  affectedKeys?: string[];

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class UserPreferencesTool extends BaseTool<
  UserPreferencesInput,
  UserPreferencesOutput
> {
  private readonly logger = new Logger(UserPreferencesTool.name);

  // 模拟存储（实际应使用数据库）
  private preferencesStore: Map<string, Record<string, unknown>> = new Map();

  readonly id = "user-preferences";
  readonly sideEffect = "idempotent" as const;
  readonly category: ToolCategory = "memory";
  readonly tags = ["memory", "preferences", "user", "settings", "profile"];
  readonly name = "用户偏好";
  readonly description =
    "管理用户偏好设置，支持获取、设置、删除、列出和合并偏好。偏好按命名空间组织，支持嵌套键路径。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: ["GET", "SET", "DELETE", "LIST", "MERGE", "RESET"],
      },
      userId: {
        type: "string",
        description: "用户 ID",
      },
      namespace: {
        type: "string",
        description: "命名空间（默认: default）",
        default: "default",
      },
      key: {
        type: "string",
        description: "偏好键（支持点号路径，如 theme.mode）",
      },
      value: {
        type: "string",
        description: "偏好值",
      },
      preferences: {
        type: "object",
        description: "要合并的偏好对象",
      },
      defaultValue: {
        type: "string",
        description: "默认值（键不存在时返回）",
      },
    },
    required: ["operation", "userId"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "操作是否成功" },
      operation: { type: "string", description: "操作类型" },
      value: { type: "string", description: "获取的值" },
      preferences: { type: "object", description: "所有偏好" },
      affectedKeys: {
        type: "array",
        description: "受影响的键",
        items: { type: "string" },
      },
      error: { type: "string", description: "错误信息" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property
  }

  validateInput(input: UserPreferencesInput) {
    if (!input.operation || !input.userId) {
      return false;
    }

    const { operation, key, value, preferences } = input;

    switch (operation) {
      case "GET":
      case "DELETE":
        if (!key) return false;
        break;
      case "SET":
        if (!key || value === undefined) return false;
        break;
      case "MERGE":
        if (!preferences || typeof preferences !== "object") return false;
        break;
      case "LIST":
      case "RESET":
        // 不需要额外参数
        break;
    }

    return true;
  }

  protected async doExecute(
    input: UserPreferencesInput,
    _context: ToolContext,
  ): Promise<UserPreferencesOutput> {
    const {
      operation,
      userId,
      namespace = "default",
      key,
      value,
      preferences,
      defaultValue,
    } = input;

    const storeKey = `${userId}:${namespace}`;

    this.logger.log(
      `[doExecute] Preferences operation: ${operation} for user ${userId}`,
    );

    try {
      switch (operation) {
        case "GET":
          return this.getPreference(storeKey, key!, defaultValue);

        case "SET":
          return this.setPreference(storeKey, key!, value);

        case "DELETE":
          return this.deletePreference(storeKey, key!);

        case "LIST":
          return this.listPreferences(storeKey);

        case "MERGE":
          return this.mergePreferences(storeKey, preferences!);

        case "RESET":
          return this.resetPreferences(storeKey);

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[doExecute] Preferences operation failed: ${errorMessage}`,
      );

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private getPreference(
    storeKey: string,
    key: string,
    defaultValue?: unknown,
  ): UserPreferencesOutput {
    const prefs = this.preferencesStore.get(storeKey) || {};
    const value = this.getNestedValue(prefs, key);

    return {
      success: true,
      operation: "GET",
      value: value !== undefined ? value : defaultValue,
    };
  }

  private setPreference(
    storeKey: string,
    key: string,
    value: unknown,
  ): UserPreferencesOutput {
    const prefs = this.preferencesStore.get(storeKey) || {};
    this.setNestedValue(prefs, key, value);
    this.preferencesStore.set(storeKey, prefs);

    return {
      success: true,
      operation: "SET",
      value,
      affectedKeys: [key],
    };
  }

  private deletePreference(
    storeKey: string,
    key: string,
  ): UserPreferencesOutput {
    const prefs = this.preferencesStore.get(storeKey) || {};
    this.deleteNestedValue(prefs, key);
    this.preferencesStore.set(storeKey, prefs);

    return {
      success: true,
      operation: "DELETE",
      affectedKeys: [key],
    };
  }

  private listPreferences(storeKey: string): UserPreferencesOutput {
    const prefs = this.preferencesStore.get(storeKey) || {};

    return {
      success: true,
      operation: "LIST",
      preferences: prefs,
    };
  }

  private mergePreferences(
    storeKey: string,
    newPrefs: Record<string, unknown>,
  ): UserPreferencesOutput {
    const prefs = this.preferencesStore.get(storeKey) || {};
    const mergedPrefs = this.deepMerge(prefs, newPrefs);
    this.preferencesStore.set(storeKey, mergedPrefs);

    return {
      success: true,
      operation: "MERGE",
      preferences: mergedPrefs,
      affectedKeys: Object.keys(newPrefs),
    };
  }

  private resetPreferences(storeKey: string): UserPreferencesOutput {
    this.preferencesStore.delete(storeKey);

    return {
      success: true,
      operation: "RESET",
    };
  }

  // 辅助方法：获取嵌套值
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  // 辅助方法：设置嵌套值
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const keys = path.split(".");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
  }

  // 辅助方法：删除嵌套值
  private deleteNestedValue(obj: Record<string, unknown>, path: string): void {
    const keys = path.split(".");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== "object") {
        return;
      }
      current = current[key] as Record<string, unknown>;
    }

    delete current[keys[keys.length - 1]];
  }

  // 辅助方法：深度合并对象
  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(
          (result[key] as Record<string, unknown>) || {},
          source[key] as Record<string, unknown>,
        );
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
