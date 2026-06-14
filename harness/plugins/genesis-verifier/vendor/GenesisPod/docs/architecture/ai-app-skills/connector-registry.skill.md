---
name: connector-registry
description: |
  Data source connector registry pattern for AI App modules. Defines the IDataSourceConnector
  interface, registry with health checks, and plugin-style connector registration.
  Use when: external-api-integration, data-connector, plugin-system, adapter-registry.
version: "2.0.0"
domain: general
layer: content
taskTypes:
  - connector-implementation
  - api-integration
  - plugin-architecture
priority: 70
author: genesis-ai
source: local
tags:
  - connector
  - registry
  - adapter
  - plugin
  - data-source
  - best-practice
tokenBudget: 2000
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: medium
---

# 数据源连接器注册 Skill

## 角色定位

你是 GenesisPod 平台的集成架构师，负责设计外部数据源的插件化接入框架。你的标准来自 Topic Insights 的 DataSourceConnectorRegistry。

## 核心原则

**新增数据源只需实现一个接口 + 在 onModuleInit 注册，不改框架代码。Registry 负责健康检查和故障隔离。**

## 连接器接口

```typescript
// 所有连接器实现这个接口
interface IDataSourceConnector {
  // 连接器标识
  readonly sourceType: DataSourceType;
  readonly name: string;

  // 核心能力：搜索
  search(
    query: string,
    maxResults: number,
    options?: ConnectorOptions,
  ): Promise<DataSourceResult[]>;

  // 可选：健康检查
  healthCheck?(): Promise<ConnectorHealth>;

  // 可选：支持的查询类型
  getSupportedQueryTypes?(): string[];
}

// 搜索结果标准结构
interface DataSourceResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: Date;
  source: string; // 来源名称
  sourceType: DataSourceType;
  metadata?: Record<string, unknown>;
}

// 健康状态
interface ConnectorHealth {
  healthy: boolean;
  latency: number; // 毫秒
  lastChecked: Date;
  error?: string;
}

// 连接器配置
interface ConnectorOptions {
  since?: Date; // 时间范围
  language?: string; // 语言过滤
  signal?: AbortSignal; // 取消信号
  [key: string]: unknown;
}
```

## 连接器注册表

```typescript
@Injectable()
export class ConnectorRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorRegistry.name);
  private connectors = new Map<DataSourceType, ConnectorRegistration>();
  private healthCheckInterval?: NodeJS.Timeout;

  interface ConnectorRegistration {
    connector: IDataSourceConnector;
    health: ConnectorHealth;
    registeredAt: Date;
  }

  // ★ 启动时开始周期性健康检查
  onModuleInit(): void {
    this.healthCheckInterval = setInterval(
      () => void this.runHealthChecks(),
      5 * 60 * 1000,  // 每 5 分钟
    );
  }

  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  // ★ 注册连接器
  register(connector: IDataSourceConnector): void {
    if (this.connectors.has(connector.sourceType)) {
      this.logger.warn(`Overriding connector for ${connector.sourceType}`);
    }

    this.connectors.set(connector.sourceType, {
      connector,
      health: { healthy: true, latency: 0, lastChecked: new Date() },
      registeredAt: new Date(),
    });

    this.logger.log(`Registered connector: ${connector.name} (${connector.sourceType})`);
  }

  // ★ 安全搜索（故障隔离）
  async search(
    sourceType: DataSourceType,
    query: string,
    maxResults: number,
    options?: ConnectorOptions,
  ): Promise<DataSourceResult[]> {
    const registration = this.connectors.get(sourceType);
    if (!registration) {
      this.logger.warn(`No connector for ${sourceType}`);
      return [];
    }

    // 跳过不健康的连接器
    if (!registration.health.healthy) {
      this.logger.warn(`Connector ${sourceType} is unhealthy, skipping`);
      return [];
    }

    try {
      const start = Date.now();
      const results = await registration.connector.search(query, maxResults, options);
      registration.health = {
        healthy: true,
        latency: Date.now() - start,
        lastChecked: new Date(),
      };
      return results;
    } catch (err) {
      registration.health = {
        healthy: false,
        latency: 0,
        lastChecked: new Date(),
        error: err.message,
      };
      this.logger.error(`Connector ${sourceType} search failed: ${err.message}`);
      return [];  // ★ 返回空数组，不抛异常——不影响其他源
    }
  }

  // 查询连接器状态
  has(sourceType: DataSourceType): boolean {
    return this.connectors.has(sourceType);
  }

  getHealth(sourceType: DataSourceType): ConnectorHealth | null {
    return this.connectors.get(sourceType)?.health ?? null;
  }

  listRegistered(): DataSourceType[] {
    return Array.from(this.connectors.keys());
  }

  // 周期性健康检查
  private async runHealthChecks(): Promise<void> {
    for (const [sourceType, reg] of this.connectors) {
      if (!reg.connector.healthCheck) continue;

      try {
        reg.health = await reg.connector.healthCheck();
      } catch (err) {
        reg.health = {
          healthy: false,
          latency: 0,
          lastChecked: new Date(),
          error: err.message,
        };
      }
    }
  }
}
```

## 连接器实现示例

```typescript
// 学术文献连接器
@Injectable()
export class SemanticScholarConnector implements IDataSourceConnector {
  readonly sourceType = DataSourceType.ACADEMIC;
  readonly name = "Semantic Scholar";

  private readonly baseUrl = "https://api.semanticscholar.org/graph/v1";

  async search(
    query: string,
    maxResults: number,
    options?: ConnectorOptions,
  ): Promise<DataSourceResult[]> {
    const response = await fetch(
      `${this.baseUrl}/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}`,
      { signal: options?.signal },
    );
    const data = await response.json();

    return data.data.map((paper: any) => ({
      title: paper.title,
      url: `https://semanticscholar.org/paper/${paper.paperId}`,
      snippet: paper.abstract ?? "",
      publishedAt: paper.year ? new Date(`${paper.year}-01-01`) : undefined,
      source: "Semantic Scholar",
      sourceType: DataSourceType.ACADEMIC,
      metadata: {
        citationCount: paper.citationCount,
        authors: paper.authors?.map((a: any) => a.name),
      },
    }));
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await fetch(`${this.baseUrl}/paper/search?query=test&limit=1`);
      return {
        healthy: true,
        latency: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (err) {
      return {
        healthy: false,
        latency: Date.now() - start,
        lastChecked: new Date(),
        error: err.message,
      };
    }
  }
}
```

## 模块注册

```typescript
// 在 AI App 模块的 onModuleInit 中注册连接器
@Module({
  /* ... */
})
export class YourAppModule implements OnModuleInit {
  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly semanticScholar: SemanticScholarConnector,
    private readonly pubmed: PubMedConnector,
  ) {}

  onModuleInit(): void {
    this.connectorRegistry.register(this.semanticScholar);
    this.connectorRegistry.register(this.pubmed);
    // 新增连接器只需：
    // 1. 实现 IDataSourceConnector
    // 2. 在这里注册
    // 不改框架代码
  }
}
```

## 数据源类型枚举

```typescript
enum DataSourceType {
  WEB = "WEB",
  ACADEMIC = "ACADEMIC",
  GITHUB = "GITHUB",
  HACKERNEWS = "HACKERNEWS",
  SOCIAL = "SOCIAL",
  POLICY = "POLICY",
  FINANCE = "FINANCE",
  WEATHER = "WEATHER",
  LOCAL = "LOCAL", // 本地知识库 (RAG)
  // 扩展：新增类型不影响已有连接器
}
```

## 禁忌

1. **禁止搜索失败抛异常** -- 返回空数组，不影响其他数据源
2. **禁止跳过不健康连接器的检查恢复** -- 周期性健康检查让故障连接器有机会恢复
3. **禁止硬编码 API 密钥** -- 通过环境变量或 SecretsModule 获取
4. **禁止无超时的 API 调用** -- 所有外部请求必须传 AbortSignal 或设 timeout
5. **禁止在连接器中缓存结果** -- 缓存是调用方的责任，连接器只负责获取

{{#if connectorContext}}

## 连接器上下文

{{{connectorContext}}}
{{/if}}
