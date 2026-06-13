/**
 * Content Engine Abstractions (L2)
 *
 * Abstract interfaces for content production capabilities.
 * L4 (AI App) services implement these interfaces and inject via DI tokens.
 * This eliminates L2 → L4 reverse type dependencies.
 *
 * @see facade.providers.ts ContentFeature, IntelligenceFeature
 */

/**
 * Long-form content engine interface.
 * Implemented by: ai-app/writing/content-engine/services/long-content-engine.service.ts
 */
export interface ILongContentEngine {
  generateLongContent?(params: unknown): Promise<unknown>;
}

/**
 * Continuation protocol interface for resuming long-form content generation.
 * Implemented by: ai-app/writing/content-engine/services/continuation-protocol.service.ts
 */
export interface IContinuationProtocol {
  continueGeneration?(params: unknown): Promise<unknown>;
}

/**
 * Report synthesis engine interface.
 * Implemented by: ai-app/office/content-synthesis/report-synthesis.service.ts
 */
export interface IReportSynthesisEngine {
  synthesize?(params: unknown): Promise<unknown>;
  sanitizeReport(text: string): string;
}
