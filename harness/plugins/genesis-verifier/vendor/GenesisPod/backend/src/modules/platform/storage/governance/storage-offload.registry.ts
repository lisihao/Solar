import { KnowledgeBaseStatus, Prisma, WikiDiffStatus } from "@prisma/client";
import type { PrismaService } from "../../../../common/prisma/prisma.service";

export type OffloadContentKind = "string" | "json";

export interface OffloadRow {
  id: string;
  content: string;
  version?: number;
}

export interface OffloadTarget {
  name: string;
  table: string;
  field: string;
  uriField: string;
  r2Prefix: string;
  contentKind: OffloadContentKind;
  list: (prisma: PrismaService, take: number) => Promise<OffloadRow[]>;
  commit: (
    prisma: PrismaService,
    id: string,
    uri: string,
    size: number,
  ) => Promise<void>;
  recordSmall: (
    prisma: PrismaService,
    id: string,
    size: number,
  ) => Promise<void>;
  keyFor: (id: string, version?: number) => string;
  contentType: string;
}

const WIKI_DIFF_GRACE_DAYS = parseInt(
  process.env.OFFLOAD_GRACE_DAYS_WIKI_DIFF ?? "30",
  10,
);

export const OFFLOAD_TARGETS: readonly OffloadTarget[] = [
  {
    name: "topic_reports.full_report",
    table: "topic_reports",
    field: "full_report",
    uriField: "full_report_uri",
    r2Prefix: "topic-reports/",
    contentKind: "string",
    list: async (p, take) => {
      const rows = await p.topicReport.findMany({
        where: { fullReportUri: null, fullReport: { not: "" } },
        select: { id: true, version: true, fullReport: true },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        version: r.version,
        content: r.fullReport ?? "",
      }));
    },
    commit: async (p, id, uri, size) => {
      await p.topicReport.update({
        where: { id },
        data: {
          fullReport: "",
          fullReportUri: uri,
          fullReportSize: size,
        },
      });
    },
    recordSmall: async (p, id, size) => {
      await p.topicReport.update({
        where: { id },
        data: { fullReportSize: size },
      });
    },
    keyFor: (id, version) => `topic-reports/${id}/v${version ?? 1}.md`,
    contentType: "text/markdown; charset=utf-8",
  },
  {
    name: "dimension_analyses.data_points",
    table: "dimension_analyses",
    field: "data_points",
    uriField: "data_points_uri",
    r2Prefix: "dimension-analyses/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.dimensionAnalysis.findMany({
        where: {
          dataPointsUri: null,
          NOT: { dataPoints: { equals: Prisma.DbNull } },
        },
        // dataPointsUri 一起 select 消除 hydrate 警告（本扫描限定 uri=null,
        // 行未 off-load,hydrate 对其 no-op,读到的仍是原始 JSON）。
        select: { id: true, dataPoints: true, dataPointsUri: true },
        take,
      });
      return rows
        .filter((r) => r.dataPoints !== null)
        .map((r) => ({
          id: r.id,
          content: JSON.stringify(r.dataPoints),
        }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE dimension_analyses SET data_points=NULL, data_points_uri=$1, data_points_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.dimensionAnalysis.update({
        where: { id },
        data: { dataPointsSize: size },
      });
    },
    keyFor: (id) => `dimension-analyses/${id}/data_points.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "research_tasks.result",
    table: "research_tasks",
    field: "result",
    uriField: "result_uri",
    r2Prefix: "research-tasks/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.researchTask.findMany({
        where: {
          resultUri: null,
          NOT: { result: { equals: Prisma.DbNull } },
        },
        select: { id: true, result: true, resultUri: true },
        take,
      });
      return rows
        .filter((r) => r.result !== null)
        .map((r) => ({
          id: r.id,
          content: JSON.stringify(r.result),
        }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE research_tasks SET result=NULL, result_uri=$1, result_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.researchTask.update({
        where: { id },
        data: { resultSize: size },
      });
    },
    keyFor: (id) => `research-tasks/${id}/result.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "knowledge_base_documents.raw_content",
    table: "knowledge_base_documents",
    field: "raw_content",
    uriField: "raw_content_uri",
    r2Prefix: "kb-documents/",
    contentKind: "string",
    list: async (p, take) => {
      const rows = await p.knowledgeBaseDocument.findMany({
        where: {
          rawContentUri: null,
          status: KnowledgeBaseStatus.READY,
          NOT: { rawContent: "" },
        },
        select: { id: true, rawContent: true, rawContentUri: true },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        content: r.rawContent ?? "",
      }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE knowledge_base_documents SET raw_content='', raw_content_uri=$1, raw_content_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.knowledgeBaseDocument.update({
        where: { id },
        data: { rawContentSize: size },
      });
    },
    keyFor: (id) => `kb-documents/${id}/raw.txt`,
    contentType: "text/plain; charset=utf-8",
  },
  {
    name: "wiki_page_revisions.body",
    table: "wiki_page_revisions",
    field: "body",
    uriField: "body_uri",
    r2Prefix: "wiki-revisions/",
    contentKind: "string",
    list: async (p, take) => {
      const rows = await p.wikiPageRevision.findMany({
        where: { bodyUri: null, NOT: { body: "" } },
        select: { id: true, body: true, bodyUri: true },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        content: r.body ?? "",
      }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE wiki_page_revisions SET body='', body_uri=$1, body_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.wikiPageRevision.update({
        where: { id },
        data: { bodySize: size },
      });
    },
    keyFor: (id) => `wiki-revisions/${id}/body.md`,
    contentType: "text/markdown; charset=utf-8",
  },
  {
    name: "wiki_diffs.items",
    table: "wiki_diffs",
    field: "items",
    uriField: "items_uri",
    r2Prefix: "wiki-diffs/",
    contentKind: "json",
    list: async (p, take) => {
      const cutoff = new Date(
        Date.now() - WIKI_DIFF_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );
      const rows = await p.wikiDiff.findMany({
        where: {
          itemsUri: null,
          status: { in: [WikiDiffStatus.APPLIED, WikiDiffStatus.DISMISSED] },
          createdAt: { lt: cutoff },
          NOT: { items: { equals: Prisma.JsonNull } },
        },
        select: { id: true, items: true, itemsUri: true },
        take,
      });
      return rows
        .filter((r) => r.items !== null)
        .map((r) => ({
          id: r.id,
          content: JSON.stringify(r.items),
        }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE wiki_diffs SET items='null'::jsonb, items_uri=$1, items_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.wikiDiff.update({
        where: { id },
        data: { itemsSize: size },
      });
    },
    keyFor: (id) => `wiki-diffs/${id}/items.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "agent_playground_missions.report_full",
    table: "agent_playground_missions",
    field: "report_full",
    uriField: "report_full_uri",
    r2Prefix: "mission-records/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: {
          reportFullUri: null,
          NOT: { reportFull: { equals: Prisma.DbNull } },
        },
        select: { id: true, reportFull: true, reportFullUri: true },
        take,
      });
      return rows
        .filter((r) => r.reportFull !== null)
        .map((r) => ({ id: r.id, content: JSON.stringify(r.reportFull) }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE agent_playground_missions SET report_full=NULL, report_full_uri=$1, report_full_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.agentPlaygroundMission.update({
        where: { id },
        data: { reportFullSize: size },
      });
    },
    keyFor: (id) => `mission-records/${id}/report_full.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "agent_playground_missions.reconciliation_report",
    table: "agent_playground_missions",
    field: "reconciliation_report",
    uriField: "reconciliation_report_uri",
    r2Prefix: "mission-records/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: {
          reconciliationReportUri: null,
          NOT: { reconciliationReport: { equals: Prisma.DbNull } },
        },
        select: {
          id: true,
          reconciliationReport: true,
          reconciliationReportUri: true,
        },
        take,
      });
      return rows
        .filter((r) => r.reconciliationReport !== null)
        .map((r) => ({
          id: r.id,
          content: JSON.stringify(r.reconciliationReport),
        }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE agent_playground_missions SET reconciliation_report=NULL, reconciliation_report_uri=$1, reconciliation_report_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.agentPlaygroundMission.update({
        where: { id },
        data: { reconciliationReportSize: size },
      });
    },
    keyFor: (id) => `mission-records/${id}/reconciliation_report.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "agent_playground_missions.leader_journal",
    table: "agent_playground_missions",
    field: "leader_journal",
    uriField: "leader_journal_uri",
    r2Prefix: "mission-records/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: {
          leaderJournalUri: null,
          NOT: { leaderJournal: { equals: Prisma.DbNull } },
        },
        select: { id: true, leaderJournal: true, leaderJournalUri: true },
        take,
      });
      return rows
        .filter((r) => r.leaderJournal !== null)
        .map((r) => ({ id: r.id, content: JSON.stringify(r.leaderJournal) }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE agent_playground_missions SET leader_journal=NULL, leader_journal_uri=$1, leader_journal_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.agentPlaygroundMission.update({
        where: { id },
        data: { leaderJournalSize: size },
      });
    },
    keyFor: (id) => `mission-records/${id}/leader_journal.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "agent_playground_missions.analyst_output",
    table: "agent_playground_missions",
    field: "analyst_output",
    uriField: "analyst_output_uri",
    r2Prefix: "mission-records/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: {
          analystOutputUri: null,
          NOT: { analystOutput: { equals: Prisma.DbNull } },
        },
        select: { id: true, analystOutput: true, analystOutputUri: true },
        take,
      });
      return rows
        .filter((r) => r.analystOutput !== null)
        .map((r) => ({ id: r.id, content: JSON.stringify(r.analystOutput) }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE agent_playground_missions SET analyst_output=NULL, analyst_output_uri=$1, analyst_output_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.agentPlaygroundMission.update({
        where: { id },
        data: { analystOutputSize: size },
      });
    },
    keyFor: (id) => `mission-records/${id}/analyst_output.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "agent_playground_missions.outline_plan",
    table: "agent_playground_missions",
    field: "outline_plan",
    uriField: "outline_plan_uri",
    r2Prefix: "mission-records/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: {
          outlinePlanUri: null,
          NOT: { outlinePlan: { equals: Prisma.DbNull } },
        },
        select: { id: true, outlinePlan: true, outlinePlanUri: true },
        take,
      });
      return rows
        .filter((r) => r.outlinePlan !== null)
        .map((r) => ({ id: r.id, content: JSON.stringify(r.outlinePlan) }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE agent_playground_missions SET outline_plan=NULL, outline_plan_uri=$1, outline_plan_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.agentPlaygroundMission.update({
        where: { id },
        data: { outlinePlanSize: size },
      });
    },
    keyFor: (id) => `mission-records/${id}/outline_plan.json`,
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "mission_report_versions.report_full",
    table: "mission_report_versions",
    field: "report_full",
    uriField: "report_full_uri",
    r2Prefix: "report-versions/",
    contentKind: "json",
    list: async (p, take) => {
      const rows = await p.missionReportVersion.findMany({
        where: {
          reportFullUri: null,
          NOT: { reportFull: { equals: Prisma.DbNull } },
        },
        select: { id: true, reportFull: true, reportFullUri: true },
        take,
      });
      return rows
        .filter((r) => r.reportFull !== null)
        .map((r) => ({ id: r.id, content: JSON.stringify(r.reportFull) }));
    },
    commit: async (p, id, uri, size) => {
      await p.$executeRawUnsafe(
        `UPDATE mission_report_versions SET report_full=NULL, report_full_uri=$1, report_full_size=$2 WHERE id=$3`,
        uri,
        size,
        id,
      );
    },
    recordSmall: async (p, id, size) => {
      await p.missionReportVersion.update({
        where: { id },
        data: { reportFullSize: size },
      });
    },
    keyFor: (id) => `report-versions/${id}/report_full.json`,
    contentType: "application/json; charset=utf-8",
  },
] as const;
