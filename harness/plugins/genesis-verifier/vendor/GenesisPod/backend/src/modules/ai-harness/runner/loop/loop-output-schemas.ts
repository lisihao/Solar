/**
 * Native structured-output JSON schemas for harness loop call sites.
 *
 * These are minimal permissive schemas — they constrain the top-level shape
 * and known properties without blocking additionalProperties, so providers
 * that auto-degrade (json_mode, prompt) still fall through gracefully.
 * The manual parse fallbacks in each loop remain as the final safety net.
 *
 * R2-#35: Used by simple-loop and react-loop (non-FC branch) to pass
 * structuredOutputStrategy + outputJsonSchema to AiChatService.chat(),
 * enabling native json_schema / tool_use adapter routing.
 *
 * #35 strict finalize schemas: business-agent finalize output schemas with
 * additionalProperties:false so strict providers (json_schema_strict) actually
 * constrain the payload shape. See RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.
 */

/**
 * Schema for SimpleLoop: the loop expects the LLM to return an arbitrary
 * JSON object (or array).  We cannot predict the exact shape here because
 * different agents provide different outputSchemas via outputSchemaValidator.
 * A permissive object schema still signals to the provider that JSON is
 * required, which is better than relying on responseFormat:"json" alone.
 */
export const SIMPLE_LOOP_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [{ type: "object", additionalProperties: true }, { type: "array" }],
};

/**
 * Schema for ReActLoop non-FC branch (ParsedDecision).
 *
 * ParsedDecision shape:
 *   { thinking: string; action: { kind: string; [key: string]: unknown } }
 *
 * We make all top-level properties optional (providers differ on whether
 * required is enforced in strict vs non-strict mode) and allow additional
 * properties so dialect variants (e.g. actions[] shorthand) are not rejected.
 */
export const REACT_LOOP_DECISION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    thinking: { type: "string" },
    action: {
      type: "object",
      properties: {
        kind: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: true,
    },
    // shorthand dialect: some models emit top-level "actions" array
    actions: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: true,
};

/**
 * #35 — Strict JSON schema for ResearcherAgent finalize output.
 *
 * Derived from the `Output` zod in researcher.agent.ts:
 *   z.object({
 *     dimension: z.string(),
 *     findings: z.array(z.object({ claim, evidence, source (required),
 *                                   sourceTitle?, sourceSnippet?,
 *                                   sourcePublishedAt? })),
 *     summary: z.string(),
 *     figureCandidates?: z.array(z.object({ sourceUrl, caption (required),
 *                                           imageUrl?, sourcePageOrSection?,
 *                                           relevanceHint? })).max(5).default([]),
 *   })
 *
 * CRITICAL GUARANTEE: this schema must not reject valid researcher output.
 *
 * Design decisions to ensure no false rejections:
 *   1. Optional zod fields (`.optional()`) → not in `required`
 *   2. `.default()` fields (figureCandidates, relevanceHint) → not required
 *   3. `.refine()` validators (URL prefix on sourceUrl/imageUrl) → dropped at
 *      JSON-schema level (provider cannot enforce custom predicates)
 *   4. `.min()` on strings → not enforced (provider-side minLength is unreliable)
 *   5. `.max(5)` on figureCandidates → maxItems:5 (safe constraint)
 *   6. additionalProperties:false at every object level (strict shape)
 *
 * The zod outputSchema in the loop still validates the actual values after the
 * provider response, so relaxing min/refine at the JSON-schema level is safe.
 *
 * Analyst and Writer agents follow the same pattern when their strict schemas
 * are added: derive from their zod Output, apply the same 6 rules.
 */
export const RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["dimension", "findings", "summary"],
  properties: {
    dimension: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "evidence", "source"],
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          source: { type: "string" },
          sourceTitle: { type: "string" },
          sourceSnippet: { type: "string" },
          sourcePublishedAt: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
    // figureCandidates has .default([]) → optional in the JSON output
    figureCandidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceUrl", "caption"],
        properties: {
          sourceUrl: { type: "string" },
          imageUrl: { type: "string" },
          caption: { type: "string" },
          sourcePageOrSection: { type: "string" },
          // relevanceHint has .default("medium") → optional
          relevanceHint: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
      },
    },
  },
};
