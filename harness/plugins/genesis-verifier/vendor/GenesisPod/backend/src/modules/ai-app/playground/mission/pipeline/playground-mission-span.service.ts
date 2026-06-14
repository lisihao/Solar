/**
 * PlaygroundMissionSpanService — R2-#38 OTel span emission (playground 薄壳)
 *
 * 2026-05-24 P4 重构：通用 mission/stage/agent 三级 OTel span 嵌套机制已上提到
 *   `ai-harness/teams/business-team/span/business-team-mission-span.framework`，
 * 本类仅作为 playground 业务专属 namespace 实例，extends framework 注入
 * "playground" 前缀，向后兼容现有 import 路径与构造函数签名。
 *
 * span name 模板（由 framework 提供）：
 *   - root:  `playground.mission`
 *   - stage: `playground.stage.${stepId}`
 *   - agent: `playground.agent`
 *
 * AgentTracer 由 HarnessModule 提供并路由 span 到 SpanExporter sinks
 * (Logger + Langfuse when configured)。tracer 缺省时整个 service no-op。
 */

import { Injectable, Optional } from "@nestjs/common";
import {
  AgentTracer,
  BusinessTeamMissionSpanFramework,
} from "@/modules/ai-harness/facade";

@Injectable()
export class PlaygroundMissionSpanService extends BusinessTeamMissionSpanFramework {
  constructor(@Optional() tracer?: AgentTracer) {
    super(tracer, "playground");
  }
}
