/**
 * Slides Engine - Orchestrator Module
 *
 * v5.0: 采用 AI Teams Leader 协调模式
 * - SlidesTeamOrchestrator: 主编排器
 * - SlidesLeader: Leader 角色（规划、审核、综合）
 * - SlidesTeamMember: 成员基类（执行 Skills）
 */

export * from "./slides.controller";

// v5.0: Team-based Orchestrator
export * from "./types";
export * from "./slides-leader";
export * from "./slides-team-member";
export * from "./slides-team-orchestrator";
export * from "./slides-repository";
