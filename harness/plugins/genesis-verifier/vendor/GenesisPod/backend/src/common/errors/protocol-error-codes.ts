/**
 * Cross-protocol error-code reference (documentation + mapping constants only).
 *
 * GenesisPod exposes three external response contracts, each with its OWN error
 * envelope. This file is a READ-ONLY reference: it does NOT change the runtime
 * behavior of any filter. It exists so that:
 *   - external integrators have one place to see how the three contracts differ;
 *   - internal code can reference a stable mapping instead of re-deriving codes.
 *
 * The three contracts (verified against source 2026-05-30):
 *
 * 1. REST (internal + Public REST) — `common/filters/all-exceptions.filter.ts`
 *    Shape: { statusCode, timestamp, path, method, message, code,
 *             requestId?, traceId?, details?, stack? }
 *    `code` is a string token (see {@link RestErrorCode}).
 *
 * 2. MCP JSON-RPC (`/mcp`) — `open-api/external/mcp/filters/mcp-exception.filter.ts`
 *    Shape: { jsonrpc: "2.0", id, error: { code: number, message } }
 *    `code` is a numeric JSON-RPC code (see {@link MCP_RPC_ERROR_CODE}).
 *
 * 3. A2A JSON-RPC (`/a2a`) — `ai-harness/protocols/a2a/a2a-rpc.service.ts`
 *    Shape: { jsonrpc: "2.0", id, error: { code: number, message } }
 *    `code` is a numeric JSON-RPC code (see {@link A2A_RPC_ERROR_CODE}).
 *
 * IMPORTANT: MCP and A2A both use the JSON-RPC server-error range
 * (-32000..-32099) but assign DIFFERENT meanings to the same numbers
 * (e.g. -32001 = "Authentication failed" for MCP but "Task not found" for A2A).
 * The numeric codes are therefore NOT interchangeable across protocols; never
 * collapse them into one shared numeric enum without a versioned migration.
 * This file only DOCUMENTS the divergence — it does not reconcile it.
 */

/** Stable string error codes emitted by the REST exception filter. */
export const REST_ERROR_CODE = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE_ERROR: "DUPLICATE_ERROR",
  FOREIGN_KEY_VIOLATION: "FOREIGN_KEY_VIOLATION",
  RELATION_VIOLATION: "RELATION_VIOLATION",
  NULL_CONSTRAINT_VIOLATION: "NULL_CONSTRAINT_VIOLATION",
  DATA_INCONSISTENCY: "DATA_INCONSISTENCY",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type RestErrorCode =
  (typeof REST_ERROR_CODE)[keyof typeof REST_ERROR_CODE];

/**
 * MCP JSON-RPC numeric codes (mirror of
 * `open-api/external/mcp/abstractions/mcp-server.interface.ts#JSON_RPC_ERRORS`
 * plus the inline MCP_AUTH_ERROR in the filter). Kept as a documentation mirror
 * so the cross-protocol table below is self-contained; the filter remains the
 * source of truth for runtime emission.
 */
export const MCP_RPC_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTH_ERROR: -32001,
  PERMISSION_DENIED: -32002,
  RATE_LIMITED: -32003,
  RESOURCE_NOT_FOUND: -32004,
} as const;

/**
 * A2A JSON-RPC numeric codes (mirror of
 * `ai-harness/protocols/a2a/a2a-spec.types.ts#A2A_ERROR_CODES`).
 * Documentation mirror only; the spec types remain the source of truth.
 */
export const A2A_RPC_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED: -32007,
} as const;

/** One row of the cross-protocol semantic alignment table. */
export interface ProtocolErrorRow {
  /** Semantic category shared across protocols. */
  semantic: string;
  /** REST `code` string, or null if the REST filter has no equivalent. */
  rest: RestErrorCode | null;
  /** Typical REST HTTP status for this category. */
  restHttpStatus: number;
  /** MCP numeric code, or null if not represented. */
  mcp: number | null;
  /** A2A numeric code, or null if not represented. */
  a2a: number | null;
}

/**
 * Cross-protocol semantic alignment.
 *
 * Read by category, NOT by number: the same numeric value can mean different
 * things in MCP vs A2A. Use this to translate an error observed on one contract
 * into its closest equivalent on another.
 */
export const PROTOCOL_ERROR_TABLE: readonly ProtocolErrorRow[] = [
  {
    semantic: "Malformed JSON / parse failure",
    rest: REST_ERROR_CODE.VALIDATION_ERROR,
    restHttpStatus: 400,
    mcp: MCP_RPC_ERROR_CODE.PARSE_ERROR,
    a2a: A2A_RPC_ERROR_CODE.PARSE_ERROR,
  },
  {
    semantic: "Invalid request shape",
    rest: REST_ERROR_CODE.VALIDATION_ERROR,
    restHttpStatus: 400,
    mcp: MCP_RPC_ERROR_CODE.INVALID_REQUEST,
    a2a: A2A_RPC_ERROR_CODE.INVALID_REQUEST,
  },
  {
    semantic: "Invalid params / validation",
    rest: REST_ERROR_CODE.VALIDATION_ERROR,
    restHttpStatus: 400,
    mcp: MCP_RPC_ERROR_CODE.INVALID_PARAMS,
    a2a: A2A_RPC_ERROR_CODE.INVALID_PARAMS,
  },
  {
    semantic: "Method / operation not found",
    rest: REST_ERROR_CODE.NOT_FOUND,
    restHttpStatus: 404,
    mcp: MCP_RPC_ERROR_CODE.METHOD_NOT_FOUND,
    a2a: A2A_RPC_ERROR_CODE.METHOD_NOT_FOUND,
  },
  {
    semantic: "Resource / record not found",
    rest: REST_ERROR_CODE.NOT_FOUND,
    restHttpStatus: 404,
    mcp: MCP_RPC_ERROR_CODE.RESOURCE_NOT_FOUND,
    a2a: A2A_RPC_ERROR_CODE.TASK_NOT_FOUND,
  },
  {
    semantic: "Authentication failed",
    rest: null, // REST returns HTTP 401 with a generic HttpException code
    restHttpStatus: 401,
    mcp: MCP_RPC_ERROR_CODE.AUTH_ERROR,
    a2a: null,
  },
  {
    semantic: "Permission denied",
    rest: null, // REST returns HTTP 403
    restHttpStatus: 403,
    mcp: MCP_RPC_ERROR_CODE.PERMISSION_DENIED,
    a2a: null,
  },
  {
    semantic: "Rate limited",
    rest: null, // REST returns HTTP 429
    restHttpStatus: 429,
    mcp: MCP_RPC_ERROR_CODE.RATE_LIMITED,
    a2a: null,
  },
  {
    semantic: "Unsupported operation",
    rest: null,
    restHttpStatus: 400,
    mcp: null,
    a2a: A2A_RPC_ERROR_CODE.UNSUPPORTED_OPERATION,
  },
  {
    semantic: "Internal server error",
    rest: REST_ERROR_CODE.INTERNAL_ERROR,
    restHttpStatus: 500,
    mcp: MCP_RPC_ERROR_CODE.INTERNAL_ERROR,
    a2a: A2A_RPC_ERROR_CODE.INTERNAL_ERROR,
  },
];
