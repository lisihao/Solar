import { CreditTransactionType as PrismaCreditTransactionType } from "@prisma/client";

const CreditTransactionType = PrismaCreditTransactionType ?? {
  AI_ASK: "AI_ASK",
  ADJUSTMENT: "ADJUSTMENT",
  AI_TEAMS: "AI_TEAMS",
  AI_PLANNING: "AI_PLANNING",
  EXPLORE: "EXPLORE",
  AI_OFFICE: "AI_OFFICE",
  AI_SIMULATION: "AI_SIMULATION",
  AI_WRITING: "AI_WRITING",
  AI_IMAGE: "AI_IMAGE",
  AI_SOCIAL: "AI_SOCIAL",
  AI_RESEARCH: "AI_RESEARCH",
  AI_INSIGHTS: "AI_INSIGHTS",
  NOTEBOOK_RESEARCH: "NOTEBOOK_RESEARCH",
  LIBRARY: "LIBRARY",
  NOTES: "NOTES",
  COLLECTIONS: "COLLECTIONS",
};

export const CREDIT_TRANSACTION_TYPE_BY_MODULE: Record<
  string,
  PrismaCreditTransactionType
> = {
  "ai-ask": CreditTransactionType.AI_ASK,
  "ai-engine": CreditTransactionType.ADJUSTMENT,
  "ai-teams": CreditTransactionType.AI_TEAMS,
  "ai-planning": CreditTransactionType.AI_PLANNING,
  explore: CreditTransactionType.EXPLORE,
  "ai-office": CreditTransactionType.AI_OFFICE,
  "ai-simulation": CreditTransactionType.AI_SIMULATION,
  "ai-writing": CreditTransactionType.AI_WRITING,
  "ai-image": CreditTransactionType.AI_IMAGE,
  "ai-social": CreditTransactionType.AI_SOCIAL,
  "deep-research": CreditTransactionType.AI_RESEARCH,
  "topic-insights": CreditTransactionType.AI_INSIGHTS,
  "notebook-research": CreditTransactionType.NOTEBOOK_RESEARCH,
  library: CreditTransactionType.LIBRARY,
  notes: CreditTransactionType.NOTES,
  collections: CreditTransactionType.COLLECTIONS,
};
