export { DomainConceptRegistry } from "./concept-registry";
export { DomainAdapterRegistry, type IDomainAdapter } from "./domain-adapter";
// v3 R0-A1-a: BUILTIN_AGENTS / AGENT_CONFIGS / BuiltinAgentId 已下推到各 ai-app
// *.constants.ts；business id list 在 ai-app/contracts/agent-catalog.ts。
// base layer 不再 export 业务名常量。
export type {
  DomainConceptSpec,
  ConceptField,
  ConceptRelation,
  DomainEntity,
} from "./concept.types";
