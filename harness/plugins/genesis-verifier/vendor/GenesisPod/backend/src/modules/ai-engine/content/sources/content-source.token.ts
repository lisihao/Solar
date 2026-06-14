/**
 * ai-engine/content/sources — token + decorator
 *
 * 2026-05-24 P17a: 从 ai-app/contracts/social-data-source 上提。
 *
 * SetMetadata key 沿用 'genesis:social-data-source'（不破坏现有 prod
 * @SocialDataSourceProvider() decorator 的 metadata key 兼容性，仅外露名字改）。
 */

import { SetMetadata } from "@nestjs/common";

export const CONTENT_SOURCE_TOKEN = Symbol.for("CONTENT_SOURCE");

/**
 * Metadata key used by ContentSourceRegistry auto-discovery scan.
 *
 * NOTE: value stays 'genesis:social-data-source' for runtime compatibility —
 * key string is opaque, the registry uses it to filter providers regardless of
 * what symbol name the decorator exposes.
 */
export const CONTENT_SOURCE_METADATA = "genesis:social-data-source";

/**
 * Marks a class as a ContentSource provider so the registry discovers it via
 * `DiscoveryService` at application bootstrap.
 */
export const ContentSourceProvider = (): ClassDecorator =>
  SetMetadata(CONTENT_SOURCE_METADATA, true);
