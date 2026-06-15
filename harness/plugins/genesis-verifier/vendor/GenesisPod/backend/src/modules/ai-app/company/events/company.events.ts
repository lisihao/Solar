/**
 * CompanyMissionEvents — 事件类型注册清单（W3）
 *
 * EventBus 校验：未在 EventRegistry 注册的 type 一律 drop+warn、不广播。
 * 故所有 company.* mission 事件必须在此声明，并在 CompanyModule.onModuleInit 注册。
 * 事件经 SocketBroadcastAdapter（namespace 'company'，roomPrefix 'company'）广播到
 * room company:<missionId>，前端 useCompanyMissionStream 订阅。
 */

import { z } from "zod";
import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";

export const COMPANY_MISSION_EVENTS: readonly DomainEventTypeSpec[] = [
  {
    type: "company.mission:started",
    schema: z.object({ missionId: z.string() }),
  },
  {
    type: "company.stage:lifecycle",
    schema: z.object({ stage: z.string(), status: z.string() }),
  },
  {
    type: "company.mission:completed",
    schema: z.object({ missionId: z.string() }),
  },
  {
    type: "company.mission:failed",
    schema: z.object({ missionId: z.string(), message: z.string() }),
  },
];
