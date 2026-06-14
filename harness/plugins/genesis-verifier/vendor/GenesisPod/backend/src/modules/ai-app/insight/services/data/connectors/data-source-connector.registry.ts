/**
 * Data Source Connector Registry
 *
 * P0: 实时数据源接入框架
 * 管理所有数据源连接器的注册、发现和健康检查
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  IDataSourceConnector,
  ConnectorRegistration,
  ConnectorHealthStatus,
} from "../../../types/data-source-connector.types";
import {
  DataSourceType,
  DataSourceResult,
} from "../../../types/data-source.types";

@Injectable()
export class DataSourceConnectorRegistry implements OnModuleInit {
  private readonly logger = new Logger(DataSourceConnectorRegistry.name);
  private readonly connectors = new Map<
    DataSourceType,
    ConnectorRegistration
  >();

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `DataSourceConnectorRegistry initialized with ${this.connectors.size} connectors`,
    );
    // 启动定期健康检查（每 5 分钟，unref 防止测试/进程退出时被阻塞）
    setInterval(() => this.runHealthChecks(), 5 * 60 * 1000).unref();
  }

  /**
   * 注册数据源连接器
   */
  register(connector: IDataSourceConnector): void {
    if (this.connectors.has(connector.sourceType)) {
      this.logger.warn(
        `Overriding existing connector for ${connector.sourceType}`,
      );
    }

    this.connectors.set(connector.sourceType, {
      connector,
      registeredAt: new Date(),
    });

    this.logger.log(
      `Registered connector: ${connector.displayName} (${connector.sourceType})`,
    );
  }

  /**
   * 获取连接器
   */
  get(sourceType: DataSourceType): IDataSourceConnector | undefined {
    return this.connectors.get(sourceType)?.connector;
  }

  /**
   * 检查连接器是否已注册
   */
  has(sourceType: DataSourceType): boolean {
    return this.connectors.has(sourceType);
  }

  /**
   * 通过连接器执行搜索
   */
  async searchViaConnector(
    sourceType: DataSourceType,
    query: string,
    maxResults: number,
    options?: Record<string, unknown>,
  ): Promise<DataSourceResult[]> {
    const registration = this.connectors.get(sourceType);
    if (!registration) {
      this.logger.warn(`No connector registered for ${sourceType}`);
      return [];
    }

    const connector = registration.connector;

    try {
      const isAvailable = await connector.isAvailable();
      if (!isAvailable) {
        this.logger.warn(
          `Connector ${connector.displayName} is not available, skipping`,
        );
        return [];
      }

      return await connector.search(query, maxResults, options);
    } catch (error) {
      this.logger.error(
        `Connector ${connector.displayName} search failed: ${error}`,
      );
      return [];
    }
  }

  /**
   * 获取所有已注册的连接器类型
   */
  getRegisteredTypes(): DataSourceType[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * 获取所有连接器的状态
   */
  async getStatus(): Promise<
    Array<{
      sourceType: DataSourceType;
      displayName: string;
      available: boolean;
      registeredAt: Date;
      lastHealthCheck?: ConnectorHealthStatus;
    }>
  > {
    const statuses = [];
    for (const [sourceType, reg] of this.connectors) {
      let available = false;
      try {
        available = await reg.connector.isAvailable();
      } catch (err) {
        this.logger.warn(
          `[getAvailableConnectors] Connector ${sourceType} availability check failed: ${(err as Error).message}`,
        );
      }

      statuses.push({
        sourceType,
        displayName: reg.connector.displayName,
        available,
        registeredAt: reg.registeredAt,
        lastHealthCheck: reg.lastHealthCheck,
      });
    }
    return statuses;
  }

  /**
   * 运行所有连接器健康检查
   */
  private async runHealthChecks(): Promise<void> {
    for (const [sourceType, reg] of this.connectors) {
      try {
        const status = await reg.connector.healthCheck();
        reg.lastHealthCheck = status;

        if (!status.available) {
          this.logger.warn(
            `Connector ${sourceType} health check failed: ${status.error}`,
          );
        }
      } catch (error) {
        reg.lastHealthCheck = {
          available: false,
          lastChecked: new Date(),
          error: String(error),
        };
      }
    }
  }

  /**
   * 获取连接器数量
   */
  getCount(): number {
    return this.connectors.size;
  }
}
