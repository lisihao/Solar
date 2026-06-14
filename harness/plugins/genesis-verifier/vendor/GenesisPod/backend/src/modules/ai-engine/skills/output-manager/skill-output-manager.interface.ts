/**
 * AI Engine - Skill Output Manager Interface
 * 技能输出管理器接口定义
 *
 * 统一规范 Skill 输出的存储和读取，确保跨 Skill 的数据传递一致性
 */

/**
 * 规范化后的 Skill Output Key
 *
 * 规范：
 * 1. 所有 Key 使用 kebab-case
 * 2. 统一不带前缀（如 slides-）
 * 3. 去除逗号等特殊字符
 */
export type NormalizedSkillKey = string;

/**
 * Skill 输出条目
 */
export interface SkillOutputEntry<T = unknown> {
  /** 规范化后的 Key */
  key: NormalizedSkillKey;

  /** 原始 Skill ID */
  originalSkillId: string;

  /** 输出数据 */
  data: T;

  /** 创建时间 */
  createdAt: Date;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Skill 输出管理器接口
 *
 * 所有 Agent/Orchestrator 必须通过此接口存取 Skill 输出
 */
export interface ISkillOutputManager {
  /**
   * 存储 Skill 输出
   *
   * @param skillId - Skill ID（会被自动规范化）
   * @param output - 输出数据
   * @param metadata - 可选元数据
   */
  store<T>(
    skillId: string,
    output: T,
    metadata?: Record<string, unknown>,
  ): void;

  /**
   * 获取 Skill 输出
   *
   * @param skillId - Skill ID（支持原始 ID 或规范化 ID）
   * @returns 输出数据，不存在时返回 undefined
   */
  get<T>(skillId: string): T | undefined;

  /**
   * 获取 Skill 输出条目（包含元数据）
   *
   * @param skillId - Skill ID
   * @returns 完整的输出条目
   */
  getEntry<T>(skillId: string): SkillOutputEntry<T> | undefined;

  /**
   * 检查输出是否存在
   *
   * @param skillId - Skill ID
   */
  has(skillId: string): boolean;

  /**
   * 删除 Skill 输出
   *
   * @param skillId - Skill ID
   */
  delete(skillId: string): boolean;

  /**
   * 清空所有输出
   */
  clear(): void;

  /**
   * 获取所有输出 Key
   */
  keys(): NormalizedSkillKey[];

  /**
   * 获取所有输出
   */
  getAll(): Record<NormalizedSkillKey, unknown>;

  /**
   * 从普通对象导入（用于反序列化）
   *
   * @param outputs - 输出对象
   */
  importFrom(outputs: Record<string, unknown>): void;

  /**
   * 导出为普通对象（用于序列化）
   *
   * 为了向后兼容，同时返回：
   * - 规范化后的 key（如 "outline-planning"）
   * - 原始 skill ID（如 "slides-outline-planning"）
   * - 带前缀的变体（确保 slides-xxx 格式可用）
   */
  exportTo(): Record<string, unknown>;

  /**
   * 规范化 Skill ID 为标准 Key
   *
   * 规则：
   * 1. 去除 "slides-"、"teams-" 等前缀
   * 2. 取逗号前的第一个 ID
   * 3. trim 空白
   * 4. 转为 kebab-case
   *
   * @param skillId - 原始 Skill ID
   * @returns 规范化后的 Key
   */
  normalizeKey(skillId: string): NormalizedSkillKey;
}

/**
 * Skill 输出管理器配置
 */
export interface SkillOutputManagerConfig {
  /**
   * 已知的 Skill ID 前缀列表（会被自动去除）
   * 默认: ["slides-", "teams-", "office-", "studio-"]
   */
  knownPrefixes?: string[];

  /**
   * 是否启用调试日志
   */
  debug?: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_SKILL_OUTPUT_CONFIG: Required<SkillOutputManagerConfig> = {
  knownPrefixes: ["slides-", "teams-", "office-", "studio-"],
  debug: false,
};
