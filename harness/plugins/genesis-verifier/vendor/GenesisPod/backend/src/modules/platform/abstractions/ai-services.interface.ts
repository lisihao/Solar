/**
 * L1 Infrastructure — Abstract interfaces for L3 (AI Engine) services
 *
 * L1 modules must NOT import from L2 directly. Instead, they depend on
 * these abstract interfaces and inject via DI tokens. The actual bindings
 * (useExisting: <L2 concrete class>) are set up in app.module.ts.
 *
 * This eliminates L1 → L2 reverse layer dependencies (audit I-1/I-2).
 */

// ==================== AI Chat Service ====================

/**
 * Abstract chat interface used by ReleaseService for AI-generated release notes.
 * Implemented by: ai-engine/facade/domain/chat.facade.ts (ChatFacade)
 */
export interface IAiChat {
  chat(options: {
    messages: Array<{ role: string; content: string }>;
    taskProfile?: { creativity?: string; outputLength?: string };
  }): Promise<{ content: string }>;
}

export const AI_CHAT_TOKEN = "InfraAiChatService";

// ==================== AI Observability Service ====================

/**
 * Abstract observability interface used by HealthCheckService.
 * Implemented by: ai-harness/tracing/observability/ai-observability.service.ts
 */
export interface IAiObservability {
  getDashboard(minutes: number): {
    totalCalls: number;
    successRate: number;
    avgLatencyMs: number;
    byModel: Record<string, unknown>;
  };
}

export const AI_OBSERVABILITY_TOKEN = "InfraAiObservabilityService";
