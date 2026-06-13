import { Prisma } from "@prisma/client";

export const LINK_HEALTH = {
  HEALTHY: "HEALTHY",
  BROKEN: "BROKEN",
  UNKNOWN: "UNKNOWN",
  ARCHIVED: "ARCHIVED",
} as const;

export type LinkHealthValue = (typeof LINK_HEALTH)[keyof typeof LINK_HEALTH];

/**
 * Where clause fragment to exclude dead-link resources (BROKEN/ARCHIVED) from
 * user-facing queries (feed, list, search, related, trending). UNKNOWN is kept
 * because newly ingested resources start as UNKNOWN until the health checker
 * verifies them — hiding UNKNOWN would freeze fresh content.
 */
export const EXCLUDE_DEAD_LINKS: Prisma.ResourceWhereInput = {
  linkHealth: { notIn: [LINK_HEALTH.BROKEN, LINK_HEALTH.ARCHIVED] },
};
