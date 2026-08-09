import { BadRequestException } from "@nestjs/common";

const FORBIDDEN_HOST_MARKERS = ["thunderomlx", "omlx"] as const;
const FORBIDDEN_PORTS = new Set(["8002", "8003"]);

export const FORBIDDEN_AI_PROVIDER_ENDPOINT_MESSAGE =
  "GenesisPod forbids ThunderOMLX/OMLX AI provider endpoints";

/**
 * GenesisPod must never route AI traffic to ThunderOMLX/OMLX.
 *
 * This is intentionally a pure, fail-closed policy so every configuration
 * entry point and every final HTTP dispatch path can share the same rule.
 * Empty values remain valid for optional fields; callers retain responsibility
 * for applying provider defaults or reporting a missing endpoint.
 */
export function assertAllowedAiProviderEndpoint(
  endpoint: string | null | undefined,
): void {
  const value = endpoint?.trim();
  if (!value) return;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException(
      "AI provider endpoint must be an absolute HTTP(S) URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(
      "AI provider endpoint must be an absolute HTTP(S) URL",
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const hasForbiddenHostMarker = FORBIDDEN_HOST_MARKERS.some((marker) =>
    hostname.includes(marker),
  );

  if (hasForbiddenHostMarker || FORBIDDEN_PORTS.has(parsed.port)) {
    throw new BadRequestException(FORBIDDEN_AI_PROVIDER_ENDPOINT_MESSAGE);
  }
}
