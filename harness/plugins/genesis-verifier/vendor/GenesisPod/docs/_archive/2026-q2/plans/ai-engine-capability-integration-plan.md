# AI Engine 能力模块集成方案

> 紧急实施计划：将 EvidenceModule 和 RealtimeModule 集成到上层应用

## 一、当前状态分析

### 已使用的能力模块

| 模块                | 使用方      | 集成方式                  |
| ------------------- | ----------- | ------------------------- |
| DataModule          | AI Research | 通过 `DATA_FEATURE` 注入  |
| CollaborationModule | AI Research | 通过 Todo/Review 服务     |
| QualityModule       | AI Writing  | 自建版本（未使用 Engine） |

### 未使用的能力模块

| 模块               | 核心能力                         | 潜在使用方                      |
| ------------------ | -------------------------------- | ------------------------------- |
| **EvidenceModule** | 证据存储、引用格式化、可信度评分 | AI Research, AI Writing, AI Ask |
| **RealtimeModule** | 实时事件推送、进度追踪、房间管理 | 所有长时间任务应用              |

---

## 二、集成优先级

### P0 - 立即集成（本周）

1. **RealtimeModule → AI Research**
   - 替换 `ResearchEventEmitterService` 的底层实现
   - 统一事件格式和房间管理

2. **RealtimeModule → AI Writing**
   - 替换 `WritingEventEmitterService` 的底层实现
   - 支持章节写作进度追踪

### P1 - 短期集成（两周内）

3. **EvidenceModule → AI Research**
   - 现有 `TopicEvidence` 迁移到 `engine_evidences`
   - 统一证据管理和引用格式化

4. **RealtimeModule → AI Office**
   - PPT 生成进度推送
   - 多步骤任务状态同步

### P2 - 中期集成（一个月内）

5. **EvidenceModule → AI Writing**
   - 写作素材来源追踪
   - 故事设定引用管理

6. **RealtimeModule → AI Teams**
   - 多 Agent 协作状态同步
   - 投票进度实时推送

---

## 三、详细集成方案

### 3.1 RealtimeModule 集成

#### 现状问题

各应用自建 EventEmitter 服务，存在：

- 代码重复（每个应用 300-900 行）
- 无统一的房间管理
- 无订阅限制和清理机制
- 进度计算逻辑分散

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│ AI Research │ AI Writing  │ AI Office   │ AI Teams         │
│ EventAdapter│ EventAdapter│ EventAdapter│ EventAdapter     │
└──────┬──────┴──────┬──────┴──────┬──────┴────────┬─────────┘
       │             │             │               │
       └─────────────┴──────┬──────┴───────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│                 AI Engine Realtime Module                     │
├─────────────────────────────────────────────────────────────┤
│  EngineEventEmitterService  │  ProgressTrackerService        │
│  - subscribe/unsubscribe    │  - startTracking               │
│  - emit (房间级别)          │  - updateProgress (加权计算)   │
│  - broadcast (全局)         │  - getProgress                 │
│  - 订阅限制 (10000)         │  - 进度边界检查 (0-100)        │
└─────────────────────────────────────────────────────────────┘
```

#### 集成步骤

**Step 1: 创建应用适配器**

```typescript
// backend/src/modules/ai-app/research/topic-research/services/core/research-realtime.adapter.ts

import { Injectable } from "@nestjs/common";
import { EngineEventEmitterService } from "@/modules/ai-engine/realtime/services/engine-event-emitter.service";
import { ProgressTrackerService } from "@/modules/ai-engine/realtime/services/progress-tracker.service";
import {
  ResearchEventType,
  MissionProgressData,
  AgentWorkingData,
} from "./research-event-emitter.service";

@Injectable()
export class ResearchRealtimeAdapter {
  constructor(
    private readonly engineEmitter: EngineEventEmitterService,
    private readonly progressTracker: ProgressTrackerService,
  ) {}

  /**
   * 启动任务进度追踪
   */
  startMissionTracking(topicId: string, missionId: string, phases: string[]) {
    return this.progressTracker.startTracking(
      missionId,
      phases.map((name) => ({
        name,
        weight: 1 / phases.length,
      })),
    );
  }

  /**
   * 发送事件到专题房间
   */
  async emitToTopic(topicId: string, event: ResearchEventType, data: unknown) {
    return this.engineEmitter.emit(`research:${topicId}`, event, data);
  }

  /**
   * 更新任务进度
   */
  async updateMissionProgress(
    missionId: string,
    phase: string,
    progress: number,
  ) {
    await this.progressTracker.updateProgress(missionId, phase, progress);
    const overall = await this.progressTracker.getProgress(missionId);
    return overall;
  }
}
```

**Step 2: 修改 ResearchEventEmitterService**

```typescript
// 在 ResearchEventEmitterService 中注入适配器
constructor(
  private readonly prisma: PrismaService,
  private readonly nestEventEmitter: EventEmitter2,
  private readonly realtimeAdapter: ResearchRealtimeAdapter, // 新增
) {}

// 修改 emitToTopic 方法
async emitToTopic(topicId: string, event: ResearchEventType | string, data: unknown): Promise<void> {
  // 使用 Engine Realtime 模块
  await this.realtimeAdapter.emitToTopic(topicId, event, {
    timestamp: new Date().toISOString(),
    ...this.normalizeEventData(data),
  });

  // 保持原有的本地 handler（向后兼容）
  if (this.emitHandler) {
    await this.emitHandler(topicId, event, data);
  }
}
```

**Step 3: 注册模块依赖**

```typescript
// topic-research.module.ts
import { RealtimeModule } from "@/modules/ai-engine/realtime/realtime.module";

@Module({
  imports: [
    RealtimeModule, // 新增
    // ...
  ],
  providers: [
    ResearchRealtimeAdapter, // 新增
    // ...
  ],
})
export class TopicResearchModule {}
```

---

### 3.2 EvidenceModule 集成

#### 现状问题

AI Research 有独立的证据管理：

- `TopicEvidence` 表 - 与报告强绑定
- `EvidenceManagementService` - 仅支持研究场景
- 无引用格式化能力

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
├─────────────────┬─────────────────┬────────────────────────┤
│ AI Research     │ AI Writing      │ AI Ask                 │
│ EvidenceAdapter │ EvidenceAdapter │ RAGSourceAdapter       │
└────────┬────────┴────────┬────────┴───────────┬────────────┘
         │                 │                     │
         └─────────────────┴──────────┬──────────┘
                                      │
┌─────────────────────────────────────▼────────────────────────┐
│                  AI Engine Evidence Module                    │
├─────────────────────────────────────────────────────────────┤
│  EvidenceManagerService      │  CitationFormatterService     │
│  - save / saveBatch          │  - format (APA/MLA/Chicago)   │
│  - retrieve                  │  - generateBibliography       │
│  - 可信度评分                │                               │
│  - 引用计数                  │                               │
└─────────────────────────────────────────────────────────────┘
```

#### 集成步骤

**Step 1: 创建 Research Evidence 适配器**

```typescript
// backend/src/modules/ai-app/research/topic-research/services/data/research-evidence.adapter.ts

import { Injectable } from "@nestjs/common";
import {
  EvidenceManagerService,
  SaveEvidenceRequest,
  Evidence,
} from "@/modules/ai-engine/evidence";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class ResearchEvidenceAdapter {
  constructor(
    private readonly engineEvidence: EvidenceManagerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 保存研究证据（同时写入 TopicEvidence 和 engine_evidences）
   */
  async saveResearchEvidence(params: {
    reportId: string;
    analysisId?: string;
    url: string;
    title: string;
    snippet: string;
    sourceType: string;
    domain?: string;
    publishedAt?: Date;
  }): Promise<{ topicEvidenceId: string; engineEvidenceId: string }> {
    // 1. 写入原有的 TopicEvidence（保持向后兼容）
    const topicEvidence = await this.prisma.topicEvidence.create({
      data: {
        reportId: params.reportId,
        analysisId: params.analysisId,
        url: params.url,
        title: params.title,
        snippet: params.snippet,
        sourceType: params.sourceType,
        domain: params.domain,
        publishedAt: params.publishedAt,
      },
    });

    // 2. 同时写入 Engine Evidence（统一证据管理）
    const engineEvidence = await this.engineEvidence.save({
      type: this.mapSourceTypeToEvidenceType(params.sourceType),
      source: {
        url: params.url,
        title: params.title,
        domain: params.domain,
        publishedAt: params.publishedAt,
      },
      content: {
        original: params.snippet,
        snippet: params.snippet.slice(0, 500),
      },
      associations: {
        entityType: "research_report",
        entityId: params.reportId,
        context: params.analysisId
          ? `analysis:${params.analysisId}`
          : undefined,
      },
    });

    return {
      topicEvidenceId: topicEvidence.id,
      engineEvidenceId: engineEvidence.id,
    };
  }

  /**
   * 生成参考文献列表（使用 Engine 的格式化能力）
   */
  async generateBibliography(
    reportId: string,
    style: "apa" | "mla" | "chicago" = "apa",
  ): Promise<string> {
    return this.engineEvidence.generateBibliography(
      "research_report",
      reportId,
      style,
    );
  }

  private mapSourceTypeToEvidenceType(
    sourceType: string,
  ): "citation" | "reference" | "fact" {
    switch (sourceType.toLowerCase()) {
      case "academic":
        return "citation";
      case "news":
      case "web":
        return "reference";
      default:
        return "fact";
    }
  }
}
```

**Step 2: 修改 DataEnrichmentService**

```typescript
// backend/src/modules/ai-app/research/topic-research/services/data/data-enrichment.service.ts

// 在保存证据时使用适配器
async enrichAndSaveEvidence(reportId: string, searchResults: SearchResult[]) {
  for (const result of searchResults) {
    await this.researchEvidenceAdapter.saveResearchEvidence({
      reportId,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      sourceType: result.sourceType,
      domain: result.domain,
      publishedAt: result.publishedAt,
    });
  }
}
```

---

## 四、数据迁移方案

### 4.1 TopicEvidence → engine_evidences 迁移

```sql
-- 迁移脚本：将现有 TopicEvidence 数据同步到 engine_evidences
-- 执行时机：在应用适配器上线后，逐步迁移历史数据

INSERT INTO engine_evidences (
  id,
  type,
  source_url,
  source_title,
  source_domain,
  source_published_at,
  content_original,
  content_snippet,
  entity_type,
  entity_id,
  context,
  relevance_score,
  credibility_score,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  CASE
    WHEN source_type = 'academic' THEN 'CITATION'
    WHEN source_type IN ('news', 'web') THEN 'REFERENCE'
    ELSE 'FACT'
  END,
  url,
  title,
  domain,
  published_at,
  snippet,
  LEFT(snippet, 500),
  'research_report',
  report_id,
  CASE WHEN analysis_id IS NOT NULL THEN CONCAT('analysis:', analysis_id) ELSE NULL END,
  0.5,
  credibility_score::double precision / 100,
  created_at,
  NOW()
FROM topic_evidence
WHERE NOT EXISTS (
  SELECT 1 FROM engine_evidences e
  WHERE e.entity_id = topic_evidence.report_id
    AND e.source_url = topic_evidence.url
);
```

### 4.2 事件系统迁移

事件系统不需要数据迁移，只需要：

1. 更新服务注入
2. 保持事件类型兼容
3. 前端无需修改

---

## 五、实施时间表

### Week 1 (P0)

| 天数    | 任务                         | 负责模块    |
| ------- | ---------------------------- | ----------- |
| Day 1-2 | 创建 ResearchRealtimeAdapter | AI Research |
| Day 2-3 | 集成 ProgressTrackerService  | AI Research |
| Day 3-4 | 创建 WritingRealtimeAdapter  | AI Writing  |
| Day 4-5 | 测试和修复                   | 全部        |

### Week 2 (P1)

| 天数    | 任务                         | 负责模块    |
| ------- | ---------------------------- | ----------- |
| Day 1-2 | 创建 ResearchEvidenceAdapter | AI Research |
| Day 2-3 | 修改 DataEnrichmentService   | AI Research |
| Day 3-4 | 创建 OfficeRealtimeAdapter   | AI Office   |
| Day 4-5 | 数据迁移脚本测试             | 全部        |

### Week 3-4 (P2)

| 天数   | 任务                   | 负责模块   |
| ------ | ---------------------- | ---------- |
| Week 3 | WritingEvidenceAdapter | AI Writing |
| Week 3 | TeamsRealtimeAdapter   | AI Teams   |
| Week 4 | 历史数据迁移           | 全部       |
| Week 4 | 监控和优化             | 全部       |

---

## 六、风险和缓解措施

### 风险 1: 事件格式不兼容

**缓解**: 适配器模式保持原有事件类型，Engine 层做标准化

### 风险 2: 性能下降

**缓解**:

- RealtimeModule 已有订阅限制 (10000)
- 进度更新有边界检查
- 批量操作有分批处理

### 风险 3: 数据迁移失败

**缓解**:

- 双写策略：新数据同时写入两个表
- 迁移脚本可重复执行
- 保留原有表结构

---

## 七、验收标准

### RealtimeModule 集成

- [ ] AI Research 进度事件通过 Engine 发送
- [ ] AI Writing 章节进度通过 Engine 发送
- [ ] 前端无需修改即可接收事件
- [ ] 订阅数不超过 10000

### EvidenceModule 集成

- [ ] 新证据同时写入 TopicEvidence 和 engine_evidences
- [ ] 可以生成 APA/MLA 格式参考文献
- [ ] 历史数据迁移成功率 > 99%

---

## 八、附录：关键文件路径

### Engine 能力模块

```
backend/src/modules/ai-engine/
├── realtime/
│   ├── services/
│   │   ├── engine-event-emitter.service.ts  # 事件发射
│   │   └── progress-tracker.service.ts      # 进度追踪
│   └── abstractions/
│       └── event-emitter.interface.ts       # 接口定义
├── evidence/
│   ├── services/
│   │   ├── evidence-manager.service.ts      # 证据管理
│   │   └── citation-formatting.utils.service.ts    # 引用格式化
│   └── abstractions/
│       └── evidence.interface.ts            # 接口定义
```

### 待集成的应用服务

```
backend/src/modules/ai-app/
├── research/topic-research/services/
│   ├── core/research-event-emitter.service.ts   # 待替换
│   └── data/evidence-management.service.ts      # 待增强
├── writing/services/
│   └── events/writing-event-emitter.service.ts  # 待替换
├── office/slides/services/
│   └── slides-metrics.service.ts                # 待集成
└── teams/services/events/
    └── topic-event-emitter.service.ts           # 待替换
```

---

**文档版本**: 1.0
**创建日期**: 2026-02-03
**作者**: Claude Code

