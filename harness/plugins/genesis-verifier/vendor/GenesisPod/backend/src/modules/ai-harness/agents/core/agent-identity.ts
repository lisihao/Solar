/**
 * AgentIdentity — IAgentIdentity 的轻量实现 + builder 辅助
 */

import type {
  IAgentIdentity,
  IAgentRole,
  IAgentPersona,
  IAgentGoal,
  IAgentConstraints,
  SkillRef,
  ToolRef,
} from "../abstractions";

const DEFAULT_CONSTRAINTS: IAgentConstraints = {
  maxTokens: 50_000,
  maxIterations: 20,
  maxWallTimeMs: 10 * 60_000,
  safetyLevel: "standard",
};

/** 不可变 AgentIdentity */
export class AgentIdentity implements IAgentIdentity {
  readonly role: IAgentRole;
  readonly persona?: IAgentPersona;
  readonly goal?: IAgentGoal;
  readonly constraints: IAgentConstraints;
  readonly skills: readonly SkillRef[];
  readonly tools: readonly ToolRef[];
  readonly forbiddenTools: readonly ToolRef[];

  constructor(spec: IAgentIdentity) {
    this.role = spec.role;
    this.persona = spec.persona;
    this.goal = spec.goal;
    this.constraints = { ...DEFAULT_CONSTRAINTS, ...spec.constraints };
    this.skills = spec.skills ?? [];
    this.tools = spec.tools ?? [];
    this.forbiddenTools = spec.forbiddenTools ?? [];
  }

  /** Builder：快捷创建 */
  static of(
    role: IAgentRole,
    extras: Partial<IAgentIdentity> = {},
  ): AgentIdentity {
    return new AgentIdentity({ role, ...extras });
  }

  /** 生成默认 system prompt（基于 identity） */
  toSystemPrompt(): string {
    const lines: string[] = [];
    lines.push(`# Role\n${this.role.name}`);
    if (this.role.description) {
      lines.push(`\n${this.role.description}`);
    }
    if (this.persona) {
      lines.push(
        `\n# Persona\n- Tone: ${this.persona.tone ?? "neutral"}` +
          (this.persona.style ? `\n- Style: ${this.persona.style}` : ""),
      );
    }
    if (this.goal) {
      lines.push(`\n# Goal\n${this.goal.summary}`);
      if (this.goal.successCriteria?.length) {
        lines.push(
          `\n## Success Criteria\n${this.goal.successCriteria
            .map((c) => `- ${c}`)
            .join("\n")}`,
        );
      }
    }
    return lines.join("\n");
  }
}
