/**
 * BusinessAgentTeam — Stage Bindings Framework
 *
 * 业务团队 stage bindings 装配的薄骨架：subclass 实现 buildCtx / buildDeps，
 * framework 仅承担 logger 提供 + 通用 marker（让 architecture spec 能识别）。
 *
 * 2026-05-24 (P4) 抽取自 ai-app 业务侧 stage bindings service:
 *   - ai-app/playground/services/mission/workflow/mission-stage-bindings.service.ts  @migrated-from
 *
 * 没有任何业务团队专属字段在 framework 层；业务侧的具体 MissionContext /
 * MissionDeps 由各业务团队自己在 ai-app/<team>/ 内定义。
 *
 * 业务侧扩展模板：
 * ```ts
 * @Injectable()
 * export class MyStageBindings
 *   extends BusinessTeamStageBindingsFramework<CtxArgs, MyCtx, MyDeps>
 *   implements BusinessTeamStageBindings<CtxArgs, MyCtx, MyDeps>
 * {
 *   constructor(private readonly leader: LeaderService, ...) { super(); }
 *   buildCtx(args: CtxArgs): MyCtx { return { ... }; }
 *   buildDeps(): MyDeps { return { ... }; }
 * }
 * ```
 */

import { Logger } from "@nestjs/common";
import type { BusinessTeamStageBindings } from "./abstractions/business-team-stage-bindings.interface";

export abstract class BusinessTeamStageBindingsFramework<
  TCtxArgs,
  TCtx,
  TDeps,
> implements BusinessTeamStageBindings<TCtxArgs, TCtx, TDeps> {
  protected readonly log: Logger;

  constructor(loggerLabel?: string) {
    this.log = new Logger(
      loggerLabel ?? this.constructor.name ?? "BusinessTeamStageBindings",
    );
  }

  abstract buildCtx(args: TCtxArgs): TCtx;
  abstract buildDeps(): TDeps;
}
