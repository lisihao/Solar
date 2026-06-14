import { Prisma } from "@prisma/client";

/**
 * Safely cast a value to Prisma.InputJsonValue
 * Avoids scattered `as unknown as Prisma.InputJsonValue` assertions
 */
export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
