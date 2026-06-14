/**
 * Capability Guard Service
 * Enforces process-level access control for tools, skills, and data
 */
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { CapabilityCheckResult } from "./capability.types";

// ProcessId 在 ai-harness/lifecycle/manager/process.types 同名定义
// 这里 inline 一份避免 engine → harness 反向 import
type ProcessId = string;

@Injectable()
export class CapabilityGuardService {
  private readonly logger = new Logger(CapabilityGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a process has access to a specific tool
   */
  async checkToolAccess(
    processId: ProcessId,
    toolId: string,
  ): Promise<CapabilityCheckResult> {
    const process = await this.prisma.agentProcess.findUnique({
      where: { id: processId },
      select: { grantedTools: true },
    });

    if (!process) {
      // Process not found in DB (may have been cleaned up) — treat as unrestricted
      return { allowed: true };
    }

    // Empty grantedTools means all tools are allowed (no restrictions)
    if (process.grantedTools.length === 0) {
      return { allowed: true };
    }

    // Check if tool is in the granted list
    if (
      process.grantedTools.includes(toolId) ||
      process.grantedTools.includes("*")
    ) {
      return { allowed: true };
    }

    this.logger.warn(`Process ${processId} denied access to tool ${toolId}`);
    return { allowed: false, reason: `Tool ${toolId} not in granted tools` };
  }

  /**
   * Check if a process has access to a specific skill
   */
  async checkSkillAccess(
    processId: ProcessId,
    skillId: string,
  ): Promise<CapabilityCheckResult> {
    const process = await this.prisma.agentProcess.findUnique({
      where: { id: processId },
      select: { grantedSkills: true },
    });

    if (!process) {
      return { allowed: false, reason: "Process not found" };
    }

    // Empty grantedSkills means all skills are allowed
    if (process.grantedSkills.length === 0) {
      return { allowed: true };
    }

    if (
      process.grantedSkills.includes(skillId) ||
      process.grantedSkills.includes("*")
    ) {
      return { allowed: true };
    }

    this.logger.warn(`Process ${processId} denied access to skill ${skillId}`);
    return { allowed: false, reason: `Skill ${skillId} not in granted skills` };
  }

  /**
   * Check if a process has access to specific data
   */
  async checkDataAccess(
    processId: ProcessId,
    resourceType: string,
    resourceId: string,
  ): Promise<CapabilityCheckResult> {
    const process = await this.prisma.agentProcess.findUnique({
      where: { id: processId },
      select: { dataScope: true, userId: true },
    });

    if (!process) {
      return { allowed: false, reason: "Process not found" };
    }

    // No data scope restriction
    if (!process.dataScope) {
      return { allowed: true };
    }

    const scope = process.dataScope as Record<string, unknown>;

    // Check resource type restrictions
    const allowedResources = scope[resourceType] as string[] | undefined;
    if (
      allowedResources &&
      !allowedResources.includes(resourceId) &&
      !allowedResources.includes("*")
    ) {
      this.logger.warn(
        `Process ${processId} denied access to ${resourceType}:${resourceId}`,
      );
      return {
        allowed: false,
        reason: `${resourceType}:${resourceId} not in data scope`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get all capabilities for a process
   */
  async getCapabilities(processId: ProcessId) {
    const process = await this.prisma.agentProcess.findUnique({
      where: { id: processId },
      select: { grantedTools: true, grantedSkills: true, dataScope: true },
    });

    if (!process) return null;

    const rawScope = (process.dataScope ?? {}) as Record<string, unknown>;
    return {
      grantedTools: process.grantedTools ?? [],
      grantedSkills: process.grantedSkills ?? [],
      dataScope: {
        allowedTypes: (rawScope.allowedTypes as string[]) ?? [],
        deniedResources: (rawScope.deniedResources as string[]) ?? [],
      },
      meta: (rawScope.meta as Record<string, unknown>) ?? {},
    };
  }
}
