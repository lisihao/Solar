/**
 * ResearchReport schema —— deep-insight 能力的报告产物契约（中立，平台所有）。
 *
 * 历史上定义在 playground 的 run-mission.dto.ts；2026-06-08 上架沉淀时挪到能力共享层，
 * 让 writer/reviewer agent（已挪入本能力）与任何消费方都按引用消费，不反依赖 playground。
 * run-mission.dto.ts 留 re-export 桩，存量 18 处 import 一字不改。
 */
import { z } from "zod";

export const ResearchReportSchema = z.object({
  title: z.string().min(2),
  summary: z.string().min(20),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
        sources: z.array(z.string().url()).optional(),
      }),
    )
    .min(1),
  conclusion: z.string().min(20),
  citations: z.array(z.string().url()).optional(),
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
