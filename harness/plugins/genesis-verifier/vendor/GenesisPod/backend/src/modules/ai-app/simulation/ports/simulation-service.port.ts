/**
 * Simulation domain service port.
 *
 * This port belongs to the simulation app domain. It must not live in
 * ai-engine or ai-harness facades because it represents simulation-specific
 * application semantics rather than reusable engine capability.
 */
export interface ISimulationService {
  createScenario(
    userId: string,
    name: string,
    description: string,
    config?: Record<string, unknown>,
  ): Promise<{
    id: string;
    name: string;
    description: string;
  }>;

  executeSimulationRound?(
    scenarioId: string,
    roundNumber: number,
    actions: Array<{
      team: string;
      action: string;
      reasoning?: string;
    }>,
  ): Promise<{
    roundNumber: number;
    results: unknown;
  }>;

  getSimulationResults?(scenarioId: string): Promise<{
    scenarioId: string;
    rounds: unknown[];
    summary?: string;
  }>;
}

export const SIMULATION_SERVICE_TOKEN = Symbol("SIMULATION_SERVICE");
