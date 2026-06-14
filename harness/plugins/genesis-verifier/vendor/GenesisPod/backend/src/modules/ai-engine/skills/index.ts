/**
 * AI Engine - Skills Module
 * 技能系统导出
 *
 * 包含：
 * - 技能接口和类型
 * - 基础技能类
 * - 技能注册表
 * - 输出管理器（统一 Skill 输出 Key 规范）
 * - SKILL.md 加载器（Claude Code 风格）
 * - Prompt 构建器
 * - SkillsMP 生态系统集成
 */

// Abstractions
export * from "./abstractions";

// Base
export * from "./base";

// Registry
export * from "./registry";

// Output Manager - 统一 Skill 输出 Key 管理规范
export * from "./output-manager";

// SKILL.md Types
export * from "./types/skill-md.types";

// Loader - SKILL.md 加载和解析
export * from "./loader";

// Builder - System Prompt 组装
export * from "./builder";

// Content - Prompt 内容和版本管理
export * from "./content";

// Analytics - 执行监控和分析
export * from "./analytics";

// Sandbox - 测试执行
export * from "./sandbox";

// Ecosystem - SkillsMP 集成
export * from "./marketplace";
