# 数据采集系统实施路线图

## 文档信息

- **版本**: v1.0
- **创建日期**: 2025-11-21
- **项目周期**: 9周（约2.5个月）
- **开始日期**: 2025-11-25
- **预计完成**: 2026-02-01

---

## 一、项目总览

### 1.1 项目目标

**彻底重构**数据采集系统，解决当前存在的4个致命问题：

1. ✅ 原始数据100%完整
2. ✅ 建立PostgreSQL ↔ MongoDB双向引用
3. ✅ 去重准确率 >98%
4. ✅ 支持15+个数据源，日采集量500+条

### 1.2 项目里程碑

```
Week 1-2: 基础架构优化 ━━━━━━━━━━━━━━━━━━━━━━━ 100%
Week 3-4: 数据源扩展     ━━━━━━━━━━━━━━━━━━━━━━━ 100%
Week 5:   任务调度系统   ━━━━━━━━━━━━━━━━━━━━━━━ 100%
Week 6:   数据质量保障   ━━━━━━━━━━━━━━━━━━━━━━━ 100%
Week 7-8: UI开发         ━━━━━━━━━━━━━━━━━━━━━━━ 100%
Week 9:   测试和上线     ━━━━━━━━━━━━━━━━━━━━━━━ 100%
```

---

## 二、Phase 1: 基础架构优化（Week 1-2）

### Week 1: 数据模型重构

#### 目标

- ✅ 修复数据完整性问题
- ✅ 建立双向引用机制
- ✅ 确保数据可追溯

#### 任务清单

**Day 1-2: Prisma Schema更新**

- [ ] 更新 `backend/prisma/schema.prisma`
  - [ ] 增强 `Resource` 模型（添加新字段）
  - [ ] 创建 `CollectionTask` 模型
  - [ ] 创建 `DataSource` 模型
  - [ ] 创建 `DeduplicationRecord` 模型
  - [ ] 创建 `DataQualityMetric` 模型
- [ ] 创建数据库迁移
  ```bash
  npx prisma migrate dev --name enhance_data_collection
  ```
- [ ] 运行迁移到开发环境

**Day 3-4: MongoDB Schema设计**

- [ ] 创建 `backend/src/schemas/raw-data.schema.ts`
  ```typescript
  interface RawDataDocument {
    _id: ObjectId;
    source: string;
    sourceType: string;
    data: any; // 完整原始数据
    collectionMetadata: CollectionMetadata;
    deduplication: DeduplicationInfo;
    processingStatus: ProcessingStatus;
    quality: QualityInfo;
    resourceId: string; // ⭐ PostgreSQL关联
    createdAt: Date;
    updatedAt: Date;
  }
  ```
- [ ] 创建MongoDB索引
- [ ] 编写Schema验证器

**Day 5: 双向引用机制实现**

- [ ] 创建 `backend/src/modules/common/storage/storage.service.ts`

  ```typescript
  class StorageService {
    async storeWithReference(data: ParsedItem): Promise<{
      rawDoc: any;
      resource: Resource;
    }> {
      // 1. 插入MongoDB
      const rawDoc = await this.mongo.insertOne({...});

      // 2. 创建PostgreSQL资源
      const resource = await this.prisma.resource.create({
        data: { rawDataId: rawDoc._id.toString() }
      });

      // 3. 回写resourceId
      await this.mongo.updateOne(
        { _id: rawDoc._id },
        { $set: { resourceId: resource.id } }
      );

      return { rawDoc, resource };
    }
  }
  ```

- [ ] 编写单元测试

**验收标准**：

- ✅ 所有Prisma模型创建完成
- ✅ MongoDB Schema定义完成
- ✅ 双向引用机制测试通过
- ✅ 能成功存储一条完整数据并验证引用关系

---

### Week 2: 去重引擎开发

#### 目标

- ✅ 实现4层去重机制
- ✅ 去重准确率 >98%
- ✅ 去重性能 <100ms/条

#### 任务清单

**Day 1-2: URL哈希去重**

- [ ] 创建 `backend/src/modules/data-collection/services/deduplication-engine.service.ts`
- [ ] 实现URL规范化算法
  ```typescript
  normalizeUrl(url: string): string {
    // 1. 转小写
    // 2. 移除协议差异
    // 3. 移除www.前缀
    // 4. 移除尾部斜杠
    // 5. 移除utm_参数
    // 6. 移除#hash
  }
  ```
- [ ] 实现MD5哈希计算
- [ ] 集成Redis缓存（O(1)查询）
- [ ] 编写测试用例

**Day 3-4: 标题相似度去重**

- [ ] 安装依赖
  ```bash
  npm install fastest-levenshtein
  ```
- [ ] 实现标题规范化
- [ ] 实现Levenshtein距离计算
- [ ] 实现相似度阈值检测（0.85）
- [ ] 优化：引入MinHash加速（可选）
- [ ] 编写测试用例

**Day 5: 内容指纹去重**

- [ ] 实现SimHash算法
  ```typescript
  generateContentFingerprint(content: string): string {
    // 1. 分词
    // 2. 计算每个词的哈希
    // 3. 加权向量累加
    // 4. 生成64位指纹
  }
  ```
- [ ] 实现汉明距离计算
- [ ] 设置阈值（≤3位差异）
- [ ] 编写测试用例

**Day 6: 作者+时间去重**

- [ ] 实现组合键生成
  ```typescript
  generateAuthorTimeKey(authors: string[], date: Date): string {
    const sortedAuthors = authors.slice(0, 3).sort();
    const dateKey = date.toISOString().split('T')[0];
    return MD5(`${sortedAuthors.join('_')}:${dateKey}`);
  }
  ```
- [ ] Redis索引存储
- [ ] 编写测试用例

**Day 7: 集成测试**

- [ ] 综合去重测试
- [ ] 性能测试（目标 <100ms）
- [ ] 准确率测试（目标 >98%）
- [ ] 编写测试报告

**验收标准**：

- ✅ 4层去重机制全部实现
- ✅ 单元测试覆盖率 >80%
- ✅ 去重性能 <100ms/条
- ✅ 去重准确率 >98%（手动标注100条测试）

---

## 三、Phase 2: 数据源扩展（Week 3-4）

### Week 3: 新增爬虫实现

#### 目标

- ✅ 实现5个新爬虫（Medium、YouTube、PubMed、Policy、通用RSS）
- ✅ 所有爬虫继承统一基类

#### 任务清单

**Day 1: 爬虫基类设计**

- [ ] 创建 `backend/src/modules/crawler/base-crawler.service.ts`

  ```typescript
  abstract class BaseCrawlerService {
    abstract fetchData(config): Promise<any[]>;
    abstract parseData(rawItems): Promise<ParsedItem[]>;

    async collect(config): Promise<CollectionResult> {
      const rawItems = await this.fetchData(config);
      const parsedItems = await this.parseData(rawItems);
      const uniqueItems = await this.deduplicateItems(parsedItems);
      const results = await this.storeItems(uniqueItems);
      return this.generateReport(results);
    }
  }
  ```

- [ ] 实现通用方法（去重、存储、报告生成）
- [ ] 编写测试

**Day 2: Medium博客爬虫**

- [ ] 创建 `backend/src/modules/crawler/medium.service.ts`
- [ ] 支持RSS Feed采集
- [ ] 支持按标签采集（#AI、#MachineLearning）
- [ ] 提取完整文章内容（HTML → Markdown）
- [ ] 测试采集50篇文章

**Day 3: YouTube视频爬虫**

- [ ] 安装依赖
  ```bash
  npm install youtube-transcript
  ```
- [ ] 创建 `backend/src/modules/crawler/youtube.service.ts`
- [ ] 集成YouTube Data API v3
- [ ] 提取视频元数据（标题、描述、统计）
- [ ] 提取视频字幕（英文/中文）
- [ ] 测试采集20个视频

**Day 4: PubMed论文爬虫**

- [ ] 创建 `backend/src/modules/crawler/pubmed.service.ts`
- [ ] 集成PubMed E-utilities API
- [ ] 支持按关键词搜索
- [ ] 提取论文完整元数据（PMID、DOI、作者、摘要）
- [ ] 测试采集50篇论文

**Day 5: 政策文件爬虫**

- [ ] 创建 `backend/src/modules/crawler/policy.service.ts`
- [ ] 实现美国政策采集（whitehouse.gov, congress.gov）
- [ ] 实现欧盟政策采集（ec.europa.eu）
- [ ] PDF文档下载和文本提取
- [ ] 测试采集10份政策文件

**Day 6-7: 通用RSS爬虫**

- [ ] 安装依赖
  ```bash
  npm install rss-parser
  ```
- [ ] 创建 `backend/src/modules/crawler/rss.service.ts`
- [ ] 支持任意RSS Feed URL
- [ ] 自动检测Feed格式（RSS 2.0、Atom）
- [ ] 提取文章内容（支持全文RSS和摘要RSS）
- [ ] 测试采集多个RSS源

**验收标准**：

- ✅ 5个新爬虫全部实现
- ✅ 每个爬虫能成功采集测试数据
- ✅ 所有原始数据100%保存到MongoDB
- ✅ 双向引用正确建立

---

### Week 4: 爬虫优化和测试

#### 目标

- ✅ 反爬虫机制
- ✅ 并发控制
- ✅ 错误处理和重试

#### 任务清单

**Day 1-2: 反爬虫机制**

- [ ] 安装依赖
  ```bash
  npm install p-queue p-limit
  npm install playwright
  ```
- [ ] 实现User-Agent轮换
  ```typescript
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    // ... 10+个User-Agent
  ];
  ```
- [ ] 实现代理池（可选）
- [ ] 实现请求延迟（rate limiting）
- [ ] Playwright集成（处理动态网页）

**Day 3-4: 并发控制**

- [ ] 创建 `backend/src/modules/crawler/concurrency-manager.service.ts`

  ```typescript
  class ConcurrencyManager {
    private queues: Map<string, PQueue>;

    getQueue(sourceType: string): PQueue {
      if (!this.queues.has(sourceType)) {
        this.queues.set(
          sourceType,
          new PQueue({
            concurrency: this.getConcurrency(sourceType),
          }),
        );
      }
      return this.queues.get(sourceType);
    }
  }
  ```

- [ ] 配置每个数据源的并发数
- [ ] 实现全局并发限制
- [ ] 测试高并发场景

**Day 5: 错误处理和重试**

- [ ] 实现指数退避重试
  ```typescript
  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.sleep(Math.pow(2, i) * 1000);
      }
    }
  }
  ```
- [ ] 实现错误分类（网络错误、解析错误、业务错误）
- [ ] 实现错误日志记录
- [ ] 编写测试

**Day 6-7: 集成测试**

- [ ] 端到端测试（每个爬虫）
- [ ] 压力测试（1000条数据采集）
- [ ] 稳定性测试（24小时运行）
- [ ] 性能优化

**验收标准**：

- ✅ 所有爬虫支持反爬虫机制
- ✅ 并发控制正常工作
- ✅ 错误重试机制有效
- ✅ 24小时稳定性测试通过

---

## 四、Phase 3: 任务调度系统（Week 5）

### Week 5: BullMQ集成

#### 目标

- ✅ 实现分布式任务队列
- ✅ 支持Cron定时调度
- ✅ 实现任务监控和日志

#### 任务清单

**Day 1: BullMQ安装和配置**

- [ ] 安装依赖
  ```bash
  npm install bullmq ioredis
  npm install @nestjs/bullmq
  ```
- [ ] 创建 `backend/src/modules/queue/queue.module.ts`
- [ ] 配置Redis连接
- [ ] 创建队列定义
  ```typescript
  @Module({
    imports: [
      BullModule.forRoot({
        connection: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT),
        },
      }),
      BullModule.registerQueue({
        name: "data-collection",
      }),
    ],
  })
  export class QueueModule {}
  ```

**Day 2: 任务生产者**

- [ ] 创建 `backend/src/modules/queue/producers/collection-producer.service.ts`

  ```typescript
  @Injectable()
  export class CollectionProducer {
    constructor(@InjectQueue("data-collection") private queue: Queue) {}

    async scheduleCollection(config: CollectionConfig): Promise<Job> {
      return this.queue.add("collect", config, {
        priority: config.priority,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });
    }
  }
  ```

- [ ] 实现任务优先级
- [ ] 实现任务去重（防止重复调度）

**Day 3: 任务消费者**

- [ ] 创建 `backend/src/modules/queue/processors/collection-processor.service.ts`

  ```typescript
  @Processor("data-collection")
  export class CollectionProcessor {
    @Process("collect")
    async handleCollect(job: Job<CollectionConfig>) {
      const { sourceId, config } = job.data;

      // 获取对应的爬虫
      const crawler = this.getCrawler(sourceId);

      // 执行采集
      const result = await crawler.collect(config);

      // 更新进度
      await job.updateProgress(100);

      return result;
    }
  }
  ```

- [ ] 实现进度追踪
- [ ] 实现错误处理

**Day 4: Cron定时调度**

- [ ] 创建 `backend/src/modules/scheduler/scheduler.service.ts`

  ```typescript
  @Injectable()
  export class SchedulerService {
    async setupSchedules() {
      // 从数据库读取所有活跃的采集规则
      const rules = await this.prisma.collectionTask.findMany({
        where: { status: "ACTIVE", schedule: { not: null } },
      });

      // 为每个规则创建定时任务
      for (const rule of rules) {
        await this.queue.add("collect", rule.sourceConfig, {
          repeat: { pattern: rule.schedule },
        });
      }
    }
  }
  ```

- [ ] 实现动态调度（增删改规则）
- [ ] 测试Cron表达式解析

**Day 5: 任务监控**

- [ ] 创建 `backend/src/modules/queue/queue-monitor.service.ts`

  ```typescript
  @Injectable()
  export class QueueMonitorService {
    async getQueueStatus(): Promise<QueueStatus> {
      const [waiting, active, completed, failed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
      ]);

      return { waiting, active, completed, failed };
    }
  }
  ```

- [ ] 实现WebSocket实时推送
- [ ] 创建监控API端点

**Day 6-7: 集成测试**

- [ ] 测试任务调度
- [ ] 测试Cron定时执行
- [ ] 测试任务失败重试
- [ ] 测试任务监控
- [ ] 性能测试

**验收标准**：

- ✅ BullMQ集成完成
- ✅ 定时任务正常执行
- ✅ 任务监控实时更新
- ✅ 失败重试机制有效

---

## 五、Phase 4: 数据质量保障（Week 6）

### Week 6: 质量评估和问题检测

#### 目标

- ✅ 实现质量评分算法
- ✅ 自动检测质量问题
- ✅ 提供修复建议

#### 任务清单

**Day 1-2: 质量评分服务**

- [ ] 创建 `backend/src/modules/data-collection/services/quality-assessment.service.ts`
- [ ] 实现完整性评分（40%）
- [ ] 实现准确性评分（30%）
- [ ] 实现时效性评分（20%）
- [ ] 实现可用性评分（10%）
- [ ] 编写测试用例

**Day 3: 质量问题检测**

- [ ] 实现问题检测器

  ```typescript
  class QualityIssueDetector {
    detect(resource: Resource): QualityIssue[] {
      const issues: QualityIssue[] = [];

      if (!resource.title || resource.title.length < 10) {
        issues.push({
          type: "MISSING_TITLE",
          severity: "HIGH",
          message: "标题缺失或过短",
          suggestion: "从PDF或内容中提取标题",
        });
      }

      // ... 更多检测规则

      return issues;
    }
  }
  ```

- [ ] 实现问题严重程度分级
- [ ] 编写测试

**Day 4: 自动修复**

- [ ] 创建 `backend/src/modules/data-collection/services/quality-fixer.service.ts`
  ```typescript
  class QualityFixerService {
    async fixIssue(issue: QualityIssue): Promise<FixResult> {
      switch (issue.type) {
        case "MISSING_TITLE":
          return await this.extractTitleFromContent();
        case "INCOMPLETE_METADATA":
          return await this.recrawlMetadata();
        case "URL_INVALID":
          return await this.findAlternativeUrl();
        default:
          return { fixed: false, message: "无法自动修复" };
      }
    }
  }
  ```
- [ ] 实现常见问题的自动修复
- [ ] 编写测试

**Day 5: 质量报告生成**

- [ ] 创建 `backend/src/modules/data-collection/services/quality-reporter.service.ts`
- [ ] 实现日报生成
- [ ] 实现周报生成
- [ ] 实现趋势分析

**Day 6-7: API和集成测试**

- [ ] 创建质量管理API

  ```typescript
  @Controller("api/v1/data-collection/quality")
  export class QualityController {
    @Get("overview")
    async getOverview() {}

    @Get("issues")
    async getIssues(@Query() query) {}

    @Post("issues/:id/fix")
    async fixIssue(@Param("id") id: string) {}
  }
  ```

- [ ] 集成测试
- [ ] 性能测试

**验收标准**：

- ✅ 质量评分算法实现完成
- ✅ 能自动检测10+种质量问题
- ✅ 能自动修复5+种常见问题
- ✅ 质量报告自动生成

---

## 六、Phase 5: UI开发（Week 7-8）

### Week 7: 核心页面开发

#### 目标

- ✅ 完成3个核心页面

#### 任务清单

**Day 1-2: 采集总览仪表盘**

- [ ] 创建 `frontend/app/data-collection/dashboard/page.tsx`
- [ ] 实现关键指标卡片
- [ ] 实现7天趋势图（Recharts）
- [ ] 实现数据源分类统计
- [ ] 实现实时任务状态
- [ ] WebSocket集成

**Day 3-4: 数据源管理页面**

- [ ] 创建 `frontend/app/data-collection/sources/page.tsx`
- [ ] 实现数据源列表（Table）
- [ ] 实现添加数据源向导（Multi-step Form）
- [ ] 实现批量操作
- [ ] 实现测试连接功能

**Day 5-7: 采集计划管理页面**

- [ ] 创建 `frontend/app/data-collection/scheduler/page.tsx`
- [ ] 实现今日计划时间轴
- [ ] 实现计划列表
- [ ] 实现创建/编辑计划表单
- [ ] Cron表达式可视化编辑器

**验收标准**：

- ✅ 3个核心页面UI完成
- ✅ 所有API集成完成
- ✅ 响应式设计适配

---

### Week 8: 监控和质量页面

#### 目标

- ✅ 完成实时监控和质量管理页面

#### 任务清单

**Day 1-3: 实时监控页面**

- [ ] 创建 `frontend/app/data-collection/monitor/page.tsx`
- [ ] 实现系统状态监控
- [ ] 实现正在执行的任务展示
- [ ] 实现实时日志流（WebSocket）
- [ ] 实现任务控制（暂停、停止）

**Day 4-6: 数据质量管理页面**

- [ ] 创建 `frontend/app/data-collection/quality/page.tsx`
- [ ] 实现质量概览
- [ ] 实现质量问题列表
- [ ] 实现问题处理（自动修复、手动处理）
- [ ] 实现质量趋势图

**Day 7: 采集历史页面**

- [ ] 创建 `frontend/app/data-collection/history/page.tsx`
- [ ] 实现历史记录表格
- [ ] 实现统计报表
- [ ] 实现导出功能（Excel/PDF）

**验收标准**：

- ✅ 所有页面UI完成
- ✅ WebSocket实时推送正常
- ✅ 所有功能测试通过

---

## 七、Phase 6: 测试和上线（Week 9）

### Week 9: 全面测试和部署

#### 目标

- ✅ 确保系统稳定可靠
- ✅ 成功部署到生产环境

#### 任务清单

**Day 1-2: 单元测试**

- [ ] 后端单元测试覆盖率 >80%
  ```bash
  npm run test:cov
  ```
- [ ] 前端组件测试
- [ ] 修复所有测试失败

**Day 3-4: 集成测试**

- [ ] 端到端测试（Playwright）
- [ ] API集成测试
- [ ] 数据库集成测试
- [ ] 修复集成问题

**Day 5: 性能测试**

- [ ] 负载测试（k6）
  ```javascript
  export default function () {
    http.post("http://localhost:3000/api/v1/crawler/arxiv/latest", {
      headers: { "Content-Type": "application/json" },
    });
  }
  ```
- [ ] 并发测试（100并发）
- [ ] 内存泄漏检测
- [ ] 性能优化

**Day 6: 部署准备**

- [ ] 环境变量配置
- [ ] Docker镜像构建
- [ ] 数据库迁移脚本
- [ ] 部署文档编写

**Day 7: 正式部署**

- [ ] 部署到Staging环境
- [ ] 验证Staging环境
- [ ] 部署到Production环境
- [ ] 监控系统运行

**验收标准**：

- ✅ 单元测试覆盖率 >80%
- ✅ 所有集成测试通过
- ✅ 性能满足目标（50条/分钟）
- ✅ 成功部署到生产环境

---

## 八、上线后（Week 10+）

### 8.1 监控和优化（Week 10-12）

- [ ] 监控系统运行24/7
- [ ] 收集用户反馈
- [ ] 修复发现的Bug
- [ ] 性能优化

### 8.2 功能增强（Week 13+）

- [ ] 增加更多数据源（目标15+）
- [ ] 优化去重算法（引入Bloom Filter）
- [ ] 增强AI分析能力
- [ ] 实现数据仓库（OLAP分析）

---

## 九、风险管理

### 9.1 技术风险

| 风险           | 影响 | 概率 | 应对措施              | 责任人   |
| -------------- | ---- | ---- | --------------------- | -------- |
| 反爬虫限制     | 高   | 高   | 代理池、限速、备用API | 后端开发 |
| 数据迁移失败   | 高   | 中   | 完整备份、灰度迁移    | DBA      |
| 性能瓶颈       | 中   | 中   | 分布式部署、队列优化  | 架构师   |
| BullMQ学习曲线 | 低   | 中   | 提前学习、POC验证     | 后端开发 |

### 9.2 进度风险

| 风险       | 影响 | 概率 | 应对措施             |
| ---------- | ---- | ---- | -------------------- |
| 开发延期   | 中   | 中   | 每周Review、灵活调整 |
| 测试不充分 | 高   | 低   | 预留充足测试时间     |
| 依赖库问题 | 低   | 低   | 选择成熟稳定的库     |

---

## 十、资源分配

### 10.1 团队配置

| 角色       | 人数 | 主要职责          |
| ---------- | ---- | ----------------- |
| 后端开发   | 2    | 爬虫、API、数据库 |
| 前端开发   | 1    | UI页面、WebSocket |
| 测试工程师 | 1    | 测试、质量保证    |
| 产品经理   | 1    | 需求、验收        |

### 10.2 开发环境

| 环境        | 用途     | 配置              |
| ----------- | -------- | ----------------- |
| Development | 本地开发 | Docker Compose    |
| Staging     | 测试验证 | 云服务器（2核4G） |
| Production  | 生产环境 | 云服务器（4核8G） |

---

## 十一、成功指标

### 11.1 技术指标

| 指标       | 当前值 | 目标值 | 验证方式      |
| ---------- | ------ | ------ | ------------- |
| 数据完整性 | ~30%   | >95%   | 人工抽查100条 |
| 去重准确率 | 0%     | >98%   | 标注测试集    |
| 采集成功率 | ~50%   | >95%   | 监控统计      |
| 平均质量分 | 未知   | >8.0   | 自动评分      |
| 日采集量   | ~100   | 500+   | 统计报表      |
| 数据源数量 | 3      | 15+    | 系统配置      |

### 11.2 业务指标

| 指标         | 目标值 |
| ------------ | ------ |
| 用户满意度   | >85%   |
| 系统稳定性   | >99.5% |
| 平均响应时间 | <2s    |
| 错误率       | <1%    |

---

## 十二、附录

### A. 每日站会

- **时间**: 每天上午10:00
- **时长**: 15分钟
- **内容**:
  - 昨天完成了什么
  - 今天计划做什么
  - 遇到了什么问题

### B. 每周Review

- **时间**: 每周五下午3:00
- **时长**: 1小时
- **内容**:
  - 本周进度汇报
  - Demo演示
  - 下周计划
  - 风险识别

### C. 相关文档

- [产品需求文档](../prd/data-collection-system-v3.0.md)
- [技术架构文档](./architecture.md)
- [数据模型设计](./data-model.md)

---

**项目状态**: 🟢 Ready to Start
**下次更新**: 2025-11-25 (项目启动会)
