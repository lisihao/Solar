/**
 * SocialEventBuffer — social.* 事件内存缓冲（B6-L3 lift：复用 framework）
 *
 * 注册为 EventBus adapter，截获所有 `social.` 前缀事件入内存，
 * 供 /replay 等回放端点读取。
 *
 * 2026-05-26 B6 lift：原 80-LOC 自实现替换为继承 BusinessTeamEventBufferFramework；
 * social 当前 v1 无 DB write-through（暂未独立 mission_events 表，后续 W5 看流量
 * 决定是否落 DB），persistEvent / fetchPersisted 走 no-op hooks。
 */

import { Injectable } from "@nestjs/common";
import {
  BusinessTeamEventBufferFramework,
  type EventBufferHooks,
} from "@/modules/ai-harness/facade";

@Injectable()
export class SocialEventBuffer extends BusinessTeamEventBufferFramework {
  constructor() {
    const hooks: EventBufferHooks = {
      adapterId: "social.mission-buffer",
      acceptsEvent: (type) => type.startsWith("social."),
      // social v1 无 DB write-through；persist no-op
      persistEvent: () => Promise.resolve(),
      // 内存 FIFO 足够，fetchPersisted 返回空
      fetchPersisted: () => Promise.resolve([]),
    };
    super(hooks, "SocialEventBuffer");
  }
}
