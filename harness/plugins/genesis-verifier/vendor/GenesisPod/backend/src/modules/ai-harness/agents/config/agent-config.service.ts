import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

interface CacheEntry {
  data: Awaited<ReturnType<PrismaService["agentConfig"]["findUnique"]>>;
  timestamp: number;
}

@Injectable()
export class AgentConfigService {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly configCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters?: { domain?: string; enabled?: boolean }) {
    const where: Record<string, unknown> = {};
    if (filters?.domain) where.domain = filters.domain;
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    return this.prisma.agentConfig.findMany({
      where,
      orderBy: [{ domain: "asc" }, { name: "asc" }],
    });
  }

  async findOne(id: string) {
    const config = await this.prisma.agentConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`AgentConfig ${id} not found`);
    return config;
  }

  async findByAgentId(agentId: string) {
    return this.prisma.agentConfig.findUnique({ where: { agentId } });
  }

  async create(data: {
    agentId: string;
    name: string;
    description?: string;
    agentType: string;
    domain: string;
    systemPrompt: string;
    tools?: string[];
    skills?: string[];
    modelType?: string;
    taskProfile?: Prisma.InputJsonValue;
    enabled?: boolean;
  }) {
    return this.prisma.agentConfig.create({
      data: {
        agentId: data.agentId,
        name: data.name,
        description: data.description,
        agentType: data.agentType,
        domain: data.domain,
        systemPrompt: data.systemPrompt,
        tools: data.tools ?? [],
        skills: data.skills ?? [],
        modelType: data.modelType,
        taskProfile: data.taskProfile,
        enabled: data.enabled ?? true,
        isBuiltIn: false,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      systemPrompt: string;
      tools: string[];
      skills: string[];
      modelType: string;
      taskProfile: Prisma.InputJsonValue;
      enabled: boolean;
    }>,
  ) {
    const existing = await this.findOne(id); // throws if not found
    const result = await this.prisma.agentConfig.update({
      where: { id },
      data: data as Prisma.AgentConfigUpdateInput,
    });
    this.invalidateCache(existing.agentId);
    return result;
  }

  async delete(id: string) {
    const config = await this.findOne(id);
    if (config.isBuiltIn) {
      throw new BadRequestException(
        "Cannot delete built-in agent configuration",
      );
    }
    const result = await this.prisma.agentConfig.delete({ where: { id } });
    this.invalidateCache(config.agentId);
    return result;
  }

  async getEffectiveConfig(agentId: string) {
    const cached = this.configCache.get(agentId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const dbConfig = await this.findByAgentId(agentId);
    this.configCache.set(agentId, { data: dbConfig, timestamp: Date.now() });

    if (dbConfig) return dbConfig;
    return null; // Caller should fallback to code-registered config
  }

  invalidateCache(agentId: string): void {
    this.configCache.delete(agentId);
  }

  async seedDefaults(
    agents: Array<{
      agentId: string;
      name: string;
      description?: string;
      agentType: string;
      domain: string;
      systemPrompt: string;
      tools?: string[];
      skills?: string[];
    }>,
  ) {
    let created = 0;
    for (const agent of agents) {
      const existing = await this.findByAgentId(agent.agentId);
      if (!existing) {
        await this.prisma.agentConfig.create({
          data: {
            ...agent,
            tools: agent.tools ?? [],
            skills: agent.skills ?? [],
            isBuiltIn: true,
          },
        });
        created++;
      }
    }
    this.logger.log(`Seeded ${created} default agent configs`);
    return created;
  }
}
