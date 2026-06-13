/**
 * Metadata Validation Utilities
 *
 * Provides runtime validation for JSON metadata fields to ensure:
 * - Size limits are enforced
 * - Depth limits are enforced
 * - Invalid data (undefined, functions) is stripped
 *
 * @module MetadataValidator
 */

export interface MetadataValidationResult {
  valid: boolean;
  sanitized: Record<string, unknown> | null;
  error?: string;
}

/**
 * Default validation limits
 */
export const METADATA_LIMITS = {
  MAX_DEPTH: 5,
  MAX_SIZE_BYTES: 1024 * 1024, // 1MB
} as const;

/**
 * Calculate the depth of a JSON object
 *
 * @param obj - The object to measure
 * @param current - Current depth level (internal)
 * @returns Maximum depth of the object
 */
function getJsonDepth(obj: unknown, current = 0): number {
  if (typeof obj !== "object" || obj === null) {
    return current;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return current + 1;
    return Math.max(...obj.map((item) => getJsonDepth(item, current + 1)));
  }

  const values = Object.values(obj as Record<string, unknown>);
  if (values.length === 0) return current + 1;

  return Math.max(...values.map((value) => getJsonDepth(value, current + 1)));
}

/**
 * Validate JSON metadata before persisting to database
 *
 * Checks:
 * 1. Serialized size is within limits
 * 2. Nesting depth is within limits
 * 3. Data can be safely serialized (strips undefined, functions)
 *
 * @param data - The metadata to validate
 * @param maxDepth - Maximum allowed nesting depth (default: 5)
 * @param maxSize - Maximum allowed size in bytes (default: 1MB)
 * @returns Validation result with sanitized data
 *
 * @example
 * ```typescript
 * const result = validateMetadata({ user: { name: 'test' } });
 * if (result.valid) {
 *   await prisma.resource.create({
 *     data: { metadata: result.sanitized }
 *   });
 * }
 * ```
 */
export function validateMetadata(
  data: unknown,
  maxDepth = METADATA_LIMITS.MAX_DEPTH,
  maxSize = METADATA_LIMITS.MAX_SIZE_BYTES,
): MetadataValidationResult {
  // Null or undefined is valid (empty metadata)
  if (data === null || data === undefined) {
    return { valid: true, sanitized: null };
  }

  // Must be an object
  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      sanitized: null,
      error: "Metadata must be an object (not array or primitive)",
    };
  }

  try {
    // Sanitize by serializing and parsing (strips undefined, functions)
    const serialized = JSON.stringify(data);

    // Check size
    const sizeBytes = Buffer.byteLength(serialized, "utf8");
    if (sizeBytes > maxSize) {
      return {
        valid: false,
        sanitized: null,
        error: `Metadata exceeds maximum size (${sizeBytes} > ${maxSize} bytes)`,
      };
    }

    // Parse to get sanitized data
    const sanitized = JSON.parse(serialized) as Record<string, unknown>;

    // Check depth
    const depth = getJsonDepth(sanitized);
    if (depth > maxDepth) {
      return {
        valid: false,
        sanitized: null,
        error: `Metadata exceeds maximum depth (${depth} > ${maxDepth})`,
      };
    }

    return { valid: true, sanitized };
  } catch (error) {
    return {
      valid: false,
      sanitized: null,
      error: `Metadata serialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Validate and sanitize metadata, throwing an error if invalid
 *
 * @param data - The metadata to validate
 * @param maxDepth - Maximum allowed nesting depth
 * @param maxSize - Maximum allowed size in bytes
 * @returns Sanitized metadata
 * @throws Error if metadata is invalid
 */
export function validateMetadataOrThrow(
  data: unknown,
  maxDepth = METADATA_LIMITS.MAX_DEPTH,
  maxSize = METADATA_LIMITS.MAX_SIZE_BYTES,
): Record<string, unknown> | null {
  const result = validateMetadata(data, maxDepth, maxSize);
  if (!result.valid) {
    throw new Error(`Invalid metadata: ${result.error}`);
  }
  return result.sanitized;
}
