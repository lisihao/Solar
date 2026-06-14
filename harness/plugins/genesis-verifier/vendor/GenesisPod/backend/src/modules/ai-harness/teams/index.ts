/**
 * AI Engine - Teams Module
 * 团队系统导出
 */

// Abstractions
export * from "./abstractions";

// Constraints
export * from "./constraints";

// Base implementations
export * from "./base";

// Registry
export * from "./registry";

// Orchestrator
export * from "./orchestrator";

// Templates: team configs now registered by AI App modules at runtime
// See: ai-app/research, ai-app/office, ai-app/teams

// Services (exclude MissionStatus to avoid conflict with abstractions)
export { TeamsService } from "./services";
export type { CreateMissionDto, TeamInfo } from "./services";

// Module
export { TeamsModule } from "./teams.module";
