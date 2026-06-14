import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  ContentVisibility,
  Prisma,
  SimulationRunStatus,
  SimulationScenario,
  SimulationTeam,
} from "@prisma/client";
import { AiSimulationEngineService } from "./ai-simulation.engine";
import { BillingContext } from "../../platform/facade";

export interface CreateScenarioInput {
  name: string;
  industry: string;
  region?: string;
  goals?: Prisma.InputJsonValue;
  constraints?: Prisma.InputJsonValue;
  dataSources?: Prisma.InputJsonValue;
  createdById?: string;
  companies?: Array<{
    name: string;
    type?: string;
    market?: string;
    metrics?: Prisma.InputJsonValue;
    publicData?: Prisma.InputJsonValue;
    privateData?: Prisma.InputJsonValue;
  }>;
  agents?: Array<{
    companyName?: string;
    team: SimulationTeam;
    role: string;
    persona?: Prisma.InputJsonValue;
    memoryPublic?: Prisma.InputJsonValue;
    memoryPrivate?: Prisma.InputJsonValue;
    tools?: Prisma.InputJsonValue;
  }>;
}

export interface StartRunInput {
  scenarioId: string;
  rounds?: number;
  params?: Prisma.InputJsonValue;
  startedById?: string;
}

// 视角类型定义
export type ViewPerspective = "GOD" | "BLUE" | "RED" | "GREEN" | "WHITE";

// 提交数据的视角过滤
export interface Submission {
  team?: string;
  role?: string;
  publicAction?: string;
  innerMonologue?: string;
  irrational?: boolean;
  chaosInjected?: boolean;
  tools?: unknown;
  agentId?: string;
  companyId?: string;
  visibility?: string;
  timestamp?: string;
}

/**
 * 根据视角过滤提交数据
 * - 上帝视角：可查看所有信息
 * - 阵营视角：本阵营可查看完整信息，其他阵营只能看公开信息（publicAction）
 */
function filterSubmissionByPerspective(
  submission: Submission,
  perspective: ViewPerspective,
): Submission {
  const submissionTeam = submission.team?.toUpperCase();
  const canViewFull = perspective === "GOD" || submissionTeam === perspective;

  if (canViewFull) {
    return submission;
  }

  // 非本方阵营：只返回公开信息
  return {
    team: submission.team,
    role: submission.role,
    publicAction: submission.publicAction, // 公开行动始终可见
    agentId: submission.agentId,
    companyId: submission.companyId,
    visibility: submission.visibility,
    timestamp: submission.timestamp,
    // 私密信息隐藏
    innerMonologue: undefined,
    tools: undefined,
    irrational: undefined,
    chaosInjected: undefined,
  };
}

@Injectable()
export class AiSimulationService {
  private readonly logger = new Logger(AiSimulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AiSimulationEngineService,
  ) {}

  async createScenario(input: CreateScenarioInput) {
    const companies = input.companies || [];
    const agents = input.agents || [];

    const scenario = await this.prisma.simulationScenario.create({
      data: {
        name: input.name,
        industry: input.industry,
        region: input.region,
        goals: input.goals,
        constraints: input.constraints,
        dataSources: input.dataSources,
        createdById: input.createdById,
        companies: {
          create: companies.map((c) => ({
            name: c.name,
            type: c.type,
            market: c.market,
            metrics: c.metrics,
            publicData: c.publicData,
            privateData: c.privateData,
          })),
        },
      },
      include: {
        companies: true,
      },
    });

    // attach agents after companies created (resolve companyId by name if provided)
    if (agents.length > 0) {
      const companyMap = new Map(
        scenario.companies.map((c) => [c.name.toLowerCase(), c.id]),
      );
      await this.prisma.simulationAgent.createMany({
        data: agents.map((a) => ({
          scenarioId: scenario.id,
          companyId: a.companyName
            ? companyMap.get(a.companyName.toLowerCase()) || null
            : null,
          team: a.team,
          role: a.role,
          persona: a.persona,
          memoryPublic: a.memoryPublic,
          memoryPrivate: a.memoryPrivate,
          tools: a.tools,
        })),
      });
    }

    return this.getScenarioById(scenario.id);
  }

  async getScenarioById(id: string) {
    const scenario = await this.prisma.simulationScenario.findUnique({
      where: { id },
      include: {
        companies: true,
        agents: {
          include: {
            company: true, // Include company relation for each agent
          },
        },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 5, // Include last 5 runs for history
        },
      },
    });
    if (!scenario) {
      throw new NotFoundException(`Scenario ${id} not found`);
    }
    return scenario;
  }

  async deleteScenario(id: string) {
    const scenario = await this.prisma.simulationScenario.findUnique({
      where: { id },
    });
    if (!scenario) {
      throw new NotFoundException(`Scenario ${id} not found`);
    }

    // Delete related records first (cascading delete)
    await this.prisma.simulationAgent.deleteMany({
      where: { scenarioId: id },
    });
    await this.prisma.simulationCompany.deleteMany({
      where: { scenarioId: id },
    });

    // Delete the scenario
    await this.prisma.simulationScenario.delete({
      where: { id },
    });

    return { success: true, message: "Scenario deleted successfully" };
  }

  /** 多租户可见性切换（仅创建者）。createdById 为 nullable，需非空才可比对。 */
  async updateVisibility(
    userId: string,
    scenarioId: string,
    visibility: ContentVisibility,
  ): Promise<SimulationScenario> {
    const scenario = await this.prisma.simulationScenario.findUnique({
      where: { id: scenarioId },
    });
    if (!scenario) throw new NotFoundException("Scenario not found");
    if (!scenario.createdById || scenario.createdById !== userId) {
      throw new ForbiddenException("Not owner");
    }
    return this.prisma.simulationScenario.update({
      where: { id: scenarioId },
      data: { visibility },
    });
  }

  async updateScenario(id: string, input: Partial<CreateScenarioInput>) {
    this.logger.log(`[updateScenario] Updating scenario ${id}`);
    this.logger.log(
      `[updateScenario] Input agents count: ${input.agents?.length || 0}`,
    );
    if (input.agents) {
      this.logger.log(
        `[updateScenario] Input agents: ${JSON.stringify(input.agents.map((a) => ({ role: a.role, team: a.team, companyName: a.companyName, hasPersona: !!a.persona })))}`,
      );
    }

    const existing = await this.prisma.simulationScenario.findUnique({
      where: { id },
      include: { companies: true, agents: true },
    });
    if (!existing) {
      throw new NotFoundException(`Scenario ${id} not found`);
    }

    // Update basic scenario fields
    await this.prisma.simulationScenario.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        industry: input.industry ?? existing.industry,
        region: input.region ?? existing.region,
        goals: (input.goals ?? existing.goals) as
          | Prisma.InputJsonValue
          | undefined,
        constraints: (input.constraints ?? existing.constraints) as
          | Prisma.InputJsonValue
          | undefined,
        dataSources: (input.dataSources ?? existing.dataSources) as
          | Prisma.InputJsonValue
          | undefined,
      },
    });

    // If companies are provided, replace them all
    if (input.companies) {
      // Delete existing companies first
      await this.prisma.simulationCompany.deleteMany({
        where: { scenarioId: id },
      });
      // Create new companies
      if (input.companies.length > 0) {
        await this.prisma.simulationCompany.createMany({
          data: input.companies.map((c) => ({
            scenarioId: id,
            name: c.name,
            type: c.type,
            market: c.market,
            metrics: c.metrics,
            publicData: c.publicData,
            privateData: c.privateData,
          })),
        });
      }
    }

    // If agents are provided, replace them all
    if (input.agents) {
      // First delete existing agents
      await this.prisma.simulationAgent.deleteMany({
        where: { scenarioId: id },
      });

      // Get updated companies to map names to IDs
      const updatedCompanies = await this.prisma.simulationCompany.findMany({
        where: { scenarioId: id },
      });
      const companyMap = new Map(
        updatedCompanies.map((c) => [c.name.toLowerCase(), c.id]),
      );

      this.logger.log(
        `[updateScenario] Companies in scenario: ${updatedCompanies.map((c) => c.name).join(", ")}`,
      );
      this.logger.log(
        `[updateScenario] Agent companyNames: ${input.agents.map((a) => a.companyName || "none").join(", ")}`,
      );

      // Create new agents
      if (input.agents.length > 0) {
        const agentsToCreate = input.agents.map((a) => {
          const companyId = a.companyName
            ? companyMap.get(a.companyName.toLowerCase()) || null
            : null;
          this.logger.log(
            `[updateScenario] Agent ${a.role}: companyName="${a.companyName}", matched companyId=${companyId}`,
          );
          return {
            scenarioId: id,
            companyId,
            team: a.team,
            role: a.role,
            persona: a.persona,
            memoryPublic: a.memoryPublic,
            memoryPrivate: a.memoryPrivate,
            tools: a.tools,
          };
        });

        await this.prisma.simulationAgent.createMany({
          data: agentsToCreate,
        });
      }
    }

    return this.getScenarioById(id);
  }

  async listScenarios() {
    return this.prisma.simulationScenario.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        companies: true,
        agents: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  async startRun(input: StartRunInput) {
    const scenario = await this.getScenarioById(input.scenarioId);

    const rounds = input.rounds ?? 2;
    const run = await this.prisma.simulationRun.create({
      data: {
        scenarioId: scenario.id,
        status: SimulationRunStatus.RUNNING,
        params: input.params,
        rounds,
        startedById: input.startedById,
      },
    });

    // 立即返回run ID，后台异步执行推演
    // 前端通过轮询 /runs/:id 获取进度更新
    // 不使用 await，让推演在后台运行
    const billingData = {
      userId: input.startedById || "",
      moduleType: "ai-simulation",
      operationType: "run",
      referenceId: scenario.id,
      description: `AI 模拟推演 - ${scenario.name} (${rounds}轮)`,
    };
    BillingContext.run(billingData, () => this.engine.executeRun(run.id)).catch(
      (err) => {
        this.logger.error(`[Simulation] Run ${run.id} failed: ${err.message}`);
        // 更新状态为失败
        this.prisma.simulationRun
          .update({
            where: { id: run.id },
            data: { status: SimulationRunStatus.FAILED },
          })
          .catch((err) => {
            this.logger.error(
              `Failed to update simulation run status: ${err?.message}`,
            );
          });
      },
    );

    // 立即返回，让前端可以导航到run页面
    return this.getRunById(run.id);
  }

  async resumeRun(runId: string) {
    const run = await this.getRunById(runId);
    if (run.status !== SimulationRunStatus.PAUSED) {
      return run;
    }
    await this.prisma.simulationRun.update({
      where: { id: runId },
      data: { status: SimulationRunStatus.RUNNING },
    });

    // 后台异步执行推演，不阻塞（包装在 BillingContext 中）
    const billingData = {
      userId: run.startedById || "",
      moduleType: "ai-simulation",
      operationType: "run",
      referenceId: run.scenarioId,
      description: `AI 模拟推演续行 - Run ${runId}`,
    };
    BillingContext.run(billingData, () =>
      this.engine.executeRun(runId, { resume: true }),
    ).catch((err) => {
      this.logger.error(
        `[Simulation] Run ${runId} resume failed: ${err.message}`,
      );
      this.prisma.simulationRun
        .update({
          where: { id: runId },
          data: { status: SimulationRunStatus.FAILED },
        })
        .catch((err) => {
          this.logger.error(
            `Failed to update simulation run status: ${err?.message}`,
          );
        });
    });

    return this.getRunById(runId);
  }

  async pauseRun(runId: string) {
    const run = await this.getRunById(runId);
    if (run.status !== SimulationRunStatus.RUNNING) {
      return run;
    }
    await this.prisma.simulationRun.update({
      where: { id: runId },
      data: { status: SimulationRunStatus.PAUSED },
    });
    return this.getRunById(runId);
  }

  async interveneRun(
    runId: string,
    intervention: { message: string; injectEvent?: Record<string, unknown> },
  ) {
    const run = await this.getRunById(runId);

    const interventionRecord = {
      timestamp: new Date().toISOString(),
      message: intervention.message,
      injectEvent: intervention.injectEvent,
      round: run.currentRound,
    };

    // Store intervention in run params
    const updatedParams = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column cast; runtime shape is untyped
      ...(run.params as Record<string, any> | null),
      interventions: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column cast; runtime shape is untyped
        ...((run.params as Record<string, any> | null)?.interventions || []),
        interventionRecord,
      ],
    };

    // Also store in worldState for frontend display
    const updatedWorldState = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column cast; runtime shape is untyped
      ...(run.worldState as Record<string, any> | null),
      interventions: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column cast; runtime shape is untyped
        ...((run.worldState as Record<string, any> | null)?.interventions ||
          []),
        interventionRecord,
      ],
      lastIntervention: interventionRecord,
    };

    await this.prisma.simulationRun.update({
      where: { id: runId },
      data: {
        params: updatedParams as Prisma.InputJsonValue,
        worldState: updatedWorldState as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `[Simulation] Run ${runId} received intervention at round ${run.currentRound}: ${intervention.message.substring(0, 50)}...`,
    );

    return this.getRunById(runId);
  }

  async getRunById(id: string, perspective?: ViewPerspective) {
    const run = await this.prisma.simulationRun.findUnique({
      where: { id },
      include: {
        scenario: {
          include: { companies: true, agents: true },
        },
        turns: true,
      },
    });
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }

    // 如果指定了视角且不是上帝视角，则过滤私密信息
    if (perspective && perspective !== "GOD") {
      return {
        ...run,
        turns: run.turns.map((turn) => {
          // turns 中的 submissions 是 JSON 存储的
          const submissions = turn.submissions as Submission[] | null;
          if (!submissions) return turn;

          return {
            ...turn,
            submissions: submissions.map((sub) =>
              filterSubmissionByPerspective(sub, perspective),
            ),
          };
        }),
      };
    }

    return run;
  }

  async deleteRun(id: string) {
    const run = await this.prisma.simulationRun.findUnique({
      where: { id },
    });
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }

    // Delete related turns first
    await this.prisma.simulationTurn.deleteMany({
      where: { runId: id },
    });

    // Delete the run
    await this.prisma.simulationRun.delete({
      where: { id },
    });

    this.logger.log(`[Simulation] Deleted run ${id}`);
    return { success: true, message: "Run deleted successfully" };
  }
}
