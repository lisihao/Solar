import { Injectable } from "@nestjs/common";
import { TemplateBaseHelper } from "./templates/template-base.helper";

/**
 * Template generator class — migration target, not yet active.
 *
 * Current status: This class is a pre-created extraction target and is NOT
 * imported or injected anywhere. The actual template generation methods still
 * reside in the original infographic-template.service.ts and have NOT been
 * migrated here yet.
 *
 * Planned methods to migrate from infographic-template.service.ts:
 * - generateConsultingInfographicHTML (cards layout)
 * - generateCenterVisualHTML
 * - generateTimelineHTML
 * - generateComparisonHTML
 * - generateStatisticsHTML
 * - generateChecklistHTML
 * - generateFunnelHTML
 * - generateMatrixHTML
 * - generateRankingHTML
 *
 * Do NOT add this class to any module provider or inject it until
 * the migration task is completed.
 */
@Injectable()
export class InfographicTemplatesGenerator extends TemplateBaseHelper {
  // Migration pending: template methods have not been moved here yet.
  // See infographic-template.service.ts for the current implementations.
}
