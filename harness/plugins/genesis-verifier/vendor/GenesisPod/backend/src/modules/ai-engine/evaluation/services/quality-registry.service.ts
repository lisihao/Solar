/**
 * Quality Registry Service
 * 质量检查器注册服务 - 管理和发现检查器
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { QualityGateService } from "./quality-gate.service";
import {
  IQualityChecker,
  QualityDimension,
} from "../abstractions/quality-gate.interface";

/**
 * 检查器元数据
 */
export interface CheckerMetadata {
  dimension: QualityDimension;
  name: string;
  description?: string;
  priority?: number;
  dependencies?: QualityDimension[];
}

/**
 * 质量检查器注册服务
 */
@Injectable()
export class QualityRegistryService implements OnModuleInit {
  private readonly logger = new Logger(QualityRegistryService.name);
  private readonly registry = new Map<QualityDimension, CheckerMetadata>();

  constructor(
    // ModuleRef 保留用于将来的自动发现检查器功能
    _moduleRef: ModuleRef,
    private readonly qualityGate: QualityGateService,
  ) {
    // 将来用于自动发现检查器：this.moduleRef = _moduleRef;
  }

  /**
   * 模块初始化时自动注册检查器
   */
  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing quality registry...");
    // 自动发现和注册检查器将在具体实现中完成
  }

  /**
   * 注册检查器
   */
  register(
    checker: IQualityChecker,
    metadata?: Partial<CheckerMetadata>,
  ): void {
    const fullMetadata: CheckerMetadata = {
      dimension: checker.dimension,
      name: checker.name,
      description: checker.description,
      priority: metadata?.priority ?? 0,
      dependencies: metadata?.dependencies ?? [],
    };

    this.registry.set(checker.dimension, fullMetadata);
    this.qualityGate.registerChecker(checker);

    this.logger.log(
      `Registered checker: ${checker.dimension} (${checker.name})`,
    );
  }

  /**
   * 批量注册检查器
   */
  registerBatch(
    checkers: Array<{
      checker: IQualityChecker;
      metadata?: Partial<CheckerMetadata>;
    }>,
  ): void {
    for (const { checker, metadata } of checkers) {
      this.register(checker, metadata);
    }
  }

  /**
   * 注销检查器
   */
  unregister(dimension: QualityDimension): boolean {
    const removed = this.registry.delete(dimension);
    if (removed) {
      this.qualityGate.unregisterChecker(dimension);
      this.logger.log(`Unregistered checker: ${dimension}`);
    }
    return removed;
  }

  /**
   * 获取检查器元数据
   */
  getMetadata(dimension: QualityDimension): CheckerMetadata | undefined {
    return this.registry.get(dimension);
  }

  /**
   * 获取所有注册的检查器
   */
  getAllMetadata(): CheckerMetadata[] {
    return Array.from(this.registry.values());
  }

  /**
   * 按优先级获取检查器
   */
  getByPriority(): CheckerMetadata[] {
    return this.getAllMetadata().sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }

  /**
   * 获取检查器的依赖关系
   */
  getDependencies(dimension: QualityDimension): QualityDimension[] {
    const metadata = this.registry.get(dimension);
    return metadata?.dependencies ?? [];
  }

  /**
   * 检查依赖是否满足
   */
  checkDependencies(dimension: QualityDimension): boolean {
    const dependencies = this.getDependencies(dimension);
    for (const dep of dependencies) {
      if (!this.registry.has(dep)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取注册的检查器数量
   */
  get size(): number {
    return this.registry.size;
  }
}
